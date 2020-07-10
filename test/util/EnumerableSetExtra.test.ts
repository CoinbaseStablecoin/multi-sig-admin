import { EnumerableSetExtraTestInstance } from "../../@types/generated";

const EnumerableSetExtraTest = artifacts.require("EnumerableSetExtraTest");

contract("EnumerableSetExtra", (accounts) => {
  let testContract: EnumerableSetExtraTestInstance;

  beforeEach(async () => {
    testContract = await EnumerableSetExtraTest.new();
  });

  describe("AddressSet", () => {
    describe("elements", async () => {
      it("returns the list of elements in the set", async () => {
        expect(await testContract.elementsInAddressSet()).to.eql([]);

        await testContract.addAddress(accounts[0]);
        expect(await testContract.elementsInAddressSet()).to.eql([accounts[0]]);

        await testContract.addAddress(accounts[1]);
        expect(await testContract.elementsInAddressSet()).to.eql([
          accounts[0],
          accounts[1],
        ]);

        await testContract.addAddress(accounts[2]);
        expect(await testContract.elementsInAddressSet()).to.eql([
          accounts[0],
          accounts[1],
          accounts[2],
        ]);
      });
    });

    describe("clear", async () => {
      it("removes all elements in the set", async () => {
        await testContract.addAddress(accounts[0]);
        await testContract.clearAddressSet();
        expect(await testContract.elementsInAddressSet()).to.eql([]);

        await testContract.addAddress(accounts[0]);
        await testContract.addAddress(accounts[1]);
        expect(await testContract.elementsInAddressSet()).to.eql([
          accounts[0],
          accounts[1],
        ]);
        await testContract.clearAddressSet();
        expect(await testContract.elementsInAddressSet()).to.eql([]);
      });
    });
  });

  describe("UintSet", () => {
    describe("elements", async () => {
      it("returns the list of elements in the set", async () => {
        expect(await testContract.elementsInUintSet()).to.eql([]);

        await testContract.addUint(0);
        expect(
          (await testContract.elementsInUintSet()).map((v) => v.toNumber())
        ).to.eql([0]);

        await testContract.addUint(123);
        expect(
          (await testContract.elementsInUintSet()).map((v) => v.toNumber())
        ).to.eql([0, 123]);

        await testContract.addUint(777);
        expect(
          (await testContract.elementsInUintSet()).map((v) => v.toNumber())
        ).to.eql([0, 123, 777]);
      });
    });
  });
});
