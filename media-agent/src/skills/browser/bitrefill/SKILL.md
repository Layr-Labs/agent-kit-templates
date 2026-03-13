---
name: bitrefill
description: Buy prepaid Visa cards on Bitrefill using crypto, then redeem for virtual card details. Used to provision payment methods for API access.
---

# Bitrefill Skill

Provisions prepaid virtual Visa cards via browser automation on bitrefill.com.

## Available Tools

- `check_card_status` - Check if a prepaid card is already provisioned
- `get_card_details` - Get the virtual card details (number, CVV, expiry)
- `provision_card` - Buy and redeem a prepaid card (two-phase browser flow)

## Flow

1. Navigate to bitrefill.com, find Digital Prepaid Visa
2. Select denomination, pay with ETH or SOL
3. Extract gift card code after purchase
4. Navigate to redemption portal, enter code
5. Extract virtual Visa details (card number, CVV, expiry)
6. Save to card_details.json

## Requirements

- Browser session available (browser-autopilot)
- `cast` skill for crypto payment
- Alternatively: set CARD_NUMBER/CARD_CVV/CARD_EXPIRY env vars to skip provisioning
