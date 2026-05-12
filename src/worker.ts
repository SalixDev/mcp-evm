import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GetBalanceArgs,
  GetTransactionsArgs,
  GetTxArgs,
  GetGasPriceArgs,
  getBalance,
  getTransactions,
  getTx,
  getGasPrice,
  type ToolConfig,
} from "./tools.js";

interface Env {
  ETHERSCAN_API_KEY: string;
  DEFAULT_CHAIN?: string;
  MCP_OBJECT: DurableObjectNamespace;
}

// Durable Object that hosts one MCP session.
export class EvmMcp extends McpAgent<Env> {
  server = new McpServer({ name: "mcp-evm", version: "0.1.0" });

  async init() {
    const cfg: ToolConfig = {
      apiKey: this.env.ETHERSCAN_API_KEY,
      defaultChain: Number(this.env.DEFAULT_CHAIN ?? 1),
    };

    this.server.tool(
      "get_balance",
      `Get the native token balance (in wei) for an address on an EVM chain. Default chain: ${cfg.defaultChain}.`,
      GetBalanceArgs.shape,
      async (args) => {
        const out = await getBalance(args, cfg);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      },
    );

    this.server.tool(
      "get_transactions",
      "List normal transactions (sent + received) for an address, newest first by default.",
      GetTransactionsArgs.shape,
      async (args) => {
        const out = await getTransactions(args, cfg);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      },
    );

    this.server.tool(
      "get_tx",
      "Get a single transaction by hash plus its receipt status.",
      GetTxArgs.shape,
      async (args) => {
        const out = await getTx(args, cfg);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      },
    );

    this.server.tool(
      "get_gas_price",
      "Get current gas oracle (safe / propose / fast gwei prices and the last block).",
      GetGasPriceArgs.shape,
      async (args) => {
        const out = await getGasPrice(args, cfg);
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
      },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({ name: "mcp-evm", endpoint: "/mcp", tools: 4 }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/mcp") {
      return EvmMcp.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
