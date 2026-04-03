# Personalization & Memory

## Overview

EigenPA personalizes its behavior to each user through three complementary memory systems, all stored in the user's encrypted database. No data crosses user boundaries.

## Memory Systems

### 1. Structured Memories (key-value facts)

The agent stores explicit facts about the user in the `memories` table. These are injected into the system prompt on every request.

**How they're created**: The agent has a `save_memory` tool it can call during conversation when it learns something worth remembering.

**Examples**:
```
name       → Jordan
role       → engineering manager at Acme Corp
timezone   → America/Chicago
tone_pref  → concise, no fluff
languages  → TypeScript, Go, Rust
```

**How they're used**: Loaded at the start of every request and placed in the system prompt under "Known facts about this user". The agent reads these before generating a response.

**Lifecycle**: Upserted on key — if the agent learns a new value for an existing key, it overwrites the old one. Never auto-deleted; the user can ask the agent to forget things.

### 2. Semantic Memory (vector embeddings)

Every conversation exchange is embedded via Voyage AI and stored in the `embeddings` table. On each new request, the user's message is embedded and a cosine-distance nearest-neighbor search retrieves the 5 most relevant past exchanges.

**How they're created**: After every request-response cycle, the concatenated exchange (`User: ... \n Assistant: ...`) is embedded and stored.

**How they're used**: Retrieved at the start of every request via `vectorSearch()` and placed in the system prompt under "Relevant past context". This gives the agent long-term recall beyond the 20-message conversation window.

**Search method**: Exact (brute-force) cosine distance via Turso's `vector_distance_cos()`. No ANN index — sufficient for <50k embeddings per user.

```
New message: "What did we discuss about the API migration?"
                │
                ▼
        Voyage AI embed()
                │
                ▼
        vector_distance_cos() over all embeddings
                │
                ▼
        Top 5 most similar past exchanges
                │
                ▼
        Injected into system prompt as context
```

### 3. Conversation History (rolling window)

The last 20 messages from the user's conversation are loaded and passed as the `messages` array to the LLM. This provides immediate conversational continuity.

**How they're created**: Every user message and assistant response is inserted into the `conversations` table.

**How they're used**: Loaded in chronological order and passed directly as the conversation history to `generateText()`.

**Window**: 20 messages (configurable by modifying `assistant.ts`). Older messages are still available through semantic memory and the `search_history` tool.

## Agent Tools

The agent has three tools it can use during conversation:

### `save_memory`

Saves or updates a structured fact about the user.

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Short label (e.g., "name", "role") |
| `value` | string | The fact to remember |

The agent decides autonomously when to call this — typically when the user shares personal information, preferences, or context that would be useful in future interactions.

### `recall_memories`

Retrieves all stored facts. No parameters. The agent uses this when it needs to check what it already knows before asking redundant questions.

### `search_history`

Full-text search over past conversations (SQL `LIKE` query).

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search term |
| `limit` | number | Max results (default 10) |

Useful when the user references something from a past conversation that isn't in the 20-message window or the top-5 semantic results.

## Personalization Pipeline

Every request flows through the full personalization pipeline:

```
 ┌─────────────────────────────────────────────────────┐
 │                   System Prompt                      │
 │                                                      │
 │  ┌────────────────────────────────────────────────┐  │
 │  │  SOUL.md (agent personality)                   │  │
 │  └────────────────────────────────────────────────┘  │
 │  ┌────────────────────────────────────────────────┐  │
 │  │  constitution.md (safety boundaries)           │  │
 │  └────────────────────────────────────────────────┘  │
 │  ┌────────────────────────────────────────────────┐  │
 │  │  Structured memories (key-value facts)     ◄───┼──── from memories table
 │  └────────────────────────────────────────────────┘  │
 │  ┌────────────────────────────────────────────────┐  │
 │  │  Semantic context (top-5 relevant exchanges) ◄─┼──── from embeddings table
 │  └────────────────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────┐
 │                    Messages                          │
 │                                                      │
 │  Last 20 messages from conversations table      ◄────── from conversations table
 │  + current user message                              │
 └─────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────┐
 │                     Tools                            │
 │                                                      │
 │  save_memory, recall_memories, search_history        │
 │  (all scoped to user's DB)                           │
 └─────────────────────────────────────────────────────┘

                          │
                          ▼
                   generateText()
                   (up to 10 tool steps)
                          │
                          ▼
                   Response + side effects
                   (new memories, new embeddings)
```

## Data Isolation

All three memory systems are stored in the user's individual encrypted database file. There is no shared state:

- No shared memories table with a `user_id` column
- No shared vector store with namespace filtering
- No shared conversation log

Each user's data is physically isolated in a separate `.db` file, encrypted with a key only they can derive. See [encryption.md](./encryption.md) for details.
