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

contract TestTarget is Ownable {
    string private _foo;
    uint256 private _bar;

    event SetFooCalled(address indexed caller, string value);
    event SetBarCalled(address indexed caller, uint256 value);
    event ReceiveCalled(address indexed caller, uint256 value);
    event FallbackCalled(address indexed caller, uint256 value);

    constructor() public Ownable() {}

    function setFoo(string calldata foo)
        external
        payable
        onlyOwner
        returns (bool)
    {
        _foo = foo;
        emit SetFooCalled(msg.sender, foo);
        return true;
    }

    function getFoo() external view returns (string memory) {
        return _foo;
    }

    function setBar(uint256 bar) external payable onlyOwner returns (bool) {
        _bar = bar;
        emit SetBarCalled(msg.sender, bar);
        return true;
    }

    function getBar() external view returns (uint256) {
        return _bar;
    }

    function revertWithError(string calldata err) external pure {
        revert(err);
    }

    function revertWithoutError() external pure {
        // solhint-disable-next-line reason-string
        revert();
    }

    receive() external payable {
        emit ReceiveCalled(msg.sender, msg.value);
    }

    fallback() external payable {
        emit FallbackCalled(msg.sender, msg.value);
    }
}
