import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { useState } from "react";

type Status = "idle" | "siwe" | "key" | "done" | "error";

const STATUS_LABELS: Record<Status, string> = {
  idle: "Sign in & Unlock",
  siwe: "Confirming identity...",
  key: "Deriving encryption key...",
  done: "Unlocked!",
  error: "Failed — try again",
};

export function WalletGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<Status>("idle");

  const signIn = async () => {
    if (!address) return;

    try {
      // Step 1: SIWE — verify identity
      setStatus("siwe");
      const nonce = await fetch("/api/auth/nonce").then((r) => r.text());
      const siweMsg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to EigenPA",
        uri: window.location.origin,
        version: "1",
        chainId: 1,
        nonce,
      });
      const prepared = siweMsg.prepareMessage();
      const siweSig = await signMessageAsync({ message: prepared });
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prepared, signature: siweSig }),
      });
      if (!verifyRes.ok) throw new Error("SIWE verification failed");

      // Step 2: Deterministic signature for encryption key derivation
      setStatus("key");
      const keyMessage = [
        "Derive encryption key for EigenPA",
        `Address: ${address}`,
        "Version: 1",
      ].join("\n");
      const keySig = await signMessageAsync({ message: keyMessage });
      const unlockRes = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keySig }),
      });
      if (!unlockRes.ok) throw new Error("Key derivation failed");

      setStatus("done");
      onUnlocked();
    } catch (err) {
      console.error("Sign-in failed:", err);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "100vh",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>EigenPA</h1>
        <p style={{ opacity: 0.6, marginBottom: "2rem" }}>
          Personal assistant with encrypted per-user storage
        </p>

        {!isConnected ? (
          <ConnectButton />
        ) : (
          <button
            onClick={signIn}
            disabled={status !== "idle" && status !== "error"}
            style={{
              padding: "0.75rem 2rem",
              fontSize: "1rem",
              background: status === "error" ? "#cc3333" : "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor:
                status === "idle" || status === "error"
                  ? "pointer"
                  : "not-allowed",
              opacity:
                status === "idle" || status === "error" ? 1 : 0.7,
            }}
          >
            {STATUS_LABELS[status]}
          </button>
        )}
      </div>
    </div>
  );
}
