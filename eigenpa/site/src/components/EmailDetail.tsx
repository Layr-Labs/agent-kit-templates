import { Markdown } from "./Markdown";

interface EmailDetailProps {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  attachments?: string[];
}

export function EmailDetail({
  from,
  to,
  subject,
  date,
  body,
  attachments,
}: EmailDetailProps) {
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
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.5rem" }}>
          {subject || "(no subject)"}
        </div>
        <div style={{ fontSize: "0.8rem", opacity: 0.6, lineHeight: 1.6 }}>
          <div>
            <strong>From:</strong> {from}
          </div>
          <div>
            <strong>To:</strong> {to}
          </div>
          <div>
            <strong>Date:</strong> {date}
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          padding: "0.75rem 1rem",
          fontSize: "0.9rem",
          lineHeight: 1.6,
          color: "#c0c0d0",
        }}
      >
        <Markdown content={body} />
      </div>

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div
          style={{
            padding: "0.5rem 1rem",
            borderTop: "1px solid #1c1c30",
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {attachments.map((a, i) => (
            <span
              key={i}
              style={{
                fontSize: "0.8rem",
                padding: "0.25rem 0.5rem",
                background: "#1c1c30",
                borderRadius: "4px",
                opacity: 0.7,
              }}
            >
              📎 {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
