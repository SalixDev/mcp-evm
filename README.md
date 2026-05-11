# mcp-monad

A **Model Context Protocol** server for Monad and other EVM chains. Built on the [Etherscan v2 unified API](https://docs.etherscan.io/etherscan-v2) — one API key, every supported chain (Monad, Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, …).

Connects via **stdio**. Works with Claude Code, Cursor, and any MCP client.

## Tools (v1)

- `get_balance(address, chain?)` — native token balance (wei + decimal).
- `get_transactions(address, page?, offset?, sort?, chain?)` — list normal txs for an address. Newest first by default. Max 100 per page.
- `get_tx(hash, chain?)` — fetch a single tx + receipt status.
- `get_gas_price(chain?)` — gas oracle (safe / propose / fast in gwei).

All tools accept an optional `chain` argument. Pass a **numeric chainid** (e.g. `143`) or an **alias**:

| Alias | Chain ID |
|---|---|
| `monad`, `monad-mainnet` | 143 |
| `monad-testnet` | 10143 |
| `ethereum`, `eth`, `mainnet` | 1 |
| `polygon`, `matic` | 137 |
| `arbitrum` | 42161 |
| `optimism` | 10 |
| `base` | 8453 |
| `bsc` | 56 |

Default chain is set by `DEFAULT_CHAIN` in `.env` (defaults to Monad mainnet `143`).

## Setup

1. Get an Etherscan v2 API key (free, takes 30s): https://etherscan.io/myapikey
2. Clone and install:
   ```bash
   git clone https://github.com/SalixDev/mcp-monad
   cd mcp-monad
   npm install
   cp .env.example .env
   # paste your key into .env
   ```
3. Smoke test:
   ```bash
   npm run dev
   ```
   You should see `[mcp-monad] connected. default_chain=143` on stderr. Ctrl+C to exit.

## Connect to Claude Code

From inside the cloned folder:

```bash
claude mcp add mcp-monad --scope user -- npx -y tsx "$(pwd)/src/server.ts"
```

Restart Claude Code. Run `/mcp`. You should see `mcp-monad · ✓ connected · 4 tools`.

## Try it

```
> what's the balance of 0x... on monad?
> show me the last 5 txs from 0x... on polygon
> get tx 0x... on ethereum, did it succeed?
> what's the current gas price on monad?
```

## Why Etherscan v2 over raw RPC

Raw EVM RPC (e.g. `eth_getBalance`, `eth_getTransactionByHash`) is universal but low-level. It can't answer queries like "list the transactions for this address" because nodes don't index by address — they index by block. The Etherscan API runs that index on their side, so you get a one-call answer to address-history queries that would otherwise require a full chain scan or your own indexer.

Iteration 2 will add raw-RPC tools (`read_contract`, `get_logs`) alongside the Etherscan-indexed ones for the cases where you need contract reads or filtered events.
