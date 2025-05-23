import { toNano } from "@ton/core";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Blockchain } from "@ton/sandbox";
import { Test } from "./output/asm-shuffle-in-comptime_Test";
import "@ton/test-utils";

describe("asm-shuffle-in-comptime", () => {
    let blockchain: Blockchain;
    let treasury: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<Test>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity.print = false;
        treasury = await blockchain.treasury("treasury");

        contract = blockchain.openContract(await Test.fromInit());

        const deployResult = await contract.send(
            treasury.getSender(),
            { value: toNano("0.5") },
            null,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            deploy: true,
        });
    });

    it("should shuffle arguments correctly", async () => {
        expect(await contract.getFoo(10n)).toEqual(20n);
        expect(await contract.getFoo(100n)).toEqual(100n);
        expect(await contract.getBar()).toEqual(0n);
    });
});
