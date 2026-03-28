interface AgendaEvent {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
}

export function CalendarAgenda({
  date,
  events,
}: {
  date: string;
  events: AgendaEvent[];
}) {
  const isEmpty = events.length === 0;

  return (
    <div
      style={{
        background: "#111119",
        borderRadius: "12px",
        border: "1px solid #1c1c30",
        margin: "0.5rem 0",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #1c1c30",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "1.1rem" }}>📅</span>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{date}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.8rem",
            opacity: 0.5,
          }}
        >
          {isEmpty ? "No events" : `${events.length} event${events.length > 1 ? "s" : ""}`}
        </span>
      </div>

      {isEmpty ? (
        <div
          style={{
            padding: "2rem 1rem",
            textAlign: "center",
            opacity: 0.4,
            fontSize: "0.9rem",
          }}
        >
          Your day is clear
        </div>
      ) : (
        <div style={{ padding: "0.5rem 0" }}>
          {events.map((event, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                padding: "0.6rem 1rem",
                gap: "0.75rem",
                borderLeft: "3px solid #4f46e5",
                marginLeft: "0.75rem",
                marginBottom: i < events.length - 1 ? "0.25rem" : 0,
              }}
            >
              {/* Time column */}
              <div
                style={{
                  minWidth: "5rem",
                  fontSize: "0.8rem",
                  opacity: 0.6,
                  fontFamily: "monospace",
                  paddingTop: "0.1rem",
                }}
              >
                {formatTime(event.start)}
                <br />
                {formatTime(event.end)}
              </div>

              {/* Event details */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {event.title}
                </div>
                {event.location && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      opacity: 0.5,
                      marginTop: "0.15rem",
                    }}
                  >
                    📍 {event.location}
                  </div>
                )}
                {event.description && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      opacity: 0.4,
                      marginTop: "0.15rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "30rem",
                    }}
                  >
                    {event.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}
