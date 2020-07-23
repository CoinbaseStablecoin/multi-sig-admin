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

pragma solidity 0.6.12;

import { EnumerableSet } from "@openzeppelin/contracts/utils/EnumerableSet.sol";
import { EnumerableSetExtra } from "../util/EnumerableSetExtra.sol";

contract EnumerableSetExtraTest {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetExtra for EnumerableSet.AddressSet;
    using EnumerableSetExtra for EnumerableSet.UintSet;

    EnumerableSet.AddressSet private _addressSet;
    EnumerableSet.UintSet private _uintSet;

    function addAddress(address value) external {
        _addressSet.add(value);
    }

    function addUint(uint256 value) external {
        _uintSet.add(value);
    }

    function elementsInAddressSet() external view returns (address[] memory) {
        return _addressSet.elements();
    }

    function elementsInUintSet() external view returns (uint256[] memory) {
        return _uintSet.elements();
    }

    function clearAddressSet() external {
        _addressSet.clear();
    }
}
