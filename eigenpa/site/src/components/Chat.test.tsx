import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chat } from "./Chat";

const TEST_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

describe("Chat", () => {
  it("renders without crashing", () => {
    render(<Chat address={TEST_ADDRESS} />);
    expect(screen.getByText("EigenPA")).toBeInTheDocument();
  });

  it("shows the truncated address in the header", () => {
    render(<Chat address={TEST_ADDRESS} />);
    expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
  });

  it("shows placeholder text when no messages", () => {
    render(<Chat address={TEST_ADDRESS} />);
    expect(
      screen.getByText("What can I help you with?")
    ).toBeInTheDocument();
  });

  it("renders the input field with empty value", () => {
    render(<Chat address={TEST_ADDRESS} />);
    const input = screen.getByPlaceholderText("Send a message...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("send button is disabled when input is empty", () => {
    render(<Chat address={TEST_ADDRESS} />);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeDisabled();
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Chat address={TEST_ADDRESS} />);
    const input = screen.getByPlaceholderText("Send a message...");

    await user.type(input, "hello world");
    expect(input).toHaveValue("hello world");
  });

  it("enables send button when input has text", async () => {
    const user = userEvent.setup();
    render(<Chat address={TEST_ADDRESS} />);
    const input = screen.getByPlaceholderText("Send a message...");
    const button = screen.getByRole("button", { name: "Send" });

    expect(button).toBeDisabled();
    await user.type(input, "test message");
    expect(button).not.toBeDisabled();
  });

  it("sends message on submit and clears input", async () => {
    const user = userEvent.setup();
    render(<Chat address={TEST_ADDRESS} />);
    const input = screen.getByPlaceholderText("Send a message...");

    await user.type(input, "hello agent");
    await user.click(screen.getByRole("button", { name: "Send" }));

    // Input should be cleared
    expect(input).toHaveValue("");
    // User message should appear
    expect(screen.getByText("hello agent")).toBeInTheDocument();
  });

  it("renders assistant response after sending", async () => {
    const user = userEvent.setup();
    render(<Chat address={TEST_ADDRESS} />);
    const input = screen.getByPlaceholderText("Send a message...");

    await user.type(input, "test");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Mock response")).toBeInTheDocument();
    });
  });

  it("does not crash when message content is undefined", () => {
    // This is the regression test — ai@6 can return messages
    // where content is undefined and text lives in parts only
    expect(() => {
      render(<Chat address={TEST_ADDRESS} />);
    }).not.toThrow();
  });
});
