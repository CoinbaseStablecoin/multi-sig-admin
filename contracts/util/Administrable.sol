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

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/EnumerableSet.sol";
import { EnumerableSetExtra } from "./EnumerableSetExtra.sol";

/**
 * @title Administrable
 * @notice Enable a contract to have multiple administrators that can perform
 * privileged actions.
 */
contract Administrable is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSetExtra for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _admins;

    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);

    /**
     * @notice Ensure that the caller is an admin
     */
    modifier onlyAdmin() {
        require(
            _admins.contains(msg.sender),
            "Administrable: caller is not an admin"
        );
        _;
    }

    /**
     * @notice Check whether a given address is of an admin
     * @param account   Address to check
     * @return True if admin
     */
    function isAdmin(address account) external view returns (bool) {
        return _admins.contains(account);
    }

    /**
     * @notice List of admins
     * @return Addresses of the admins
     */
    function getAdmins() external view returns (address[] memory) {
        return _admins.elements();
    }

    /**
     * @notice Add new admins
     * @param accounts  Addresses of the new admins to add
     */
    function addAdmins(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _addAdmin(accounts[i]);
        }
    }

    /**
     * @notice Remove existing admins
     * @param accounts  Addresses of the admins to remove
     */
    function removeAdmins(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _removeAdmin(accounts[i]);
        }
    }

    function _addAdmin(address account) private {
        require(
            account != address(0),
            "Administrable: given account is the zero address"
        );
        require(
            _admins.add(account),
            "Administrable: given account is already an admin"
        );

        emit AdminAdded(account);
    }

    function _removeAdmin(address account) private {
        require(
            _admins.remove(account),
            "Administrable: given account is not an admin"
        );

        emit AdminRemoved(account);
    }

    /**
     * @dev Disable renounceOwnership() in Ownable
     */
    function renounceOwnership() public override onlyOwner {
        revert("Administrable: ownership cannot be renounced");
    }
}
