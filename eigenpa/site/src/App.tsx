import { useState } from "react";
import { useAccount } from "wagmi";
import { WalletGate } from "./components/WalletGate";
import { Chat } from "./components/Chat";

export function App() {
  const { address, isConnected } = useAccount();
  const [unlocked, setUnlocked] = useState(false);

  if (!isConnected || !address || !unlocked) {
    return <WalletGate onUnlocked={() => setUnlocked(true)} />;
  }

  return <Chat address={address} />;
}
