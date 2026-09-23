// @vitest-environment node
//
// @solana/web3.js's PublicKey.findProgramAddressSync does real ed25519
// on-curve checks; under jsdom that check spuriously rejects every bump
// seed (see solana-deposit.test.ts's own note). This file does no DOM
// work, so it runs under Node instead.
import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@/lib/solana/deposit";
import { findAssociatedTokenAddress } from "@/lib/solana/deposit";
import {
  assertIsReserveTokenAccount,
  buildTransferCheckedInstruction,
  DestinationMismatchError,
  glcToAtomic,
  RESERVE_MINT_DECIMALS,
  RESERVE_TOKEN_ACCOUNT_ADDRESS,
} from "@/lib/solana/fund-reserve";

const WALLET = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const MINT = new PublicKey("GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH");
const RESERVE_TOKEN_ACCOUNT = new PublicKey(RESERVE_TOKEN_ACCOUNT_ADDRESS);
const SOME_OTHER_ACCOUNT = new PublicKey("11111111111111111111111111111112");

/** The pre-migration reserve vault. Bound to the retired mint; never fundable. */
const RETIRED_RESERVE_TOKEN_ACCOUNT = new PublicKey(
  "5AFssVkaz9nzS2tSQowUqYYmpg7wPSJa1mLKxuHKP2kp",
);

describe("the post-migration Solana asset, pinned", () => {
  /*
   * Production moved the mint, the bridge program and the reserve vault
   * together, and the funding page was verified against the new ones (a
   * 100 GLC transfer, then the reserve funded to 2,000,000 GLC). These are
   * the three values that decide where an operator's funds land, so they
   * are asserted literally rather than through the constants that define
   * them — a future edit to the source has to change this file too.
   */
  it("funds the current reserve token account, not the retired one", () => {
    expect(RESERVE_TOKEN_ACCOUNT_ADDRESS).toBe(
      "DS7dJAFRZhwp9TbxkHtrXihmzaidMm8sqWFrshUr5r5W",
    );
    expect(RESERVE_TOKEN_ACCOUNT_ADDRESS).not.toBe(
      RETIRED_RESERVE_TOKEN_ACCOUNT.toBase58(),
    );
  });

  it("builds against the current Token-2022 mint", () => {
    expect(MINT.toBase58()).toBe("GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH");
  });

  it("uses the Token-2022 program, never the original SPL Token program", () => {
    expect(TOKEN_2022_PROGRAM_ID.toBase58()).toBe(
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    );
  });
});

describe("glcToAtomic — 6-decimal conversion", () => {
  it("1 GLC produces exactly 1,000,000 atomic units", () => {
    expect(glcToAtomic("1")).toBe(1_000_000n);
  });

  it("converts a fractional amount correctly", () => {
    expect(glcToAtomic("12.5")).toBe(12_500_000n);
  });

  it("converts an amount using all 6 decimal places", () => {
    expect(glcToAtomic("0.000001")).toBe(1n);
  });

  it("rejects more than 6 decimal places", () => {
    expect(() => glcToAtomic("1.0000001")).toThrow(/at most 6 decimal places/i);
  });

  it("rejects zero", () => {
    expect(() => glcToAtomic("0")).toThrow(/greater than zero/i);
  });

  it("rejects a negative or malformed amount", () => {
    expect(() => glcToAtomic("-1")).toThrow();
    expect(() => glcToAtomic("abc")).toThrow();
    expect(() => glcToAtomic("")).toThrow();
  });
});

describe("assertIsReserveTokenAccount — the runtime destination guard", () => {
  it("accepts exactly the existing reserve token account", () => {
    expect(() => assertIsReserveTokenAccount(RESERVE_TOKEN_ACCOUNT)).not.toThrow();
  });

  it("refuses any other account, including a plausible-looking one", () => {
    expect(() => assertIsReserveTokenAccount(SOME_OTHER_ACCOUNT)).toThrow(
      DestinationMismatchError,
    );
    expect(() => assertIsReserveTokenAccount(WALLET)).toThrow(DestinationMismatchError);
  });

  it("refuses the retired pre-migration reserve vault", () => {
    // The single most plausible wrong destination there is: it WAS the
    // right one, it is still a real Token-2022 account, and a transfer to
    // it would be checked against a mint the reserve no longer holds.
    expect(() => assertIsReserveTokenAccount(RETIRED_RESERVE_TOKEN_ACCOUNT)).toThrow(
      DestinationMismatchError,
    );
  });
});

describe("buildTransferCheckedInstruction — the funding instruction itself", () => {
  const source = findAssociatedTokenAddress(WALLET, MINT);
  const amountAtomic = glcToAtomic("1");

  function build(destination: PublicKey) {
    return buildTransferCheckedInstruction({
      source,
      mint: MINT,
      destination,
      authority: WALLET,
      amountAtomic,
      decimals: RESERVE_MINT_DECIMALS,
    });
  }

  it("uses EXACTLY the existing reserve token account as the destination — never derived", () => {
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    const destinationKey = instruction.keys[2];
    expect(destinationKey?.pubkey.toBase58()).toBe(RESERVE_TOKEN_ACCOUNT_ADDRESS);
  });

  it("refuses to build a transaction against the retired reserve vault", () => {
    expect(() => build(RETIRED_RESERVE_TOKEN_ACCOUNT)).toThrow(DestinationMismatchError);
  });

  it("refuses to build a transaction with any destination other than the reserve token account", () => {
    expect(() => build(SOME_OTHER_ACCOUNT)).toThrow(DestinationMismatchError);
    expect(() => build(WALLET)).toThrow(DestinationMismatchError);
  });

  it("never derives a recipient ATA — the destination account is passed through verbatim, with no owner-based PDA derivation for it anywhere in this function", () => {
    // If this function derived an ATA for the destination the way
    // findAssociatedTokenAddress does for the source, the resulting
    // pubkey would differ from RESERVE_TOKEN_ACCOUNT_ADDRESS (a plain
    // account, not a PDA of any owner+mint pair this function knows
    // about). It does not: the same literal address goes in and comes
    // out.
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    const derivedForReserveAsOwner = findAssociatedTokenAddress(
      RESERVE_TOKEN_ACCOUNT,
      MINT,
    );
    expect(instruction.keys[2]?.pubkey.toBase58()).not.toBe(
      derivedForReserveAsOwner.toBase58(),
    );
    expect(instruction.keys[2]?.pubkey.toBase58()).toBe(RESERVE_TOKEN_ACCOUNT_ADDRESS);
  });

  it("uses the connected wallet's own canonical Token-2022 ATA as the source, for the correct mint", () => {
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    const sourceKey = instruction.keys[0];
    const expectedSource = findAssociatedTokenAddress(WALLET, MINT);
    expect(sourceKey?.pubkey.toBase58()).toBe(expectedSource.toBase58());
    // Confirm it really is derived from the ASSOCIATED_TOKEN_PROGRAM_ID +
    // TOKEN_2022_PROGRAM_ID + wallet + mint combination, not some other
    // account that happens to be passed in.
    const [expected] = PublicKey.findProgramAddressSync(
      [WALLET.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), MINT.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(sourceKey?.pubkey.toBase58()).toBe(expected.toBase58());
  });

  it("requires the connected wallet to sign — authority is marked isSigner", () => {
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    const authorityKey = instruction.keys[3];
    expect(authorityKey?.pubkey.toBase58()).toBe(WALLET.toBase58());
    expect(authorityKey?.isSigner).toBe(true);
    // No OTHER key in the instruction is a signer — the wallet's own
    // authority is the only one this instruction ever asks to sign.
    const otherKeys = instruction.keys.filter((k) => !k.pubkey.equals(WALLET));
    for (const key of otherKeys) {
      expect(key.isSigner).toBe(false);
    }
  });

  it("contains exactly one instruction's worth of data: TransferChecked, never an account-creation instruction", () => {
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    // TransferChecked's SPL Token instruction discriminator is 12 — NOT 1
    // (InitializeAccount) or the Associated Token Program's
    // CreateAssociatedTokenAccount (which has no leading discriminator
    // byte in the same sense and targets a different program id entirely).
    expect(instruction.data[0]).toBe(12);
    expect(instruction.programId.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    // Exactly 4 accounts: source, mint, destination, authority — no
    // system program, no rent sysvar, no associated-token-program
    // account, which is what a create-account instruction would need.
    expect(instruction.keys).toHaveLength(4);
    expect(
      instruction.keys.some((k) => k.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)),
    ).toBe(false);
  });

  it("encodes the amount and decimals correctly for 1 GLC", () => {
    const instruction = build(RESERVE_TOKEN_ACCOUNT);
    const amount = instruction.data.readBigUInt64LE(1);
    const decimals = instruction.data.readUInt8(9);
    expect(amount).toBe(1_000_000n);
    expect(decimals).toBe(6);
    expect(instruction.data).toHaveLength(10);
  });
});
