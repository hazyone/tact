import type { ABIField } from "@ton/core";
import type { CompilerContext } from "@/context/context";
import { idToHex } from "@/utils/idToHex";
import {
    idTextErr,
    throwConstEvalError,
    throwInternalCompilerError,
} from "@/error/errors";
import { getType, getAllTypes } from "@/types/resolveDescriptors";
import type {
    BinaryReceiverSelector,
    CommentReceiverSelector,
    ReceiverDescription,
    TypeDescription,
} from "@/types/types";
import { throwCompilationError } from "@/error/errors";
import type * as Ast from "@/ast/ast";
import type { FactoryAst } from "@/ast/ast-helpers";
import { commentPseudoOpcode } from "@/generator/writers/writeRouter";
import { dummySrcInfo } from "@/grammar";
import { ensureInt } from "@/optimizer/interpreter";
import { evalConstantExpression } from "@/optimizer/constEval";
import { getAstUtil } from "@/ast/util";
import { sha256, highest32ofSha256 } from "@/utils/sha256";
import { snakeCase } from "@/utils/change-case/snake-case";

export function resolveSignatures(ctx: CompilerContext, Ast: FactoryAst) {
    const util = getAstUtil(Ast);

    const signatures: Map<
        string,
        { signature: string; tlb: string; id: Ast.Number | null }
    > = new Map();
    function createTypeFormat(
        type: string,
        format: string | number | boolean | null,
    ) {
        if (type === "int") {
            if (typeof format === "number") {
                return `int${format}`;
            } else if (format === "varint16" || format === "varint32") {
                return format;
            } else if (format !== null) {
                throwInternalCompilerError(`Unsupported int format: ${format}`);
            }
            return `int`;
        } else if (type === "uint") {
            if (typeof format === "number") {
                return `uint${format}`;
            } else if (format === "coins") {
                return `coins`;
            } else if (format === "varuint16" || format === "varuint32") {
                return format;
            } else if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported uint format: ${format}`,
                );
            }
            return `uint`;
        } else if (type === "bool") {
            if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported bool format: ${format}`,
                );
            }
            return "bool";
        } else if (type === "address") {
            if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported address format: ${format}`,
                );
            }
            return "address";
        } else if (type === "cell") {
            if (format === "remainder") {
                return "remainder<cell>";
            } else if (format === "ref") {
                return "^cell";
            }
            if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported cell format: ${format}`,
                );
            }
            return "^cell";
        } else if (type === "slice") {
            if (format === "remainder") {
                return "remainder<slice>";
            } else if (format === "ref") {
                return "^slice";
            } else if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported slice format: ${format}`,
                );
            }
            return "^slice";
        } else if (type === "builder") {
            if (format === "remainder") {
                return "remainder<builder>";
            } else if (format === "ref") {
                return "^slice";
            } else if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported builder format: ${format}`,
                );
            }
            return "^builder";
        } else if (type === "string") {
            if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported builder format: ${format}`,
                );
            }
            return "^string";
        } else if (type === "fixed-bytes") {
            if (typeof format === "number") {
                return `fixed_bytes${format}`;
            } else if (format !== null) {
                throwInternalCompilerError(
                    `Unsupported fixed-bytes format: ${format}`,
                );
            }
            throwInternalCompilerError("Missing fixed-bytes format");
        }

        // Struct types
        const t = getType(ctx, type);
        if (t.kind !== "struct") {
            throwInternalCompilerError(`Unsupported type: ${type}`);
        }
        const s = createTupleSignature(type);
        if (format === "ref") {
            return `^${s.signature}`;
        } else if (format !== null) {
            throwInternalCompilerError(`Unsupported struct format: ${format}`);
        }
        return s.signature;
    }

    function createTLBField(src: ABIField) {
        switch (src.type.kind) {
            case "simple": {
                let base = createTypeFormat(
                    src.type.type,
                    src.type.format ?? null,
                );
                if (src.type.optional && base !== "address") {
                    base = "Maybe " + base;
                }
                return src.name + ":" + base;
            }
            case "dict": {
                if (src.type.format !== null && src.type.format !== undefined) {
                    throwInternalCompilerError(
                        `Unsupported map format: ${src.type.format}`,
                    );
                }
                if (src.type.keyFormat === "coins") {
                    throwCompilationError(
                        `Unsupported format ${src.type.keyFormat} for map key`,
                    );
                }
                const key = createTypeFormat(
                    src.type.key,
                    src.type.keyFormat ?? null,
                );
                const value = createTypeFormat(
                    src.type.value,
                    src.type.valueFormat ?? null,
                );
                return src.name + ":dict<" + key + ", " + value + ">";
            }
        }
    }

    function createTupleSignature(name: string): {
        signature: string;
        tlb: string;
        id: Ast.Number | null;
    } {
        if (signatures.has(name)) {
            return signatures.get(name)!;
        }
        const t = getType(ctx, name);
        if (t.kind !== "struct" && t.kind !== "contract") {
            throwInternalCompilerError(`Unsupported type: ${name}`);
        }

        for (const field of t.fields) {
            const type = field.type;
            if (type.kind !== "ref") {
                continue;
            }

            const t = getType(ctx, type.name);
            if (t.kind === "contract") {
                throwCompilationError(
                    `Fields with a contract type are not supported yet`,
                    field.loc,
                );
            }
            if (t.kind === "trait") {
                throwCompilationError(
                    `Fields with a trait type are not supported`,
                    field.loc,
                );
            }
        }

        // Check for no "as remaining" in the middle of the struct or contract
        for (const field of t.fields.slice(0, -1)) {
            if (field.as === "remaining") {
                const kind =
                    t.ast.kind === "message_decl"
                        ? "message"
                        : t.ast.kind === "contract"
                          ? "contract"
                          : "struct";
                throwCompilationError(
                    `The "as remaining" field can only be the last field of the ${kind}`,
                    field.loc,
                );
            }
        }

        for (const field of t.fields) {
            if (field.as === "remaining") {
                const type = field.type;
                if (type.kind === "ref" && type.optional) {
                    throwCompilationError(
                        `The "as remaining" field cannot have optional type`,
                        field.ast.type.loc,
                    );
                }
            }
        }

        const fields = t.fields.map((v) => createTLBField(v.abi));

        // Calculate signature and method id
        const signature = name + "{" + fields.join(",") + "}";
        let id: Ast.Number | null = null;
        if (t.ast.kind === "message_decl") {
            if (t.ast.opcode !== undefined) {
                // Currently, message opcode expressions do not get typechecked, so
                // ```
                // message(true ? 42 : false) TypeError { }
                // ```
                // WILL NOT result in error
                const opCode = ensureInt(
                    evalConstantExpression(t.ast.opcode, ctx, util),
                ).value;
                if (opCode === 0n) {
                    throwConstEvalError(
                        `Opcode of message ${idTextErr(t.ast.name)} is zero: those are reserved for text comments and cannot be used for message structs`,
                        true,
                        t.ast.opcode.loc,
                    );
                }
                if (opCode < 0) {
                    throwConstEvalError(
                        `Opcode of message ${idTextErr(t.ast.name)} is negative ('${opCode}') which is not allowed`,
                        true,
                        t.ast.opcode.loc,
                    );
                }
                if (opCode > 0xffff_ffff) {
                    throwConstEvalError(
                        `Opcode of message ${idTextErr(t.ast.name)} is too large ('${opCode}'): it must fit into 32 bits`,
                        true,
                        t.ast.opcode.loc,
                    );
                }
                id =
                    t.ast.opcode.kind === "number"
                        ? t.ast.opcode
                        : {
                              kind: "number",
                              base: 10,
                              value: opCode,
                              id: 0,
                              loc: dummySrcInfo,
                          };
            } else {
                id = newMessageOpcode(signature);
                if (id.value === 0n) {
                    throwCompilationError(
                        `Auto-generated opcode for message "${idTextErr(t.ast.name)}" is zero which is reserved for text comments.\nTry changing names of the message type or its fields to get a non-zero opcode.\nOr consider specifying the opcode explicitly.`,
                        t.ast.loc,
                    );
                }
            }
        }

        // Calculate TLB
        const tlbHeader =
            id !== null
                ? `${snakeCase(name)}#${idToHex(Number(id.value))}`
                : "_";
        const tlb = tlbHeader + " " + fields.join(" ") + " = " + name;

        signatures.set(name, { signature, id, tlb });
        return { signature, id, tlb };
    }

    getAllTypes(ctx).forEach((t) => {
        if (t.kind === "struct" || t.kind === "contract") {
            const r = createTupleSignature(t.name);
            t.tlb = r.tlb;
            t.signature = r.signature;
            t.header = r.id;
        }
    });

    checkAggregateTypes(ctx);

    return ctx;
}

function newMessageOpcode(signature: string): Ast.Number {
    return {
        kind: "number",
        base: 10,
        value: highest32ofSha256(sha256(signature)),
        id: 0,
        loc: dummySrcInfo,
    };
}

type messageType = string;
type binOpcode = number;

function checkBinaryMessageReceiver(
    rcv: BinaryReceiverSelector,
    rcvAst: Ast.Receiver,
    usedOpcodes: Map<binOpcode, messageType>,
    ctx: CompilerContext,
) {
    const msgType = getType(ctx, rcv.type);
    const opcode = msgType.header!;
    if (usedOpcodes.has(Number(opcode.value))) {
        throwCompilationError(
            `Receive functions of a contract or trait cannot process messages with the same opcode: opcodes of message types "${rcv.type}" and "${usedOpcodes.get(Number(opcode.value))}" are equal`,
            rcvAst.loc,
        );
    } else {
        usedOpcodes.set(Number(opcode.value), rcv.type);
    }
}

type commentOpcode = string;

// "opcode" clashes are highly unlikely in this case, of course
function checkCommentMessageReceiver(
    rcv: CommentReceiverSelector,
    rcvAst: Ast.Receiver,
    usedOpcodes: Map<commentOpcode, messageType>,
) {
    const opcode1 = commentPseudoOpcode(rcv.comment, true, rcvAst.loc);
    const opcode2 = commentPseudoOpcode(rcv.comment, false, rcvAst.loc);
    if (usedOpcodes.has(opcode1) || usedOpcodes.has(opcode2)) {
        throwCompilationError(
            `Receive functions of a contract or trait cannot process comments with the same hashes: hashes of comment strings "${rcv.comment}" and "${usedOpcodes.get(opcode1)}" are equal`,
            rcvAst.loc,
        );
    } else {
        usedOpcodes.set(opcode1, rcv.comment);
        usedOpcodes.set(opcode2, rcv.comment);
    }
}

function checkMessageOpcodesUniqueInContractOrTrait(
    receivers: ReceiverDescription[],
    ctx: CompilerContext,
) {
    const binBouncedRcvUsedOpcodes: Map<binOpcode, messageType> = new Map();
    const binExternalRcvUsedOpcodes: Map<binOpcode, messageType> = new Map();
    const binInternalRcvUsedOpcodes: Map<binOpcode, messageType> = new Map();

    const commentExternalRcvUsedOpcodes: Map<commentOpcode, messageType> =
        new Map();
    const commentInternalRcvUsedOpcodes: Map<commentOpcode, messageType> =
        new Map();

    for (const rcv of receivers) {
        switch (rcv.selector.kind) {
            case "internal-binary":
                checkBinaryMessageReceiver(
                    rcv.selector,
                    rcv.ast,
                    binInternalRcvUsedOpcodes,
                    ctx,
                );
                break;
            case "bounce-binary":
                checkBinaryMessageReceiver(
                    rcv.selector,
                    rcv.ast,
                    binBouncedRcvUsedOpcodes,
                    ctx,
                );
                break;
            case "external-binary":
                checkBinaryMessageReceiver(
                    rcv.selector,
                    rcv.ast,
                    binExternalRcvUsedOpcodes,
                    ctx,
                );
                break;
            case "internal-comment":
                checkCommentMessageReceiver(
                    rcv.selector,
                    rcv.ast,
                    commentInternalRcvUsedOpcodes,
                );
                break;
            case "external-comment":
                checkCommentMessageReceiver(
                    rcv.selector,
                    rcv.ast,
                    commentExternalRcvUsedOpcodes,
                );
                break;
            default:
                break;
        }
    }
}

function checkAggregateTypes(ctx: CompilerContext) {
    getAllTypes(ctx).forEach((aggregate) => {
        switch (aggregate.kind) {
            case "contract":
                checkMessageOpcodesUniqueInContractOrTrait(
                    aggregate.receivers,
                    ctx,
                );
                checkContractFields(aggregate);
                break;
            case "trait":
                checkMessageOpcodesUniqueInContractOrTrait(
                    aggregate.receivers,
                    ctx,
                );
                break;
            default:
                break;
        }
    });
}

function checkContractFields(t: TypeDescription) {
    // Check if "as remaining" is only used for the last field of contract
    for (const field of t.fields.slice(0, -1)) {
        if (field.as === "remaining") {
            throwCompilationError(
                `The "as remaining" field can only be the last field of the contract`,
                field.ast.loc,
            );
        }
    }
}
