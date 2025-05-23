import { toNano } from "@ton/core";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Blockchain } from "@ton/sandbox";
import { Test } from "./output/bounceable_Test";
import "@ton/test-utils";

describe("Context.bounceable", () => {
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
            { value: toNano("10") },
            null,
        );
        expect(deployResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            deploy: true,
        });
    });

    it("should set to true for bounce message", async () => {
        await contract.send(
            treasury.getSender(),
            { value: toNano("10"), bounce: true },
            "test",
        );

        expect(await contract.getWasBounceable()).toEqual(true);
    });

    it("should set to false for non bounce message", async () => {
        await contract.send(
            treasury.getSender(),
            { value: toNano("10"), bounce: false },
            "test",
        );

        expect(await contract.getWasBounceable()).toEqual(false);
    });
});
