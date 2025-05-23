import { Address, beginCell, Cell, toNano, fromNano } from "@ton/core";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Blockchain } from "@ton/sandbox";
import { IntrinsicsTester } from "./output/intrinsics_IntrinsicsTester";
import "@ton/test-utils";
import { paddedBufferToBits } from "@ton/core/dist/boc/utils/paddedBits";
import { sha256 } from "@/utils/sha256";

describe("intrinsics", () => {
    let blockchain: Blockchain;
    let treasury: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<IntrinsicsTester>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity.print = false;
        treasury = await blockchain.treasury("treasury");

        contract = blockchain.openContract(await IntrinsicsTester.fromInit());

        const deployResult = await contract.send(
            treasury.getSender(),
            { value: toNano("10") },
            "Deploy",
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            deploy: true,
        });
    });

    it("should return correct intrinsic results", async () => {
        // Compile-time constants
        expect(fromNano(await contract.getGetTons()).toString()).toBe(
            "10.1234",
        );
        expect(fromNano(await contract.getGetTons2()).toString()).toBe(
            "10.1234",
        );
        expect(await contract.getGetString()).toBe("Hello world");
        expect(await contract.getGetString2()).toBe("Hello world");
        expect(
            (await contract.getGetAddress()).equals(
                Address.parse(
                    "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
                ),
            ),
        ).toBe(true);
        expect(
            (await contract.getGetAddress2()).equals(
                Address.parse(
                    "EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
                ),
            ),
        ).toBe(true);
        expect(
            (await contract.getGetCell()).equals(
                Cell.fromBase64("te6cckEBAQEADgAAGEhlbGxvIHdvcmxkIXgtxbw="),
            ),
        ).toBe(true);
        expect(
            (await contract.getGetCell2()).equals(
                Cell.fromBase64("te6cckEBAQEADgAAGEhlbGxvIHdvcmxkIXgtxbw="),
            ),
        ).toBe(true);
        expect((await contract.getGetPow()).toString()).toBe("512");
        expect((await contract.getGetPow2()).toString()).toBe("512");

        // Compile-time optimizations
        expect(
            (await contract.getGetComment()).equals(
                beginCell()
                    .storeUint(0, 32)
                    .storeStringTail("Hello world")
                    .endCell(),
            ),
        ).toBe(true);

        // Compile-time send/emit optimizations
        const emitResult = await contract.send(
            treasury.getSender(),
            { value: toNano(1) },
            "emit_1",
        );

        // Verify emitted message
        expect(emitResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            outMessagesCount: 1,
        });
        const outMessage = emitResult.externals[0]!.body.beginParse();
        expect(outMessage.loadUint(32)).toEqual(0);
        expect(outMessage.loadStringTail()).toEqual("Hello world");
        expect(outMessage.remainingBits).toEqual(0);
        expect(outMessage.remainingRefs).toEqual(0);

        // Check `slice`
        expect(
            (await contract.getGetSlice())
                .asCell()
                .equals(
                    Cell.fromBase64("te6cckEBAQEADgAAGEhlbGxvIHdvcmxkIXgtxbw="),
                ),
        ).toBe(true);
        expect(
            (await contract.getGetSlice2())
                .asCell()
                .equals(
                    Cell.fromBase64("te6cckEBAQEADgAAGEhlbGxvIHdvcmxkIXgtxbw="),
                ),
        ).toBe(true);

        // Check `rawSlice`
        expect(
            (await contract.getGetRawSlice())
                .asCell()
                .equals(
                    beginCell()
                        .storeBuffer(Buffer.from("abcdef", "hex"))
                        .endCell(),
                ),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice2())
                .asCell()
                .equals(
                    beginCell()
                        .storeBuffer(Buffer.from("abcdef", "hex"))
                        .endCell(),
                ),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice3()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice4()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice5())
                .asCell()
                .equals(beginCell().storeUint(18, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice6())
                .asCell()
                .equals(beginCell().storeUint(18, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice7()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice8()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice9())
                .asCell()
                .equals(beginCell().storeUint(0, 3).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice10())
                .asCell()
                .equals(beginCell().storeUint(0, 3).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice11()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice12()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice13())
                .asCell()
                .equals(beginCell().storeUint(7, 4).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice14())
                .asCell()
                .equals(beginCell().storeUint(7, 4).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice15()).asCell().equals(
                beginCell()
                    .storeBits(
                        paddedBufferToBits(
                            Buffer.from(
                                "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcf",
                                "hex",
                            ),
                        ),
                    )
                    .endCell(),
            ),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice16()).asCell().equals(
                beginCell()
                    .storeBits(
                        paddedBufferToBits(
                            Buffer.from(
                                "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcf",
                                "hex",
                            ),
                        ),
                    )
                    .endCell(),
            ),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice17())
                .asCell()
                .equals(beginCell().storeUint(0b100010, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice18())
                .asCell()
                .equals(beginCell().storeUint(0b100010, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice19())
                .asCell()
                .equals(beginCell().storeUint(0b100010, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice20())
                .asCell()
                .equals(beginCell().storeUint(0b100010, 6).endCell()),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice21()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice22()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice23()).asCell().equals(Cell.EMPTY),
        ).toBe(true);
        expect(
            (await contract.getGetRawSlice24()).asCell().equals(Cell.EMPTY),
        ).toBe(true);

        // Check `ascii`
        expect((await contract.getGetAscii()).toString()).toBe(
            "126207244316550804821666916",
        );
        expect((await contract.getGetAscii2()).toString()).toBe(
            "126207244316550804821666916",
        );
        expect((await contract.getGetAscii3()).toString()).toBe(
            "1563963554659859369353828835329962428465513941646011501275668087180532385",
        );
        expect((await contract.getGetAscii4()).toString()).toBe(
            "1563963554659859369353828835329962428465513941646011501275668087180532385",
        );
        expect((await contract.getGetAscii5()).toString(16)).toBe(
            "a090d080c225c0be48982c2a9",
        );
        expect((await contract.getGetAscii6()).toString(16)).toBe(
            "a090d080c225c0be48982c2a9",
        );

        // Check `crc32`
        expect((await contract.getGetCrc32()).toString()).toBe("2235694568");
        expect((await contract.getGetCrc32_2()).toString()).toBe("2235694568");
        expect((await contract.getGetCrc32_3()).toString()).toBe("0");
        expect((await contract.getGetCrc32_4()).toString()).toBe("0");
    });

    const checkSha256 = async (input: string) => {
        const expected = sha256(input).value;
        const actual = await contract.getGetHashLongRuntime(input);
        expect(actual.toString(16)).toEqual(expected.toString(16));
    };

    const checkSha256Slice = async (input: string) => {
        const expected = sha256(input).value;
        const actual = await contract.getGetHashLongRuntimeSlice(
            beginCell().storeStringTail(input).asSlice(),
        );
        expect(actual.toString(16)).toEqual(expected.toString(16));
    };

    const generateString = (length: number): string => {
        const chars =
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    };

    it("should calculate sha256 correctly", async () => {
        function sha256Hex(src: string | Buffer) {
            return sha256(src).value;
        }
        expect(await contract.getGetHash()).toBe(sha256Hex("hello world"));
        expect(await contract.getGetHashSlice()).toBe(sha256Hex("hello world"));
        expect(await contract.getGetHash2()).toBe(sha256Hex("hello world"));
        expect(
            await contract.getGetHash3(
                beginCell().storeStringTail("sometest").endCell().asSlice(),
            ),
        ).toBe(sha256Hex("sometest"));
        expect(await contract.getGetHash4("wallet")).toBe(sha256Hex("wallet"));
        const longString =
            "------------------------------------------------------------------------------------------------------------------------------129";
        expect(await contract.getGetHashLongComptime()).toBe(
            sha256Hex(longString),
        );

        await checkSha256("hello world");

        const input256bytes = generateString(256);

        // check various length input for strings and slices
        const s1 = generateString(15);
        await checkSha256(s1);
        await checkSha256Slice(s1);

        const s2 = generateString(127);
        await checkSha256(s2);
        await checkSha256Slice(s2);

        const s3 = generateString(128);
        await checkSha256(s3);
        await checkSha256Slice(s3);

        await checkSha256(input256bytes);
        await checkSha256Slice(input256bytes);

        const s5 = generateString(1024);
        await checkSha256(s5);
        await checkSha256Slice(s5);

        const s6 = generateString(16999);
        await checkSha256(s6);
        await checkSha256Slice(s6);

        // check that we hash all string, not just first 127 bytes
        const first128bytesOf256bytesString = input256bytes.slice(0, 128);
        const first128bytesOf256bytesStringHash =
            await contract.getGetHashLongRuntime(first128bytesOf256bytesString);
        const input256bytesStringHash =
            await contract.getGetHashLongRuntime(input256bytes);

        expect(first128bytesOf256bytesStringHash.toString()).not.toEqual(
            input256bytesStringHash.toString(),
        );

        // check that we hash all slice, not just first 127 bytes
        const first128bytesOf256bytesSliceHash =
            await contract.getGetHashLongRuntimeSlice(
                beginCell()
                    .storeStringTail(first128bytesOf256bytesString)
                    .asSlice(),
            );
        const input256bytesSliceHash =
            await contract.getGetHashLongRuntimeSlice(
                beginCell().storeStringTail(input256bytes).asSlice(),
            );

        expect(first128bytesOf256bytesSliceHash.toString()).not.toEqual(
            input256bytesSliceHash.toString(),
        );

        // NOTE:
        // The SHA256U instruction is used by string_hash() from FunC stdlib,
        // which was previously used by Tact for runtime hashing of String and Slice values.

        // check that SHA256U instruction hashes ONLY first 127 bytes
        const first128bytesOf256bytesSHA256U = await contract.getGetHashSha256U(
            beginCell()
                .storeStringTail(first128bytesOf256bytesString)
                .asSlice(),
        );
        const input256bytesSHA256U = await contract.getGetHashSha256U(
            beginCell().storeStringTail(input256bytes).asSlice(),
        );

        expect(first128bytesOf256bytesSHA256U.toString()).toEqual(
            input256bytesSHA256U.toString(),
        );

        // check that HASHEXT_SHA256 instruction hashes ONLY first 127 bytes
        const first128bytesOf256bytesHASHEXTSHA256 =
            await contract.getGetHashHashextsha256(
                beginCell()
                    .storeStringTail(first128bytesOf256bytesString)
                    .asSlice(),
            );
        const input256bytesHASHEXTSHA256 =
            await contract.getGetHashHashextsha256(
                beginCell().storeStringTail(input256bytes).asSlice(),
            );

        expect(first128bytesOf256bytesHASHEXTSHA256.toString()).toEqual(
            input256bytesHASHEXTSHA256.toString(),
        );
    });
});
