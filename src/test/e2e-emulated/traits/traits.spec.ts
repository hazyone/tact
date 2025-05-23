import { toNano } from "@ton/core";
import type { SandboxContract, TreasuryContract } from "@ton/sandbox";
import { Blockchain } from "@ton/sandbox";
import { LaikaContract } from "./output/traits_LaikaContract";
import "@ton/test-utils";

describe("traits", () => {
    let blockchain: Blockchain;
    let treasury: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<LaikaContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity.print = false;
        treasury = await blockchain.treasury("treasury");

        contract = blockchain.openContract(await LaikaContract.fromInit());

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

    it("should implement traits correctly", async () => {
        // Check the contract's behavior after deployment
        expect(await contract.getSay()).toBe("I am a Laika and I say Woof");
    });

    it("should override constant correctly", async () => {
        // Check the contract's behavior after deployment
        expect(await contract.getFooConstant()).toBe(100n);
    });
});
