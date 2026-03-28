import { useChat } from "@ai-sdk/react";
import { useRef, useEffect } from "react";
import { OAuthButton } from "./OAuthButton";
import { EventList } from "./EventList";
import { EmailPreview } from "./EmailPreview";

/** Map tool names → component renderers for their results */
const toolRenderers: Record<
  string,
  (result: any) => React.ReactNode | null
> = {
  show_integration_signin: (result) => {
    if (result.type === "already_enabled") return null;
    return (
      <OAuthButton
        integrationId={result.integrationId}
        name={result.name}
        reason={result.reason}
        oauthUrl={result.oauthUrl}
      />
    );
  },
  show_event_list: (result) => <EventList events={result.events} />,
  show_email_preview: (result) => <EmailPreview emails={result.emails} />,
};

export function Chat({ address }: { address: string }) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      api: "/api/chat",
      maxSteps: 10,
    });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        maxWidth: 720,
        margin: "0 auto",
        height: "100vh",
        padding: "1rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.5rem 0",
          borderBottom: "1px solid #222",
          marginBottom: "1rem",
        }}
      >
        <span style={{ fontWeight: 600 }}>EigenPA</span>
        <span
          style={{
            fontFamily: "monospace",
            opacity: 0.5,
            fontSize: "0.85rem",
          }}
        >
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "1rem" }}>
        {messages.length === 0 && (
          <p style={{ opacity: 0.4, textAlign: "center", marginTop: "40%" }}>
            What can I help you with?
          </p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: "1rem" }}>
            {/* Text content */}
            {msg.content && (
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "0.75rem 1rem",
                    borderRadius: "12px",
                    background:
                      msg.role === "user" ? "#4f46e5" : "#1a1a2e",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
              </div>
            )}

            {/* Tool invocation renderings */}
            {msg.toolInvocations?.map((invocation) => {
              if (invocation.state !== "result") return null;
              const renderer = toolRenderers[invocation.toolName];
              if (!renderer) return null;
              const rendered = renderer(invocation.result);
              if (!rendered) return null;
              return (
                <div key={invocation.toolCallId}>{rendered}</div>
              );
            })}
          </div>
        ))}

        {isLoading && (
          <div style={{ marginBottom: "1rem" }}>
            <div
              style={{
                display: "inline-block",
                padding: "0.75rem 1rem",
                borderRadius: "12px",
                background: "#1a1a2e",
                opacity: 0.6,
              }}
            >
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.5rem", paddingTop: "0.5rem" }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Send a message..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: "0.75rem 1rem",
            fontSize: "1rem",
            background: "#111",
            color: "#e0e0e0",
            border: "1px solid #333",
            borderRadius: "8px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            background: "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
            opacity: isLoading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
