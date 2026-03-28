import { useState, useCallback } from "react";

/**
 * Minimal mock of @ai-sdk/react's useChat hook.
 * Returns the same shape as the real hook so components can be tested
 * without a running server or real AI SDK dependency.
 */
export function useChat(_opts?: any) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    []
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!input.trim()) return;
      const userMsg = {
        id: `msg-${Date.now()}`,
        role: "user" as const,
        content: input,
        parts: [{ type: "text" as const, text: input }],
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      // Simulate assistant response
      setIsLoading(true);
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
        setIsLoading(false);
      }, 10);
    },
    [input]
  );

  const append = useCallback(
    (msg: { role: string; content: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: msg.role,
          content: msg.content,
          parts: [{ type: "text" as const, text: msg.content }],
        },
      ]);
    },
    []
  );

  return {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    isLoading,
    append,
  };
}
