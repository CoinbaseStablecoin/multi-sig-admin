const MultiSigAdmin = artifacts.require("MultiSigAdmin");

module.exports = async (deployer, _network) => {
  await deployer.deploy(MultiSigAdmin);
};
