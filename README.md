# SecretSphere: Encrypted Double Draw

SecretSphere is a fully homomorphic encryption (FHE) lottery that keeps every player choice and reward private on-chain. Players spend `0.001 ETH` to buy a ticket, pick two digits between `1-9`, trigger their own draw, and later decrypt their encrypted winnings. Zama’s FHEVM stack powers the confidentiality end-to-end, while a React + Vite frontend offers a clean RainbowKit-powered UX on Sepolia.

## Why it matters
- **On-chain privacy for games:** Ticket picks, winning numbers, and scores stay encrypted. Only the owner can decrypt their state through user decryption.
- **Fair draws without data leakage:** Winning numbers are generated inside the contract with `FHE.randEuint32`, bounded to `1-9`, so guesses remain hidden even from validators.
- **Self-service lifecycle:** Users encrypt inputs client-side, run draws themselves, and decrypt outcomes locally. No custodial backend or mock data.
- **Provable rewards:** Reward tiers are deterministic (1 match = 100 pts, 2 matches = 1000 pts) and stored as encrypted balances that accumulate across rounds.

## Game rules at a glance
- Ticket price: `0.001 ETH` (`TICKET_PRICE` constant).
- Choices: two digits from `1` to `9`, encrypted before submission.
- Draw: player calls `startDraw()` to generate encrypted winning digits.
- Rewards: 1 match → 100 points; 2 matches → 1000 points; all points remain encrypted until user decryption.
- Views: `getTicket`, `getLastWinningNumbers`, `getEncryptedPoints`, `getPlayerStatus`, `stats`, `ticketPrice`.
- Owner controls: `withdraw(to, amount)` to move funds from the contract balance.

## Tech stack
- **Smart contracts:** Solidity `0.8.27`, Hardhat, `@fhevm/solidity`, Hardhat Deploy, TypeChain, Solidity coverage.
- **FHE tooling:** `@fhevm/hardhat-plugin` for encryption helpers and mock testing, random encrypted draws, ACL grants for user decryption.
- **Frontend:** React + Vite + TypeScript, RainbowKit for wallet UX, wagmi/viem for reads, ethers for writes, `@zama-fhe/relayer-sdk` (bundle) for encryption, input proofs, and user decryption flows. No Tailwind or env vars in the UI.
- **Network:** Sepolia by default via Infura; local Hardhat network for development.

## Repository layout
- `contracts/EncryptedDoubleDraw.sol` — Confidential lottery logic (encrypted guesses, draws, rewards, stats).
- `deploy/deploy.ts` — Hardhat Deploy script for the contract.
- `tasks/EncryptedDoubleDraw.ts` — CLI helpers to buy, draw, decrypt, and print addresses.
- `test/EncryptedDoubleDraw.ts` — FHE-enabled test suite with TypeChain types.
- `deployments/` — Generated ABIs and addresses (copy the Sepolia ABI/address into the frontend config after deployment).
- `home/` — React frontend (`LotteryApp`) using RainbowKit + Zama relayer SDK.

## Prerequisites
- Node.js ≥ 20 and npm.
- An Infura API key for Sepolia RPC.
- A funded Sepolia private key (no mnemonics) for deployment and transactions.

## Backend / contracts workflow
1. Install dependencies (root):
   ```bash
   npm install
   ```
2. Environment (`.env` in repo root):
   ```bash
   PRIVATE_KEY=your_sepolia_private_key_without_0x
   INFURA_API_KEY=your_infura_project_id
   ETHERSCAN_API_KEY=optional_for_verification
   ```
3. Compile and types:
   ```bash
   npm run compile
   ```
4. Tests (mocked FHE runtime):
   ```bash
   npm run test            # unit tests with fhevm mock
   npm run coverage        # optional coverage
   ```
5. Local node and deploy:
   ```bash
   npm run chain           # hardhat node (no deploy)
   npm run deploy:localhost
   ```
6. Sepolia deploy & verify:
   ```bash
   npm run deploy:sepolia
   npm run verify:sepolia <deployed_address>
   ```
7. Hardhat tasks (examples):
   ```bash
   npx hardhat lottery:address --network sepolia
   npx hardhat lottery:buy --first 2 --second 8 --network sepolia
   npx hardhat lottery:draw --network sepolia
   npx hardhat lottery:decrypt --network sepolia
   ```
   Tasks use `fhevm.createEncryptedInput` to encrypt picks and `userDecryptEuint` to reveal scores.

## Frontend workflow (`home/`)
1. Install:
   ```bash
   cd home
   npm install
   ```
2. WalletConnect project ID: update `home/src/config/wagmi.ts` (`projectId`) with your WalletConnect Cloud ID.
3. Contract wiring:
   - Deploy the contract.
   - Copy the Sepolia ABI/address from `deployments/sepolia/EncryptedDoubleDraw.json`.
   - Paste the address and ABI into `home/src/config/contracts.ts` (frontend uses only the generated ABI; no `.env` files).
4. Run:
   ```bash
   npm run dev      # Vite dev server
   npm run build    # production build
   npm run preview  # preview built app
   ```
5. Usage flow:
   - Connect wallet (RainbowKit, Sepolia).
   - Pick two digits (1–9); encryption happens client-side via Zama relayer SDK.
   - Buy ticket with `0.001 ETH`.
   - Trigger `Start draw` to generate encrypted winning numbers.
   - Decrypt winnings or scores with user decryption (keys generated on the fly; signatures requested via EIP-712).

## Architecture notes
- **Confidential data path:** Client encrypts guesses → contract stores encrypted values → contract generates encrypted winners → rewards computed and stored as ciphertext → users decrypt locally through relayer SDK user-decrypt.
- **ACL hygiene:** Contract grants `allowThis` for internal reuse and `allow(user)` so players can decrypt their own ciphertexts.
- **Randomness:** `FHE.randEuint32()` bounded to `1-9` inside `_randomTicketNumber`; no plaintext leakage.
- **Deterministic rewards:** Reward calculation uses encrypted comparisons and selections, avoiding observable branches.
- **Metrics:** `stats()` exposes ticket count, draw count, and contract balance for UI display (pool is shown after viem formatting).

## Problems solved
- Keeps betting inputs and results private while staying fully on-chain.
- Removes the need for custom Gateway handling by using the Relayer SDK.
- Prevents inference attacks by checking sender access before decryption (reads avoid `msg.sender` in view paths).
- Provides reproducible tasks and tests to validate the full FHE pipeline locally before going to Sepolia.

## Future roadmap
- Global leaderboard with encrypted score snapshots and per-user decryption.
- Multiple concurrent games or pooled draws with time-based rounds.
- Frontend polish for mobile-first animations and richer error states.
- Automated ABI/address sync from `deployments/` into the frontend config.
- Optional oracle-based public decryption for provable community draws.

## Troubleshooting
- **FHE init issues:** Ensure `@fhevm/hardhat-plugin` is installed and `npm run compile` succeeds; tests skip if FHE mock is unavailable.
- **Relayer SDK errors in UI:** Reload after setting WalletConnect project ID and confirm Sepolia RPC availability.
- **Empty ciphertexts:** Play at least one round; decryption buttons are disabled until ciphertext handles exist.

## License
BSD-3-Clause-Clear. See `LICENSE`.
