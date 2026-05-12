# mcp-evm

A **Model Context Protocol** server for EVM chains — Monad, Ethereum, Polygon, Arbitrum, Optimism, Base, BSC, and any other chain supported by [Etherscan v2](https://docs.etherscan.io/etherscan-v2). One API key, every supported chain.

Two transports, same tool surface:

- **Cloudflare Worker** (HTTP / Streamable HTTP) — public deployment, no install required. **Live:** `https://mcp-evm.yieldmon.com/mcp`
- **stdio** — run locally with your own Etherscan key.

Works with Claude Code, Cursor, and any MCP client.

## Tools

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

Default chain is set by `DEFAULT_CHAIN` (defaults to Ethereum mainnet `1`).

## Try it (hosted demo)

Register the public deployment with Claude Code:

```bash
claude mcp add mcp-evm --scope user --transport http https://mcp-evm.yieldmon.com/mcp
```

Restart Claude Code. Run `/mcp` to confirm `mcp-evm · ✓ connected · 4 tools`. Then ask anything:

```
> what's the balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on ethereum?
> show me the last 5 txs from that address on polygon
> what's the current gas price on arbitrum?
```

## Run it yourself (local stdio)

For your own Etherscan key and quota.

1. Get an Etherscan v2 API key (free, ~30s): https://etherscan.io/myapikey
2. Clone and install:
   ```bash
   git clone https://github.com/SalixDev/mcp-evm
   cd mcp-evm
   npm install
   cp .env.example .env
   # paste your key into .env
   ```
3. Smoke test:
   ```bash
   npm run dev
   ```
   You should see `[mcp-evm] connected. default_chain=1` on stderr. Ctrl+C to exit.
4. Register with Claude Code:
   ```bash
   claude mcp add mcp-evm --scope user -- npx -y tsx "$(pwd)/src/server.ts"
   ```

Verify the registration captured the server path:

```bash
claude mcp list | grep mcp-evm
```

The output should show the full `npx -y tsx /absolute/path/to/src/server.ts`. If you only see `npx -y tsx` with no path, a stale registration blocked the add (the `add` command exits with `already exists` instead of overwriting). Fix:

```bash
claude mcp remove mcp-evm --scope user
claude mcp add mcp-evm --scope user -- npx -y tsx "$(pwd)/src/server.ts"
```

## Run your own hosted deployment

Want your own Etherscan quota and URL? Deploy this repo to Cloudflare Workers:

```bash
npm install
npx wrangler login
npx wrangler secret put ETHERSCAN_API_KEY   # paste your key
npm run deploy
```

Your endpoint will be `https://mcp-evm.<your-account>.workers.dev/mcp`. Optionally bind a custom domain in the Cloudflare dashboard.

## Security model

The hosted endpoint at `mcp-evm.yieldmon.com` is **authless**: anyone can call it. Three layers keep it from being a free abuse target:

1. **No write tools.** Every call is read-only against public on-chain data. There is nothing to compromise per-call.
2. **The server-side Etherscan key is the budget ceiling.** Free tier is 5 req/sec, 100k req/day. The worst case is the key gets throttled and the demo gets slow — no leak, no spend.
3. **Cloudflare rate limiting per IP.** Configured in the dashboard, free tier covers basic per-IP caps. Reduces single-source abuse.

If you need stronger guarantees (private quota, audit trail, per-user identity), deploy your own copy via the section above.

## Why Etherscan v2 over raw RPC

Raw EVM RPC (e.g. `eth_getBalance`, `eth_getTransactionByHash`) is universal but low-level. It can't answer queries like "list the transactions for this address" because nodes don't index by address — they index by block. The Etherscan API runs that index on their side, so you get a one-call answer to address-history queries that would otherwise require a full chain scan or your own indexer.

Iteration 2 will add raw-RPC tools (`read_contract`, `get_logs`) alongside the Etherscan-indexed ones for the cases where you need contract reads or filtered events.
