import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1
      style={{
        fontSize: "1.5rem",
        fontWeight: 700,
        margin: "1rem 0 0.5rem",
        lineHeight: 1.3,
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        fontSize: "1.25rem",
        fontWeight: 600,
        margin: "0.75rem 0 0.4rem",
        lineHeight: 1.3,
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      style={{
        fontSize: "1.1rem",
        fontWeight: 600,
        margin: "0.6rem 0 0.3rem",
        lineHeight: 1.3,
      }}
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p style={{ margin: "0.4rem 0", lineHeight: 1.6 }}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600, color: "#fff" }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ color: "#b0b0d0" }}>{children}</em>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        margin: "0.4rem 0",
        paddingLeft: "1.25rem",
        listStyleType: "disc",
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{
        margin: "0.4rem 0",
        paddingLeft: "1.25rem",
      }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ margin: "0.2rem 0", lineHeight: 1.5 }}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #4f46e5",
        paddingLeft: "0.75rem",
        margin: "0.5rem 0",
        opacity: 0.85,
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre
          style={{
            background: "#0d0d1a",
            borderRadius: "8px",
            padding: "0.75rem 1rem",
            margin: "0.5rem 0",
            overflowX: "auto",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            border: "1px solid #222",
          }}
        >
          <code style={{ fontFamily: "monospace" }}>{children}</code>
        </pre>
      );
    }
    return (
      <code
        style={{
          background: "#1a1a2e",
          padding: "0.15rem 0.35rem",
          borderRadius: "4px",
          fontSize: "0.88em",
          fontFamily: "monospace",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.5rem 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.9rem",
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ borderBottom: "2px solid #333" }}>{children}</thead>
  ),
  th: ({ children }) => (
    <th
      style={{
        textAlign: "left",
        padding: "0.5rem 0.75rem",
        fontWeight: 600,
        color: "#aaa",
        fontSize: "0.8rem",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: "0.4rem 0.75rem",
        borderBottom: "1px solid #1a1a2e",
      }}
    >
      {children}
    </td>
  ),
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid #333",
        margin: "0.75rem 0",
      }}
    />
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#818cf8", textDecoration: "none" }}
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      style={{
        maxWidth: "100%",
        borderRadius: "8px",
        margin: "0.5rem 0",
      }}
    />
  ),
};

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
