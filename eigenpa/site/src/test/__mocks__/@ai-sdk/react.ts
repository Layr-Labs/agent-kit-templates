import { useState, useCallback } from "react";

/**
 * Mock of @ai-sdk/react@3's useChat hook.
 * Matches the real API: returns sendMessage + status (not input/handleInputChange).
 * Input management is the consumer's responsibility.
 */
export function useChat(_opts?: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [status, setStatus] = useState<string>("ready");

  const sendMessage = useCallback(
    (msg: { role: string; content: string }) => {
      const userMsg = {
        id: `msg-${Date.now()}`,
        role: msg.role,
        content: msg.content,
        parts: [{ type: "text" as const, text: msg.content }],
      };
      setMessages((prev) => [...prev, userMsg]);
      setStatus("streaming");
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-asst`,
            role: "assistant" as const,
            content: "Mock response",
            parts: [{ type: "text" as const, text: "Mock response" }],
          },
        ]);
        setStatus("ready");
      }, 10);
    },
    []
  );

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    stop: () => {},
    error: undefined,
  };
}
