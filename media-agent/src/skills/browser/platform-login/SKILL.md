---
name: platform-login
description: Automated platform login via browser automation. Handles login flows for social media platforms that require web authentication.
---

# Platform Login Skill

Provides automated login capability for social media platforms using browser-autopilot browser automation.

## Available Tools

- `platform_login` - Log into a platform using credentials from environment variables

## How It Works

1. Launches browser via browser-autopilot
2. Navigates to the platform's login page
3. Enters credentials (from env vars or sensitiveData)
4. Handles 2FA/TOTP if configured
5. Saves session cookies for reuse

## Requirements

- Browser automation (browser-autopilot) available
- Platform credentials set in environment variables
