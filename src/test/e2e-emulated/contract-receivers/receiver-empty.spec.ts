import { toNano } from "@ton/core";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Blockchain } from "@ton/sandbox";
import { Test } from "./output/receiver-empty_Test";
import "@ton/test-utils";

describe("receiver-empty", () => {
    let blockchain: Blockchain;
    let treasury: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<Test>;
    const amount = toNano("0.5");

    const checkBalanceIsWithinLimits = async (
        amount: bigint,
        epsilon: bigint,
    ) => {
        const contractBalance = await contract.getBalance();
        expect(contractBalance).toBeGreaterThan(amount - epsilon);
        expect(contractBalance).toBeLessThan(amount);
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity.print = false;
        treasury = await blockchain.treasury("treasury");

        contract = blockchain.openContract(await Test.fromInit());

        const deployResult = await contract.send(
            treasury.getSender(),
            { value: amount },
            null,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            deploy: true,
        });
        await checkBalanceIsWithinLimits(amount, toNano("0.002"));
    });

    it("empty receivers accept sent funds", async () => {
        const sendResult = await contract.send(
            treasury.getSender(),
            { value: amount },
            null,
        );
        expect(sendResult.transactions).toHaveTransaction({
            from: treasury.address,
            to: contract.address,
            success: true,
            deploy: false,
        });
        await checkBalanceIsWithinLimits(2n * amount, toNano("0.003"));
    });
});
