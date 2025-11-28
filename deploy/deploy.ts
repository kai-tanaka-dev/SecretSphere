import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedLottery = await deploy("SecretSphere", {
    from: deployer,
    log: true,
  });

  console.log(`SecretSphere contract: `, deployedLottery.address);
};
export default func;
func.id = "deploy_SecretSphere"; // id required to prevent reexecution
func.tags = ["SecretSphere"];
