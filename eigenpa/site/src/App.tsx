import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { WalletGate } from "./components/WalletGate";
import { Chat } from "./components/Chat";

export function App() {
  const { address, isConnected } = useAccount();
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);

  // On mount, check if we already have an active session
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (res.ok) setUnlocked(true);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null; // Avoid flash while checking session

  if (!isConnected || !address || !unlocked) {
    return <WalletGate onUnlocked={() => setUnlocked(true)} />;
  }

  return <Chat address={address} />;
}
