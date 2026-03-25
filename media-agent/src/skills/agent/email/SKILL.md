---
name: email
description: Email for agents via EigenMail. Send and receive email from an agent-owned address. Use when the agent needs to communicate via email.
---

# Email Skill

Provides email capabilities via the EigenMail SDK (`eigenmail-sdk`).

## Available Tools

- `send_email` - Send an email from the agent's address
- `read_inbox` - List inbox messages
- `read_message` - Read a specific email message
- `trash_message` - Delete an email

## Requirements

- `eigenmail-sdk` package installed
- `EIGENMAIL_PRIVATE_KEY` environment variable set
- `EIGENMAIL_API_URL` environment variable (defaults to https://eigenmail-mainnet-alpha-api.eigenagents.org)
