import { AdministrableInstance } from "../../@types/generated";
import { behavesLikeAdministrable } from "./Administrable.behavior";

const Administrable = artifacts.require("Administrable");

contract("Administrable", (accounts) => {
  let administrable: AdministrableInstance;

  beforeEach(async () => {
    administrable = await Administrable.new({ from: accounts[0] });
  });

  behavesLikeAdministrable(async () => administrable, accounts);

  it("initially sets the owner to be the deployer", async () => {
    const owner = await administrable.owner();
    expect(owner).to.equal(accounts[0]);
  });
});
