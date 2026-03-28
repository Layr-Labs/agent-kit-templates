interface Repo {
  name: string;
  fullName: string;
  description?: string;
  language?: string;
  stars: number;
  forks?: number;
  isPrivate?: boolean;
  url?: string;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  Ruby: "#701516",
  "C++": "#f34b7d",
  C: "#555555",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Solidity: "#AA6746",
};

export function GitHubRepoCard({ repos }: { repos: Repo[] }) {
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
        <span style={{ fontSize: "1.1rem" }}>📦</span>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          Repositories
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.8rem", opacity: 0.5 }}>
          {repos.length} repo{repos.length > 1 ? "s" : ""}
        </span>
      </div>

      {repos.map((repo, i) => (
        <div
          key={repo.fullName || i}
          style={{
            padding: "0.65rem 1rem",
            borderBottom:
              i < repos.length - 1 ? "1px solid #0d0d18" : "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#818cf8" }}>
              {repo.fullName || repo.name}
            </span>
            {repo.isPrivate && (
              <span
                style={{
                  fontSize: "0.65rem",
                  padding: "0.1rem 0.4rem",
                  border: "1px solid #333",
                  borderRadius: "10px",
                  opacity: 0.5,
                }}
              >
                private
              </span>
            )}
          </div>
          {repo.description && (
            <div
              style={{
                fontSize: "0.8rem",
                opacity: 0.5,
                marginTop: "0.2rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {repo.description}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginTop: "0.3rem",
              fontSize: "0.75rem",
              opacity: 0.5,
            }}
          >
            {repo.language && (
              <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <span
                  style={{
                    width: "0.5rem",
                    height: "0.5rem",
                    borderRadius: "50%",
                    background: LANG_COLORS[repo.language] ?? "#888",
                    display: "inline-block",
                  }}
                />
                {repo.language}
              </span>
            )}
            <span>⭐ {repo.stars}</span>
            {repo.forks !== undefined && <span>🔀 {repo.forks}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
