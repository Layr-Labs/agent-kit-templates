import { useState, useEffect } from "react";

interface Integration {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  hasCredentials: boolean;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((data) => {
        setIntegrations(data.integrations ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const disconnect = async (id: string) => {
    await fetch("/api/integrations/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integrationId: id }),
    });
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, enabled: false, hasCredentials: false } : i
      )
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#111119",
          border: "1px solid #1c1c30",
          borderRadius: "16px",
          padding: "1.5rem",
          width: "min(28rem, 90vw)",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.25rem",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Integrations</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "1.2rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ opacity: 0.4, padding: "1rem 0" }}>Loading...</div>
        ) : (
          integrations.map((intg) => (
            <div
              key={intg.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0.75rem 0",
                borderBottom: "1px solid #1c1c30",
                gap: "0.75rem",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: "0.95rem" }}>
                  {intg.name}
                </div>
                <div style={{ fontSize: "0.8rem", opacity: 0.4 }}>
                  {intg.description}
                </div>
              </div>
              {intg.enabled || intg.hasCredentials ? (
                <button
                  onClick={() => disconnect(intg.id)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.8rem",
                    background: "#2e1a1a",
                    color: "#f87171",
                    border: "1px solid #4a2a2a",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <span
                  style={{
                    fontSize: "0.8rem",
                    opacity: 0.3,
                    padding: "0.35rem 0.75rem",
                  }}
                >
                  Not connected
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
