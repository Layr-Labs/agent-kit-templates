# Authentication

## Overview

EigenPA uses **Sign-In with Ethereum (SIWE)** — [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361) — as its sole authentication method. Users connect an Ethereum wallet, sign a message to prove ownership, then sign a second deterministic message to derive their database encryption key.

No passwords. No emails. No OAuth providers. The wallet **is** the identity.

## Login Flow

The login requires **two wallet signatures** in sequence:

### Signature 1: Identity (SIWE)

Standard EIP-4361 flow with a server-generated nonce to prevent replay attacks.

**Frontend** (`WalletGate.tsx`):
1. Calls `GET /api/auth/nonce` → receives random nonce
2. Constructs SIWE message with domain, address, nonce, chainId
3. Wallet signs the message (`personal_sign`)
4. Sends `POST /api/auth/verify { message, signature }`

**Server** (`auth.ts`):
1. Parses SIWE message, verifies signature against nonce
2. Stores `address` in iron-session
3. Clears nonce (single-use)

### Signature 2: Encryption Key Derivation

A deterministic (nonce-free) signature used to derive the database encryption key.

**Frontend**:
1. Constructs fixed message: `"Derive encryption key for EigenPA\nAddress: 0x...\nVersion: 1"`
2. Wallet signs the message (`personal_sign`)
3. Sends `POST /api/auth/unlock { keySig }`

**Server**:
1. Verifies `keySig` was produced by the same address in the session
2. Derives 32-byte encryption key via HKDF-SHA256
3. Stores `encKey` in iron-session
4. Session cookie is sealed and sent to client

See [encryption.md](./encryption.md) for full key derivation details.

## Session Management

Sessions are managed by [iron-session](https://github.com/vvo/iron-session) — encrypted, stateless cookies.

| Property | Value |
|----------|-------|
| Cookie name | `eigenpa_session` (configurable in `config.toml`) |
| Storage | Client-side only (no server-side session store) |
| Encryption | iron-session sealing (AES-256-GCM) using `SESSION_SECRET` |
| Flags | `httpOnly`, `sameSite=lax`, `secure` (in production) |
| TTL | 72 hours (configurable in `config.toml`) |
| Contents | `{ address: string, encKey: string }` |

### Session States

```
┌──────────────────────────────────────────────────────────┐
│                    Session Lifecycle                       │
│                                                           │
│  No cookie ──► /nonce ──► /verify ──► /unlock ──► Active  │
│                  │           │           │          │      │
│                  │ nonce     │ address   │ encKey   │      │
│                  ▼           ▼           ▼          │      │
│               { nonce }  { addr }  { addr, key }   │      │
│                                                    │      │
│  Active ──► /logout ──► Cookie destroyed           │      │
│         ──► TTL expires ──► Cookie invalid          │      │
│         ──► /api/chat ──► Unseal → use encKey      │      │
└──────────────────────────────────────────────────────────┘
```

## API Endpoints

### `GET /api/auth/nonce`

Returns a random nonce string for SIWE message construction.

**Response**: `string` (plain text)

### `POST /api/auth/verify`

Verifies a SIWE signature and establishes identity.

**Body**:
```json
{
  "message": "<SIWE message string>",
  "signature": "0x..."
}
```

**Response**: `{ "address": "0x..." }`

### `POST /api/auth/unlock`

Derives the encryption key from a deterministic wallet signature.

**Requires**: Active session with `address` (call `/verify` first).

**Body**:
```json
{
  "keySig": "0x..."
}
```

**Response**: `{ "ok": true }`

### `POST /api/auth/logout`

Destroys the session and closes the user's database connection (evicts encryption key from server memory).

**Response**: `{ "ok": true }`

### `GET /api/auth/me`

Returns the current session state. 401 if not fully authenticated.

**Response**: `{ "address": "0x..." }` or `401 { "address": null }`

## User Identity

The **Ethereum address** is the user identifier throughout the entire system:

- Session key: `session.address`
- Database filename: `data/users/{address.toLowerCase()}.db`
- Conversation session ID: `address`
- Memory scoping: implicit (one DB per address)

No separate user table or registry is needed — the filesystem is the registry.
