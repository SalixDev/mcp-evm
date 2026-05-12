import { z } from "zod";

// ---- Config ---------------------------------------------------------------
export interface ToolConfig {
  apiKey: string;
  defaultChain: number;
}

const API_BASE = "https://api.etherscan.io/v2/api";

// ---- Chain resolution -----------------------------------------------------
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

export function resolveChain(input: string | number | undefined, defaultChain: number): number {
  if (input == null) return defaultChain;
  if (typeof input === "number") return input;
  if (/^\d+$/.test(input)) return Number(input);
  const alias = CHAIN_ALIASES[input.toLowerCase()];
  if (!alias) throw new Error(`unknown chain alias: ${input}`);
  return alias;
}

// ---- Etherscan v2 fetch helper -------------------------------------------
async function etherscan(
  apiKey: string,
  chainid: number,
  params: Record<string, string>,
): Promise<unknown> {
  const url = new URL(API_BASE);
  url.searchParams.set("chainid", String(chainid));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from etherscan`);
  const json = (await res.json()) as { status?: string; message?: string; result?: unknown };
  if (
    json.status === "0" &&
    json.message !== "No transactions found" &&
    json.message !== "No records found"
  ) {
    throw new Error(`etherscan: ${json.message ?? "unknown error"} — ${JSON.stringify(json.result)}`);
  }
  return json.result;
}

// ---- Tool argument schemas ------------------------------------------------
const ChainArg = z.union([z.string(), z.number()]).optional();

export const GetBalanceArgs = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex"),
  chain: ChainArg,
});

export const GetTransactionsArgs = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  page: z.number().int().min(1).default(1),
  offset: z.number().int().min(1).max(100).default(20),
  sort: z.enum(["asc", "desc"]).default("desc"),
  chain: ChainArg,
});

export const GetTxArgs = z.object({
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be 0x-prefixed 64-hex"),
  chain: ChainArg,
});

export const GetGasPriceArgs = z.object({
  chain: ChainArg,
});

// ---- Tool implementations -------------------------------------------------
export async function getBalance(
  args: z.infer<typeof GetBalanceArgs>,
  cfg: ToolConfig,
): Promise<object> {
  const chainid = resolveChain(args.chain, cfg.defaultChain);
  const result = await etherscan(cfg.apiKey, chainid, {
    module: "account",
    action: "balance",
    address: args.address,
    tag: "latest",
  });
  const wei = String(result);
  const native = (Number(wei) / 1e18).toString();
  return { chainid, address: args.address, balance_wei: wei, balance_native: native };
}

export async function getTransactions(
  args: z.infer<typeof GetTransactionsArgs>,
  cfg: ToolConfig,
): Promise<object> {
  const chainid = resolveChain(args.chain, cfg.defaultChain);
  const result = await etherscan(cfg.apiKey, chainid, {
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
  return { chainid, count: slim.length, txs: slim };
}

export async function getTx(
  args: z.infer<typeof GetTxArgs>,
  cfg: ToolConfig,
): Promise<object> {
  const chainid = resolveChain(args.chain, cfg.defaultChain);
  const [tx, receipt] = await Promise.all([
    etherscan(cfg.apiKey, chainid, {
      module: "proxy",
      action: "eth_getTransactionByHash",
      txhash: args.hash,
    }),
    etherscan(cfg.apiKey, chainid, {
      module: "proxy",
      action: "eth_getTransactionReceipt",
      txhash: args.hash,
    }),
  ]);
  return { chainid, tx, receipt };
}

export async function getGasPrice(
  args: z.infer<typeof GetGasPriceArgs>,
  cfg: ToolConfig,
): Promise<object> {
  const chainid = resolveChain(args.chain, cfg.defaultChain);
  // Try gastracker first — gives safe/propose/fast split (Ethereum, Polygon, Arbitrum, BSC, ...).
  try {
    const result = (await etherscan(cfg.apiKey, chainid, {
      module: "gastracker",
      action: "gasoracle",
    })) as Record<string, string>;
    return { chainid, source: "gastracker", ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fallback to raw eth_gasPrice via the proxy module — works on every EVM chain incl. Monad.
    if (/Missing Or invalid Module/i.test(msg)) {
      const hex = (await etherscan(cfg.apiKey, chainid, {
        module: "proxy",
        action: "eth_gasPrice",
      })) as string;
      const wei = BigInt(hex);
      const gwei = (Number(wei) / 1e9).toString();
      return {
        chainid,
        source: "eth_gasPrice",
        gas_price_wei: wei.toString(),
        gas_price_gwei: gwei,
      };
    }
    throw err;
  }
}

// ---- Shared tool-description schemas (used by stdio + http transports) ---
const chainArgsSchema = {
  chain: {
    type: "string",
    description:
      "Chain to query. Numeric chainid (e.g. 143) or alias ('monad', 'monad-testnet', 'polygon', 'ethereum', 'arbitrum', 'optimism', 'base', 'bsc'). Defaults to env DEFAULT_CHAIN.",
  },
} as const;

export function buildToolList(defaultChain: number) {
  return [
    {
      name: "get_balance",
      description: `Get the native token balance (in wei) for an address on an EVM chain. Default chain: ${defaultChain}.`,
      inputSchema: {
        type: "object" as const,
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
        type: "object" as const,
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
        type: "object" as const,
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
        type: "object" as const,
        properties: { ...chainArgsSchema },
      },
    },
  ];
}
