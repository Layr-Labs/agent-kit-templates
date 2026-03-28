import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, useCallback } from "react";
import { OAuthButton } from "./OAuthButton";
import { EventList } from "./EventList";
import { EmailPreview } from "./EmailPreview";
import { Markdown } from "./Markdown";

export function Chat({ address }: { address: string }) {
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } =
    useChat({
      api: "/api/chat",
      maxSteps: 10,
    });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, [messages]);

  const handleOAuthConnected = useCallback(
    (integrationId: string) => {
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const context = lastUserMsg?.content ?? "the task I asked about";
      append({
        role: "user",
        content: `I just connected ${integrationId}. Please continue with ${context}`,
      });
    },
    [messages, append]
  );

  function renderToolResult(toolName: string, result: any) {
    if (toolName === "show_integration_signin") {
      if (result.type === "already_enabled") return null;
      return (
        <OAuthButton
          integrationId={result.integrationId}
          name={result.name}
          reason={result.reason}
          oauthUrl={result.oauthUrl}
          onConnected={handleOAuthConnected}
        />
      );
    }
    if (toolName === "show_event_list") return <EventList events={result.events} />;
    if (toolName === "show_email_preview") return <EmailPreview emails={result.emails} />;
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        maxWidth: 760,
        margin: "0 auto",
        height: "100vh",
        padding: "1rem 1.5rem",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.75rem 0",
          borderBottom: "1px solid #1a1a2e",
          marginBottom: "1.5rem",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>EigenPA</span>
        <span
          style={{
            fontFamily: "monospace",
            opacity: 0.4,
            fontSize: "0.8rem",
          }}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "1rem" }}>
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              marginTop: "30%",
              opacity: 0.3,
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
              What can I help you with?
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginBottom: "1.25rem",
                }}
              >
                <div
                  style={{
                    maxWidth: "75%",
                    padding: "0.65rem 1rem",
                    borderRadius: "18px 18px 4px 18px",
                    background: "#4f46e5",
                    fontSize: "0.95rem",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }

          // Assistant message — render each part separately
          const parts = (msg as any).parts ?? [];
          const hasParts = parts.length > 0;

          return (
            <div key={msg.id} style={{ marginBottom: "1.25rem" }}>
              {hasParts ? (
                parts.map((part: any, i: number) => {
                  if (part.type === "text" && part.text?.trim()) {
                    return (
                      <div
                        key={i}
                        style={{
                          maxWidth: "90%",
                          padding: "0.75rem 1.25rem",
                          borderRadius: "18px 18px 18px 4px",
                          background: "#111119",
                          border: "1px solid #1c1c30",
                          marginBottom:
                            i < parts.length - 1 ? "0.5rem" : 0,
                          fontSize: "0.95rem",
                          color: "#d0d0e0",
                        }}
                      >
                        <Markdown content={part.text} />
                      </div>
                    );
                  }
                  if (part.type === "tool-invocation" && part.state === "result") {
                    const rendered = renderToolResult(
                      part.toolName,
                      part.result
                    );
                    if (!rendered) return null;
                    return (
                      <div key={i} style={{ marginBottom: "0.5rem" }}>
                        {rendered}
                      </div>
                    );
                  }
                  if (part.type === "tool-invocation" && part.state === "call") {
                    return (
                      <div
                        key={i}
                        style={{
                          fontSize: "0.8rem",
                          opacity: 0.4,
                          padding: "0.25rem 0",
                          fontFamily: "monospace",
                        }}
                      >
                        Using {part.toolName}...
                      </div>
                    );
                  }
                  return null;
                })
              ) : msg.content ? (
                // Fallback if parts not available
                <div
                  style={{
                    maxWidth: "90%",
                    padding: "0.75rem 1.25rem",
                    borderRadius: "18px 18px 18px 4px",
                    background: "#111119",
                    border: "1px solid #1c1c30",
                    fontSize: "0.95rem",
                    color: "#d0d0e0",
                  }}
                >
                  <Markdown content={msg.content} />
                </div>
              ) : null}
            </div>
          );
        })}

        {isLoading && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div
              style={{
                display: "inline-flex",
                gap: "0.3rem",
                padding: "0.75rem 1.25rem",
                borderRadius: "18px 18px 18px 4px",
                background: "#111119",
                border: "1px solid #1c1c30",
              }}
            >
              <span style={{ animation: "pulse 1.4s infinite", opacity: 0.4 }}>
                ●
              </span>
              <span
                style={{
                  animation: "pulse 1.4s infinite 0.2s",
                  opacity: 0.4,
                }}
              >
                ●
              </span>
              <span
                style={{
                  animation: "pulse 1.4s infinite 0.4s",
                  opacity: 0.4,
                }}
              >
                ●
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem 0",
          borderTop: "1px solid #1a1a2e",
        }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "0.75rem 1rem",
            fontSize: "0.95rem",
            background: "#0a0a12",
            color: "#e0e0e0",
            border: "1px solid #1c1c30",
            borderRadius: "12px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "0.95rem",
            background: "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: "12px",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            opacity: isLoading || !input.trim() ? 0.4 : 1,
            fontWeight: 500,
            transition: "opacity 0.15s",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
