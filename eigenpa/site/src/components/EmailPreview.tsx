interface Email {
  from: string;
  subject: string;
  date: string;
  snippet?: string;
}

export function EmailPreview({ emails }: { emails: Email[] }) {
  if (!emails.length) return null;

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
      {emails.map((email, i) => (
        <div
          key={i}
          style={{
            padding: "0.5rem 0",
            borderBottom:
              i < emails.length - 1 ? "1px solid #2a2a3e" : "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>{email.subject}</div>
          <div style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: "0.2rem" }}>
            {email.from} · {email.date}
          </div>
          {email.snippet && (
            <div
              style={{
                opacity: 0.5,
                fontSize: "0.8rem",
                marginTop: "0.25rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {email.snippet}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
