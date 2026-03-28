import { useState } from "react";
import { useAccount } from "wagmi";
import { WalletGate } from "./components/WalletGate";
import { ChatInput } from "./components/ChatInput";

export function App() {
  const { address, isConnected } = useAccount();
  const [unlocked, setUnlocked] = useState(false);

  if (!isConnected || !address || !unlocked) {
    return <WalletGate onUnlocked={() => setUnlocked(true)} />;
  }

  return <ChatInput address={address} />;
}
