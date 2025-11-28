import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import { EncryptedDoubleDraw, EncryptedDoubleDraw__factory } from "../types";

const TICKET_PRICE = ethers.parseEther("0.001");

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("EncryptedDoubleDraw")) as EncryptedDoubleDraw__factory;
  const contract = (await factory.deploy()) as EncryptedDoubleDraw;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress };
}

async function encryptGuess(
  contractAddress: string,
  player: HardhatEthersSigner,
  first: number,
  second: number,
) {
  const buffer = await fhevm.createEncryptedInput(contractAddress, player.address);
  buffer.add32(first);
  buffer.add32(second);
  return buffer.encrypt();
}

async function decryptValue(
  ciphertext: string,
  contractAddress: string,
  signer: HardhatEthersSigner,
) {
  const value = await fhevm.userDecryptEuint(FhevmType.euint32, ciphertext, contractAddress, signer);
  return Number(value);
}

describe("EncryptedDoubleDraw", function () {
  let signers: Signers;
  let lottery: EncryptedDoubleDraw;
  let lotteryAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    ({ contract: lottery, contractAddress: lotteryAddress } = await deployFixture());
  });

  it("stores encrypted guesses for the buyer", async function () {
    const encryptedInput = await encryptGuess(lotteryAddress, signers.alice, 2, 8);
    await lottery
      .connect(signers.alice)
      .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
        value: TICKET_PRICE,
      });

    const [encFirst, encSecond, hasTicket] = await lottery.getTicket(signers.alice.address);
    expect(hasTicket).to.be.true;

    const clearFirst = await decryptValue(encFirst, lotteryAddress, signers.alice);
    const clearSecond = await decryptValue(encSecond, lotteryAddress, signers.alice);

    expect(clearFirst).to.equal(2);
    expect(clearSecond).to.equal(8);
  });

  it("requires exact ticket price and single active ticket", async function () {
    const encryptedInput = await encryptGuess(lotteryAddress, signers.alice, 5, 7);

    await expect(
      lottery
        .connect(signers.alice)
        .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
          value: 0,
        }),
    ).to.be.revertedWith("Ticket price is 0.001 ether");

    await lottery
      .connect(signers.alice)
      .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
        value: TICKET_PRICE,
      });

    await expect(
      lottery
        .connect(signers.alice)
        .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
          value: TICKET_PRICE,
        }),
    ).to.be.revertedWith("Active ticket in progress");
  });

  it("draws numbers, tracks stats, and exposes encrypted outputs", async function () {
    const encryptedInput = await encryptGuess(lotteryAddress, signers.alice, 1, 9);
    await lottery
      .connect(signers.alice)
      .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
        value: TICKET_PRICE,
      });

    const tx = await lottery.connect(signers.alice).startDraw();
    await tx.wait();

    const status = await lottery.getPlayerStatus(signers.alice.address);
    expect(status.hasTicket).to.be.false;
    expect(status.hasResult).to.be.true;
    expect(status.hasPoints).to.be.true;

    const [pointsCipher] = await lottery.getEncryptedPoints(signers.alice.address);
    const clearPoints = await decryptValue(pointsCipher, lotteryAddress, signers.alice);
    expect([0, 100, 1000]).to.include(clearPoints);

    const [winFirst, winSecond, hasResult] = await lottery.getLastWinningNumbers(signers.alice.address);
    expect(hasResult).to.be.true;
    const first = await decryptValue(winFirst, lotteryAddress, signers.alice);
    const second = await decryptValue(winSecond, lotteryAddress, signers.alice);
    expect(first).to.be.greaterThanOrEqual(1);
    expect(first).to.be.lessThanOrEqual(9);
    expect(second).to.be.greaterThanOrEqual(1);
    expect(second).to.be.lessThanOrEqual(9);

    const [ticketsSold, drawsPlayed, balance] = await lottery.stats();
    expect(ticketsSold).to.equal(1n);
    expect(drawsPlayed).to.equal(1n);
    expect(balance).to.equal(TICKET_PRICE);
  });

  it("accumulates encrypted points across rounds", async function () {
    const encryptedInput = await encryptGuess(lotteryAddress, signers.alice, 4, 6);

    await lottery
      .connect(signers.alice)
      .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
        value: TICKET_PRICE,
      });
    await lottery.connect(signers.alice).startDraw();
    const [firstCipher] = await lottery.getEncryptedPoints(signers.alice.address);
    const firstScore = await decryptValue(firstCipher, lotteryAddress, signers.alice);

    const encryptedSecondInput = await encryptGuess(lotteryAddress, signers.alice, 3, 5);
    await lottery
      .connect(signers.alice)
      .buyTicket(
        encryptedSecondInput.handles[0],
        encryptedSecondInput.handles[1],
        encryptedSecondInput.inputProof,
        {
          value: TICKET_PRICE,
        },
      );
    await lottery.connect(signers.alice).startDraw();
    const [secondCipher] = await lottery.getEncryptedPoints(signers.alice.address);
    const secondScore = await decryptValue(secondCipher, lotteryAddress, signers.alice);

    expect(secondScore).to.be.greaterThanOrEqual(firstScore);
  });

  it("only allows the owner to withdraw contract balance", async function () {
    const encryptedInput = await encryptGuess(lotteryAddress, signers.alice, 7, 2);
    await lottery
      .connect(signers.alice)
      .buyTicket(encryptedInput.handles[0], encryptedInput.handles[1], encryptedInput.inputProof, {
        value: TICKET_PRICE,
      });

    await expect(
      lottery.connect(signers.alice).withdraw(signers.alice.address, TICKET_PRICE),
    ).to.be.revertedWith("Only owner");

    const bobBalanceBefore = await ethers.provider.getBalance(signers.bob.address);
    const withdrawTx = await lottery.connect(signers.deployer).withdraw(signers.bob.address, TICKET_PRICE);
    await withdrawTx.wait();

    const bobBalanceAfter = await ethers.provider.getBalance(signers.bob.address);
    expect(bobBalanceAfter - bobBalanceBefore).to.equal(TICKET_PRICE);
  });
});
