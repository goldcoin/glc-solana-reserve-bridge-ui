// @vitest-environment node
//
// @solana/web3.js's PublicKey.findProgramAddressSync does real ed25519
// on-curve checks; under jsdom that check spuriously rejects every bump
// seed ("Unable to find a viable program address nonce") even though the
// exact same call succeeds in plain Node or a real browser. This file does
// no DOM work, so it runs under Node instead of fighting that mismatch.
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  attachRecentBlockhash,
  buildDepositToReserveInstruction,
  deriveDepositAccounts,
  getDepositCapability,
  isDepositProgramConfigured,
  MAX_GLC_ADDRESS_LEN,
  TOKEN_2022_PROGRAM_ID,
} from "@/lib/solana/deposit";

const PROGRAM_ID = new PublicKey("BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY");
const USER = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const RESERVE_MINT = new PublicKey("GLCzUtuEUJJRBozMrwH3BN5TEy2T7XftGH8TR3yNX5HH");

describe("getDepositCapability — checked in priority order, always a stated reason", () => {
  const base = {
    walletConfigured: true,
    programConfigured: true,
    walletConnected: true,
    canSign: true,
    glcAddressBytesLength: 20,
  };

  it("is available when every condition holds", () => {
    expect(getDepositCapability(base)).toEqual({
      available: true,
      reason: null,
      message: null,
    });
  });

  it("reports rpc-unconfigured first, even if other conditions also fail", () => {
    const capability = getDepositCapability({
      ...base,
      walletConfigured: false,
      walletConnected: false,
    });
    expect(capability).toEqual({
      available: false,
      reason: "rpc-unconfigured",
      message: expect.stringContaining("not configured"),
    });
  });

  it("reports program-unconfigured before wallet-disconnected", () => {
    const capability = getDepositCapability({
      ...base,
      programConfigured: false,
      walletConnected: false,
    });
    expect(capability.reason).toBe("program-unconfigured");
  });

  it("reports wallet-disconnected before cannot-sign", () => {
    const capability = getDepositCapability({
      ...base,
      walletConnected: false,
      canSign: false,
    });
    expect(capability.reason).toBe("wallet-disconnected");
  });

  it("reports cannot-sign when connected but unable to sign", () => {
    expect(getDepositCapability({ ...base, canSign: false }).reason).toBe("cannot-sign");
  });

  it("reports address-too-long for an empty or oversized address", () => {
    expect(getDepositCapability({ ...base, glcAddressBytesLength: 0 }).reason).toBe(
      "address-too-long",
    );
    expect(
      getDepositCapability({ ...base, glcAddressBytesLength: MAX_GLC_ADDRESS_LEN + 1 })
        .reason,
    ).toBe("address-too-long");
  });

  it("accepts the boundary length exactly", () => {
    expect(
      getDepositCapability({ ...base, glcAddressBytesLength: MAX_GLC_ADDRESS_LEN })
        .available,
    ).toBe(true);
  });
});

describe("deriveDepositAccounts", () => {
  it("derives distinct, deterministic PDAs for the same inputs", () => {
    const first = deriveDepositAccounts({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 42,
    });
    const second = deriveDepositAccounts({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 42,
    });

    expect(first.bridgeConfig.toBase58()).toBe(second.bridgeConfig.toBase58());
    expect(first.withdrawalObligation.toBase58()).toBe(
      second.withdrawalObligation.toBase58(),
    );

    const addresses = new Set(
      Object.values(first).map((key) => (key as PublicKey).toBase58()),
    );
    expect(addresses.size).toBe(Object.keys(first).length);
  });

  it("derives a different withdrawal obligation for a different obligation index", () => {
    const a = deriveDepositAccounts({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 1,
    });
    const b = deriveDepositAccounts({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 2,
    });
    expect(a.withdrawalObligation.toBase58()).not.toBe(b.withdrawalObligation.toBase58());
  });

  it("derives user/reserve token accounts under the Token-2022 program", () => {
    const accounts = deriveDepositAccounts({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 0,
    });
    const expectedUserAta = PublicKey.findProgramAddressSync(
      [USER.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), RESERVE_MINT.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
    expect(accounts.userTokenAccount.toBase58()).toBe(expectedUserAta.toBase58());
  });
});

describe("buildDepositToReserveInstruction", () => {
  it("targets the given program id with the correct anchor discriminator", () => {
    const instruction = buildDepositToReserveInstruction({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 7,
      amountAtomic: 123_456n,
      destination: "GoldcoinAddress123",
    });

    expect(instruction.programId.toBase58()).toBe(PROGRAM_ID.toBase58());

    const expectedDiscriminator = sha256("global:deposit_to_reserve").slice(0, 8);
    expect(Uint8Array.from(instruction.data.subarray(0, 8))).toEqual(
      expectedDiscriminator,
    );
  });

  it("encodes the amount as a little-endian u64 immediately after the discriminator", () => {
    const instruction = buildDepositToReserveInstruction({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 0,
      amountAtomic: 1_000_000n,
      destination: "abc",
    });
    const amountBytes = instruction.data.subarray(8, 16);
    expect(
      new DataView(amountBytes.buffer, amountBytes.byteOffset, 8).getBigUint64(0, true),
    ).toBe(1_000_000n);
  });

  it("encodes the Goldcoin address as its own UTF-8 bytes with a u32 length prefix", () => {
    const address = "GoldcoinDestination";
    const instruction = buildDepositToReserveInstruction({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 0,
      amountAtomic: 1n,
      destination: address,
    });
    const lengthBytes = instruction.data.subarray(16, 20);
    const length = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, 4).getUint32(
      0,
      true,
    );
    expect(length).toBe(address.length);

    const addressBytes = instruction.data.subarray(20, 20 + length);
    expect(Buffer.from(addressBytes).toString("utf8")).toBe(address);
  });

  it("encodes a Robinhood destination as the same UTF-8 text, 42 bytes", () => {
    /*
     * The `SolToRhn` payload. The program has NO route argument — the
     * backend classifies a Solana deposit by this payload, and
     * `destination_is_robinhood` is `payload.starts_with(b"0x")` — so these
     * bytes are what select the route.
     *
     * The encoding is the same one the Goldcoin payload uses (the
     * destination's own text as UTF-8), which is the point: one instruction,
     * one encoding, and the TEXT decides the route. `parse_robinhood_
     * destination` reads it back with `str::from_utf8` then
     * `EvmAddress::from_str`.
     */
    const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const instruction = buildDepositToReserveInstruction({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 0,
      amountAtomic: 1n,
      destination: checksummed,
    });
    const lengthBytes = instruction.data.subarray(16, 20);
    const length = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, 4).getUint32(
      0,
      true,
    );
    // `0x` plus 40 hex digits, all ASCII, so bytes === characters.
    expect(length).toBe(42);

    const addressBytes = instruction.data.subarray(20, 20 + length);
    const text = Buffer.from(addressBytes).toString("utf8");
    // Byte-for-byte, INCLUDING the case: the service verifies the EIP-55
    // checksum whenever the body mixes case, so lowercasing this payload
    // would throw away the only proof its digits survived intact.
    expect(text).toBe(checksummed);
    expect(text.startsWith("0x")).toBe(true);
  });

  it("carries the same account list whichever route the payload selects", () => {
    // Including the rolling-volume window PDA, which is seeded for the
    // Deposit DIRECTION and not per route. This is why `SolToRhn` needed no
    // new instruction: the only thing that differs is the payload.
    const accountsFor = (destination: string) =>
      buildDepositToReserveInstruction({
        programId: PROGRAM_ID,
        user: USER,
        reserveMint: RESERVE_MINT,
        obligationIndex: 3,
        amountAtomic: 1n,
        destination,
      }).keys.map((key) => key.pubkey.toBase58());

    expect(accountsFor("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toEqual(
      accountsFor("mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef"),
    );
  });

  it("refuses a payload outside the program's 1..64-byte bound", () => {
    // `MAX_GLC_ADDRESS_LEN`. Throws rather than building an instruction the
    // program would reject, which is the last of the three places this bound
    // is enforced before a deposit is signed.
    for (const destination of ["", "x".repeat(65)]) {
      expect(() =>
        buildDepositToReserveInstruction({
          programId: PROGRAM_ID,
          user: USER,
          reserveMint: RESERVE_MINT,
          obligationIndex: 0,
          amountAtomic: 1n,
          destination,
        }),
      ).toThrow(/glc_address/);
    }
  });

  it("lists accounts in the exact order the on-chain instruction expects", () => {
    const instruction = buildDepositToReserveInstruction({
      programId: PROGRAM_ID,
      user: USER,
      reserveMint: RESERVE_MINT,
      obligationIndex: 3,
      amountAtomic: 1n,
      destination: "a",
    });

    expect(instruction.keys).toHaveLength(10);
    expect(instruction.keys[0]).toMatchObject({
      pubkey: USER,
      isSigner: true,
      isWritable: true,
    });
    expect(instruction.keys[3]).toMatchObject({
      pubkey: RESERVE_MINT,
      isSigner: false,
      isWritable: false,
    });
    expect(instruction.keys[8]!.pubkey.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it("rejects an empty Goldcoin address", () => {
    expect(() =>
      buildDepositToReserveInstruction({
        programId: PROGRAM_ID,
        user: USER,
        reserveMint: RESERVE_MINT,
        obligationIndex: 0,
        amountAtomic: 1n,
        destination: "",
      }),
    ).toThrow();
  });

  it("rejects a Goldcoin address longer than MAX_GLC_ADDRESS_LEN bytes", () => {
    expect(() =>
      buildDepositToReserveInstruction({
        programId: PROGRAM_ID,
        user: USER,
        reserveMint: RESERVE_MINT,
        obligationIndex: 0,
        amountAtomic: 1n,
        destination: "x".repeat(MAX_GLC_ADDRESS_LEN + 1),
      }),
    ).toThrow();
  });
});

describe("isDepositProgramConfigured", () => {
  it("is false in the test environment (no NEXT_PUBLIC_RESERVE_PROGRAM_ID)", () => {
    expect(isDepositProgramConfigured()).toBe(false);
  });
});

describe("attachRecentBlockhash", () => {
  it("returns the connection's latest blockhash alongside the fee payer", async () => {
    const connection = {
      getLatestBlockhash: async () => ({ blockhash: "abc", lastValidBlockHeight: 100 }),
    } as unknown as Connection;

    const result = await attachRecentBlockhash(connection, USER);
    expect(result).toEqual({
      blockhash: "abc",
      lastValidBlockHeight: 100,
      feePayer: USER,
    });
  });
});
