import { describe, expect, it } from "vitest";
import { encodeGoldcoinDestination } from "@/lib/evm/destination";
import { MAX_DESTINATION_LEN } from "@/lib/evm/abi";

/**
 * The `RhnToGlc` destination encoding — the single highest-stakes detail
 * in the Robinhood deposit path.
 *
 * # Why this file is worth more than its size suggests
 *
 * The custody contract accepts ANY 1..64 bytes as `destination` and never
 * parses them. So an encoding mistake does not revert: the deposit
 * succeeds, the depositor's GLC is locked in the contract, and the service
 * later finds it cannot read those bytes as an address — the transfer
 * parks awaiting an operator refund rather than paying out.
 *
 * The encoding is therefore read from the service, not chosen here.
 * `validate_goldcoin_destination` in `service/src/robinhood/fold.rs` does
 * exactly two things with the payload:
 *
 *   std::str::from_utf8(&destination)          // must be UTF-8 text
 *   goldcoin::address::decode_p2pkh(text, ..)  // must be a P2PKH address
 *
 * which pins the payload to the UTF-8 bytes of the Base58Check address
 * string, as a human reads it — not the decoded hash160, not
 * version+payload, not any binary form.
 */

/**
 * A real Base58Check-encoded Goldcoin address (mainnet P2PKH version byte
 * 0x20, a fixed 20-byte payload), with the exact `bytes` value the
 * contract must receive for it.
 *
 * The expected hex is written out literally rather than recomputed with
 * the same function under test — a golden value, so a change to the
 * encoding has to be made deliberately here rather than sliding through
 * because both sides moved together.
 */
const GOLDCOIN_ADDRESS = "DtTTf6RR6bt3tCoZBfX5yVCp6xgANb1GWb";
const GOLDCOIN_ADDRESS_AS_BYTES =
  "0x44745454663652523662743374436f5a4266583579564370367867414e6231475762";

describe("encodeGoldcoinDestination", () => {
  it("encodes the address as the UTF-8 bytes of its Base58Check text", () => {
    const result = encodeGoldcoinDestination(GOLDCOIN_ADDRESS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hex).toBe(GOLDCOIN_ADDRESS_AS_BYTES);
  });

  it("reports a byte length equal to the address's character count", () => {
    // Base58Check is ASCII, so one byte per character — the property the
    // contract's 1..=64 bound is checked against.
    const result = encodeGoldcoinDestination(GOLDCOIN_ADDRESS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byteLength).toBe(GOLDCOIN_ADDRESS.length);
    expect(result.value.byteLength).toBe(34);
  });

  it("encodes the ADDRESS TEXT, not its decoded payload", () => {
    // The clearest way to state the contract: every byte of the payload is
    // a printable character of the address itself.
    const result = encodeGoldcoinDestination(GOLDCOIN_ADDRESS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bytes = result.value.hex.slice(2).match(/../g) ?? [];
    const decoded = bytes.map((byte) => String.fromCharCode(parseInt(byte, 16))).join("");
    expect(decoded).toBe(GOLDCOIN_ADDRESS);
  });

  it("trims surrounding whitespace, matching the backend's own trim before it hashes", () => {
    expect(encodeGoldcoinDestination(`  ${GOLDCOIN_ADDRESS} `)).toEqual(
      encodeGoldcoinDestination(GOLDCOIN_ADDRESS),
    );
  });

  it("encodes a testnet address the same way — the encoding does not vary by network", () => {
    const testnet = "mgA7SfyBBrVGVSpQ7oqGHPhxpp2gUZWtfc";
    const result = encodeGoldcoinDestination(testnet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byteLength).toBe(testnet.length);
  });

  it("refuses an empty destination rather than encoding zero bytes", () => {
    // The contract reverts on a zero-length payload; refusing here means
    // the user is told instead of paying for a reverted transaction.
    const result = encodeGoldcoinDestination("   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("empty");
  });

  it("refuses a non-ASCII destination rather than emitting multi-byte UTF-8", () => {
    // Base58Check is ASCII by construction, so a non-ASCII character means
    // the input was never a Goldcoin address. Encoding it anyway would
    // produce a payload whose byte length silently exceeds its character
    // count.
    const result = encodeGoldcoinDestination("DtTTf6RR6bt3tCoZBfX5yVCp6xgANb1GW€");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("not-ascii");
  });

  it("refuses a destination longer than the contract's own bound", () => {
    const result = encodeGoldcoinDestination("D".repeat(MAX_DESTINATION_LEN + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe("too-long");
    expect(result.message).toMatch(/at most 64 bytes/);
  });

  it("accepts a destination exactly at the bound", () => {
    expect(encodeGoldcoinDestination("D".repeat(MAX_DESTINATION_LEN)).ok).toBe(true);
  });
});
