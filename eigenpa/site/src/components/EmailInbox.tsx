interface EmailItem {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet?: string;
  unread?: boolean;
}

export function EmailInbox({ emails }: { emails: EmailItem[] }) {
  if (!emails.length) return null;

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
        <span style={{ fontSize: "1.1rem" }}>📧</span>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>Inbox</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.8rem",
            opacity: 0.5,
          }}
        >
          {emails.length} message{emails.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Email rows */}
      {emails.map((email, i) => (
        <div
          key={email.id || i}
          style={{
            display: "flex",
            padding: "0.65rem 1rem",
            borderBottom:
              i < emails.length - 1 ? "1px solid #0d0d18" : "none",
            gap: "0.75rem",
            alignItems: "flex-start",
          }}
        >
          {/* Unread dot */}
          <div
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "50%",
              background: email.unread ? "#4f46e5" : "transparent",
              marginTop: "0.4rem",
              flexShrink: 0,
            }}
          />

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
              <span
                style={{
                  fontWeight: email.unread ? 600 : 400,
                  fontSize: "0.85rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "12rem",
                }}
              >
                {extractName(email.from)}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  opacity: 0.4,
                  marginLeft: "auto",
                  flexShrink: 0,
                }}
              >
                {formatDate(email.date)}
              </span>
            </div>
            <div
              style={{
                fontWeight: email.unread ? 600 : 400,
                fontSize: "0.9rem",
                marginTop: "0.1rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email.subject || "(no subject)"}
            </div>
            {email.snippet && (
              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.4,
                  marginTop: "0.15rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {email.snippet}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function extractName(from: string): string {
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim() : from;
}

function formatDate(date: string): string {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return date;
  }
}
