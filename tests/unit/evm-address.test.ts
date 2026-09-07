import { describe, expect, it } from "vitest";
import { isEvmAddress, shortenEvmAddress, validateEvmAddress } from "@/lib/evm/address";

/**
 * The gate in front of an irreversible `GlcToRhn` payout. Its job is to
 * give the same answer the backend gives for
 * `CreateTransferInput::recipient`, while the user is still typing.
 */

// Checksummed (EIP-55) and all-lowercase spellings of one real address.
const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const LOWERCASE = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";

describe("validateEvmAddress", () => {
  it("accepts a checksummed address and returns it in canonical form", () => {
    const result = validateEvmAddress(CHECKSUMMED);
    expect(result.valid).toBe(true);
    expect(result.problem).toBeNull();
    expect(result.checksummed).toBe(CHECKSUMMED);
  });

  it("accepts an all-lowercase address and normalises it to the checksummed spelling", () => {
    // An address with no mixed case carries no checksum to verify. That is
    // EIP-55's own rule, not a relaxation — and it is the form most tools
    // export, so rejecting it would reject most valid pastes.
    const result = validateEvmAddress(LOWERCASE);
    expect(result.valid).toBe(true);
    expect(result.checksummed).toBe(CHECKSUMMED);
  });

  it("normalises surrounding whitespace rather than failing on a padded paste", () => {
    expect(validateEvmAddress(`  ${CHECKSUMMED}  `).checksummed).toBe(CHECKSUMMED);
  });

  it("reports an empty field as a problem without a message", () => {
    // Nothing to shout about while someone has not started typing.
    const result = validateEvmAddress("   ");
    expect(result.valid).toBe(false);
    expect(result.problem).toBe("empty");
    expect(result.message).toBeNull();
  });

  it("names a non-hex character rather than blaming the checksum", () => {
    const result = validateEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeZ");
    expect(result.problem).toBe("not-hex");
    expect(result.message).toMatch(/hexadecimal/i);
  });

  it("names a truncated paste by its length", () => {
    const result = validateEvmAddress(CHECKSUMMED.slice(0, 30));
    expect(result.problem).toBe("wrong-length");
    expect(result.message).toMatch(/42 characters/);
  });

  it("rejects a mixed-case address whose checksum does not match", () => {
    // One character's case flipped: still valid hex, still 42 characters,
    // and exactly the corruption EIP-55 exists to catch.
    const corrupted = `0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`;
    const result = validateEvmAddress(corrupted);
    expect(result.problem).toBe("bad-checksum");
  });

  it("rejects a Solana address offered in the EVM field", () => {
    expect(validateEvmAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").valid).toBe(
      false,
    );
  });

  it("rejects the all-zero address, which the backend refuses too", () => {
    const result = validateEvmAddress("0x0000000000000000000000000000000000000000");
    expect(result.problem).toBe("zero-address");
    expect(result.message).toMatch(/destroyed permanently/i);
  });

  it("rejects the all-zero address in its checksummed-looking uppercase form", () => {
    expect(
      validateEvmAddress("0x0000000000000000000000000000000000000000".toUpperCase())
        .valid,
    ).toBe(false);
  });
});

describe("isEvmAddress", () => {
  it("is shape-only and accepts either spelling", () => {
    expect(isEvmAddress(CHECKSUMMED)).toBe(true);
    expect(isEvmAddress(LOWERCASE)).toBe(true);
    expect(isEvmAddress("not-an-address")).toBe(false);
  });
});

describe("shortenEvmAddress", () => {
  it("keeps enough of both ends to compare against a wallet", () => {
    expect(shortenEvmAddress(CHECKSUMMED)).toBe("0x5aAe…eAed");
  });

  it("leaves an already-short string alone rather than mangling it", () => {
    expect(shortenEvmAddress("0x1234")).toBe("0x1234");
  });
});
