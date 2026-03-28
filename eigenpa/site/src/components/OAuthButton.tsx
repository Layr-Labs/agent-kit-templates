interface OAuthButtonProps {
  integrationId: string;
  name: string;
  reason: string;
  oauthUrl: string;
}

export function OAuthButton({
  name,
  reason,
  oauthUrl,
}: OAuthButtonProps) {
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
        onClick={() =>
          window.open(oauthUrl, "_blank", "width=500,height=600")
        }
        style={{
          padding: "0.5rem 1.25rem",
          background: "#4285f4",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: 500,
        }}
      >
        Sign in to {name}
      </button>
    </div>
  );
}
