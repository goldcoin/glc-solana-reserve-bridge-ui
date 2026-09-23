import { describe, expect, it } from "vitest";
import type { Connection } from "@solana/web3.js";
import {
  fetchSolBalance,
  fetchTokenBalance,
  isValidAddress,
  lamportsToBalance,
  parseTokenAmount,
  SOL_DECIMALS,
} from "@/lib/solana/balances";

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MINT = "GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH";

describe("lamportsToBalance", () => {
  it("converts a number of lamports to a SOL balance", () => {
    const balance = lamportsToBalance(1_500_000_000);
    expect(balance).toEqual({ raw: "1500000000", decimals: SOL_DECIMALS, symbol: "SOL" });
  });

  it("accepts a bigint", () => {
    expect(lamportsToBalance(42n).raw).toBe("42");
  });

  it("truncates a fractional lamport count rather than rounding", () => {
    expect(lamportsToBalance(1.9).raw).toBe("1");
  });
});

describe("fetchSolBalance", () => {
  it("wraps connection.getBalance as a WalletBalance", async () => {
    const connection = { getBalance: async () => 2_000_000_000 } as unknown as Connection;
    const balance = await fetchSolBalance(connection, OWNER);
    expect(balance).toEqual({ raw: "2000000000", decimals: SOL_DECIMALS, symbol: "SOL" });
  });
});

describe("fetchTokenBalance", () => {
  it("returns a real zero when the owner has no token account", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({ value: [] }),
    } as unknown as Connection;
    const balance = await fetchTokenBalance(connection, OWNER, MINT, "GLC");
    expect(balance).toEqual({ raw: "0", decimals: 0, symbol: "GLC" });
  });

  it("parses the amount and decimals from a real token account", async () => {
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [
          {
            account: {
              data: {
                parsed: { info: { tokenAmount: { amount: "123456", decimals: 6 } } },
              },
            },
          },
        ],
      }),
    } as unknown as Connection;
    const balance = await fetchTokenBalance(connection, OWNER, MINT, "GLC");
    expect(balance).toEqual({ raw: "123456", decimals: 6, symbol: "GLC" });
  });

  it("sums every token account for the mint rather than reading only the first", async () => {
    // A wallet can hold one mint across the associated token account plus
    // auxiliary accounts created by older tooling — reading value[0] alone
    // silently under-reports.
    const account = (amount: string) => ({
      account: {
        data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } },
      },
    });
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [account("1000000"), account("250000"), account("3")],
      }),
    } as unknown as Connection;
    const balance = await fetchTokenBalance(connection, OWNER, MINT, "GLC");
    expect(balance).toEqual({ raw: "1250003", decimals: 6, symbol: "GLC" });
  });

  it("fails the read when accounts for one mint disagree on decimals", async () => {
    const account = (amount: string, decimals: number) => ({
      account: { data: { parsed: { info: { tokenAmount: { amount, decimals } } } } },
    });
    const connection = {
      getParsedTokenAccountsByOwner: async () => ({
        value: [account("100", 6), account("100", 9)],
      }),
    } as unknown as Connection;
    await expect(fetchTokenBalance(connection, OWNER, MINT, "GLC")).rejects.toThrow(
      /disagreed on decimals/,
    );
  });
});

describe("parseTokenAmount", () => {
  it("throws on a malformed amount rather than returning a plausible wrong number", () => {
    const data = {
      parsed: { info: { tokenAmount: { amount: "not-a-number", decimals: 6 } } },
    };
    expect(() => parseTokenAmount(data, "GLC")).toThrow();
  });

  it("throws on malformed decimals", () => {
    const data = { parsed: { info: { tokenAmount: { amount: "1", decimals: -1 } } } };
    expect(() => parseTokenAmount(data, "GLC")).toThrow();
  });
});

describe("isValidAddress", () => {
  it("accepts a real base58 Solana address", () => {
    expect(isValidAddress(OWNER)).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
});
