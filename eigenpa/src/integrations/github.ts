import { tool } from "ai";
import { z } from "zod";
import type { IntegrationDefinition, IntegrationContext } from "./types.js";

function ghFetch(path: string, token: string, params?: Record<string, string>) {
  const url = new URL(`https://api.github.com${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

export const github: IntegrationDefinition = {
  id: "github",
  name: "GitHub",
  description:
    "Read repositories, issues, pull requests, and code from your GitHub account",
  credentialFields: [
    {
      key: "access_token",
      label: "GitHub Personal Access Token or OAuth Token",
      secret: true,
    },
  ],
  createTools(ctx: IntegrationContext) {
    const token = ctx.credentials.access_token;

    return {
      github_list_repos: tool({
        description:
          "List repositories the user has access to, sorted by most recently pushed",
        inputSchema: z.object({
          perPage: z
            .number()
            .optional()
            .default(10)
            .describe("Number of repos to return (max 100)"),
          type: z
            .enum(["all", "owner", "member"])
            .optional()
            .default("all")
            .describe("Filter by repo relationship"),
        }),
        execute: async ({ perPage, type }) => {
          const res = await ghFetch("/user/repos", token, {
            per_page: String(perPage),
            sort: "pushed",
            type,
          });
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const repos = (await res.json()) as Array<{
            full_name: string;
            description: string | null;
            language: string | null;
            stargazers_count: number;
            updated_at: string;
            private: boolean;
          }>;
          if (!repos.length) return "No repositories found.";
          return repos
            .map(
              (r) =>
                `- **${r.full_name}**${r.private ? " (private)" : ""}: ${r.description ?? "no description"} [${r.language ?? "?"}, ${r.stargazers_count}★]`
            )
            .join("\n");
        },
      }),

      github_list_issues: tool({
        description:
          "List issues for a repository, optionally filtered by state and labels",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner (user or org)"),
          repo: z.string().describe("Repository name"),
          state: z
            .enum(["open", "closed", "all"])
            .optional()
            .default("open")
            .describe("Issue state filter"),
          labels: z
            .string()
            .optional()
            .describe("Comma-separated list of label names to filter by"),
          perPage: z
            .number()
            .optional()
            .default(10)
            .describe("Number of issues to return"),
        }),
        execute: async ({ owner, repo, state, labels, perPage }) => {
          const params: Record<string, string> = {
            state,
            per_page: String(perPage),
            sort: "updated",
          };
          if (labels) params.labels = labels;

          const res = await ghFetch(
            `/repos/${owner}/${repo}/issues`,
            token,
            params
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const issues = (await res.json()) as Array<{
            number: number;
            title: string;
            state: string;
            user: { login: string };
            labels: Array<{ name: string }>;
            created_at: string;
            comments: number;
            pull_request?: unknown;
          }>;
          // Filter out PRs (GitHub returns PRs in the issues endpoint)
          const onlyIssues = issues.filter((i) => !i.pull_request);
          if (!onlyIssues.length) return "No issues found.";
          return onlyIssues
            .map(
              (i) =>
                `- #${i.number} [${i.state}] ${i.title} (by @${i.user.login}, ${i.comments} comments${i.labels.length ? `, labels: ${i.labels.map((l) => l.name).join(", ")}` : ""})`
            )
            .join("\n");
        },
      }),

      github_get_issue: tool({
        description: "Get details of a specific issue including its body",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          issueNumber: z.number().describe("Issue number"),
        }),
        execute: async ({ owner, repo, issueNumber }) => {
          const res = await ghFetch(
            `/repos/${owner}/${repo}/issues/${issueNumber}`,
            token
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const issue = (await res.json()) as {
            number: number;
            title: string;
            state: string;
            user: { login: string };
            body: string | null;
            labels: Array<{ name: string }>;
            created_at: string;
            comments: number;
            assignees: Array<{ login: string }>;
          };
          return [
            `# #${issue.number}: ${issue.title}`,
            `State: ${issue.state} | Author: @${issue.user.login} | Comments: ${issue.comments}`,
            issue.labels.length
              ? `Labels: ${issue.labels.map((l) => l.name).join(", ")}`
              : "",
            issue.assignees.length
              ? `Assignees: ${issue.assignees.map((a) => `@${a.login}`).join(", ")}`
              : "",
            "",
            issue.body ?? "(no description)",
          ]
            .filter(Boolean)
            .join("\n");
        },
      }),

      github_list_prs: tool({
        description:
          "List pull requests for a repository, optionally filtered by state",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          state: z
            .enum(["open", "closed", "all"])
            .optional()
            .default("open")
            .describe("PR state filter"),
          perPage: z
            .number()
            .optional()
            .default(10)
            .describe("Number of PRs to return"),
        }),
        execute: async ({ owner, repo, state, perPage }) => {
          const res = await ghFetch(
            `/repos/${owner}/${repo}/pulls`,
            token,
            {
              state,
              per_page: String(perPage),
              sort: "updated",
            }
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const prs = (await res.json()) as Array<{
            number: number;
            title: string;
            state: string;
            user: { login: string };
            draft: boolean;
            created_at: string;
            head: { ref: string };
            base: { ref: string };
          }>;
          if (!prs.length) return "No pull requests found.";
          return prs
            .map(
              (p) =>
                `- #${p.number}${p.draft ? " [draft]" : ""} ${p.title} (${p.head.ref} → ${p.base.ref}, by @${p.user.login})`
            )
            .join("\n");
        },
      }),

      github_get_pr: tool({
        description:
          "Get details of a specific pull request including its body and diff stats",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          prNumber: z.number().describe("Pull request number"),
        }),
        execute: async ({ owner, repo, prNumber }) => {
          const res = await ghFetch(
            `/repos/${owner}/${repo}/pulls/${prNumber}`,
            token
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const pr = (await res.json()) as {
            number: number;
            title: string;
            state: string;
            user: { login: string };
            body: string | null;
            draft: boolean;
            merged: boolean;
            mergeable: boolean | null;
            head: { ref: string };
            base: { ref: string };
            additions: number;
            deletions: number;
            changed_files: number;
            comments: number;
            review_comments: number;
          };
          return [
            `# PR #${pr.number}: ${pr.title}`,
            `State: ${pr.merged ? "merged" : pr.state}${pr.draft ? " (draft)" : ""} | Author: @${pr.user.login}`,
            `Branch: ${pr.head.ref} → ${pr.base.ref}`,
            `Changes: +${pr.additions} -${pr.deletions} across ${pr.changed_files} files`,
            `Comments: ${pr.comments} general, ${pr.review_comments} review`,
            "",
            pr.body ?? "(no description)",
          ].join("\n");
        },
      }),

      github_get_file: tool({
        description:
          "Read the contents of a file from a repository at a given ref (branch, tag, or commit)",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          path: z.string().describe("File path within the repository"),
          ref: z
            .string()
            .optional()
            .describe("Branch, tag, or commit SHA (defaults to default branch)"),
        }),
        execute: async ({ owner, repo, path, ref }) => {
          const params: Record<string, string> = {};
          if (ref) params.ref = ref;

          const res = await ghFetch(
            `/repos/${owner}/${repo}/contents/${path}`,
            token,
            params
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const data = (await res.json()) as {
            type: string;
            content?: string;
            encoding?: string;
            size: number;
            name: string;
          };
          if (data.type !== "file") {
            return `Path is a ${data.type}, not a file. Use github_list_directory to browse directories.`;
          }
          if (!data.content || data.encoding !== "base64") {
            return `File is too large to read via the API (${data.size} bytes). Try a smaller file.`;
          }
          return Buffer.from(data.content, "base64").toString("utf-8");
        },
      }),

      github_list_directory: tool({
        description: "List files and directories at a path in a repository",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          path: z
            .string()
            .optional()
            .default("")
            .describe("Directory path (empty for root)"),
          ref: z
            .string()
            .optional()
            .describe("Branch, tag, or commit SHA"),
        }),
        execute: async ({ owner, repo, path, ref }) => {
          const params: Record<string, string> = {};
          if (ref) params.ref = ref;

          const res = await ghFetch(
            `/repos/${owner}/${repo}/contents/${path}`,
            token,
            params
          );
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const items = (await res.json()) as Array<{
            name: string;
            type: string;
            size: number;
          }>;
          if (!Array.isArray(items)) return "Path is a file, not a directory.";
          return items
            .map(
              (i) =>
                `${i.type === "dir" ? "📁" : "📄"} ${i.name}${i.type === "file" ? ` (${i.size}B)` : ""}`
            )
            .join("\n");
        },
      }),

      github_search_code: tool({
        description:
          "Search for code across repositories using GitHub's code search",
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "Search query (supports GitHub code search syntax, e.g., 'useState repo:owner/repo language:typescript')"
            ),
          perPage: z
            .number()
            .optional()
            .default(10)
            .describe("Number of results to return"),
        }),
        execute: async ({ query, perPage }) => {
          const res = await ghFetch("/search/code", token, {
            q: query,
            per_page: String(perPage),
          });
          if (!res.ok) return `GitHub API error: request failed (${res.status})`;
          const data = (await res.json()) as {
            total_count: number;
            items: Array<{
              name: string;
              path: string;
              repository: { full_name: string };
              html_url: string;
            }>;
          };
          if (!data.items.length) return "No code matches found.";
          return [
            `Found ${data.total_count} results:`,
            ...data.items.map(
              (i) => `- ${i.repository.full_name}/${i.path}`
            ),
          ].join("\n");
        },
      }),

      github_list_commits: tool({
        description:
          "Get list of commits for a branch in a GitHub repository.",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          sha: z
            .string()
            .optional()
            .describe("Branch name, tag, or commit SHA"),
          author: z
            .string()
            .optional()
            .describe("Filter by author username or email"),
          path: z
            .string()
            .optional()
            .describe("Filter commits touching this file path"),
          since: z
            .string()
            .optional()
            .describe(
              "Only commits after this date (ISO 8601)"
            ),
          perPage: z.number().optional().default(20),
        }),
        execute: async ({
          owner,
          repo,
          sha,
          author,
          path,
          since,
          perPage,
        }) => {
          const params: Record<string, string> = {
            per_page: String(perPage),
          };
          if (sha) params.sha = sha;
          if (author) params.author = author;
          if (path) params.path = path;
          if (since) params.since = since;
          const res = await ghFetch(
            `/repos/${owner}/${repo}/commits`,
            token,
            params
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const commits = await res.json();
          if (!commits.length) return "No commits found.";
          return commits
            .map(
              (c: any) =>
                `- \`${c.sha.slice(0, 7)}\` ${c.commit.message.split("\n")[0]} — @${c.author?.login ?? c.commit.author?.name ?? "?"} (${c.commit.author?.date ?? "?"})`
            )
            .join("\n");
        },
      }),

      github_get_commit: tool({
        description:
          "Get details of a specific commit including its diff stats and changed files.",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          sha: z
            .string()
            .describe("Commit SHA, branch name, or tag"),
        }),
        execute: async ({ owner, repo, sha }) => {
          const res = await ghFetch(
            `/repos/${owner}/${repo}/commits/${sha}`,
            token
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const c = await res.json();
          const files = (c.files ?? [])
            .map(
              (f: any) =>
                `  ${f.status} ${f.filename} (+${f.additions} -${f.deletions})`
            )
            .join("\n");
          return [
            `**${c.commit.message}**`,
            `Author: @${c.author?.login ?? c.commit.author?.name ?? "?"} (${c.commit.author?.date ?? "?"})`,
            `Stats: +${c.stats?.additions ?? 0} -${c.stats?.deletions ?? 0} across ${c.files?.length ?? 0} files`,
            "",
            files,
          ].join("\n");
        },
      }),

      github_get_pr_diff: tool({
        description: "Get the diff of a pull request.",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          prNumber: z
            .number()
            .describe("Pull request number"),
        }),
        execute: async ({ owner, repo, prNumber }) => {
          const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github.diff",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const diff = await res.text();
          if (diff.length > 10000)
            return (
              diff.slice(0, 10000) +
              "\n\n... (diff truncated at 10,000 chars)"
            );
          return diff;
        },
      }),

      github_get_pr_reviews: tool({
        description: "Get reviews on a pull request.",
        inputSchema: z.object({
          owner: z.string().describe("Repository owner"),
          repo: z.string().describe("Repository name"),
          prNumber: z
            .number()
            .describe("Pull request number"),
        }),
        execute: async ({ owner, repo, prNumber }) => {
          const res = await ghFetch(
            `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
            token
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const reviews = await res.json();
          if (!reviews.length) return "No reviews yet.";
          return reviews
            .map(
              (r: any) =>
                `- @${r.user?.login ?? "?"} [${r.state}]: ${r.body || "(no comment)"}`
            )
            .join("\n");
        },
      }),

      github_search_issues: tool({
        description:
          "Search for issues and pull requests across GitHub using GitHub's search syntax.",
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              "GitHub search query (e.g., 'is:issue is:open repo:owner/repo label:bug')"
            ),
          sort: z
            .enum([
              "comments",
              "reactions",
              "created",
              "updated",
            ])
            .optional(),
          order: z
            .enum(["asc", "desc"])
            .optional()
            .default("desc"),
          perPage: z.number().optional().default(10),
        }),
        execute: async ({ query, sort, order, perPage }) => {
          const params: Record<string, string> = {
            q: query,
            per_page: String(perPage),
            order: order ?? "desc",
          };
          if (sort) params.sort = sort;
          const res = await ghFetch(
            "/search/issues",
            token,
            params
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const data = await res.json();
          if (!data.items?.length) return "No results found.";
          return [
            `Found ${data.total_count} results:`,
            ...data.items.map(
              (i: any) =>
                `- ${i.repository_url?.split("/").slice(-2).join("/") ?? ""} #${i.number} [${i.state}] ${i.title}`
            ),
          ].join("\n");
        },
      }),

      github_search_repos: tool({
        description:
          "Search for GitHub repositories by name, description, topics, or other criteria.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("Repository search query"),
          sort: z
            .enum([
              "stars",
              "forks",
              "updated",
              "help-wanted-issues",
            ])
            .optional(),
          order: z
            .enum(["asc", "desc"])
            .optional()
            .default("desc"),
          perPage: z.number().optional().default(10),
        }),
        execute: async ({ query, sort, order, perPage }) => {
          const params: Record<string, string> = {
            q: query,
            per_page: String(perPage),
            order: order ?? "desc",
          };
          if (sort) params.sort = sort;
          const res = await ghFetch(
            "/search/repositories",
            token,
            params
          );
          if (!res.ok)
            return `GitHub API error: request failed (${res.status})`;
          const data = await res.json();
          if (!data.items?.length)
            return "No repositories found.";
          return data.items
            .map(
              (r: any) =>
                `- **${r.full_name}**${r.private ? " (private)" : ""}: ${r.description ?? "no description"} [${r.language ?? "?"}, ${r.stargazers_count}\u2605]`
            )
            .join("\n");
        },
      }),
    };
  },
};
