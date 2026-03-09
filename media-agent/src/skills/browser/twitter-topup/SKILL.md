---
name: twitter-topup
description: Add a payment card to Twitter/X billing settings via browser automation. Tops up API credits so the agent can use Twitter API.
---

# Twitter Top-Up Skill

Adds a virtual prepaid card to Twitter/X billing settings via browser automation.

## Available Tools

- `topup_twitter_billing` - Navigate to Twitter billing settings and add the provisioned card

## Flow

1. Check if a card is provisioned (from bitrefill skill or env vars)
2. Navigate to Twitter's billing/payment settings
3. Enter card details (number, CVV, expiry)
4. Confirm the payment method

## Requirements

- Browser session available (browser-autopilot)
- Card provisioned via bitrefill skill or CARD_NUMBER/CARD_CVV/CARD_EXPIRY env vars
- Agent logged into Twitter
