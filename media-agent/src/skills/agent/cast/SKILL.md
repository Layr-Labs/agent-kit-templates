---
name: cast
description: EVM crypto operations via Foundry cast CLI. Check balances, send ETH/tokens, call contracts. Used by the agent to pay for services like prepaid cards.
---

# Cast Skill

Provides blockchain operations via Foundry's `cast` CLI.

## Available Tools

- `eth_balance` - Check ETH balance of any address
- `send_eth` - Send ETH to an address
- `erc20_balance` - Check ERC-20 token balance
- `gas_price` - Get current gas price
- `chain_id` - Get current chain ID
- `block_number` - Get latest block number
- `get_wallet_address` - Get the agent's wallet address

## Requirements

- Foundry must be installed (`cast` CLI available in PATH)
- `PRIVATE_KEY` environment variable set for sending transactions
