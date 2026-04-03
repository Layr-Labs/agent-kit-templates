interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
  labels?: string[];
  comments?: number;
  isPR?: boolean;
  draft?: boolean;
}

export function GitHubIssueList({
  repo,
  issues,
}: {
  repo: string;
  issues: Issue[];
}) {
  if (!issues.length) return null;

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
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #1c1c30",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "1.1rem" }}>{issues[0]?.isPR ? "🔀" : "🐛"}</span>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          {repo}
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.8rem", opacity: 0.5 }}>
          {issues.length} {issues[0]?.isPR ? "PR" : "issue"}{issues.length > 1 ? "s" : ""}
        </span>
      </div>

      {issues.map((issue, i) => (
        <div
          key={issue.number}
          style={{
            display: "flex",
            padding: "0.55rem 1rem",
            borderBottom:
              i < issues.length - 1 ? "1px solid #0d0d18" : "none",
            gap: "0.6rem",
            alignItems: "flex-start",
          }}
        >
          {/* State icon */}
          <span
            style={{
              fontSize: "0.9rem",
              marginTop: "0.1rem",
              flexShrink: 0,
            }}
          >
            {issue.state === "open" ? (
              <span style={{ color: "#3fb950" }}>●</span>
            ) : issue.state === "merged" ? (
              <span style={{ color: "#a371f7" }}>●</span>
            ) : (
              <span style={{ color: "#8b949e" }}>●</span>
            )}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                {issue.title}
              </span>
              {issue.draft && (
                <span
                  style={{
                    fontSize: "0.65rem",
                    padding: "0.05rem 0.35rem",
                    border: "1px solid #333",
                    borderRadius: "10px",
                    opacity: 0.5,
                  }}
                >
                  draft
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginTop: "0.2rem",
                fontSize: "0.75rem",
                opacity: 0.45,
                flexWrap: "wrap",
              }}
            >
              <span>#{issue.number}</span>
              <span>@{issue.author}</span>
              {issue.comments !== undefined && issue.comments > 0 && (
                <span>💬 {issue.comments}</span>
              )}
              {issue.labels?.map((label) => (
                <span
                  key={label}
                  style={{
                    padding: "0 0.3rem",
                    background: "#1c1c30",
                    borderRadius: "3px",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
