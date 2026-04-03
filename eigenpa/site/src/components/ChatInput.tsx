import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatInput({ address }: { address: string }) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || loading) return;

    setPrompt("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response ?? data.error },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: failed to reach the agent." },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
        <span style={{ fontFamily: "monospace", opacity: 0.5, fontSize: "0.85rem" }}>
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
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: "1rem",
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "0.75rem 1rem",
                borderRadius: "12px",
                background: msg.role === "user" ? "#4f46e5" : "#1a1a2e",
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
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
      <div style={{ display: "flex", gap: "0.5rem", paddingTop: "0.5rem" }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
          placeholder="Send a message..."
          disabled={loading}
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
          onClick={submit}
          disabled={loading || !prompt.trim()}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            background: "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
            opacity: loading || !prompt.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
