/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2020 Coinbase, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

pragma solidity 0.6.8;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/EnumerableSet.sol";
import { EnumerableSetExtra } from "./util/EnumerableSetExtra.sol";
import { Administrable } from "./util/Administrable.sol";

/**
 * @title Multi-sig Admin Contract
 * @notice Used to add configurable multi-sig approval process to existing
 * smart contracts.
 */
contract MultiSigAdmin is Administrable {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetExtra for EnumerableSet.AddressSet;
    using EnumerableSetExtra for EnumerableSet.UintSet;

    struct ContractCallType {
        Configuration config;
        // IDs of open proposals for this type of contract call
        EnumerableSet.UintSet openProposals;
        // Number of open proposals of each approver
        mapping(address => uint256) numOpenProposals;
    }

    struct Configuration {
        // Minimum number of approvals required to execute a proposal
        uint256 minApprovals;
        // Maximum number of open proposals per approver - if exceeded, the
        // approver has to close or execute an existing open proposal to be able
        // to create another proposal.
        uint256 maxOpenProposals;
        // Addresses of qualified approvers - accounts that can propose,
        // approve, and execute proposals
        EnumerableSet.AddressSet approvers;
    }

    enum ProposalState { NotExist, Open, Closed, Executed }

    struct Proposal {
        ProposalState state;
        address proposer;
        address targetContract;
        bytes4 selector;
        bytes argumentData;
        // Addresses of accounts that have submitted approvals
        EnumerableSet.AddressSet approvals;
    }

    /**
     * @dev Preconfigured contract call types:
     * Contract address => Function selector => ContractCallType
     */
    mapping(address => mapping(bytes4 => ContractCallType)) private _types;

    /**
     * @dev Proposals: Proposal ID => Proposal
     */
    mapping(uint256 => Proposal) private _proposals;

    /**
     * @dev Next proposal ID
     */
    uint256 private _nextProposalId;

    event ConfigurationChanged(
        address indexed targetContract,
        bytes4 indexed selector,
        address indexed admin
    );
    event ConfigurationRemoved(
        address indexed targetContract,
        bytes4 indexed selector,
        address indexed admin
    );
    event ProposalCreated(uint256 indexed id, address indexed proposer);
    event ProposalClosed(uint256 indexed id, address indexed closer);
    event ProposalApprovalSubmitted(
        uint256 indexed id,
        address indexed approver
    );
    event ProposalApprovalRescinded(
        uint256 indexed id,
        address indexed approver
    );
    event ProposalExecuted(uint256 indexed id, address indexed executor);

    /**
     * @notice Ensure that the configuration for the given type of contract call
     * is present
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     */
    modifier configurationExists(address targetContract, bytes4 selector) {
        require(
            _types[targetContract][selector].config.minApprovals > 0,
            "MultiSigAdmin: configuration does not exist"
        );
        _;
    }

    /**
     * @notice Ensure that the caller is an approver for the given type of
     * contract call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     */
    modifier onlyApprover(address targetContract, bytes4 selector) {
        require(
            _types[targetContract][selector].config.approvers.contains(
                msg.sender
            ),
            "MultiSigAdmin: caller is not an approver"
        );
        _;
    }

    /**
     * @notice Ensure that the caller is the proposer of a given proposal
     * @param proposalId    Proposal ID
     */
    modifier onlyProposer(uint256 proposalId) {
        require(
            _proposals[proposalId].proposer == msg.sender,
            "MultiSigAdmin: caller is not the proposer"
        );
        _;
    }

    /**
     * @notice Ensure that the proposal is open
     * @param proposalId    Proposal ID
     */
    modifier proposalIsOpen(uint256 proposalId) {
        require(
            _proposals[proposalId].state == ProposalState.Open,
            "MultiSigAdmin: proposal is not open"
        );
        _;
    }

    /**
     * @notice Ensure that the caller can approve a given proposal
     * @param proposalId    Proposal ID
     */
    modifier onlyApproverForProposal(uint256 proposalId) {
        Proposal storage proposal = _proposals[proposalId];
        require(
            _types[proposal.targetContract][proposal.selector]
                .config
                .approvers
                .contains(msg.sender),
            "MultiSigAdmin: caller is not an approver"
        );
        _;
    }

    constructor() public Administrable() {}

    /**
     * @notice Configure requirements for a type of contract call
     * @dev minApprovals must be greater than zero. This closes all affected
     * proposals.
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @param minApprovals      Minimum number of approvals required
     * @param maxOpenProposals  Maximum number of open proposals per approver
     * @param approvers         List of approvers' addresses
     */
    function configure(
        address targetContract,
        bytes4 selector,
        uint256 minApprovals,
        uint256 maxOpenProposals,
        address[] calldata approvers
    ) external onlyAdmin {
        require(
            targetContract != address(0),
            "MultiSigAdmin: targetContract is the zero address"
        );
        require(minApprovals > 0, "MultiSigAdmin: minApprovals is zero");
        require(
            maxOpenProposals > 0,
            "MultiSigAdmin: maxOpenProposals is zero"
        );

        ContractCallType storage callType = _types[targetContract][selector];
        Configuration storage config = callType.config;

        // Set approvers
        config.approvers.clear();
        for (uint256 i = 0; i < approvers.length; i++) {
            config.approvers.add(approvers[i]);
        }

        require(
            config.approvers.length() >= minApprovals,
            "MultiSigAdmin: approvers fewer than minApprovals"
        );

        // Set minApprovals and maxOpenProposals
        config.minApprovals = minApprovals;
        config.maxOpenProposals = maxOpenProposals;

        // Close existing open proposals
        _closeOpenProposals(callType);

        emit ConfigurationChanged(targetContract, selector, msg.sender);
    }

    /**
     * @notice Remove the configuration for a given type of contract call
     * @dev This closes all affected proposals.
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     */
    function removeConfiguration(address targetContract, bytes4 selector)
        external
        onlyAdmin
        configurationExists(targetContract, selector)
    {
        ContractCallType storage callType = _types[targetContract][selector];
        Configuration storage config = callType.config;

        // Reset minApprovals and approvers
        config.minApprovals = 0;
        config.approvers.clear();

        // Close existing open proposals
        _closeOpenProposals(callType);

        emit ConfigurationRemoved(targetContract, selector, msg.sender);
    }

    /**
     * @notice Propose a contract call
     * @dev Only approvers for a given type of contract call are able to
     * propose. Emits the proposal ID in ProposalCreated event.
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @param argumentData      ABI-encoded argument data
     * @return Proposal ID
     */
    function propose(
        address targetContract,
        bytes4 selector,
        bytes calldata argumentData
    )
        external
        configurationExists(targetContract, selector)
        onlyApprover(targetContract, selector)
        returns (uint256)
    {
        return _propose(msg.sender, targetContract, selector, argumentData);
    }

    /**
     * @notice Close a proposal without executing
     * @dev This can only be called by the proposer.
     * @param proposalId    Proposal
     */
    function closeProposal(uint256 proposalId)
        external
        proposalIsOpen(proposalId)
        onlyProposer(proposalId)
    {
        _closeProposal(proposalId, msg.sender);
    }

    /**
     * @notice Submit an approval for a proposal
     * @dev Only the approvers for the type of contract call specified in the
     * proposal are able to submit approvals.
     * @param proposalId    Proposal ID
     */
    function approve(uint256 proposalId)
        external
        proposalIsOpen(proposalId)
        onlyApproverForProposal(proposalId)
    {
        return _approve(msg.sender, proposalId);
    }

    /**
     * @notice Rescind a previously submitted approval
     * @dev Approvals can only be rescinded while the proposal is still open.
     * @param proposalId    Proposal ID
     */
    function rescindApproval(uint256 proposalId)
        external
        proposalIsOpen(proposalId)
        onlyApproverForProposal(proposalId)
    {
        EnumerableSet.AddressSet storage approvals = _proposals[proposalId]
            .approvals;
        require(
            approvals.contains(msg.sender),
            "MultiSigAdmin: caller has not approved the proposal"
        );
        approvals.remove(msg.sender);
        emit ProposalApprovalRescinded(proposalId, msg.sender);
    }

    /**
     * @notice Execute an approved proposal
     * @dev Required number of approvals must have been met; only the approvers
     * for a given type of contract call proposed are able to execute.
     * @param proposalId    Proposal ID
     * @return Return data from the contract call
     */
    function execute(uint256 proposalId)
        external
        payable
        proposalIsOpen(proposalId)
        onlyApproverForProposal(proposalId)
        returns (bytes memory)
    {
        return _execute(msg.sender, proposalId);
    }

    /**
     * @notice A convenience function to cast the final approval required and
     * execute the contract call. Same as doing approve() followed by execute().
     * @param proposalId    Proposal ID
     * @return Return data from the contract call
     */
    function approveAndExecute(uint256 proposalId)
        external
        payable
        proposalIsOpen(proposalId)
        onlyApproverForProposal(proposalId)
        returns (bytes memory)
    {
        _approve(msg.sender, proposalId);
        return _execute(msg.sender, proposalId);
    }

    /**
     * @notice A convenience function to create a proposal and execute
     * immediately. Same as doing propose() followed by approve() and execute().
     * @dev This works only if the number of approvals required is one (1).
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @param argumentData      ABI-encoded argument data
     * @return Return data from the contract call
     */
    function proposeAndExecute(
        address targetContract,
        bytes4 selector,
        bytes calldata argumentData
    )
        external
        payable
        configurationExists(targetContract, selector)
        onlyApprover(targetContract, selector)
        returns (bytes memory)
    {
        uint256 proposalId = _propose(
            msg.sender,
            targetContract,
            selector,
            argumentData
        );
        _approve(msg.sender, proposalId);
        return _execute(msg.sender, proposalId);
    }

    /**
     * @notice Minimum number of approvals required for a given type of contract
     * call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @return Minimum number of approvals required for execution
     */
    function getMinApprovals(address targetContract, bytes4 selector)
        external
        view
        returns (uint256)
    {
        return _types[targetContract][selector].config.minApprovals;
    }

    /**
     * @notice Maximum number of open proposals per approver for a given type of
     * contract call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @return Minimum number of approvals required for execution
     */
    function getMaxOpenProposals(address targetContract, bytes4 selector)
        external
        view
        returns (uint256)
    {
        return _types[targetContract][selector].config.maxOpenProposals;
    }

    /**
     * @notice List of approvers for a given type of contract call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @return List of approvers' addresses
     */
    function getApprovers(address targetContract, bytes4 selector)
        external
        view
        returns (address[] memory)
    {
        return _types[targetContract][selector].config.approvers.elements();
    }

    /**
     * @notice Whether a given account is configured to be able to approve a
     * given type of contract call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @param account           Address of the account to check
     * @return True if an approver
     */
    function isApprover(
        address targetContract,
        bytes4 selector,
        address account
    ) external view returns (bool) {
        return
            _types[targetContract][selector].config.approvers.contains(account);
    }

    /**
     * @notice List of IDs of open proposals for a given type of contract call
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @return List of IDs of open proposals
     */
    function getOpenProposals(address targetContract, bytes4 selector)
        external
        view
        returns (uint256[] memory)
    {
        return _types[targetContract][selector].openProposals.elements();
    }

    /**
     * @notice Number of approvals received for a given proposal
     * @param proposalId    Proposal ID
     * @return Number of approvals
     */
    function getNumApprovals(uint256 proposalId)
        external
        view
        returns (uint256)
    {
        return _proposals[proposalId].approvals.length();
    }

    /**
     * @notice List of approvers that have approved a given proposal
     * @dev Approvers who have rescinded their approvals are not included.
     * @param proposalId    Proposal ID
     * @return List of approvers' addresses
     */
    function getApprovals(uint256 proposalId)
        external
        view
        returns (address[] memory)
    {
        return _proposals[proposalId].approvals.elements();
    }

    /**
     * @notice Whether a proposal has received required number of approvals
     * @param proposalId    Proposal ID
     * @return True if executable
     */
    function isExecutable(uint256 proposalId) external view returns (bool) {
        Proposal storage proposal = _proposals[proposalId];
        uint256 minApprovals = _types[proposal.targetContract][proposal
            .selector]
            .config
            .minApprovals;
        return minApprovals > 0 && proposal.approvals.length() >= minApprovals;
    }

    /**
     * @notice Whether an approver has already approved a proposal
     * @dev False if the approval was rescinded.
     * @param proposalId    Proposal ID
     * @param approver      Approver's address
     * @return True if approved
     */
    function hasApproved(uint256 proposalId, address approver)
        external
        view
        returns (bool)
    {
        return _proposals[proposalId].approvals.contains(approver);
    }

    /**
     * @notice State of a given proposal
     * @param proposalId    Proposal ID
     * @return Proposal state
     */
    function getProposalState(uint256 proposalId)
        external
        view
        returns (ProposalState)
    {
        return _proposals[proposalId].state;
    }

    /**
     * @notice Proposer of a given proposal
     * @param proposalId    Proposal ID
     * @return Proposer's address
     */
    function getProposer(uint256 proposalId) external view returns (address) {
        return _proposals[proposalId].proposer;
    }

    /**
     * @notice Target contract address of a given proposal
     * @param proposalId    Proposal ID
     * @return Contract address
     */
    function getTargetContract(uint256 proposalId)
        external
        view
        returns (address)
    {
        return _proposals[proposalId].targetContract;
    }

    /**
     * @notice Target function selector of a given proposal
     * @param proposalId    Proposal ID
     * @return Function selector
     */
    function getSelector(uint256 proposalId) external view returns (bytes4) {
        return _proposals[proposalId].selector;
    }

    /**
     * @notice Call argument data of a given proposal
     * @param proposalId    Proposal ID
     * @return Argument data
     */
    function getArgumentData(uint256 proposalId)
        external
        view
        returns (bytes memory)
    {
        return _proposals[proposalId].argumentData;
    }

    /**
     * @notice Private function to close a proposal
     * @param proposalId    Proposal ID
     * @param closer        Closer's address
     */
    function _closeProposal(uint256 proposalId, address closer) private {
        Proposal storage proposal = _proposals[proposalId];

        // Update state to Closed
        proposal.state = ProposalState.Closed;

        ContractCallType storage callType = _types[proposal
            .targetContract][proposal.selector];

        // Remove proposal from openProposals
        callType.openProposals.remove(proposalId);

        // Decrement open proposal count for the proposer
        address proposer = proposal.proposer;
        callType.numOpenProposals[proposer] = callType
            .numOpenProposals[proposer]
            .sub(1);

        emit ProposalClosed(proposalId, closer);
    }

    /**
     * @notice Private function to close open proposals
     * @param callType  Contract call type
     */
    function _closeOpenProposals(ContractCallType storage callType) private {
        uint256 openProposalCount = callType.openProposals.length();
        for (uint256 i = 0; i < openProposalCount; i++) {
            // Keep removing the first open proposal, because _clearProposal
            // removes the closed proposal from the list
            _closeProposal(callType.openProposals.at(0), msg.sender);
        }
    }

    /**
     * @notice Private function to create a new proposal
     * @param proposer          Proposer's address
     * @param targetContract    Address of the contract
     * @param selector          Selector of the function in the contract
     * @param argumentData      ABI-encoded argument data
     * @return Proposal ID
     */
    function _propose(
        address proposer,
        address targetContract,
        bytes4 selector,
        bytes memory argumentData
    ) private returns (uint256) {
        ContractCallType storage callType = _types[targetContract][selector];
        uint256 numOpenProposals = callType.numOpenProposals[proposer];
        require(
            numOpenProposals < callType.config.maxOpenProposals,
            "MultiSigAdmin: Maximum open proposal limit reached"
        );

        uint256 proposalId = _nextProposalId++;

        Proposal storage proposal = _proposals[proposalId];
        proposal.state = ProposalState.Open;
        proposal.proposer = proposer;
        proposal.targetContract = targetContract;
        proposal.selector = selector;
        proposal.argumentData = argumentData;

        // Increment open proposal count for the proposer
        callType.numOpenProposals[proposer] = numOpenProposals.add(1);

        // Add proposal ID to the set of open proposals
        callType.openProposals.add(proposalId);

        emit ProposalCreated(proposalId, proposer);

        return proposalId;
    }

    /**
     * @notice Private function to add an approval to a proposal
     * @param approver      Approver's address
     * @param proposalId    Proposal ID
     */
    function _approve(address approver, uint256 proposalId) private {
        EnumerableSet.AddressSet storage approvals = _proposals[proposalId]
            .approvals;
        require(
            !approvals.contains(approver),
            "MultiSigAdmin: caller has already approved the proposal"
        );
        approvals.add(approver);
        emit ProposalApprovalSubmitted(proposalId, approver);
    }

    /**
     * @notice Private function to execute a proposal
     * @dev Before calling this function, be sure that the state of the proposal
     * is Open.
     * @param executor      Executor's address
     * @param proposalId    Proposal ID
     */
    function _execute(address executor, uint256 proposalId)
        private
        returns (bytes memory)
    {
        Proposal storage proposal = _proposals[proposalId];
        address targetContract = proposal.targetContract;
        bytes4 selector = proposal.selector;

        ContractCallType storage callType = _types[targetContract][selector];
        uint256 minApprovals = callType.config.minApprovals;

        require(
            minApprovals > 0 && proposal.approvals.length() >= minApprovals,
            "MultiSigAdmin: proposal needs more approvals"
        );

        // Mark the proposal as executed
        proposal.state = ProposalState.Executed;

        // Remove the proposal ID from openProposals
        callType.openProposals.remove(proposalId);

        // Decrement open proposal count for the proposer
        address proposer = proposal.proposer;
        callType.numOpenProposals[proposer] = callType
            .numOpenProposals[proposer]
            .sub(1);

        emit ProposalExecuted(proposalId, executor);

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returnData) = targetContract.call{
            value: msg.value
        }(abi.encodePacked(selector, proposal.argumentData));

        if (!success) {
            string memory err = "MultiSigAdmin: call failed";

            if (returnData.length <= 68) {
                revert(err);
            }

            // If the reason string exists, extract it, and bubble it up
            assembly {
                // Skip over the first four bytes (the selector)
                returnData := add(returnData, 0x04)
            }
            string memory reason = abi.decode(returnData, (string));
            revert(string(abi.encodePacked(err, ": ", reason)));
        }

        return returnData;
    }
}
