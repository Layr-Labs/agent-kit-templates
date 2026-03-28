# Encryption & Key Management

## Design Goals

1. User databases are **always encrypted on disk** — never written unencrypted.
2. Encryption keys are **never stored on the server** — they exist only in sealed session cookies held by the client.
3. Keys are **deterministically reproducible** from the user's wallet — re-login yields the same key.
4. **Server compromise** exposes encrypted `.db` files but not the keys to decrypt them.

## Key Derivation Flow

```
 Browser                                     Server
 ───────                                     ──────
    │                                           │
    │  ── Step 1: SIWE (identity) ──            │
    │  GET /api/auth/nonce                      │
    │──────────────────────────────────────────►│
    │◄──────────────────────────────────────────│  random nonce
    │                                           │
    │  wallet signs SIWE message (w/ nonce)     │
    │  POST /api/auth/verify { message, sig }   │
    │──────────────────────────────────────────►│  verify sig → address
    │◄──────────────────────────────────────────│  session.address = addr
    │                                           │
    │  ── Step 2: Encryption key ──             │
    │  wallet signs DETERMINISTIC message:      │
    │  "Derive encryption key for EigenPA\n     │
    │   Address: 0x...\n                        │
    │   Version: 1"                             │
    │                                           │
    │  POST /api/auth/unlock { keySig }         │
    │──────────────────────────────────────────►│
    │                                           │  1. verify keySig matches address
    │                                           │  2. HKDF-SHA256(
    │                                           │       ikm:  keySig bytes,
    │                                           │       salt: address (lowercase),
    │                                           │       info: "turso-db-key",
    │                                           │       len:  32 bytes
    │                                           │     )
    │                                           │  3. session.encKey = hex(derived)
    │                                           │  4. seal session into cookie
    │◄──────────────────────────────────────────│  Set-Cookie: eigenpa_session=<sealed>
    │                                           │
    │  ── Subsequent requests ──                │
    │  POST /api/chat { prompt }                │
    │  Cookie: eigenpa_session=<sealed>         │
    │──────────────────────────────────────────►│
    │                                           │  unseal → { address, encKey }
    │                                           │  Database(path, { encryption: { cipher: "aegis256", hexkey: encKey } })
    │                                           │  run agent → respond
    │◄──────────────────────────────────────────│  { response }
```

## Why HKDF?

The raw ECDSA signature is 65 bytes of structured data (r, s, v). HKDF (HMAC-based Key Derivation Function) extracts uniform randomness from this and expands it to exactly 32 bytes suitable for use as a symmetric encryption key. The salt (address) and info ("turso-db-key") ensure domain separation.

## Why Deterministic Signatures?

The key derivation message contains no nonce — it's the same every time:

```
Derive encryption key for EigenPA
Address: 0x1a2B3c4D...
Version: 1
```

All major wallets (MetaMask, Rabby, Ledger, Trezor) implement RFC 6979 deterministic ECDSA, meaning the same private key + same message = same signature every time. This allows:

- **Re-login**: User signs the same message → derives the same key → reopens the same database.
- **No key escrow**: The server never needs to store the key persistently.
- **Wallet = master key**: Only the holder of the private key can derive the encryption key.

## Turso Encryption Details

EigenPA uses Turso's experimental AEGIS-256 page-level encryption:

- **Cipher**: AEGIS-256 (authenticated encryption, faster than AES-GCM on modern CPUs)
- **Granularity**: Per-page (each 4096-byte database page is independently encrypted)
- **Nonce**: Fresh random nonce generated for every page write
- **Authentication**: Each page includes an authentication tag — tampering is detected on read
- **Page 1 header**: The SQLite header (first 100 bytes) is used as additional authenticated data (AAD) — unencrypted but tamper-proof

```
 Unencrypted Page              Encrypted Page (on disk)
 ┌───────────────┐            ┌───────────────┐
 │               │            │               │
 │ Page Content  │            │   Encrypted   │
 │ (4048 bytes)  │  ────────► │    Content    │
 │               │            │ (4048 bytes)  │
 ├───────────────┤            ├───────────────┤
 │   Reserved    │            │  Tag (16 B)   │
 │  (48 bytes)   │            ├───────────────┤
 │               │            │  Nonce (32 B) │
 └───────────────┘            └───────────────┘
    4096 bytes                   4096 bytes
```

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Encrypted at rest — always | Turso AEGIS-256; file is never written unencrypted |
| Key never persisted on server | Only lives in iron-session cookie (sealed, httpOnly, client-held) |
| Key evicted on logout | `DBRouter.closeConnection()` removes from memory; cookie destroyed |
| Key reproducible on re-login | Deterministic ECDSA (RFC 6979) on fixed message → same key |
| Wrong wallet can't open DB | Different private key → different signature → different HKDF output → decryption fails |
| Server compromise: limited | Attacker gets encrypted `.db` files but no keys |
| Cookie theft: time-bound | iron-session TTL (configurable, default 72h) |
| Tamper detection | AEGIS-256 authentication tags on every page |

## Key Lifecycle

```
Login:    wallet sig → HKDF → encKey → stored in sealed cookie → DB opened
Active:   cookie sent with each request → unsealed → encKey used to open/query DB
Logout:   cookie destroyed → DB connection closed → encKey gone from memory
Restart:  all connections closed → all DBs encrypted on disk → re-login required
Deletion: DB file removed from disk → data irrecoverable
```

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Disk theft / server compromise | `.db` files are AEGIS-256 encrypted; keys not on disk |
| Cookie theft (XSS) | Cookies are `httpOnly` + `sameSite=lax` + `secure` in production |
| Session replay | iron-session sealing includes timestamp; TTL enforced |
| Brute-force key derivation | 256-bit key space from HKDF; infeasible to brute-force |
| Lost wallet | Data is irrecoverable by design — no backdoor |
| Nondeterministic wallet signatures | Rare; Version field in message allows migration if needed |
