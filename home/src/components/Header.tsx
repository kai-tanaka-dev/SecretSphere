import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="lottery-header">
      <div className="lottery-header__container">
        <div className="lottery-header__content">
          <div>
            <p className="lottery-header__eyebrow">SecretSphere</p>
            <h1 className="lottery-header__title">Encrypted Double Draw</h1>
            <p className="lottery-header__subtitle">
              Pick two digits between 1 and 9, keep them encrypted with Zama FHE, and reveal your rewards only when you decrypt them.
            </p>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
