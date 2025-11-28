import { useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { formatEther } from 'viem';
import { useAccount, useReadContract } from 'wagmi';

import { Header } from './Header';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../config/contracts';
import '../styles/LotteryApp.css';

const NUMBER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ZERO_CIPHER = '0x0000000000000000000000000000000000000000000000000000000000000000';

export function LotteryApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [firstChoice, setFirstChoice] = useState<number | null>(null);
  const [secondChoice, setSecondChoice] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [decryptedPoints, setDecryptedPoints] = useState<number | null>(null);
  const [decryptedWinning, setDecryptedWinning] = useState<{ first: number; second: number } | null>(null);
  const [decryptingPoints, setDecryptingPoints] = useState(false);
  const [decryptingResults, setDecryptingResults] = useState(false);

  const ticketPriceQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'ticketPrice',
  });

  const statsQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'stats',
  });

  const statusQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'getPlayerStatus',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  const ticketQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'getTicket',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  const pointsQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'getEncryptedPoints',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  const resultQuery = useReadContract({
    abi: CONTRACT_ABI,
    address: CONTRACT_ADDRESS,
    functionName: 'getLastWinningNumbers',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  });

  const ticketPrice = ticketPriceQuery.data ? formatEther(ticketPriceQuery.data as bigint) : '0.001';
  const stats = statsQuery.data
    ? {
        tickets: Number((statsQuery.data as readonly [bigint, bigint, bigint])[0]),
        draws: Number((statsQuery.data as readonly [bigint, bigint, bigint])[1]),
        pool: formatEther((statsQuery.data as readonly [bigint, bigint, bigint])[2]),
      }
    : { tickets: 0, draws: 0, pool: '0.000' };

  const status = statusQuery.data
    ? {
        hasTicket: Boolean((statusQuery.data as readonly [boolean, boolean, boolean])[0]),
        hasResult: Boolean((statusQuery.data as readonly [boolean, boolean, boolean])[1]),
        hasPoints: Boolean((statusQuery.data as readonly [boolean, boolean, boolean])[2]),
      }
    : { hasTicket: false, hasResult: false, hasPoints: false };

  const pointsData = pointsQuery.data as readonly [string, boolean] | undefined;
  const resultData = resultQuery.data as readonly [string, string, boolean] | undefined;

  const disabledPurchase =
    !isConnected || !instance || zamaLoading || status.hasTicket || buying || firstChoice === null || secondChoice === null;
  const disabledDraw = !status.hasTicket || drawing || !signerPromise || !instance;
  const encryptedPointsValue = pointsData?.[0] ?? ZERO_CIPHER;
  const encryptedWinningFirst = resultData?.[0] ?? ZERO_CIPHER;
  const encryptedWinningSecond = resultData?.[1] ?? ZERO_CIPHER;

  const formatCipher = (value: string | undefined) => {
    if (!value || value === ZERO_CIPHER) {
      return '--';
    }
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
  };

  const resetDecryptedViews = () => {
    setDecryptedPoints(null);
    setDecryptedWinning(null);
  };

  const refreshPlayerState = async () => {
    await Promise.all([
      statusQuery.refetch?.(),
      ticketQuery.refetch?.(),
      pointsQuery.refetch?.(),
      resultQuery.refetch?.(),
      statsQuery.refetch?.(),
    ]);
  };

  const handlePurchase = async () => {
    if (!address) {
      setErrorMessage('Connect your wallet to buy a ticket.');
      return;
    }
    if (!instance) {
      setErrorMessage('Encryption service is not ready yet.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setErrorMessage('Signer is not available.');
      return;
    }
    if (firstChoice === null || secondChoice === null) {
      setErrorMessage('Choose both digits before buying a ticket.');
      return;
    }

    setErrorMessage('');
    setActionMessage('Encrypting your picks...');
    setBuying(true);

    try {
      const buffer = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
      buffer.add32(firstChoice);
      buffer.add32(secondChoice);
      const encryptedInput = await buffer.encrypt();

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const priceOnChain = await contract.ticketPrice();
      setActionMessage('Waiting for wallet confirmation...');
      const tx = await contract.buyTicket(
        encryptedInput.handles[0],
        encryptedInput.handles[1],
        encryptedInput.inputProof,
        {
          value: priceOnChain,
        },
      );
      setTxHash(tx.hash);
      setActionMessage('Submitting transaction...');
      await tx.wait();

      setActionMessage('Ticket confirmed!');
      setFirstChoice(null);
      setSecondChoice(null);
      resetDecryptedViews();
      await refreshPlayerState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ticket purchase failed.';
      setErrorMessage(message);
      setActionMessage('');
    } finally {
      setBuying(false);
    }
  };

  const handleDraw = async () => {
    if (!address) {
      setErrorMessage('Connect your wallet to start a draw.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setErrorMessage('Signer is not available.');
      return;
    }

    setDrawing(true);
    setErrorMessage('');
    setActionMessage('Generating encrypted winning numbers...');

    try {
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.startDraw();
      setTxHash(tx.hash);
      setActionMessage('Waiting for draw confirmation...');
      await tx.wait();

      setActionMessage('Draw completed!');
      resetDecryptedViews();
      await refreshPlayerState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Draw failed.';
      setErrorMessage(message);
      setActionMessage('');
    } finally {
      setDrawing(false);
    }
  };

  const performDecryption = async (handles: { handle: string; contractAddress: string }[]) => {
    if (!instance || !address) {
      throw new Error('Encryption service is not ready.');
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      throw new Error('Signer is not available for decryption.');
    }

    const keypair = instance.generateKeypair();
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = '10';
    const contractAddresses = [CONTRACT_ADDRESS];

    const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
      },
      eip712.message,
    );

    const decrypted = await instance.userDecrypt(
      handles,
      keypair.privateKey,
      keypair.publicKey,
      signature.replace('0x', ''),
      contractAddresses,
      address,
      startTimeStamp,
      durationDays,
    );

    return decrypted as Record<string, string>;
  };

  const handleDecryptPoints = async () => {
    if (!pointsData?.[1]) {
      setErrorMessage('Play one round before decrypting your score.');
      return;
    }
    setDecryptingPoints(true);
    setErrorMessage('');

    try {
      const cipher = pointsData[0];
      const decrypted = await performDecryption([{ handle: cipher, contractAddress: CONTRACT_ADDRESS }]);
      const score = Number(decrypted[cipher]);
      setDecryptedPoints(score);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to decrypt points.';
      setErrorMessage(message);
    } finally {
      setDecryptingPoints(false);
    }
  };

  const handleDecryptResults = async () => {
    if (!resultData?.[2]) {
      setErrorMessage('Trigger a draw to reveal the last winning numbers.');
      return;
    }
    setDecryptingResults(true);
    setErrorMessage('');

    try {
      const pairs = [
        { handle: encryptedWinningFirst, contractAddress: CONTRACT_ADDRESS },
        { handle: encryptedWinningSecond, contractAddress: CONTRACT_ADDRESS },
      ];
      const decrypted = await performDecryption(pairs);
      setDecryptedWinning({
        first: Number(decrypted[encryptedWinningFirst]),
        second: Number(decrypted[encryptedWinningSecond]),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to decrypt winning numbers.';
      setErrorMessage(message);
    } finally {
      setDecryptingResults(false);
    }
  };

  const statusChips = useMemo(
    () => [
      { label: 'Ticket locked', active: status.hasTicket },
      { label: 'Result ready', active: status.hasResult },
      { label: 'Score stored', active: status.hasPoints },
    ],
    [status.hasResult, status.hasPoints, status.hasTicket],
  );

  return (
    <div className="lottery-app">
      <Header />
      <main className="lottery-content">
        <section className="hero-card">
          <div>
            <p className="hero-eyebrow">Encrypted gaming</p>
            <h2 className="hero-title">Two mystery digits. Zero leaks.</h2>
            <p className="hero-description">
              Each ticket costs {ticketPrice} ETH. Numbers and rewards stay encrypted with Zama FHE, so only you can decrypt the outcome.
            </p>
          </div>
          <div className="hero-stats">
            <div>
              <span className="hero-stat-value">{stats.tickets}</span>
              <span className="hero-stat-label">Tickets sold</span>
            </div>
            <div>
              <span className="hero-stat-value">{stats.draws}</span>
              <span className="hero-stat-label">Draws settled</span>
            </div>
            <div>
              <span className="hero-stat-value">{Number(stats.pool).toFixed(3)} ETH</span>
              <span className="hero-stat-label">Encrypted pool</span>
            </div>
          </div>
        </section>

        {zamaError && (
          <div className="notice notice-error">
            ⚠️ {zamaError}
          </div>
        )}

        <section className="lottery-grid">
          <div className="lottery-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Step 1</p>
                <h3 className="card-title">Pick your hidden digits</h3>
              </div>
              <p className="card-note">Numbers 1 - 9</p>
            </div>
            <div className="number-pickers">
              <div className="number-column">
                <p className="number-label">First number</p>
                <div className="number-grid">
                  {NUMBER_OPTIONS.map((option) => (
                    <button
                      key={`first-${option}`}
                      className={`number-button ${firstChoice === option ? 'active' : ''}`}
                      onClick={() => setFirstChoice(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              <div className="number-column">
                <p className="number-label">Second number</p>
                <div className="number-grid">
                  {NUMBER_OPTIONS.map((option) => (
                    <button
                      key={`second-${option}`}
                      className={`number-button ${secondChoice === option ? 'active' : ''}`}
                      onClick={() => setSecondChoice(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="help-text">Selections are encrypted client-side before reaching the blockchain.</p>
          </div>

          <div className="lottery-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Step 2</p>
                <h3 className="card-title">Send ticket & trigger draw</h3>
              </div>
              <div className="status-chips">
                {statusChips.map((chip) => (
                  <span key={chip.label} className={`status-chip ${chip.active ? 'active' : ''}`}>
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>

            {!isConnected ? (
              <p className="placeholder">Connect your wallet to start playing.</p>
            ) : (
              <>
                <div className="ticket-summary">
                  <div>
                    <p className="summary-label">Current selection</p>
                    <p className="summary-value">
                      {firstChoice ?? '--'} & {secondChoice ?? '--'}
                    </p>
                  </div>
                  <div>
                    <p className="summary-label">Ticket price</p>
                    <p className="summary-value">{ticketPrice} ETH</p>
                  </div>
                </div>

                <div className="action-buttons">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handlePurchase}
                    disabled={disabledPurchase}
                  >
                    {buying ? 'Submitting...' : 'Buy encrypted ticket'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleDraw}
                    disabled={disabledDraw}
                  >
                    {drawing ? 'Drawing...' : 'Start draw'}
                  </button>
                </div>

                {actionMessage && <p className="status-message">{actionMessage}</p>}
                {txHash && (
                  <p className="status-message">
                    Last tx:{" "}
                    <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
                      {txHash.slice(0, 10)}...
                    </a>
                  </p>
                )}
                {errorMessage && <p className="error-message">{errorMessage}</p>}
              </>
            )}
          </div>
        </section>

        <section className="lottery-grid secondary">
          <div className="lottery-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Step 3</p>
                <h3 className="card-title">Reveal encrypted winnings</h3>
              </div>
            </div>
            <div className="data-list">
              <div className="data-row">
                <p className="data-label">Winning numbers (encrypted)</p>
                <p className="data-value">
                  {formatCipher(encryptedWinningFirst)} / {formatCipher(encryptedWinningSecond)}
                </p>
              </div>
              <div className="data-row">
                <p className="data-label">Winning numbers (decrypted)</p>
                <p className="data-value">
                  {decryptedWinning ? `${decryptedWinning.first} & ${decryptedWinning.second}` : 'Decrypt to view'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleDecryptResults}
              disabled={decryptingResults || !instance || !isConnected}
            >
              {decryptingResults ? 'Decrypting...' : 'Decrypt winning numbers'}
            </button>
          </div>

          <div className="lottery-card">
            <div className="card-header">
              <div>
                <p className="card-eyebrow">Encrypted rewards</p>
                <h3 className="card-title">Your score vault</h3>
              </div>
            </div>
            <div className="data-list">
              <div className="data-row">
                <p className="data-label">Encrypted points</p>
                <p className="data-value">{formatCipher(encryptedPointsValue)}</p>
              </div>
              <div className="data-row">
                <p className="data-label">Decrypted points</p>
                <p className="data-value">{decryptedPoints ?? 'Decrypt to view'}</p>
              </div>
              <div className="data-row">
                <p className="data-label">Reward tiers</p>
                <p className="data-value">1 match = 100 pts · 2 matches = 1000 pts</p>
              </div>
            </div>
            <button
              type="button"
              className="primary-button ghost"
              onClick={handleDecryptPoints}
              disabled={decryptingPoints || !instance || !isConnected}
            >
              {decryptingPoints ? 'Decrypting...' : 'Decrypt my points'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
