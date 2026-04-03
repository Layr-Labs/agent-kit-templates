import { useState } from "react";

interface LocationButtonProps {
  reason: string;
  onLocationShared?: (lat: number, lng: number) => void;
}

export function LocationButton({ reason, onLocationShared }: LocationButtonProps) {
  const [status, setStatus] = useState<
    "idle" | "pending" | "shared" | "denied" | "unavailable"
  >("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setStatus("unavailable");
      return;
    }

    setStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setStatus("shared");
        onLocationShared?.(latitude, longitude);
      },
      () => {
        setStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  if (status === "shared" && coords) {
    return (
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "#1a2e1a",
          borderRadius: "12px",
          margin: "0.5rem 0",
          border: "1px solid #2a4a2a",
          fontSize: "0.9rem",
        }}
      >
        Location shared ({coords.lat.toFixed(4)}, {coords.lng.toFixed(4)})
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "#2e1a1a",
          borderRadius: "12px",
          margin: "0.5rem 0",
          border: "1px solid #4a2a2a",
          fontSize: "0.9rem",
        }}
      >
        Location access denied
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "#2e2a1a",
          borderRadius: "12px",
          margin: "0.5rem 0",
          border: "1px solid #4a3a2a",
          fontSize: "0.9rem",
        }}
      >
        Geolocation is not available in this browser
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
        onClick={requestLocation}
        disabled={status === "pending"}
        style={{
          padding: "0.5rem 1.25rem",
          background: status === "pending" ? "#666" : "#4f46e5",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: status === "pending" ? "not-allowed" : "pointer",
          fontSize: "0.9rem",
          fontWeight: 500,
        }}
      >
        {status === "pending" ? "Requesting..." : "Share Location"}
      </button>
    </div>
  );
}
