import {
  MultiSigAdminInstance,
  TestTargetInstance,
  AdministrableInstance,
} from "../@types/generated";
import {
  AllEvents,
  ConfigurationChanged,
  ConfigurationRemoved,
  ProposalCreated,
  ProposalClosed,
  ProposalApprovalSubmitted,
  ProposalExecuted,
  ProposalApprovalRescinded,
} from "../@types/generated/MultiSigAdmin";
import { TransactionRawLog } from "../@types/TransactionRawLog";
import { expectRevert, bytes32FromAddress } from "./helpers";
import { ZERO_ADDRESS } from "./helpers/constants";
import { behavesLikeAdministrable } from "./util/Administrable.behavior";

const MultiSigAdmin = artifacts.require("MultiSigAdmin");
const TestTarget = artifacts.require("TestTarget");

enum ProposalState {
  NotExist = 0,
  Open,
  OpenAndExecutable,
  Closed,
  Executed,
}

contract("MultiSigAdmin", (accounts) => {
  const [owner, admin1, admin2, approver1, approver2, approver3] = accounts;
  let msa: MultiSigAdminInstance;
  let target1: TestTargetInstance;
  let target2: TestTargetInstance;

  beforeEach(async () => {
    msa = await MultiSigAdmin.new({ from: owner });
    await msa.addAdmins([admin1, admin2]);

    target1 = await TestTarget.new({ from: owner });
    target2 = await TestTarget.new({ from: owner });
    await target1.transferOwnership(msa.address);
    await target2.transferOwnership(msa.address);
  });

  behavesLikeAdministrable(
    () => MultiSigAdmin.new({ from: owner }) as Promise<AdministrableInstance>,
    accounts
  );

  it("initially sets the owner to be the deployer", async () => {
    expect(await msa.owner()).to.equal(owner);
  });

  const [setFoo, setBar, revertWithError, revertWithoutError] = [
    "setFoo(string)",
    "setBar(uint256)",
    "revertWithError(string)",
    "revertWithoutError()",
  ].map(web3.eth.abi.encodeFunctionSignature);

  const configure = async () => {
    return [
      await msa.configure(
        target1.address,
        setFoo,
        3, // minApprovals
        20, // maxOpenProposals (per approver)
        [approver1, approver2, approver3],
        { from: admin1 }
      ),
      await msa.configure(
        target1.address,
        setBar,
        2,
        10,
        [approver1, approver2, approver3],
        { from: admin1 }
      ),
      await msa.configure(
        target2.address,
        setFoo,
        2,
        3,
        [approver1, approver2],
        { from: admin2 }
      ),
      await msa.configure(
        target2.address,
        setBar,
        1,
        2,
        [approver1, approver2],
        { from: admin2 }
      ),
      await msa.configure(target1.address, revertWithError, 1, 1, [approver1], {
        from: admin1,
      }),
      await msa.configure(
        target1.address,
        revertWithoutError,
        1,
        1,
        [approver1],
        { from: admin1 }
      ),
    ];
  };

  const proposeAndGetId = async (
    targetContract: string,
    selector: string,
    argumentData: [string[], (string | number)[]] | null,
    from: string
  ): Promise<[number, Truffle.TransactionResponse<AllEvents>]> => {
    const res = await msa.propose(
      targetContract,
      selector,
      argumentData
        ? web3.eth.abi.encodeParameters(argumentData[0], argumentData[1])
        : "0x",
      { from }
    );
    const log = res.logs[0] as Truffle.TransactionLog<ProposalCreated>;
    return [log.args[0].toNumber(), res];
  };

  describe("configure", () => {
    it("allows admins to configure contract calls", async () => {
      const [res1, res2, res3, res4] = await configure();

      // Check that ConfigurationChanged events are emitted
      const log1 = res1.logs[0] as Truffle.TransactionLog<ConfigurationChanged>;
      expect(log1.event).to.equal("ConfigurationChanged");
      expect(log1.args[0]).to.equal(target1.address);
      expect(log1.args[1]).to.equal(setFoo.padEnd(66, "0"));
      expect(log1.args[2]).to.equal(admin1);

      const log2 = res2.logs[0] as Truffle.TransactionLog<ConfigurationChanged>;
      expect(log2.event).to.equal("ConfigurationChanged");
      expect(log2.args[0]).to.equal(target1.address);
      expect(log2.args[1]).to.equal(setBar.padEnd(66, "0"));
      expect(log2.args[2]).to.equal(admin1);

      const log3 = res3.logs[0] as Truffle.TransactionLog<ConfigurationChanged>;
      expect(log3.event).to.equal("ConfigurationChanged");
      expect(log3.args[0]).to.equal(target2.address);
      expect(log3.args[1]).to.equal(setFoo.padEnd(66, "0"));
      expect(log3.args[2]).to.equal(admin2);

      const log4 = res4.logs[0] as Truffle.TransactionLog<ConfigurationChanged>;
      expect(log4.event).to.equal("ConfigurationChanged");
      expect(log4.args[0]).to.equal(target2.address);
      expect(log4.args[1]).to.equal(setBar.padEnd(66, "0"));
      expect(log4.args[2]).to.equal(admin2);

      // Check that minApprovals are set
      expect(
        (await msa.getMinApprovals(target1.address, setFoo)).toNumber()
      ).to.equal(3);
      expect(
        (await msa.getMinApprovals(target1.address, setBar)).toNumber()
      ).to.equal(2);
      expect(
        (await msa.getMinApprovals(target2.address, setFoo)).toNumber()
      ).to.equal(2);
      expect(
        (await msa.getMinApprovals(target2.address, setBar)).toNumber()
      ).to.equal(1);

      // Check that the approver sets are updated
      expect(await msa.getApprovers(target1.address, setFoo)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);
      expect(await msa.getApprovers(target1.address, setFoo)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);
      expect(await msa.getApprovers(target2.address, setBar)).to.eql([
        approver1,
        approver2,
      ]);
      expect(await msa.getApprovers(target2.address, setBar)).to.eql([
        approver1,
        approver2,
      ]);
    });

    it("allows admins to update an existing configuration", async () => {
      await msa.configure(
        target1.address,
        setFoo,
        2,
        3,
        [approver1, approver2, approver3],
        { from: admin1 }
      );

      // Create some proposals
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      const [proposal2Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );

      const res = await msa.configure(
        target1.address,
        setFoo,
        1,
        5,
        [approver1],
        { from: admin2 }
      );

      // Check that ProposalClosed and ConfigurationChanged events are emitted
      const log1 = res.logs[0] as Truffle.TransactionLog<ProposalClosed>;
      expect(log1.event).to.equal("ProposalClosed");
      expect(log1.args[0].toNumber()).to.equal(proposal1Id);
      expect(log1.args[1]).to.equal(admin2);

      const log2 = res.logs[1] as Truffle.TransactionLog<ProposalClosed>;
      expect(log2.event).to.equal("ProposalClosed");
      expect(log2.args[0].toNumber()).to.equal(proposal2Id);
      expect(log2.args[1]).to.equal(admin2);

      const log3 = res.logs[2] as Truffle.TransactionLog<ConfigurationChanged>;
      expect(log3.event).to.equal("ConfigurationChanged");
      expect(log3.args[0]).to.equal(target1.address);
      expect(log3.args[1]).to.equal(setFoo.padEnd(66, "0"));
      expect(log3.args[2]).to.equal(admin2);

      // Check that the configuration is updated
      expect(
        (await msa.getMinApprovals(target1.address, setFoo)).toNumber()
      ).to.equal(1);
      expect(
        (await msa.getMaxOpenProposals(target1.address, setFoo)).toNumber()
      ).to.equal(5);
      expect(await msa.getApprovers(target1.address, setFoo)).to.eql([
        approver1,
      ]);

      // Check that the existing open proposals are closed
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
    });

    it("reverts if any of the affected open proposals is executable when updating an existing configuration", async () => {
      await msa.configure(
        target1.address,
        setFoo,
        2,
        3,
        [approver1, approver2, approver3],
        { from: admin1 }
      );

      // Create some proposals
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );

      // Approve proposal 1
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.approve(proposal1Id, { from: approver2 });
      await msa.approve(proposal1Id, { from: approver3 });

      // Check that the function reverts when closeExecutable is false
      await expectRevert(
        msa.configure(target1.address, setFoo, 1, 5, [approver1], {
          from: admin2,
        }),
        "an executable proposal exists"
      );
    });

    it("does not allow the minimum number of approvals to be set to zero", async () => {
      await expectRevert(
        msa.configure(target1.address, setFoo, 0, 1, [approver1], {
          from: admin1,
        }),
        "minApprovals is zero"
      );
    });

    it("does not allow the number of approvers to be fewer than the minimum number of approvals needed", async () => {
      await expectRevert(
        msa.configure(target1.address, setFoo, 2, 1, [approver1], {
          from: admin1,
        }),
        "approvers fewer than minApprovals"
      );

      // duplicated approvers
      await expectRevert(
        msa.configure(target1.address, setFoo, 2, 1, [approver1, approver1], {
          from: admin1,
        }),
        "approvers fewer than minApprovals"
      );
    });

    it("does not allow the maximum number of open proposals per approver to be set to zero", async () => {
      await expectRevert(
        msa.configure(target1.address, setFoo, 1, 0, [approver1], {
          from: admin1,
        }),
        "maxOpenProposals is zero"
      );
    });

    it("does not allow the target contract to be the zero address", async () => {
      await expectRevert(
        msa.configure(ZERO_ADDRESS, setFoo, 1, 1, [approver1], {
          from: admin1,
        }),
        "targetContract is the zero address"
      );
    });

    it("does not allow accounts that are not admins to configure", async () => {
      await expectRevert(
        msa.configure(
          target1.address,
          setFoo,
          3,
          1,
          [approver1, approver2, approver3],
          { from: approver1 }
        ),
        "caller is not an admin"
      );

      await expectRevert(
        msa.configure(target1.address, setBar, 1, 1, [approver2], {
          from: approver2,
        }),
        "caller is not an admin"
      );
    });
  });

  describe("removeConfiguration", () => {
    let proposal1Id: number;
    let proposal2Id: number;

    beforeEach(async () => {
      await configure();

      [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["such amaze"]],
        approver1
      );
      [proposal2Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["much wow"]],
        approver1
      );
    });

    it("allows admins to remove existing configurations", async () => {
      const res1 = await msa.removeConfiguration(
        target1.address,
        setFoo,
        false,
        { from: admin2 }
      );
      const res2 = await msa.removeConfiguration(
        target2.address,
        setBar,
        false,
        { from: admin1 }
      );

      // Check that ProposalClosed events are emitted
      const log1_1 = res1.logs[0] as Truffle.TransactionLog<ProposalClosed>;
      expect(log1_1.event).to.equal("ProposalClosed");
      expect(log1_1.args[0].toNumber()).to.equal(proposal1Id);
      expect(log1_1.args[1]).to.equal(admin2);

      const log1_2 = res1.logs[1] as Truffle.TransactionLog<ProposalClosed>;
      expect(log1_2.event).to.equal("ProposalClosed");
      expect(log1_2.args[0].toNumber()).to.equal(proposal2Id);
      expect(log1_2.args[1]).to.equal(admin2);

      // Check that ConfigurationRemoved events are emitted
      const log1_3 = res1.logs[2] as Truffle.TransactionLog<
        ConfigurationRemoved
      >;
      expect(log1_3.event).to.equal("ConfigurationRemoved");
      expect(log1_3.args[0]).to.equal(target1.address);
      expect(log1_3.args[1]).to.equal(setFoo.padEnd(66, "0"));
      expect(log1_3.args[2]).to.equal(admin2);

      const log2 = res2.logs[0] as Truffle.TransactionLog<ConfigurationRemoved>;
      expect(log2.event).to.equal("ConfigurationRemoved");
      expect(log2.args[0]).to.equal(target2.address);
      expect(log2.args[1]).to.equal(setBar.padEnd(66, "0"));
      expect(log2.args[2]).to.equal(admin1);

      // Check that configurations are removed
      expect(
        (await msa.getMinApprovals(target1.address, setFoo)).toNumber()
      ).to.equal(0);
      expect(await msa.getApprovers(target1.address, setFoo)).to.eql([]);
      expect(
        (await msa.getMinApprovals(target2.address, setBar)).toNumber()
      ).to.equal(0);
      expect(await msa.getApprovers(target2.address, setBar)).to.eql([]);

      // Check that all existing open proposals are closed
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
    });

    it("reverts if any of the affected open proposals is executable unless closeExecutable argument is true", async () => {
      // Approve proposal 1
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.approve(proposal1Id, { from: approver2 });
      await msa.approve(proposal1Id, { from: approver3 });

      // Check that the function reverts when closeExecutable is false
      await expectRevert(
        msa.removeConfiguration(target1.address, setFoo, false, {
          from: admin2,
        }),
        "an executable proposal exists"
      );

      // Check that the function does not revert when closeExecutable is true
      const res = await msa.removeConfiguration(target1.address, setFoo, true, {
        from: admin2,
      });

      // Check that ProposalClosed events are emitted
      const log1 = res.logs[0] as Truffle.TransactionLog<ProposalClosed>;
      expect(log1.event).to.equal("ProposalClosed");
      expect(log1.args[0].toNumber()).to.equal(proposal1Id);
      expect(log1.args[1]).to.equal(admin2);

      const log2 = res.logs[1] as Truffle.TransactionLog<ProposalClosed>;
      expect(log2.event).to.equal("ProposalClosed");
      expect(log2.args[0].toNumber()).to.equal(proposal2Id);
      expect(log2.args[1]).to.equal(admin2);

      // Check that ConfigurationRemoved events are emitted
      const log3 = res.logs[2] as Truffle.TransactionLog<ConfigurationRemoved>;
      expect(log3.event).to.equal("ConfigurationRemoved");
      expect(log3.args[0]).to.equal(target1.address);
      expect(log3.args[1]).to.equal(setFoo.padEnd(66, "0"));
      expect(log3.args[2]).to.equal(admin2);
    });

    it("does not allow admins to remove a configuration that does not exist", async () => {
      await msa.removeConfiguration(target1.address, setFoo, false, {
        from: admin1,
      });

      await expectRevert(
        msa.removeConfiguration(target1.address, setFoo, false, {
          from: admin1,
        }),
        "configuration does not exist"
      );
    });

    it("does not allow accounts that are not admins to remove a configuration", async () => {
      await expectRevert(
        msa.removeConfiguration(target1.address, setFoo, false, {
          from: approver1,
        }),
        "caller is not an admin"
      );

      await expectRevert(
        msa.removeConfiguration(target1.address, setBar, false, {
          from: approver2,
        }),
        "caller is not an admin"
      );
    });
  });

  describe("propose", () => {
    beforeEach(configure);

    it("allows approvers to create proposals", async () => {
      const [proposalId, res] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["such amaze"]],
        approver3
      );

      // Check that a ProposalCreated event is emitted
      const log = res.logs[0] as Truffle.TransactionLog<ProposalCreated>;
      expect(log.event).to.equal("ProposalCreated");
      expect(log.args[0].toNumber()).to.equal(proposalId);
      expect(log.args[1]).to.equal(approver3);

      expect(
        (await msa.getOpenProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposalId]);

      expect(await msa.getProposer(proposalId)).to.equal(approver3);
      expect(await msa.getTargetContract(proposalId)).to.equal(target1.address);
      expect(await msa.getSelector(proposalId)).to.equal(setFoo);
      expect(await msa.getArgumentData(proposalId)).to.equal(
        web3.eth.abi.encodeParameters(["string"], ["such amaze"])
      );
      // Check that the proposal state is open
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.Open
      );
      expect((await msa.getNumApprovals(proposalId)).toNumber()).to.equal(0);
      expect(await msa.getApprovals(proposalId)).to.eql([]);
      expect(await msa.isExecutable(proposalId)).to.equal(false);
    });

    it("does not allow creating a proposal when the maximum number of open proposal per approver is reached for the proposer", async () => {
      const createProposal = (from: string) =>
        proposeAndGetId(
          target2.address,
          setFoo,
          [["string"], ["such amaze"]],
          from
        );

      // maxOpenProposals for target2.setFoo = 3
      // Create three proposals from approver1
      const [proposal1Id] = await createProposal(approver1);
      await createProposal(approver1);
      await createProposal(approver1);

      // Create a proposal from approver2 - should not be affected
      await createProposal(approver2);

      // Creating another proposal from approver1 fails
      await expectRevert(
        createProposal(approver1),
        "Maximum open proposal limit reached"
      );

      // Create two more proposals from approver2
      const [proposal2Id] = await createProposal(approver2);
      await createProposal(approver2);

      // Creating another proposal from approver2 fails
      await expectRevert(
        createProposal(approver2),
        "Maximum open proposal limit reached"
      );

      // Close one of the proposals from approver1
      await msa.closeProposal(proposal1Id, { from: approver1 });

      // Approver1 can now create another proposal
      await createProposal(approver1);

      // Execute one of the proposals approver2 proposed
      await msa.approve(proposal2Id, { from: approver1 });
      await msa.approveAndExecute(proposal2Id, { from: approver2 });

      // Approver2 can now create another proposal
      await createProposal(approver2);
    });

    it("does not allow accounts that are not qualified approvers to create proposals", async () => {
      await expectRevert(
        msa.propose(
          target1.address,
          setFoo,
          web3.eth.abi.encodeParameters(["string"], ["much wow"]),
          { from: admin1 }
        ),
        "caller is not an approver"
      );

      await expectRevert(
        msa.propose(
          target2.address,
          setFoo,
          web3.eth.abi.encodeParameters(["string"], ["much wow"]),
          { from: approver3 } // approver3 is not an approver for target2.setFoo
        ),
        "caller is not an approver"
      );
    });

    it("does not allow creating a proposal for a contract call that is not configured", async () => {
      await expectRevert(
        msa.propose(
          target1.address,
          web3.eth.abi.encodeFunctionSignature("setBaz(string)"),
          web3.eth.abi.encodeParameters(["string"], ["such amaze"]),
          { from: approver1 }
        ),
        "configuration does not exist"
      );
    });
  });

  describe("closeProposal", () => {
    let proposal1Id: number;
    let proposal2Id: number;

    beforeEach(async () => {
      await configure();
      [proposal1Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [456]],
        approver2
      );
    });

    it("allows the original proposers to close their open proposals", async () => {
      expect(
        (await msa.getOpenProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id, proposal2Id]);
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Open
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      // Close proposal 1
      let res = await msa.closeProposal(proposal1Id, { from: approver1 });

      // Check that a ProposalClosed event is emitted
      let log = res.logs[0] as Truffle.TransactionLog<ProposalClosed>;
      expect(log.event).to.equal("ProposalClosed");
      expect(log.args[0].toNumber()).to.equal(proposal1Id);
      expect(log.args[1]).to.equal(approver1);

      expect(
        (await msa.getOpenProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal2Id]);
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      // Close proposal 2
      res = await msa.closeProposal(proposal2Id, { from: approver2 });

      // Check that a ProposalClosed event is emitted
      log = res.logs[0] as Truffle.TransactionLog<ProposalClosed>;
      expect(log.event).to.equal("ProposalClosed");
      expect(log.args[0].toNumber()).to.equal(proposal2Id);
      expect(log.args[1]).to.equal(approver2);

      expect(await msa.getOpenProposals(target1.address, setFoo)).to.eql([]);

      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
    });

    it("does not allow accounts that are not the original proposers to close proposals", async () => {
      await expectRevert(
        msa.closeProposal(proposal1Id, { from: admin1 }),
        "caller is not the proposer"
      );

      await expectRevert(
        msa.closeProposal(proposal1Id, { from: approver2 }),
        "caller is not the proposer"
      );

      await expectRevert(
        msa.closeProposal(proposal2Id, { from: approver1 }),
        "caller is not the proposer"
      );
    });

    it("does not allow closing a proposal that does not exist", async () => {
      await expectRevert(
        msa.closeProposal(999, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow closing a proposal that is already closed", async () => {
      await msa.closeProposal(proposal1Id, { from: approver1 });

      await expectRevert(
        msa.closeProposal(proposal1Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow closing a proposal that is already executed", async () => {
      await msa.approveAndExecute(proposal1Id, { from: approver1 });

      await expectRevert(
        msa.closeProposal(proposal1Id, { from: approver1 }),
        "proposal is not open"
      );
    });
  });

  describe("approve", () => {
    let proposal1Id: number;
    let proposal2Id: number;

    beforeEach(async () => {
      await configure();
      [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["such amaze"]],
        approver1
      );
      [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [456]],
        approver2
      );
    });

    it("allows qualified approvers to submit approvals", async () => {
      // Initially there are no approvals
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(0);
      expect(await msa.getApprovals(proposal1Id)).to.eql([]);

      let res = await msa.approve(proposal1Id, { from: approver1 });

      // Check that a ProposalApprovalSubmitted event is emitted
      let log = res.logs[0] as Truffle.TransactionLog<
        ProposalApprovalSubmitted
      >;
      expect(log.event).to.equal("ProposalApprovalSubmitted");
      expect(log.args[0].toNumber()).to.equal(proposal1Id);
      expect(log.args[1]).to.equal(approver1);
      expect(log.args[2].toNumber()).to.equal(1);
      expect(log.args[3].toNumber()).to.equal(3);

      // Check that the number of approvals is increased
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(1);
      // Check that the list of approvals includes the address of the approver
      expect(await msa.getApprovals(proposal1Id)).to.eql([approver1]);
      // Check that the proposal state is still open
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      // Second approval
      res = await msa.approve(proposal1Id, { from: approver2 });

      log = res.logs[0] as Truffle.TransactionLog<ProposalApprovalSubmitted>;
      expect(log.event).to.equal("ProposalApprovalSubmitted");
      expect(log.args[0].toNumber()).to.equal(proposal1Id);
      expect(log.args[1]).to.equal(approver2);
      expect(log.args[2].toNumber()).to.equal(2);
      expect(log.args[3].toNumber()).to.equal(3);

      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(2);
      expect(await msa.getApprovals(proposal1Id)).to.eql([
        approver1,
        approver2,
      ]);
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      // Third approval
      res = await msa.approve(proposal1Id, { from: approver3 });

      log = res.logs[0] as Truffle.TransactionLog<ProposalApprovalSubmitted>;
      expect(log.event).to.equal("ProposalApprovalSubmitted");
      expect(log.args[0].toNumber()).to.equal(proposal1Id);
      expect(log.args[1]).to.equal(approver3);
      expect(log.args[2].toNumber()).to.equal(3);
      expect(log.args[3].toNumber()).to.equal(3);

      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(3);
      expect(await msa.getApprovals(proposal1Id)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);
      // Check that the proposal state is now open and executable
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );
    });

    it("does not allow accounts that are not qualified approvers to submit approvals", async () => {
      await expectRevert(
        msa.approve(proposal1Id, { from: admin1 }),
        "caller is not an approver"
      );

      await expectRevert(
        msa.approve(proposal2Id, { from: approver3 }),
        "caller is not an approver"
      );
    });

    it("does not allow the approver to submit a duplicate approval", async () => {
      await msa.approve(proposal1Id, { from: approver1 });

      await expectRevert(
        msa.approve(proposal1Id, { from: approver1 }),
        "caller has already approved the proposal"
      );
    });

    it("allows resubmission of an approval that was rescinded", async () => {
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.rescindApproval(proposal1Id, { from: approver1 });

      await msa.approve(proposal1Id, { from: approver1 });
      expect(await msa.getApprovals(proposal1Id)).to.eql([approver1]);
    });

    it("does not allow approving a proposal that does not exist", async () => {
      await expectRevert(
        msa.approve(999, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow approving a proposal that is closed", async () => {
      await msa.closeProposal(proposal1Id, { from: approver1 });

      await expectRevert(
        msa.approve(proposal1Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow approving a proposal that is already executed", async () => {
      await msa.approveAndExecute(proposal2Id, { from: approver2 });

      await expectRevert(
        msa.approve(proposal2Id, { from: approver2 }),
        "proposal is not open"
      );
    });
  });

  describe("rescindApproval", () => {
    let proposalId: number;

    beforeEach(async () => {
      await configure();
      [proposalId] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      await msa.approve(proposalId, { from: approver1 });
    });

    it("allows approvers to rescind their approvals", async () => {
      // Initially there is an approval
      expect((await msa.getNumApprovals(proposalId)).toNumber()).to.equal(1);
      expect(await msa.getApprovals(proposalId)).to.eql([approver1]);
      // Check that the proposal state is initially open and executable
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );

      // Rescind the approval
      const res = await msa.rescindApproval(proposalId, { from: approver1 });

      // Check that a ProposalApprovalRescinded is emitted
      const log = res.logs[0] as Truffle.TransactionLog<
        ProposalApprovalRescinded
      >;
      expect(log.event).to.equal("ProposalApprovalRescinded");
      expect(log.args[0].toNumber()).to.equal(proposalId);
      expect(log.args[1]).to.equal(approver1);
      expect(log.args[2].toNumber()).to.equal(0);
      expect(log.args[3].toNumber()).to.equal(1);

      // Check that the approval is removed
      expect((await msa.getNumApprovals(proposalId)).toNumber()).to.equal(0);
      expect(await msa.getApprovals(proposalId)).to.eql([]);
      // Check that the proposal state is rolled back to open
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.Open
      );
    });

    it("does not allow accounts that did not submit an approval to rescind", async () => {
      await expectRevert(
        msa.rescindApproval(proposalId, { from: approver2 }),
        "caller has not approved the proposal"
      );
    });

    it("does not allow the approver to rescind the same approval twice", async () => {
      await msa.rescindApproval(proposalId, { from: approver1 });

      await expectRevert(
        msa.rescindApproval(proposalId, { from: approver1 }),
        "caller has not approved the proposal"
      );
    });

    it("does not allow accounts that are not qualified approvers to rescind", async () => {
      await expectRevert(
        msa.rescindApproval(proposalId, { from: approver3 }),
        "caller is not an approver"
      );
    });

    it("does not allow rescinding an approval for a proposal that does not exist", async () => {
      await expectRevert(
        msa.rescindApproval(999, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow rescinding an approval for a proposal that is closed", async () => {
      await msa.closeProposal(proposalId, { from: approver1 });

      await expectRevert(
        msa.rescindApproval(proposalId, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow rescinding an approval for a proposal that is already executed", async () => {
      await msa.execute(proposalId, { from: approver1 });

      await expectRevert(
        msa.rescindApproval(proposalId, { from: approver1 }),
        "proposal is not open"
      );
    });
  });

  describe("execute", () => {
    let proposal1Id: number;
    let proposal2Id: number;

    beforeEach(async () => {
      await configure();
      [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["such amaze"]],
        approver1
      );
      [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
    });

    it("allows qualified approvers to execute proposals that have sufficient approvals", async () => {
      // Approve the first proposal
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.approve(proposal1Id, { from: approver2 });
      await msa.approve(proposal1Id, { from: approver3 });

      // Execute the first proposal as the original proposer
      let res = await msa.execute(proposal1Id, { from: approver1 });

      // Check that a ProposalExecuted event is emitted
      let log = res.logs[0] as Truffle.TransactionLog<ProposalExecuted>;
      expect(log.event).to.equal("ProposalExecuted");
      expect(log.args[0].toNumber()).to.equal(proposal1Id);
      expect(log.args[1]).to.equal(approver1);

      // Check that the proposal is marked as executed
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Executed
      );
      expect(await msa.getOpenProposals(target1.address, setFoo)).to.eql([]);

      // Check that the contract call in the proposal (target1.setFoo) is made
      // Check that a SetFooCalled event is emitted by the target contract
      let callLog = res.receipt.rawLogs[1] as TransactionRawLog;
      expect(callLog.address).to.equal(target1.address);
      expect(callLog.topics[0]).to.equal(
        web3.utils.keccak256("SetFooCalled(address,string)")
      );
      // Check log parameters (caller, value)
      expect(callLog.topics[1]).to.equal(bytes32FromAddress(msa.address));
      expect(
        web3.eth.abi.decodeParameters(["string"], callLog.data)[0]
      ).to.equal("such amaze");
      // Check that the call resulted in a state change
      expect(await target1.getFoo()).to.equal("such amaze");

      // Approve the second proposal
      await msa.approve(proposal2Id, { from: approver1 });

      // Execute the second proposal as one of the qualified approvers, even
      // though an approval was not submitted by this approver
      res = await msa.execute(proposal2Id, { from: approver2 });

      // Check that a ProposalExecuted event is emitted
      log = res.logs[0] as Truffle.TransactionLog<ProposalExecuted>;
      expect(log.event).to.equal("ProposalExecuted");
      expect(log.args[0].toNumber()).to.equal(proposal2Id);
      expect(log.args[1]).to.equal(approver2);

      // Check that the proposal is marked as executed
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Executed
      );
      expect(await msa.getOpenProposals(target2.address, setBar)).to.eql([]);

      // Check that the contract call in the proposal (target2.setBar) is made
      // Check that a SetBarCalled event is emitted by the target contract
      callLog = res.receipt.rawLogs[1] as TransactionRawLog;
      expect(callLog.address).to.equal(target2.address);
      expect(callLog.topics[0]).to.equal(
        web3.utils.keccak256("SetBarCalled(address,uint256)")
      );
      // Check log parameters (caller, value)
      expect(callLog.topics[1]).to.equal(bytes32FromAddress(msa.address));
      expect(
        web3.eth.abi.decodeParameters(["uint256"], callLog.data)[0]
      ).to.equal("123");
      // Check that the call resulted in a state change
      expect((await target2.getBar()).toNumber()).to.equal(123);
    });

    it("does not allow executing proposals that have not received required number of approvals", async () => {
      await expectRevert(
        msa.execute(proposal1Id, { from: approver1 }),
        "proposal needs more approvals"
      );
      await expectRevert(
        msa.execute(proposal2Id, { from: approver1 }),
        "proposal needs more approvals"
      );

      // 1/3 approvals
      await msa.approve(proposal1Id, { from: approver1 });

      await expectRevert(
        msa.execute(proposal1Id, { from: approver1 }),
        "proposal needs more approvals"
      );

      // 2/3 approvals
      await msa.approve(proposal1Id, { from: approver2 });

      await expectRevert(
        msa.execute(proposal1Id, { from: approver1 }),
        "proposal needs more approvals"
      );
    });

    it("does not allow accounts that are not qualified approvers to execute", async () => {
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.approve(proposal1Id, { from: approver2 });
      await msa.approve(proposal1Id, { from: approver3 });
      await msa.approve(proposal2Id, { from: approver1 });

      await expectRevert(
        msa.execute(proposal1Id, { from: admin1 }),
        "caller is not an approver"
      );

      // Approver3 is an approver for proposal 1 but not an approver for 2
      await expectRevert(
        msa.execute(proposal2Id, { from: approver3 }),
        "caller is not an approver"
      );
    });

    it("does not allow executing a proposal that does not exist", async () => {
      await expectRevert(
        msa.execute(999, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow executing a proposal that is closed", async () => {
      await msa.approve(proposal2Id, { from: approver1 });
      await msa.closeProposal(proposal2Id, { from: approver1 });

      await expectRevert(
        msa.execute(proposal2Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow executing a proposal that is already executed", async () => {
      await msa.approveAndExecute(proposal2Id, { from: approver1 });

      await expectRevert(
        msa.execute(proposal2Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow executing a call to an externally owned account", async () => {
      const target = accounts[9];

      await msa.configure(target, setFoo, 1, 10, [approver1], {
        from: admin1,
      });

      const [proposalId] = await proposeAndGetId(
        target,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      await msa.approve(proposalId, { from: approver1 });

      await expectRevert(
        msa.execute(proposalId, { from: approver1 }),
        "targetContract is not a contract"
      );
    });

    it("reverts execution with the reason of the failure if the contract call fails with an error message", async () => {
      // Call a function that intentionally reverts with a given error
      const [proposalId] = await proposeAndGetId(
        target1.address,
        revertWithError,
        [["string"], ["something went wrong spectacularly"]],
        approver1
      );
      await msa.approve(proposalId, { from: approver1 });

      // Check that it reverts with the reason of the failure
      await expectRevert(
        msa.execute(proposalId, { from: approver1 }),
        "call failed: something went wrong spectacularly"
      );

      // Check that the proposal state is still open and executable, and not
      // executed
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );
      expect(
        (
          await msa.getOpenProposals(target1.address, revertWithError)
        ).map((id) => id.toNumber())
      ).to.eql([proposalId]);
    });

    it("reverts execution with the reason of the failure if the contract call fails without an error message", async () => {
      // Call a function that intentionally reverts
      const [proposalId] = await proposeAndGetId(
        target1.address,
        revertWithoutError,
        null,
        approver1
      );
      await msa.approve(proposalId, { from: approver1 });

      // Check that it reverts
      await expectRevert(
        msa.execute(proposalId, { from: approver1 }),
        "call failed"
      );

      // Check that the proposal state is still open and executable, and not
      // executed
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );
      expect(
        (
          await msa.getOpenProposals(target1.address, revertWithoutError)
        ).map((id) => id.toNumber())
      ).to.eql([proposalId]);
    });
  });

  describe("approveAndExecute", () => {
    let proposal1Id: number;
    let proposal2Id: number;

    beforeEach(async () => {
      await configure();
      [proposal1Id] = await proposeAndGetId(
        target2.address,
        setFoo,
        [["string"], ["much wow"]],
        approver1
      );
      [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [456]],
        approver1
      );
    });

    it("allows qualified approvers to submit the last approval required, and execute in a single transaction", async () => {
      // Proposal 1 requires 2 approvals
      await msa.approve(proposal1Id, { from: approver1 });

      // Approve and execute proposal 1
      let res = await msa.approveAndExecute(proposal1Id, { from: approver2 });

      // Check that ProposalApproveSubmitted and ProposalExecuted events are
      // emitted
      let log1 = res.logs[0] as Truffle.TransactionLog<
        ProposalApprovalSubmitted
      >;
      let log2 = res.logs[1] as Truffle.TransactionLog<ProposalExecuted>;
      expect(log1.event).to.equal("ProposalApprovalSubmitted");
      expect(log1.args[0].toNumber()).to.equal(proposal1Id);
      expect(log1.args[1]).to.equal(approver2);
      expect(log1.args[2].toNumber()).to.equal(2);
      expect(log1.args[3].toNumber()).to.equal(2);

      expect(log2.event).to.equal("ProposalExecuted");
      expect(log2.args[0].toNumber()).to.equal(proposal1Id);
      expect(log1.args[1]).to.equal(approver2);

      // Check that the proposal is marked as executed
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Executed
      );
      expect(await msa.getOpenProposals(target2.address, setFoo)).to.eql([]);

      // Check that the contract call in the proposal (target2.setFoo) is made
      // Check that a SetFooCalled event is emitted by the target contract
      let callLog = res.receipt.rawLogs[2] as TransactionRawLog;
      expect(callLog.address).to.equal(target2.address);
      expect(callLog.topics[0]).to.equal(
        web3.utils.keccak256("SetFooCalled(address,string)")
      );
      // Check log parameters (caller, value)
      expect(callLog.topics[1]).to.equal(bytes32FromAddress(msa.address));
      expect(
        web3.eth.abi.decodeParameters(["string"], callLog.data)[0]
      ).to.equal("much wow");
      // Check that the call resulted in a state change
      expect(await target2.getFoo()).to.equal("much wow");

      // Proposal 2 requires only 1 approval
      // Approve and execute proposal 2
      res = await msa.approveAndExecute(proposal2Id, { from: approver1 });

      // Check that ProposalApproveSubmitted and ProposalExecuted events are
      // emitted
      log1 = res.logs[0] as Truffle.TransactionLog<ProposalApprovalSubmitted>;
      log2 = res.logs[1] as Truffle.TransactionLog<ProposalExecuted>;
      expect(log1.event).to.equal("ProposalApprovalSubmitted");
      expect(log1.args[0].toNumber()).to.equal(proposal2Id);
      expect(log1.args[1]).to.equal(approver1);
      expect(log1.args[2].toNumber()).to.equal(1);
      expect(log1.args[3].toNumber()).to.equal(1);

      expect(log2.event).to.equal("ProposalExecuted");
      expect(log2.args[0].toNumber()).to.equal(proposal2Id);
      expect(log1.args[1]).to.equal(approver1);

      // Check that the proposal is marked as executed
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Executed
      );
      expect(await msa.getOpenProposals(target2.address, setBar)).to.eql([]);

      // Check that the contract call in the proposal (target2.setBar) is made
      // Check that a SetBarCalled event is emitted by the target contract
      callLog = res.receipt.rawLogs[2] as TransactionRawLog;
      expect(callLog.address).to.equal(target2.address);
      expect(callLog.topics[0]).to.equal(
        web3.utils.keccak256("SetBarCalled(address,uint256)")
      );
      // Check log parameters (caller, value)
      expect(callLog.topics[1]).to.equal(bytes32FromAddress(msa.address));
      expect(
        web3.eth.abi.decodeParameters(["uint256"], callLog.data)[0]
      ).to.equal("456");
      // Check that the call resulted in a state change
      expect((await target2.getBar()).toNumber()).to.equal(456);
    });

    it("does not allow approving and executing proposals that have not received required number of approvals - 1", async () => {
      await expectRevert(
        msa.approveAndExecute(proposal1Id, { from: approver1 }),
        "proposal needs more approvals"
      );

      const [proposalId] = await proposeAndGetId(
        target1.address,
        setBar,
        [["uint256"], [456]],
        approver1
      );
      await expectRevert(
        msa.approveAndExecute(proposalId, { from: approver1 }),
        "proposal needs more approvals"
      );
    });

    it("does not allow accounts that are not qualified approvers to approve and execute", async () => {
      await msa.approve(proposal1Id, { from: approver2 });

      await expectRevert(
        msa.approveAndExecute(proposal1Id, { from: admin1 }),
        "caller is not an approver"
      );

      // Approver3 is an approver for proposal 1 but not an approver for 2
      await expectRevert(
        msa.approveAndExecute(proposal2Id, { from: approver3 }),
        "caller is not an approver"
      );
    });

    it("does not allow approving and executing a proposal that does not exist", async () => {
      await expectRevert(
        msa.approveAndExecute(999, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow approving and executing a proposal that is closed", async () => {
      await msa.closeProposal(proposal2Id, { from: approver1 });

      await expectRevert(
        msa.approveAndExecute(proposal2Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow approving and executing a proposal that is already executed", async () => {
      await msa.approveAndExecute(proposal2Id, { from: approver1 });

      await expectRevert(
        msa.approveAndExecute(proposal2Id, { from: approver1 }),
        "proposal is not open"
      );
    });

    it("does not allow approving and executing a call to an externally owned account", async () => {
      const target = accounts[9];

      await msa.configure(target, setFoo, 1, 10, [approver1], {
        from: admin1,
      });

      const [proposalId] = await proposeAndGetId(
        target,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );

      await expectRevert(
        msa.approveAndExecute(proposalId, { from: approver1 }),
        "targetContract is not a contract"
      );
    });

    it("reverts approval and execution with the reason of the failure if the contract call fails", async () => {
      // Call a function that intentionally reverts with a given error
      const [proposalId] = await proposeAndGetId(
        target1.address,
        revertWithError,
        [["string"], ["oh noes! something went really wrong"]],
        approver1
      );

      // Check that it reverts with the reason of the failure
      await expectRevert(
        msa.approveAndExecute(proposalId, { from: approver1 }),
        "call failed: oh noes! something went really wrong"
      );

      // Check that the approval is reverted
      expect((await msa.getNumApprovals(proposalId)).toNumber()).to.equal(0);
      expect(await msa.getApprovals(proposalId)).to.eql([]);

      // Check that the proposal state is still open and not executable because
      // the approval is reverted
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.Open
      );
      expect(
        (
          await msa.getOpenProposals(target1.address, revertWithError)
        ).map((id) => id.toNumber())
      ).to.eql([proposalId]);
    });
  });

  describe("proposeAndExecute", () => {
    beforeEach(configure);

    it("allows qualifier approvers to propose and execute proposals that only require 1 approval in a single transaction", async () => {
      // Propose, approve, and execute a proposal (target2.setBar is configured
      // to require only 1 approval)
      const res = await msa.proposeAndExecute(
        target2.address,
        setBar,
        web3.eth.abi.encodeParameters(["uint256"], [123]),
        { from: approver1 }
      );

      // Check that ProposalCreated, ProposalApprovalSubmitted, and
      // ProposalExecuted events are submitted
      const log1 = res.logs[0] as Truffle.TransactionLog<ProposalCreated>;
      const log2 = res.logs[1] as Truffle.TransactionLog<
        ProposalApprovalSubmitted
      >;
      const log3 = res.logs[2] as Truffle.TransactionLog<ProposalExecuted>;
      expect(log1.event).to.equal("ProposalCreated");
      // Get the proposal ID from the ProposalCreated event
      const proposalId = log1.args[0].toNumber();
      expect(log1.args[1]).to.equal(approver1);
      expect(log2.event).to.equal("ProposalApprovalSubmitted");
      expect(log2.args[0].toNumber()).to.equal(proposalId);
      expect(log2.args[1]).to.equal(approver1);
      expect(log2.args[2].toNumber()).to.equal(1);
      expect(log2.args[3].toNumber()).to.equal(1);
      expect(log3.event).to.equal("ProposalExecuted");
      expect(log3.args[0].toNumber()).to.equal(proposalId);
      expect(log3.args[1]).to.equal(approver1);

      // Check that the proposal is marked as executed
      expect((await msa.getProposalState(proposalId)).toNumber()).to.equal(
        ProposalState.Executed
      );
      expect(await msa.getOpenProposals(target2.address, setFoo)).to.eql([]);

      // Check that the contract call in the proposal (target2.setBar) is made
      // Check that a SetBarCalled event is emitted by the target contract
      const callLog = res.receipt.rawLogs[3] as TransactionRawLog;
      expect(callLog.address).to.equal(target2.address);
      expect(callLog.topics[0]).to.equal(
        web3.utils.keccak256("SetBarCalled(address,uint256)")
      );
      // Check log parameters (caller, value)
      expect(callLog.topics[1]).to.equal(bytes32FromAddress(msa.address));
      expect(
        web3.eth.abi.decodeParameters(["uint256"], callLog.data)[0]
      ).to.equal("123");
      // Check that the call resulted in a state change
      expect((await target2.getBar()).toNumber()).to.equal(123);
    });

    it("does not allow proposing and executing when the maximum number of open proposal per approver is reached for the proposer", async () => {
      // maxOpenProposals for target2.setBar = 2
      // Create two existing proposals
      await msa.propose(
        target2.address,
        setBar,
        web3.eth.abi.encodeParameters(["uint256"], [123]),
        { from: approver1 }
      );
      await msa.propose(
        target2.address,
        setBar,
        web3.eth.abi.encodeParameters(["uint256"], [456]),
        { from: approver1 }
      );

      // Try creating another one by calling proposeAndExecute
      await expectRevert(
        msa.proposeAndExecute(
          target2.address,
          setBar,
          web3.eth.abi.encodeParameters(["uint256"], [789]),
          { from: approver1 }
        ),
        "Maximum open proposal limit reached"
      );
    });

    it("does not allow proposing and executing proposals that require more than one approval", async () => {
      await expectRevert(
        msa.proposeAndExecute(
          target1.address,
          setFoo,
          web3.eth.abi.encodeParameters(["string"], ["hello"]),
          { from: approver1 }
        ),
        "proposal needs more approvals"
      );

      await expectRevert(
        msa.proposeAndExecute(
          target1.address,
          setBar,
          web3.eth.abi.encodeParameters(["uint256"], ["123"]),
          { from: approver2 }
        ),
        "proposal needs more approvals"
      );
    });

    it("does not allow accounts that are not qualified approvers to propose and execute", async () => {
      await expectRevert(
        msa.proposeAndExecute(
          target2.address,
          setBar,
          web3.eth.abi.encodeParameters(["uint256"], ["123"]),
          { from: admin1 }
        ),
        "caller is not an approver"
      );

      await expectRevert(
        msa.proposeAndExecute(
          target2.address,
          setBar,
          web3.eth.abi.encodeParameters(["uint256"], ["456"]),
          { from: owner }
        ),
        "caller is not an approver"
      );
    });

    it("does not allow proposing and executing a call to an externally owned account", async () => {
      const target = accounts[9];

      await msa.configure(target, setFoo, 1, 10, [approver1], {
        from: admin1,
      });

      await expectRevert(
        msa.proposeAndExecute(
          target,
          setFoo,
          web3.eth.abi.encodeParameters(["string"], ["hello"]),
          { from: approver1 }
        ),
        "targetContract is not a contract"
      );
    });

    it("reverts approval and execution with the reason of the failure if the contract call fails", async () => {
      // Call a function that intentionally reverts with a given error
      await expectRevert(
        msa.proposeAndExecute(
          target1.address,
          revertWithError,
          web3.eth.abi.encodeParameters(["string"], ["ouch"]),
          { from: approver1 }
        ),
        "call failed: ouch"
      );
    });
  });

  describe("getMinApprovals", () => {
    beforeEach(configure);

    it("returns the minimum required number of approvals for a given type of contract call", async () => {
      expect(
        (await msa.getMinApprovals(target1.address, setFoo)).toNumber()
      ).to.equal(3);
      expect(
        (await msa.getMinApprovals(target1.address, setBar)).toNumber()
      ).to.equal(2);
      expect(
        (await msa.getMinApprovals(target2.address, setFoo)).toNumber()
      ).to.equal(2);
      expect(
        (await msa.getMinApprovals(target2.address, setBar)).toNumber()
      ).to.equal(1);
      expect(
        (await msa.getMinApprovals(target1.address, revertWithError)).toNumber()
      ).to.equal(1);
      expect(
        (
          await msa.getMinApprovals(target1.address, revertWithoutError)
        ).toNumber()
      ).to.equal(1);
    });

    it("returns 0 when given a type of contract call that has not been configured", async () => {
      expect(
        (await msa.getMinApprovals(target2.address, revertWithError)).toNumber()
      ).to.equal(0);
    });
  });

  describe("getMaxOpenProposals", () => {
    beforeEach(configure);

    it("returns the minimum required number of approvals for a given type of contract call", async () => {
      expect(
        (await msa.getMaxOpenProposals(target1.address, setFoo)).toNumber()
      ).to.equal(20);
      expect(
        (await msa.getMaxOpenProposals(target1.address, setBar)).toNumber()
      ).to.equal(10);
      expect(
        (await msa.getMaxOpenProposals(target2.address, setFoo)).toNumber()
      ).to.equal(3);
      expect(
        (await msa.getMaxOpenProposals(target2.address, setBar)).toNumber()
      ).to.equal(2);
      expect(
        (
          await msa.getMaxOpenProposals(target1.address, revertWithError)
        ).toNumber()
      ).to.equal(1);
      expect(
        (
          await msa.getMaxOpenProposals(target1.address, revertWithoutError)
        ).toNumber()
      ).to.equal(1);
    });

    it("returns 0 when given a type of contract call that has not been configured", async () => {
      expect(
        (
          await msa.getMaxOpenProposals(target2.address, revertWithError)
        ).toNumber()
      ).to.equal(0);
    });
  });

  describe("getApprovers", () => {
    beforeEach(configure);

    it("returns the list of qualified approvers for a given type of contract call", async () => {
      expect(await msa.getApprovers(target1.address, setFoo)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);
      expect(await msa.getApprovers(target1.address, setBar)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);
      expect(await msa.getApprovers(target2.address, setFoo)).to.eql([
        approver1,
        approver2,
      ]);
      expect(await msa.getApprovers(target2.address, setBar)).to.eql([
        approver1,
        approver2,
      ]);
      expect(await msa.getApprovers(target1.address, revertWithError)).to.eql([
        approver1,
      ]);
    });

    it("returns an empty list when given a type of contract call that has not been configured", async () => {
      expect(await msa.getApprovers(target2.address, revertWithError)).to.eql(
        []
      );
    });
  });

  describe("isApprover", () => {
    beforeEach(configure);

    it("returns whether a given account is a qualified approver for a given type of contract call", async () => {
      expect(await msa.isApprover(target1.address, setFoo, approver1)).to.equal(
        true
      );
      expect(await msa.isApprover(target1.address, setFoo, approver2)).to.equal(
        true
      );
      expect(await msa.isApprover(target1.address, setFoo, approver2)).to.equal(
        true
      );
      expect(await msa.isApprover(target1.address, setFoo, owner)).to.equal(
        false
      );
      expect(await msa.isApprover(target1.address, setFoo, admin1)).to.equal(
        false
      );
      expect(await msa.isApprover(target1.address, setFoo, admin2)).to.equal(
        false
      );

      expect(await msa.isApprover(target2.address, setFoo, approver1)).to.equal(
        true
      );
      expect(await msa.isApprover(target2.address, setFoo, approver2)).to.equal(
        true
      );
      expect(await msa.isApprover(target2.address, setFoo, approver3)).to.equal(
        false
      );
    });

    it("returns false when given a type of contract call that has not been configured", async () => {
      expect(
        await msa.isApprover(target2.address, revertWithError, approver1)
      ).to.equal(false);
    });
  });

  describe("getOpenProposals", () => {
    beforeEach(configure);

    it("returns the list of proposals that are currently open for a given type of contract call", async () => {
      expect(await msa.getOpenProposals(target1.address, setFoo)).to.eql([]);

      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect(
        (await msa.getOpenProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id]);

      const [proposal2Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["world"]],
        approver1
      );

      expect(
        (await msa.getOpenProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id, proposal2Id]);

      const [proposal3Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      expect(
        (await msa.getOpenProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal3Id]);
      expect(
        (await msa.getOpenProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id, proposal2Id]);

      // check that the executable proposals are included in the result
      await msa.approve(proposal3Id, { from: approver1 });
      expect((await msa.getProposalState(proposal3Id)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );
      expect(
        (await msa.getOpenProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal3Id]);
    });

    it("returns an empty list when given a type of contract call that has not been configured", async () => {
      expect(
        await msa.getOpenProposals(target1.address, revertWithError)
      ).to.eql([]);
    });
  });

  describe("getExecutableProposals", () => {
    beforeEach(configure);

    it("returns the list of proposals that are currently open and executable for a given type of contract call", async () => {
      expect(await msa.getExecutableProposals(target1.address, setFoo)).to.eql(
        []
      );

      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect(
        (await msa.getExecutableProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([]);

      // Approve proposal 1
      await msa.approve(proposal1Id, { from: approver1 });
      await msa.approve(proposal1Id, { from: approver2 });
      await msa.approve(proposal1Id, { from: approver3 });

      expect(
        (await msa.getExecutableProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id]);

      const [proposal2Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["world"]],
        approver1
      );

      // Approve proposal 2
      await msa.approve(proposal2Id, { from: approver1 });
      await msa.approve(proposal2Id, { from: approver2 });
      await msa.approve(proposal2Id, { from: approver3 });

      expect(
        (await msa.getExecutableProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id, proposal2Id]);

      const [proposal3Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );

      expect(
        (await msa.getExecutableProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([]);

      // Approve proposal 3
      await msa.approve(proposal3Id, { from: approver1 });

      expect(
        (await msa.getExecutableProposals(target2.address, setBar)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal3Id]);

      expect(
        (await msa.getExecutableProposals(target1.address, setFoo)).map((id) =>
          id.toNumber()
        )
      ).to.eql([proposal1Id, proposal2Id]);
    });

    it("returns an empty list when given a type of contract call that has not been configured", async () => {
      expect(
        await msa.getExecutableProposals(target1.address, revertWithError)
      ).to.eql([]);
    });
  });

  describe("getNumApprovals", () => {
    beforeEach(configure);

    it("returns the number of approvals a given proposal has received", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(0);

      await msa.approve(proposal1Id, { from: approver1 });
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(1);

      await msa.approve(proposal1Id, { from: approver2 });
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(2);

      await msa.approve(proposal1Id, { from: approver3 });
      expect((await msa.getNumApprovals(proposal1Id)).toNumber()).to.equal(3);

      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      expect((await msa.getNumApprovals(proposal2Id)).toNumber()).to.equal(0);

      await msa.approve(proposal2Id, { from: approver2 });
      expect((await msa.getNumApprovals(proposal2Id)).toNumber()).to.equal(1);
    });

    it("returns 0 when given a proposal that does not exist", async () => {
      expect((await msa.getNumApprovals(999)).toNumber()).to.equal(0);
    });
  });

  describe("getApprovals", () => {
    beforeEach(configure);

    it("returns the list of accounts that have approved a given proposal", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect(await msa.getApprovals(proposal1Id)).to.eql([]);

      await msa.approve(proposal1Id, { from: approver1 });
      expect(await msa.getApprovals(proposal1Id)).to.eql([approver1]);

      await msa.approve(proposal1Id, { from: approver2 });
      expect(await msa.getApprovals(proposal1Id)).to.eql([
        approver1,
        approver2,
      ]);

      await msa.approve(proposal1Id, { from: approver3 });
      expect(await msa.getApprovals(proposal1Id)).to.eql([
        approver1,
        approver2,
        approver3,
      ]);

      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      expect(await msa.getApprovals(proposal2Id)).to.eql([]);

      await msa.approve(proposal2Id, { from: approver2 });
      expect(await msa.getApprovals(proposal2Id)).to.eql([approver2]);
    });

    it("returns an empty list when given a proposal that does not exist", async () => {
      expect(await msa.getApprovals(999)).to.eql([]);
    });
  });

  describe("isExecutable", () => {
    beforeEach(configure);

    it("returns whether a proposal has received enough approvals to be executable", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect(await msa.isExecutable(proposal1Id)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver1 });
      expect(await msa.isExecutable(proposal1Id)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver2 });
      expect(await msa.isExecutable(proposal1Id)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver3 });
      expect(await msa.isExecutable(proposal1Id)).to.equal(true);

      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      expect(await msa.isExecutable(proposal2Id)).to.equal(false);

      await msa.approve(proposal2Id, { from: approver2 });
      expect(await msa.isExecutable(proposal2Id)).to.equal(true);
    });

    it("returns false when given a proposal that does not exist", async () => {
      expect(await msa.isExecutable(999)).to.equal(false);
    });
  });

  describe("hasApproved", () => {
    beforeEach(configure);

    it("returns whether a proposal has received an approval from a given approver", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect(await msa.hasApproved(proposal1Id, approver1)).to.equal(false);
      expect(await msa.hasApproved(proposal1Id, approver2)).to.equal(false);
      expect(await msa.hasApproved(proposal1Id, approver3)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver1 });
      expect(await msa.hasApproved(proposal1Id, approver1)).to.equal(true);
      expect(await msa.hasApproved(proposal1Id, approver2)).to.equal(false);
      expect(await msa.hasApproved(proposal1Id, approver3)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver2 });
      expect(await msa.hasApproved(proposal1Id, approver1)).to.equal(true);
      expect(await msa.hasApproved(proposal1Id, approver2)).to.equal(true);
      expect(await msa.hasApproved(proposal1Id, approver3)).to.equal(false);

      await msa.approve(proposal1Id, { from: approver3 });
      expect(await msa.hasApproved(proposal1Id, approver1)).to.equal(true);
      expect(await msa.hasApproved(proposal1Id, approver2)).to.equal(true);
      expect(await msa.hasApproved(proposal1Id, approver3)).to.equal(true);

      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setFoo,
        [["string"], ["world"]],
        approver1
      );
      expect(await msa.hasApproved(proposal2Id, approver1)).to.equal(false);
      expect(await msa.hasApproved(proposal2Id, approver2)).to.equal(false);
      expect(await msa.hasApproved(proposal2Id, approver3)).to.equal(false);

      await msa.approve(proposal2Id, { from: approver2 });
      expect(await msa.hasApproved(proposal2Id, approver1)).to.equal(false);
      expect(await msa.hasApproved(proposal2Id, approver2)).to.equal(true);
      expect(await msa.hasApproved(proposal2Id, approver3)).to.equal(false);
    });

    it("returns false when given a proposal that does not exist", async () => {
      expect(await msa.hasApproved(999, approver1)).to.equal(false);
    });

    it("returns false when given an unknown address", async () => {
      const [proposalId] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      await msa.approve(proposalId, { from: approver1 });

      expect(await msa.hasApproved(proposalId, ZERO_ADDRESS)).to.equal(false);
    });
  });

  describe("getProposalState", () => {
    beforeEach(configure);

    it("returns the current state of a given proposal", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver1
      );
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      await msa.approve(proposal1Id, { from: approver1 });
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.OpenAndExecutable
      );

      await msa.execute(proposal1Id, { from: approver1 });
      expect((await msa.getProposalState(proposal1Id)).toNumber()).to.equal(
        ProposalState.Executed
      );

      const [proposal2Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Open
      );

      await msa.closeProposal(proposal2Id, { from: approver1 });
      expect((await msa.getProposalState(proposal2Id)).toNumber()).to.equal(
        ProposalState.Closed
      );
    });

    it("returns 0 (= NotExist) when given a proposal that does not exist", async () => {
      expect((await msa.getProposalState(999)).toNumber()).to.equal(
        ProposalState.NotExist
      );
    });
  });

  describe("getProposer", () => {
    beforeEach(configure);

    it("returns the address of the original proposer of a proposal", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver2
      );

      expect(await msa.getProposer(proposal1Id)).to.equal(approver1);
      expect(await msa.getProposer(proposal2Id)).to.equal(approver2);
    });

    it("returns the zero address when given a proposal that does not exist", async () => {
      expect(await msa.getProposer(999)).to.equal(ZERO_ADDRESS);
    });
  });

  describe("getTargetContract", () => {
    beforeEach(configure);

    it("returns the address of the contract to be called when a given proposal is executed", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver2
      );

      expect(await msa.getTargetContract(proposal1Id)).to.equal(
        target1.address
      );
      expect(await msa.getTargetContract(proposal2Id)).to.equal(
        target2.address
      );
    });

    it("returns the zero address when given a proposal that does not exist", async () => {
      expect(await msa.getTargetContract(999)).to.equal(ZERO_ADDRESS);
    });
  });

  describe("getSelector", () => {
    beforeEach(configure);

    it("returns the function selector of the function to be called when a given proposal is executed", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver2
      );

      expect(await msa.getSelector(proposal1Id)).to.equal(setFoo);
      expect(await msa.getSelector(proposal2Id)).to.equal(setBar);
    });

    it("returns blank bytes when given a proposal that does not exist", async () => {
      expect(await msa.getSelector(999)).to.equal("0x00000000");
    });
  });

  describe("getArgumentData", () => {
    beforeEach(configure);

    it("returns the ABI-encoded argument data of the contract call of a given proposal", async () => {
      const [proposal1Id] = await proposeAndGetId(
        target1.address,
        setFoo,
        [["string"], ["hello"]],
        approver1
      );
      const [proposal2Id] = await proposeAndGetId(
        target2.address,
        setBar,
        [["uint256"], [123]],
        approver2
      );

      expect(await msa.getArgumentData(proposal1Id)).to.equal(
        web3.eth.abi.encodeParameters(["string"], ["hello"])
      );
      expect(await msa.getArgumentData(proposal2Id)).to.equal(
        web3.eth.abi.encodeParameters(["uint256"], [123])
      );
    });

    it("returns null when given a proposal that does not exist", async () => {
      expect(await msa.getArgumentData(999)).to.equal(null);
    });
  });
});
