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
import {
  GetBalanceArgs,
  GetTransactionsArgs,
  GetTxArgs,
  GetGasPriceArgs,
  buildToolList,
  getBalance,
  getTransactions,
  getTx,
  getGasPrice,
  type ToolConfig,
} from "./tools.js";

const API_KEY = process.env.ETHERSCAN_API_KEY;
const DEFAULT_CHAIN = Number(process.env.DEFAULT_CHAIN ?? 1);

if (!API_KEY) {
  console.error("Missing ETHERSCAN_API_KEY in env");
  process.exit(1);
}

const cfg: ToolConfig = { apiKey: API_KEY, defaultChain: DEFAULT_CHAIN };

const server = new Server(
  { name: "mcp-evm", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildToolList(DEFAULT_CHAIN),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  try {
    let result: object;
    if (name === "get_balance") {
      result = await getBalance(GetBalanceArgs.parse(rawArgs), cfg);
    } else if (name === "get_transactions") {
      result = await getTransactions(GetTransactionsArgs.parse(rawArgs), cfg);
    } else if (name === "get_tx") {
      result = await getTx(GetTxArgs.parse(rawArgs), cfg);
    } else if (name === "get_gas_price") {
      result = await getGasPrice(GetGasPriceArgs.parse(rawArgs ?? {}), cfg);
    } else {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `error: ${msg}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp-evm] connected. default_chain=${DEFAULT_CHAIN}`);
