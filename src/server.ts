import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const API_KEY = process.env.ETHERSCAN_API_KEY;
const DEFAULT_CHAIN = Number(process.env.DEFAULT_CHAIN ?? 143);

if (!API_KEY) {
  console.error("Missing ETHERSCAN_API_KEY in env");
  process.exit(1);
}

const API_BASE = "https://api.etherscan.io/v2/api";

// ---- Chain alias map ------------------------------------------------------
// Numeric chainids pass through unchanged. Strings normalize to ids.
const CHAIN_ALIASES: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  polygon: 137,
  matic: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
  monad: 143,
  "monad-mainnet": 143,
  "monad-testnet": 10143,
};

function resolveChain(input: string | number | undefined): number {
  if (input == null) return DEFAULT_CHAIN;
  if (typeof input === "number") return input;
  if (/^\d+$/.test(input)) return Number(input);
  const alias = CHAIN_ALIASES[input.toLowerCase()];
  if (!alias) throw new Error(`unknown chain alias: ${input}`);
  return alias;
}

// ---- Etherscan v2 fetch helper -------------------------------------------
async function etherscan(chainid: number, params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("chainid", String(chainid));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", API_KEY!);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from etherscan`);
  const json = (await res.json()) as { status?: string; message?: string; result?: unknown };
  // Etherscan returns status="0" with message="No transactions found" for empty results — treat as success.
  if (json.status === "0" && json.message !== "No transactions found" && json.message !== "No records found") {
    throw new Error(`etherscan: ${json.message ?? "unknown error"} — ${JSON.stringify(json.result)}`);
  }
  return json.result;
}

// ---- Tool schemas ---------------------------------------------------------
const ChainArg = z.union([z.string(), z.number()]).optional();

const GetBalanceArgs = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex"),
  chain: ChainArg,
});

const GetTransactionsArgs = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  page: z.number().int().min(1).default(1),
  offset: z.number().int().min(1).max(100).default(20),
  sort: z.enum(["asc", "desc"]).default("desc"),
  chain: ChainArg,
});

const GetTxArgs = z.object({
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be 0x-prefixed 64-hex"),
  chain: ChainArg,
});

const GetGasPriceArgs = z.object({
  chain: ChainArg,
});

// ---- MCP server -----------------------------------------------------------
const server = new Server(
  { name: "mcp-evm", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const chainArgsSchema = {
  chain: {
    type: "string",
    description:
      "Chain to query. Numeric chainid (e.g. 143) or alias ('monad', 'monad-testnet', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'base', 'bsc'). Defaults to env DEFAULT_CHAIN.",
  },
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_balance",
      description: `Get the native token balance (in wei) for an address on an EVM chain. Default chain: ${DEFAULT_CHAIN}.`,
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string", description: "0x-prefixed address." },
          ...chainArgsSchema,
        },
        required: ["address"],
      },
    },
    {
      name: "get_transactions",
      description: `List normal transactions (sent + received) for an address, newest first by default.`,
      inputSchema: {
        type: "object",
        properties: {
          address: { type: "string" },
          page: { type: "number", default: 1 },
          offset: { type: "number", default: 20, description: "Page size, max 100." },
          sort: { type: "string", enum: ["asc", "desc"], default: "desc" },
          ...chainArgsSchema,
        },
        required: ["address"],
      },
    },
    {
      name: "get_tx",
      description: `Get a single transaction by hash plus its receipt status.`,
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "0x-prefixed 32-byte tx hash." },
          ...chainArgsSchema,
        },
        required: ["hash"],
      },
    },
    {
      name: "get_gas_price",
      description: `Get current gas oracle (safe / propose / fast gwei prices and the last block).`,
      inputSchema: {
        type: "object",
        properties: { ...chainArgsSchema },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  try {
    if (name === "get_balance") {
      const args = GetBalanceArgs.parse(rawArgs);
      const chainid = resolveChain(args.chain);
      const result = await etherscan(chainid, {
        module: "account",
        action: "balance",
        address: args.address,
        tag: "latest",
      });
      const wei = String(result);
      const eth = (Number(wei) / 1e18).toString();
      const out = { chainid, address: args.address, balance_wei: wei, balance_native: eth };
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }

    if (name === "get_transactions") {
      const args = GetTransactionsArgs.parse(rawArgs);
      const chainid = resolveChain(args.chain);
      const result = await etherscan(chainid, {
        module: "account",
        action: "txlist",
        address: args.address,
        startblock: "0",
        endblock: "99999999",
        page: String(args.page),
        offset: String(args.offset),
        sort: args.sort,
      });
      const txs = Array.isArray(result) ? result : [];
      const slim = txs.map((t: Record<string, unknown>) => ({
        hash: t.hash,
        block: t.blockNumber,
        timestamp: t.timeStamp,
        from: t.from,
        to: t.to,
        value_wei: t.value,
        gas_used: t.gasUsed,
        is_error: t.isError === "1",
        method_id: t.methodId,
        function_name: t.functionName || null,
      }));
      return {
        content: [
          { type: "text", text: JSON.stringify({ chainid, count: slim.length, txs: slim }, null, 2) },
        ],
      };
    }

    if (name === "get_tx") {
      const args = GetTxArgs.parse(rawArgs);
      const chainid = resolveChain(args.chain);
      const [tx, receipt] = await Promise.all([
        etherscan(chainid, { module: "proxy", action: "eth_getTransactionByHash", txhash: args.hash }),
        etherscan(chainid, { module: "proxy", action: "eth_getTransactionReceipt", txhash: args.hash }),
      ]);
      return {
        content: [{ type: "text", text: JSON.stringify({ chainid, tx, receipt }, null, 2) }],
      };
    }

    if (name === "get_gas_price") {
      const args = GetGasPriceArgs.parse(rawArgs ?? {});
      const chainid = resolveChain(args.chain);
      const result = await etherscan(chainid, { module: "gastracker", action: "gasoracle" });
      return { content: [{ type: "text", text: JSON.stringify({ chainid, ...(result as object) }, null, 2) }] };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${name}` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `error: ${msg}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp-evm] connected. default_chain=${DEFAULT_CHAIN}`);
