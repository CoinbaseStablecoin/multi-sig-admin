import {
  AdminAdded,
  AdminRemoved,
  AdministrableInstance,
} from "../../@types/generated/Administrable";
import { expectRevert } from "../helpers";
import { ZERO_ADDRESS } from "../helpers/constants";

export function behavesLikeAdministrable(
  getContract: () => Promise<AdministrableInstance>,
  accounts: Truffle.Accounts
): void {
  describe("behaves like a Administrable", () => {
    let administrable: AdministrableInstance;
    let owner: string;

    beforeEach(async () => {
      administrable = await getContract();
      owner = await administrable.owner();
      expect(owner).not.to.equal(accounts[1]);
    });

    describe("addAdmins", () => {
      it("is also an ownable", async () => {
        await administrable.transferOwnership(accounts[1], { from: owner });
        expect(await administrable.owner()).to.equal(accounts[1]);
      });

      it("allows owner to add new admins", async () => {
        expect(await administrable.isAdmin(accounts[1])).to.equal(false);
        expect(await administrable.isAdmin(accounts[2])).to.equal(false);
        expect(await administrable.getAdmins()).to.eql([]);

        const result = await administrable.addAdmins(
          [accounts[1], accounts[2]],
          { from: owner }
        );

        expect(await administrable.isAdmin(accounts[1])).to.equal(true);
        expect(await administrable.isAdmin(accounts[2])).to.equal(true);
        expect(await administrable.getAdmins()).to.eql([
          accounts[1],
          accounts[2],
        ]);

        // check that AdminAdded event is emitted
        const log0 = result.logs[0] as Truffle.TransactionLog<AdminAdded>;
        expect(log0.event).to.equal("AdminAdded");
        expect(log0.args[0]).to.equal(accounts[1]);
        const log1 = result.logs[1] as Truffle.TransactionLog<AdminAdded>;
        expect(log1.event).to.equal("AdminAdded");
        expect(log1.args[0]).to.equal(accounts[2]);
      });

      it("does not allow a non-owner to add new admins", async () => {
        await expectRevert(
          administrable.addAdmins([accounts[1]], { from: accounts[1] }),
          "caller is not the owner"
        );
      });

      it("does not allow a zero address to be an admin", async () => {
        await expectRevert(
          administrable.addAdmins([ZERO_ADDRESS], { from: owner }),
          "given account is the zero address"
        );
      });

      it("does not allow adding an existing admin again", async () => {
        await administrable.addAdmins([accounts[1]], { from: owner });

        await expectRevert(
          administrable.addAdmins([accounts[1]], { from: owner }),
          "given account is already an admin"
        );
      });
    });

    describe("removeAdmins", () => {
      it("lets the owner remove existing admins", async () => {
        await administrable.addAdmins([accounts[1], accounts[2], accounts[3]], {
          from: owner,
        });

        const result = await administrable.removeAdmins(
          [accounts[1], accounts[3]],
          { from: owner }
        );

        expect(await administrable.isAdmin(accounts[1])).to.equal(false);
        expect(await administrable.isAdmin(accounts[2])).to.equal(true);
        expect(await administrable.isAdmin(accounts[3])).to.equal(false);
        expect(await administrable.getAdmins()).to.eql([accounts[2]]);

        // check that AdminRemoved event is emitted
        const log0 = result.logs[0] as Truffle.TransactionLog<AdminRemoved>;
        expect(log0.event).to.equal("AdminRemoved");
        expect(log0.args[0]).to.equal(accounts[1]);
        const log1 = result.logs[1] as Truffle.TransactionLog<AdminRemoved>;
        expect(log1.event).to.equal("AdminRemoved");
        expect(log1.args[0]).to.equal(accounts[3]);
      });

      it("does not allow a non-owner to remove existing admins", async () => {
        await administrable.addAdmins([accounts[1], accounts[2]], {
          from: owner,
        });

        await expectRevert(
          administrable.removeAdmins([accounts[2]], { from: accounts[1] }),
          "caller is not the owner"
        );
      });

      it("does not allow a non-existent admin to be removed", async () => {
        await administrable.addAdmins([accounts[1], accounts[2]], {
          from: owner,
        });

        await expectRevert(
          administrable.removeAdmins([accounts[3]], { from: owner }),
          "given account is not an admin"
        );
      });
    });

    describe("renounceOwnership", () => {
      it("is disabled, reverts regardless of the caller", async () => {
        await expectRevert(
          administrable.renounceOwnership({ from: owner }),
          "ownership cannot be renounced"
        );

        await expectRevert(
          administrable.renounceOwnership({ from: accounts[1] }),
          "caller is not the owner"
        );
      });
    });
  });
}
