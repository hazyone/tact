import { Writer } from "@/utils/Writer";
import {
    Cell,
    type ABIArgument,
    type ABIType,
    type ContractABI,
} from "@ton/core";
import {
    writeArgumentToStack,
    writeDictParser,
    writeGetParser,
    writeGetterTupleParser,
    writeInitSerializer,
    writeParser,
    writeSerializer,
    writeStruct,
    writeTupleParser,
    writeTupleSerializer,
} from "@/bindings/typescript/writeStruct";
import type { AllocationCell } from "@/storage/operation";
import { throwInternalCompilerError } from "@/error/errors";
import { topologicalSort } from "@/utils/utils";
import { allocate, getAllocationOperationFromField } from "@/storage/allocator";
import { serializers } from "@/bindings/typescript/serializers";

import { eqNames } from "@/ast/ast-helpers";
import { enabledOptimizedChildCode } from "@/config/features";
import type { CompilerContext } from "@/context/context";
import type { TypeDescription } from "@/types/types";
import { pascalCase } from "@/utils/change-case/pascal-case";

function writeArguments(args: ABIArgument[]) {
    const res: string[] = [];
    outer: for (const f of args) {
        for (const s of serializers) {
            const v = s.abiMatcher(f.type);
            if (v) {
                res.push(`${f.name}: ${s.tsType(v)}`);
                continue outer;
            }
        }
        throwInternalCompilerError(
            `Unsupported type: ${JSON.stringify(f.type)}`,
        );
    }

    return res;
}

export type WrappersConstantDescription = {
    readonly name: string;
    readonly value: string | undefined;
    readonly fromContract: boolean;
};

export function writeTypescript(
    abi: ContractABI,
    ctx: CompilerContext,
    constants: readonly WrappersConstantDescription[],
    contract: undefined | TypeDescription,
    init?: {
        code: string;
        system: string | null;
        args: ABIArgument[];
        prefix?:
            | {
                  value: number;
                  bits: number;
              }
            | undefined;
    },
) {
    const w = new Writer();

    w.write(`
        import {
            Cell,
            Slice,
            Address,
            Builder,
            beginCell,
            ComputeError,
            TupleItem,
            TupleReader,
            Dictionary,
            contractAddress,
            address,
            ContractProvider,
            Sender,
            Contract,
            ContractABI,
            ABIType,
            ABIGetter,
            ABIReceiver,
            TupleBuilder,
            DictionaryValue
        } from '@ton/core';
    `);
    w.append();

    const allocations: Record<
        string,
        {
            size: { bits: number; refs: number };
            root: AllocationCell;
        }
    > = {};

    // Structs
    if (abi.types) {
        // Allocations
        const refs = (src: ABIType) => {
            const res: ABIType[] = [];
            const t: Set<string> = new Set();
            for (const f of src.fields) {
                const r = f.type;
                if (r.kind === "simple") {
                    const e = abi.types!.find((v) => eqNames(v.name, r.type));
                    if (e) {
                        if (!t.has(r.type)) {
                            t.add(r.type);
                            res.push(e);
                        }
                    }
                }
            }
            return res;
        };
        const sortedTypes = topologicalSort(abi.types, refs);
        for (const f of sortedTypes) {
            const ops = f.fields.map((v) => ({
                name: v.name,
                type: v.type,
                op: getAllocationOperationFromField(
                    v.type,
                    (s) => allocations[s]!.size,
                ),
            }));
            const headerBits = f.header ? 32 : 0;
            const allocation = allocate({
                reserved: { bits: headerBits, refs: 0 },
                ops,
            });
            allocations[f.name] = {
                size: {
                    bits: allocation.size.bits + headerBits,
                    refs: allocation.size.refs,
                },
                root: allocation,
            };
        }

        for (const s of abi.types) {
            writeStruct(s.name, s.fields, true, w);
            writeSerializer(s, allocations[s.name]!.root, w);
            writeParser(s, allocations[s.name]!.root, w);
            writeTupleParser(s, w);
            writeGetterTupleParser(s, w);
            writeTupleSerializer(s, w);
            writeDictParser(s, w);
        }
    }

    // Init
    if (init) {
        // Write serializer
        const argTypeName = (abi.name ?? "Contract") + "_init_args";
        const ops = init.args.map((v) => ({
            name: v.name,
            type: v.type,
            op: getAllocationOperationFromField(
                v.type,
                (s) => allocations[s]!.size,
            ),
        }));
        const allocation = allocate({
            reserved: { bits: init.prefix ? init.prefix.bits : 0, refs: 1 },
            ops,
        });
        writeStruct(argTypeName, init.args, false, w);
        writeInitSerializer(argTypeName, allocation, w);

        // Write init function
        w.append(
            `async function ${abi.name}_init(${writeArguments(init.args).join(", ")}) {`,
        );
        w.inIndent(() => {
            // Code references
            const code = Cell.fromBase64(init.code).toBoc().toString("hex");
            w.append(`const __code = Cell.fromHex('${code}');`);
            w.append("const builder = beginCell();");

            if (init.system !== null && !enabledOptimizedChildCode(ctx)) {
                const system = Cell.fromBase64(init.system)
                    .toBoc()
                    .toString("hex");
                w.append(`const __system = Cell.fromHex('${system}');`);
                w.append(`builder.storeRef(__system);`);
            }

            if (init.prefix) {
                w.append(
                    `builder.storeUint(${init.prefix.value}, ${init.prefix.bits});`,
                );
            }
            w.append(
                `init${argTypeName}({ ${[`$$type: '${argTypeName}'`, ...init.args.map((v) => v.name)].join(", ")} })(builder);`,
            );
            w.append(`const __data = builder.endCell();`);
            w.append(`return { code: __code, data: __data };`);
        });
        w.append(`}`);
        w.append();
    }

    // Errors
    w.append(`export const ${abi.name}_errors = {`);
    w.inIndent(() => {
        if (abi.errors) {
            Object.entries(abi.errors).forEach(([k, abiError]) => {
                w.append(
                    `${k}: { message: ${JSON.stringify(abiError.message)} },`,
                );
            });
        }
    });
    w.append(`} as const`);
    w.append();

    // Errors (backward)
    w.append(`export const ${abi.name}_errors_backward = {`);
    w.inIndent(() => {
        if (abi.errors) {
            Object.entries(abi.errors).forEach(([k, abiError]) => {
                w.append(`${JSON.stringify(abiError.message)}: ${k},`);
            });
        }
    });
    w.append(`} as const`);
    w.append();

    // Types
    w.append(`const ${abi.name}_types: ABIType[] = [`);
    w.inIndent(() => {
        if (abi.types) {
            for (const t of abi.types) {
                w.append(JSON.stringify(t) + ",");
            }
        }
    });
    w.append(`]`);
    w.append();

    // Opcodes
    w.append(`const ${abi.name}_opcodes = {`);
    w.inIndent(() => {
        if (abi.types) {
            for (const t of abi.types) {
                if (typeof t.header === "number") {
                    w.append(`${JSON.stringify(t.name)}: ${t.header},`);
                }
            }
        }
    });
    w.append(`}`);
    w.append();

    const getterNames: Map<string, string> = new Map();

    // Getters
    w.append(`const ${abi.name}_getters: ABIGetter[] = [`);
    w.inIndent(() => {
        if (abi.getters) {
            for (const t of abi.getters) {
                w.append(JSON.stringify(t) + ",");

                let getterName = pascalCase(t.name);
                if (Array.from(getterNames.values()).includes(getterName)) {
                    getterName = t.name;
                }
                getterNames.set(t.name, getterName);
            }
        }
    });
    w.append(`]`);
    w.append();

    // Getter mapping
    w.append(
        `export const ${abi.name}_getterMapping: { [key: string]: string } = {`,
    );
    w.inIndent(() => {
        if (abi.getters) {
            for (const t of abi.getters) {
                w.append(`'${t.name}': 'get${getterNames.get(t.name)}',`);
            }
        }
    });
    w.append(`}`);
    w.append();

    // Receivers
    w.append(`const ${abi.name}_receivers: ABIReceiver[] = [`);
    w.inIndent(() => {
        if (abi.receivers) {
            for (const t of abi.receivers) {
                w.append(JSON.stringify(t) + ",");
            }
        }
    });
    w.append(`]`);
    w.append();

    for (const constant of constants) {
        if (typeof constant.value === "undefined" || constant.fromContract) {
            continue;
        }
        w.append(`export const ${constant.name} = ${constant.value};`);
    }

    if (constants.length > 0) {
        w.append();
    }

    // Wrapper
    w.append(`export class ${abi.name} implements Contract {`);
    w.inIndent(() => {
        w.append();

        const addedContractConstants: Set<string> = new Set();
        for (const constant of constants) {
            if (
                typeof constant.value === "undefined" ||
                !constant.fromContract ||
                addedContractConstants.has(constant.name)
            ) {
                continue;
            }
            w.append(
                `public static readonly ${constant.name} = ${constant.value};`,
            );

            addedContractConstants.add(constant.name);
        }

        w.append(
            `public static readonly errors = ${abi.name}_errors_backward;`,
        );
        w.append(`public static readonly opcodes = ${abi.name}_opcodes;`);

        if (constants.length > 0) {
            w.append();
        }

        if (init) {
            w.append(
                `static async init(${writeArguments(init.args).join(", ")}) {`,
            );
            w.inIndent(() => {
                w.append(
                    `return await ${abi.name}_init(${init!.args.map((v) => v.name).join(", ")});`,
                );
            });
            w.append(`}`);
            w.append();

            w.append(
                `static async fromInit(${writeArguments(init.args).join(", ")}) {`,
            );
            w.inIndent(() => {
                w.append(
                    `const __gen_init = await ${abi.name}_init(${init!.args.map((v) => v.name).join(", ")});`,
                );
                w.append(`const address = contractAddress(0, __gen_init);`);
                w.append(`return new ${abi.name}(address, __gen_init);`);
            });
            w.append(`}`);
            w.append();
        }

        w.append(`static fromAddress(address: Address) {`);
        w.inIndent(() => {
            w.append(`return new ${abi.name}(address);`);
        });
        w.append(`}`);
        w.append();

        w.append(`readonly address: Address; `);
        w.append(`readonly init?: { code: Cell, data: Cell };`);
        w.append(`readonly abi: ContractABI = {`);
        w.inIndent(() => {
            w.append(`types:  ${abi.name}_types,`);
            w.append(`getters: ${abi.name}_getters,`);
            w.append(`receivers: ${abi.name}_receivers,`);
            w.append(`errors: ${abi.name}_errors,`);
        });
        w.append(`};`);
        w.append();
        w.append(
            `constructor(address: Address, init?: { code: Cell, data: Cell }) {`,
        );
        w.inIndent(() => {
            w.append("this.address = address;");
            w.append("this.init = init;");
        });
        w.append("}");
        w.append();

        // Internal receivers
        if (
            abi.receivers &&
            abi.receivers.filter((v) => v.receiver === "internal").length > 0
        ) {
            // Types
            const receivers: string[] = [];
            for (const r of abi.receivers) {
                if (r.receiver !== "internal") {
                    continue;
                }
                switch (r.message.kind) {
                    case "empty":
                        {
                            receivers.push(`null`);
                        }
                        break;
                    case "typed":
                        {
                            receivers.push(r.message.type);
                        }
                        break;
                    case "text":
                        {
                            if (
                                r.message.text !== null &&
                                r.message.text !== undefined
                            ) {
                                receivers.push(JSON.stringify(r.message.text));
                            } else {
                                receivers.push(`string`);
                            }
                        }
                        break;
                    case "any":
                        {
                            receivers.push(`Slice`);
                        }
                        break;
                }
            }

            // Receiver function
            w.append(
                `async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: ${receivers.join(" | ")}) {`,
            );
            w.inIndent(() => {
                w.append();

                // Parse message
                w.append(`let body: Cell | null = null;`);
                for (const r of abi.receivers!) {
                    if (r.receiver !== "internal") {
                        continue;
                    }
                    const msg = r.message;
                    switch (msg.kind) {
                        case "typed":
                            {
                                w.append(
                                    `if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === '${msg.type}') {`,
                                );
                                w.inIndent(() => {
                                    w.append(
                                        `body = beginCell().store(store${msg.type}(message)).endCell();`,
                                    );
                                });
                                w.append(`}`);
                            }
                            break;
                        case "empty":
                            {
                                w.append(`if (message === null) {`);
                                w.inIndent(() => {
                                    w.append(`body = new Cell();`);
                                });
                                w.append(`}`);
                            }
                            break;
                        case "text":
                            {
                                if (
                                    msg.text === null ||
                                    msg.text === undefined
                                ) {
                                    w.append(
                                        `if (typeof message === 'string') {`,
                                    );
                                    w.inIndent(() => {
                                        w.append(
                                            `body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();`,
                                        );
                                    });
                                    w.append(`}`);
                                } else {
                                    w.append(
                                        `if (message === ${JSON.stringify(msg.text)}) {`,
                                    );
                                    w.inIndent(() => {
                                        w.append(
                                            `body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();`,
                                        );
                                    });
                                    w.append(`}`);
                                }
                            }
                            break;
                        case "any": {
                            w.append(
                                `if (message && typeof message === 'object' && message instanceof Slice) {`,
                            );
                            w.inIndent(() => {
                                w.append(`body = message.asCell();`);
                            });
                            w.append(`}`);
                        }
                    }
                }
                w.append(
                    `if (body === null) { throw new Error('Invalid message type'); }`,
                );
                w.append();

                // Send message
                w.append(
                    `await provider.internal(via, { ...args, body: body });`,
                );
                w.append();
            });
            w.append(`}`);
            w.append();
        }

        if (
            abi.receivers &&
            abi.receivers.filter((v) => v.receiver === "external").length > 0
        ) {
            // Types
            const receivers: string[] = [];
            for (const r of abi.receivers) {
                if (r.receiver !== "external") {
                    continue;
                }
                switch (r.message.kind) {
                    case "empty":
                        {
                            receivers.push(`null`);
                        }
                        break;
                    case "typed":
                        {
                            receivers.push(r.message.type);
                        }
                        break;
                    case "text":
                        {
                            if (
                                r.message.text !== null &&
                                r.message.text !== undefined
                            ) {
                                receivers.push(`'${r.message.text}'`);
                            } else {
                                receivers.push(`string`);
                            }
                        }
                        break;
                    case "any":
                        {
                            receivers.push(`Slice`);
                        }
                        break;
                }
            }

            // Receiver function
            w.append(
                `async sendExternal(provider: ContractProvider, message: ${receivers.join(" | ")}) {`,
            );
            w.inIndent(() => {
                w.append();

                // Parse message
                w.append(`let body: Cell | null = null;`);
                for (const r of abi.receivers!) {
                    if (r.receiver !== "external") {
                        continue;
                    }
                    const msg = r.message;
                    switch (msg.kind) {
                        case "typed":
                            {
                                w.append(
                                    `if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === '${msg.type}') {`,
                                );
                                w.inIndent(() => {
                                    w.append(
                                        `body = beginCell().store(store${msg.type}(message)).endCell();`,
                                    );
                                });
                                w.append(`}`);
                            }
                            break;
                        case "empty":
                            {
                                w.append(`if (message === null) {`);
                                w.inIndent(() => {
                                    w.append(`body = new Cell();`);
                                });
                                w.append(`}`);
                            }
                            break;
                        case "text":
                            {
                                if (
                                    msg.text === null ||
                                    msg.text === undefined
                                ) {
                                    w.append(
                                        `if (typeof message === 'string') {`,
                                    );
                                    w.inIndent(() => {
                                        w.append(
                                            `body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();`,
                                        );
                                    });
                                    w.append(`}`);
                                } else {
                                    w.append(
                                        `if (message === '${msg.text}') {`,
                                    );
                                    w.inIndent(() => {
                                        w.append(
                                            `body = beginCell().storeUint(0, 32).storeStringTail(message).endCell();`,
                                        );
                                    });
                                    w.append(`}`);
                                }
                            }
                            break;
                        case "any": {
                            w.append(
                                `if (message && typeof message === 'object' && message instanceof Slice) {`,
                            );
                            w.inIndent(() => {
                                w.append(`body = message.asCell();`);
                            });
                            w.append(`}`);
                        }
                    }
                }
                w.append(
                    `if (body === null) { throw new Error('Invalid message type'); }`,
                );
                w.append();

                // Send message
                w.append(`await provider.external(body);`);
                w.append();
            });
            w.append(`}`);
            w.append();
        }

        // Getters
        if (abi.getters) {
            for (const g of abi.getters) {
                w.append(
                    `async get${getterNames.get(g.name)}(${["provider: ContractProvider", ...writeArguments(g.arguments ?? [])].join(", ")}) {`,
                );
                w.inIndent(() => {
                    w.append(`const builder = new TupleBuilder();`);
                    if (g.arguments) {
                        for (const a of g.arguments) {
                            writeArgumentToStack(a.name, a.type, w);
                        }
                    }

                    const method = contract?.functions.get(g.name);
                    const explicitMethodId = method?.ast.attributes.find(
                        (attr) => attr.type === "get",
                    )?.methodId;

                    // use call by name for getter if no explicit method id is stated
                    // since with Blueprint we get this error:
                    //    Error: Method name must be a string for TonClient provider
                    if (g.methodId && typeof explicitMethodId !== "undefined") {
                        // 'as any' is used because Sandbox contracts's getters can be called
                        // using the function name or the method id number
                        // but the ContractProvider's interface get methods can only
                        // take strings (function names)
                        w.append(
                            `const source = (await provider.get(${g.methodId} as any, builder.build())).stack;`,
                        );
                    } else {
                        w.append(
                            `const source = (await provider.get('${g.name}', builder.build())).stack;`,
                        );
                    }
                    if (g.returnType) {
                        writeGetParser("result", g.returnType, w);
                        w.append(`return result;`);
                    }
                });
                w.append(`}`);
                w.append();
            }
        }
    });
    w.append(`}`);

    return w.end();
}
