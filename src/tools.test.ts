import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveChain,
  getBalance,
  getGasPrice,
  GetBalanceArgs,
  GetTransactionsArgs,
  GetTxArgs,
} from "./tools.js";

describe("resolveChain", () => {
  it("falls back to defaultChain when input is undefined", () => {
    expect(resolveChain(undefined, 143)).toBe(143);
    expect(resolveChain(undefined, 1)).toBe(1);
  });

  it("passes through numeric chainids unchanged", () => {
    expect(resolveChain(143, 1)).toBe(143);
    expect(resolveChain(8453, 1)).toBe(8453);
  });
  
  it("resolves canonical aliases", () => {
    expect(resolveChain("monad", 1)).toBe(143);
    expect(resolveChain("monad-mainnet", 1)).toBe(143);
    expect(resolveChain("monad-testnet", 1)).toBe(10143);
    expect(resolveChain("ethereum", 0)).toBe(1);
    expect(resolveChain("eth", 0)).toBe(1);
    expect(resolveChain("mainnet", 0)).toBe(1);
    expect(resolveChain("polygon", 0)).toBe(137);
    expect(resolveChain("matic", 0)).toBe(137);
    expect(resolveChain("arbitrum", 0)).toBe(42161);
    expect(resolveChain("optimism", 0)).toBe(10);
    expect(resolveChain("base", 0)).toBe(8453);
    expect(resolveChain("bsc", 0)).toBe(56);
    expect(resolveChain("bnb", 0)).toBe(56);
    expect(resolveChain("bnb-chain", 0)).toBe(56);
  });

  it("matches aliases case-insensitively", () => {
    expect(resolveChain("MONAD", 1)).toBe(143);
    expect(resolveChain("Polygon", 1)).toBe(137);
    expect(resolveChain("BsC", 1)).toBe(56);
  });

  it("throws on unknown alias", () => {
    expect(() => resolveChain("solana", 1)).toThrow(/unknown chain alias: solana/);
    expect(() => resolveChain("ethereum-classic", 1)).toThrow(/unknown chain alias: ethereum-classic/);
    expect(() => resolveChain("alpha", 1)).toThrow(/unknown chain alias: alpha/);
  });
});

describe("argument schemas", () => {
  it("GetBalanceArgs rejects non-hex addresses", () => {
    expect(() => GetBalanceArgs.parse({ address: "0xnothex" })).toThrow();
    expect(() => GetBalanceArgs.parse({ address: "vitalik.eth" })).toThrow();
    expect(() => GetBalanceArgs.parse({ address: "0x123" })).toThrow();
  });

  it("GetBalanceArgs accepts a valid checksummed address", () => {
    const out = GetBalanceArgs.parse({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(out.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("GetTransactionsArgs applies defaults", () => {
    const out = GetTransactionsArgs.parse({
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(out.page).toBe(1);
    expect(out.offset).toBe(20);
    expect(out.sort).toBe("desc");
  });

  it("GetTransactionsArgs clamps offset to <= 100", () => {
    expect(() =>
      GetTransactionsArgs.parse({
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        offset: 500,
      }),
    ).toThrow();
  });

  it("GetTxArgs rejects malformed tx hashes", () => {
    expect(() => GetTxArgs.parse({ hash: "0x123" })).toThrow();
    expect(() => GetTxArgs.parse({ hash: "not a hash" })).toThrow();
  });
});

describe("getBalance (mocked etherscan)", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "1", message: "OK", result: "1000000000000000000" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns wei + native decimal balance", async () => {
    const out = (await getBalance(
      { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      { apiKey: "fake", defaultChain: 1 },
    )) as { chainid: number; address: string; balance_wei: string; balance_native: string };
    expect(out.chainid).toBe(1);
    expect(out.balance_wei).toBe("1000000000000000000");
    expect(out.balance_native).toBe("1");
  });

  it("calls etherscan with the resolved chainid and the api key", async () => {
    await getBalance(
      { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "monad" },
      { apiKey: "secret-key", defaultChain: 1 },
    );
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("chainid")).toBe("143");
    expect(url.searchParams.get("module")).toBe("account");
    expect(url.searchParams.get("action")).toBe("balance");
    expect(url.searchParams.get("apikey")).toBe("secret-key");
  });
});

describe("getGasPrice fallback", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("uses gastracker when the chain supports it", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "1",
          message: "OK",
          result: { LastBlock: "1", SafeGasPrice: "0.1", ProposeGasPrice: "0.1", FastGasPrice: "0.1" },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const out = (await getGasPrice({ chain: "ethereum" }, { apiKey: "k", defaultChain: 1 })) as {
      source: string;
    };
    expect(out.source).toBe("gastracker");
  });

  it("falls back to eth_gasPrice when gastracker errors with 'Missing Or invalid Module name'", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ status: "0", message: "NOTOK", result: "Missing Or invalid Module name (#1)" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "1", message: "OK", result: "0x174876E800" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = (await getGasPrice({ chain: "monad" }, { apiKey: "k", defaultChain: 1 })) as {
      source: string;
      gas_price_wei: string;
      gas_price_gwei: string;
    };
    expect(out.source).toBe("eth_gasPrice");
    expect(out.gas_price_wei).toBe("100000000000");
    expect(out.gas_price_gwei).toBe("100");
  });

  it("falls back when error message uses 'Action name' wording (monad testnet)", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ status: "0", message: "NOTOK", result: "Missing Or invalid Action name (#1)" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "1", message: "OK", result: "0x12A05F200" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = (await getGasPrice({ chain: "monad-testnet" }, { apiKey: "k", defaultChain: 1 })) as {
      source: string;
    };
    expect(out.source).toBe("eth_gasPrice");
  });

  it("does NOT fall back on unrelated errors (e.g. rate limit)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ status: "0", message: "NOTOK", result: "Max calls per sec rate limit reached (3/sec)" }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    await expect(
      getGasPrice({ chain: "ethereum" }, { apiKey: "k", defaultChain: 1 }),
    ).rejects.toThrow(/Max calls per sec/);
  });
});
