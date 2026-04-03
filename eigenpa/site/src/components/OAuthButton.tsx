import { useState, useEffect, useCallback } from "react";

interface OAuthButtonProps {
  integrationId: string;
  name: string;
  reason: string;
  oauthUrl: string;
  onConnected?: (integrationId: string) => void;
}

export function OAuthButton({
  integrationId,
  name,
  reason,
  oauthUrl,
  onConnected,
}: OAuthButtonProps) {
  const [status, setStatus] = useState<"idle" | "pending" | "connected">(
    "idle"
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (
        event.data?.type === "oauth_complete" &&
        event.data?.integrationId === integrationId
      ) {
        setStatus("connected");
        onConnected?.(integrationId);
      }
    },
    [integrationId, onConnected]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  if (status === "connected") {
    return (
      <div
        style={{
          padding: "1rem",
          background: "#1a2e1a",
          borderRadius: "12px",
          margin: "0.5rem 0",
          border: "1px solid #2a4a2a",
        }}
      >
        {name} connected
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "1rem",
        background: "#1a1a2e",
        borderRadius: "12px",
        margin: "0.5rem 0",
        border: "1px solid #333",
      }}
    >
      <p style={{ marginBottom: "0.75rem", opacity: 0.8 }}>{reason}</p>
      <button
        onClick={() => {
          setStatus("pending");
          window.open(oauthUrl, "_blank", "width=500,height=600");
        }}
        disabled={status === "pending"}
        style={{
          padding: "0.5rem 1.25rem",
          background: status === "pending" ? "#666" : "#4285f4",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: status === "pending" ? "not-allowed" : "pointer",
          fontSize: "0.9rem",
          fontWeight: 500,
        }}
      >
        {status === "pending" ? "Waiting for sign-in..." : `Sign in to ${name}`}
      </button>
    </div>
  );
}
