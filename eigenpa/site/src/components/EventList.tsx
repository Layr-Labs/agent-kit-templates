interface Event {
  title: string;
  start: string;
  end: string;
  description?: string;
}

export function EventList({ events }: { events: Event[] }) {
  if (!events.length) return null;

  return (
    <div
      style={{
        background: "#1a1a2e",
        borderRadius: "12px",
        padding: "0.75rem 1rem",
        margin: "0.5rem 0",
        border: "1px solid #333",
      }}
    >
      {events.map((event, i) => (
        <div
          key={i}
          style={{
            padding: "0.5rem 0",
            borderBottom:
              i < events.length - 1 ? "1px solid #2a2a3e" : "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>{event.title}</div>
          <div style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: "0.2rem" }}>
            {event.start} — {event.end}
          </div>
          {event.description && (
            <div style={{ opacity: 0.5, fontSize: "0.8rem", marginTop: "0.25rem" }}>
              {event.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
