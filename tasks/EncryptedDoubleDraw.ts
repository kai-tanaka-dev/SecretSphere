import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

const CONTRACT_NAME = "EncryptedDoubleDraw";

async function resolveDeployment(hre: any, providedAddress?: string) {
  if (providedAddress) {
    return { address: providedAddress };
  }

  return hre.deployments.get(CONTRACT_NAME);
}

task("lottery:address", "Prints the EncryptedDoubleDraw contract address")
  .addOptionalParam("address", "Optional contract address override")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const deployment = await resolveDeployment(hre, taskArguments.address as string | undefined);
    console.log(`EncryptedDoubleDraw address: ${deployment.address}`);
  });

task("lottery:buy", "Buys a lottery ticket with two encrypted numbers")
  .addParam("first", "First number (1-9)")
  .addParam("second", "Second number (1-9)")
  .addOptionalParam("address", "Optional contract address override")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    const deployment = await resolveDeployment(hre, taskArguments.address as string | undefined);
    const lottery = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const [signer] = await ethers.getSigners();

    const first = parseInt(taskArguments.first);
    const second = parseInt(taskArguments.second);
    if (![first, second].every((value) => Number.isInteger(value) && value >= 1 && value <= 9)) {
      throw new Error("Both numbers must be integers between 1 and 9");
    }

    await fhevm.initializeCLIApi();

    const encryptedBuffer = await fhevm.createEncryptedInput(deployment.address, signer.address);
    encryptedBuffer.add32(first);
    encryptedBuffer.add32(second);
    const encryptedPayload = await encryptedBuffer.encrypt();

    const ticketPrice = await lottery.ticketPrice();
    const tx = await lottery
      .connect(signer)
      .buyTicket(encryptedPayload.handles[0], encryptedPayload.handles[1], encryptedPayload.inputProof, {
        value: ticketPrice,
      });

    console.log(`Submitted ticket tx: ${tx.hash}`);
    await tx.wait();
    console.log("Ticket confirmed.");
  });

task("lottery:draw", "Triggers a draw for the caller")
  .addOptionalParam("address", "Optional contract address override")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers } = hre;
    const deployment = await resolveDeployment(hre, taskArguments.address as string | undefined);
    const lottery = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const [signer] = await ethers.getSigners();

    const tx = await lottery.connect(signer).startDraw();
    console.log(`Drawing numbers tx: ${tx.hash}`);
    await tx.wait();
    console.log("Draw completed.");
  });

task("lottery:decrypt", "Decrypts your encrypted points and last winning numbers")
  .addOptionalParam("address", "Optional contract address override")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await resolveDeployment(hre, taskArguments.address as string | undefined);
    const lottery = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
    const [signer] = await ethers.getSigners();

    const [encryptedPoints, hasPoints] = await lottery.getEncryptedPoints(signer.address);
    if (!hasPoints) {
      console.log("No score stored yet.");
    } else {
      const clearPoints = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encryptedPoints,
        deployment.address,
        signer,
      );
      console.log(`Encrypted points: ${encryptedPoints}`);
      console.log(`Decrypted points: ${clearPoints}`);
    }

    const [winFirst, winSecond, hasResult] = await lottery.getLastWinningNumbers(signer.address);
    if (!hasResult) {
      console.log("No draw result available.");
      return;
    }

    const clearFirst = await fhevm.userDecryptEuint(FhevmType.euint32, winFirst, deployment.address, signer);
    const clearSecond = await fhevm.userDecryptEuint(FhevmType.euint32, winSecond, deployment.address, signer);
    console.log(`Winning numbers encrypted: [${winFirst}, ${winSecond}]`);
    console.log(`Winning numbers decrypted: [${clearFirst}, ${clearSecond}]`);
  });
