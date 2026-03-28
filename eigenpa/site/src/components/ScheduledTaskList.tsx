interface ScheduledTask {
  id: number;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  nextRun?: string;
  lastRun?: string;
}

export function ScheduledTaskList({
  tasks,
  delegated,
}: {
  tasks: ScheduledTask[];
  delegated: boolean;
}) {
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
        <span style={{ fontSize: "1.1rem" }}>⏰</span>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
          Scheduled Tasks
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.75rem",
            padding: "0.15rem 0.5rem",
            borderRadius: "10px",
            background: delegated ? "#1a2e1a" : "#2e1a1a",
            color: delegated ? "#4ade80" : "#f87171",
            border: `1px solid ${delegated ? "#2a4a2a" : "#4a2a2a"}`,
          }}
        >
          {delegated ? "Active" : "Inactive"}
        </span>
      </div>

      {!delegated && (
        <div
          style={{
            padding: "0.6rem 1rem",
            fontSize: "0.8rem",
            opacity: 0.5,
            borderBottom: tasks.length ? "1px solid #1c1c30" : "none",
          }}
        >
          Background tasks are not enabled. Enable delegation in settings for
          tasks to run automatically.
        </div>
      )}

      {tasks.length === 0 ? (
        <div
          style={{
            padding: "2rem 1rem",
            textAlign: "center",
            opacity: 0.4,
            fontSize: "0.9rem",
          }}
        >
          No scheduled tasks
        </div>
      ) : (
        tasks.map((task, i) => (
          <div
            key={task.id}
            style={{
              padding: "0.65rem 1rem",
              borderBottom:
                i < tasks.length - 1 ? "1px solid #0d0d18" : "none",
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
            }}
          >
            {/* Status indicator */}
            <div
              style={{
                width: "0.5rem",
                height: "0.5rem",
                borderRadius: "50%",
                background: task.enabled ? "#4ade80" : "#8b949e",
                marginTop: "0.45rem",
                flexShrink: 0,
              }}
            />

            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                  {task.name}
                </span>
                {!task.enabled && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.05rem 0.35rem",
                      border: "1px solid #333",
                      borderRadius: "10px",
                      opacity: 0.5,
                    }}
                  >
                    paused
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.5,
                  marginTop: "0.15rem",
                }}
              >
                {task.description}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  marginTop: "0.3rem",
                  fontSize: "0.75rem",
                  opacity: 0.4,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    background: "#1c1c30",
                    padding: "0.1rem 0.35rem",
                    borderRadius: "3px",
                  }}
                >
                  {task.cron}
                </span>
                {task.nextRun && (
                  <span>Next: {formatRelative(task.nextRun)}</span>
                )}
                {task.lastRun && (
                  <span>Last: {formatRelative(task.lastRun)}</span>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const absDiff = Math.abs(diff);

    if (absDiff < 60_000) return "just now";
    if (absDiff < 3_600_000) {
      const mins = Math.round(absDiff / 60_000);
      return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
    }
    if (absDiff < 86_400_000) {
      const hrs = Math.round(absDiff / 3_600_000);
      return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}
