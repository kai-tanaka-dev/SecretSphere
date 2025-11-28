// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint32, ebool, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SecretSphere
/// @notice Confidential lottery where players pick two encrypted digits and earn encrypted points.
contract SecretSphere is ZamaEthereumConfig {
    uint256 public constant TICKET_PRICE = 0.001 ether;

    address public immutable owner;
    uint256 public totalTickets;
    uint256 public totalDraws;

    struct PlayerState {
        euint32 firstGuess;
        euint32 secondGuess;
        euint32 encryptedPoints;
        euint32 lastWinningFirst;
        euint32 lastWinningSecond;
        bool hasTicket;
        bool hasResult;
        bool hasPoints;
    }

    mapping(address => PlayerState) private players;

    event TicketPurchased(address indexed player);
    event DrawCompleted(address indexed player);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function buyTicket(
        externalEuint32 firstChoice,
        externalEuint32 secondChoice,
        bytes calldata inputProof
    ) external payable {
        require(msg.value == TICKET_PRICE, "Ticket price is 0.001 ether");

        PlayerState storage player = players[msg.sender];
        require(!player.hasTicket, "Active ticket in progress");

        euint32 encryptedFirst = FHE.fromExternal(firstChoice, inputProof);
        euint32 encryptedSecond = FHE.fromExternal(secondChoice, inputProof);

        player.firstGuess = encryptedFirst;
        player.secondGuess = encryptedSecond;
        player.hasTicket = true;
        player.hasResult = false;

        FHE.allowThis(encryptedFirst);
        FHE.allowThis(encryptedSecond);
        FHE.allow(encryptedFirst, msg.sender);
        FHE.allow(encryptedSecond, msg.sender);

        totalTickets += 1;

        emit TicketPurchased(msg.sender);
    }

    function startDraw() external {
        PlayerState storage player = players[msg.sender];
        require(player.hasTicket, "No active ticket");

        euint32 winningFirst = _randomTicketNumber();
        euint32 winningSecond = _randomTicketNumber();

        player.lastWinningFirst = winningFirst;
        player.lastWinningSecond = winningSecond;
        player.hasTicket = false;
        player.hasResult = true;

        FHE.allowThis(winningFirst);
        FHE.allowThis(winningSecond);
        FHE.allow(winningFirst, msg.sender);
        FHE.allow(winningSecond, msg.sender);

        euint32 reward = _calculateReward(player.firstGuess, player.secondGuess, winningFirst, winningSecond);

        if (player.hasPoints) {
            player.encryptedPoints = FHE.add(player.encryptedPoints, reward);
        } else {
            player.encryptedPoints = reward;
            player.hasPoints = true;
        }

        FHE.allowThis(player.encryptedPoints);
        FHE.allow(player.encryptedPoints, msg.sender);

        totalDraws += 1;

        emit DrawCompleted(msg.sender);
    }

    function getTicket(address user) external view returns (euint32, euint32, bool) {
        PlayerState storage player = players[user];
        return (player.firstGuess, player.secondGuess, player.hasTicket);
    }

    function getLastWinningNumbers(address user) external view returns (euint32, euint32, bool) {
        PlayerState storage player = players[user];
        return (player.lastWinningFirst, player.lastWinningSecond, player.hasResult);
    }

    function getEncryptedPoints(address user) external view returns (euint32, bool) {
        PlayerState storage player = players[user];
        return (player.encryptedPoints, player.hasPoints);
    }

    function getPlayerStatus(address user) external view returns (bool hasTicket, bool hasResult, bool hasPoints) {
        PlayerState storage player = players[user];
        return (player.hasTicket, player.hasResult, player.hasPoints);
    }

    function ticketPrice() external pure returns (uint256) {
        return TICKET_PRICE;
    }

    function stats() external view returns (uint256 ticketsSold, uint256 drawsPlayed, uint256 contractBalance) {
        return (totalTickets, totalDraws, address(this).balance);
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount <= address(this).balance, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdraw failed");
    }

    function _randomTicketNumber() private returns (euint32) {
        euint32 raw = FHE.randEuint32();
        euint32 bounded = FHE.rem(raw, 9);
        return FHE.add(bounded, FHE.asEuint32(1));
    }

    function _calculateReward(
        euint32 guessOne,
        euint32 guessTwo,
        euint32 winningFirst,
        euint32 winningSecond
    ) private returns (euint32) {
        ebool firstMatch = FHE.eq(guessOne, winningFirst);
        ebool secondMatch = FHE.eq(guessTwo, winningSecond);

        euint32 matches = FHE.add(
            FHE.select(firstMatch, FHE.asEuint32(1), FHE.asEuint32(0)),
            FHE.select(secondMatch, FHE.asEuint32(1), FHE.asEuint32(0))
        );

        ebool doubleMatch = FHE.eq(matches, FHE.asEuint32(2));
        ebool singleMatch = FHE.eq(matches, FHE.asEuint32(1));

        return FHE.select(
            doubleMatch,
            FHE.asEuint32(1000),
            FHE.select(singleMatch, FHE.asEuint32(100), FHE.asEuint32(0))
        );
    }
}
