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

import { EnumerableSet } from "@openzeppelin/contracts/utils/EnumerableSet.sol";

/**
 * @notice Extra functions for enumerable sets
 */
library EnumerableSetExtra {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    /**
     * @notice Remove all elements from the address set
     */
    function clear(EnumerableSet.AddressSet storage set) internal {
        bytes32[] storage values = set._inner._values;
        mapping(bytes32 => uint256) storage indexes = set._inner._indexes;
        uint256 count = values.length;
        for (uint256 i = 0; i < count; i++) {
            delete indexes[values[i]];
        }
        delete set._inner._values;
    }

    /**
     * @notice Return all elements in the address set as an array
     */
    function elements(EnumerableSet.AddressSet storage set)
        internal
        view
        returns (address[] memory)
    {
        uint256 count = set.length();
        address[] memory list = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            list[i] = set.at(i);
        }
        return list;
    }

    /**
     * @notice Return all elements in the uint set as an array
     */
    function elements(EnumerableSet.UintSet storage set)
        internal
        view
        returns (uint256[] memory)
    {
        uint256 count = set.length();
        uint256[] memory list = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            list[i] = set.at(i);
        }
        return list;
    }
}
