import { stringToHex, type Hex } from "viem";
import { MAX_DESTINATION_LEN } from "./abi";

/**
 * The `destination` payload for a `RhnToGlc` deposit: how a Goldcoin
 * payout address is carried across the EVM boundary.
 *
 * # This encoding is read from the backend, not chosen here
 *
 * The custody contract does NOT define it. `deposit()` takes `bytes
 * destination` and deliberately never parses it — its own docs say a
 * Goldcoin address and a Solana address "are both just bytes, and this
 * contract cannot tell them apart without becoming the address parser it
 * deliberately refuses to be". What the bytes MEAN is fixed by `route`.
 *
 * The service is what fixes it, at fold time, in exactly one place —
 * `validate_goldcoin_destination` in
 * `service/src/robinhood/fold.rs`:
 *
 * ```rust
 * let text = std::str::from_utf8(&observation.observation.destination) ... ;
 * crate::goldcoin::address::decode_p2pkh(text, network) ... ;
 * ```
 *
 * So the payload is **the UTF-8 bytes of the Base58Check-encoded Goldcoin
 * address string** — the address exactly as a user reads and pastes it,
 * not its decoded hash160, not its version+payload, not any binary form.
 * `decode_p2pkh` also means **P2PKH specifically**: the payout builder
 * (`signing::goldcoin_vault`) decodes the recipient the same way and would
 * refuse anything else, so a P2SH address folds to `ManualReview` and a
 * refund rather than paying out.
 *
 * # Why a wrong guess here would be unrecoverable
 *
 * A deposit whose destination bytes the service cannot read as an address
 * is not rejected on-chain — the contract accepts any 1..64 bytes. It is
 * accepted, the depositor's GLC is locked in the custody contract, and the
 * service parks the observation as an undeliverable destination awaiting
 * an operator refund. That is why this module encodes exactly what the
 * service decodes and validates the address against the SAME rule before
 * building anything.
 */

/** Why a Goldcoin destination cannot be encoded for a Robinhood deposit. */
export type DestinationProblem = "empty" | "not-ascii" | "too-long";

export interface EncodedDestination {
  /** ABI `bytes` payload, `0x`-prefixed. */
  readonly hex: Hex;
  /** Byte length, which the contract bounds to 1..=64. */
  readonly byteLength: number;
}

export type DestinationResult =
  | { readonly ok: true; readonly value: EncodedDestination }
  | {
      readonly ok: false;
      readonly problem: DestinationProblem;
      readonly message: string;
    };

/**
 * Encodes an already-validated Goldcoin P2PKH address as the contract's
 * `destination` payload.
 *
 * The caller MUST have run `validateGoldcoinAddress` first: this function
 * checks only what the byte encoding itself can check (non-empty, ASCII,
 * within the contract's length bound), never whether the address is real
 * or on the right network. Base58Check is ASCII by construction, so a
 * non-ASCII character means the input was never a Goldcoin address and is
 * refused rather than silently encoded as multi-byte UTF-8.
 */
export function encodeGoldcoinDestination(address: string): DestinationResult {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      problem: "empty",
      message: "Enter a Goldcoin destination address.",
    };
  }

  // Printable ASCII only — the range Base58Check itself lives in.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    return {
      ok: false,
      problem: "not-ascii",
      message:
        "That destination contains characters that are not part of a Goldcoin address. Re-copy it from your wallet.",
    };
  }

  const hex = stringToHex(trimmed);
  // Two hex characters per byte, after the `0x`. ASCII-only above, so this
  // equals the character count — computed from the encoded form regardless,
  // so the bound is checked against the bytes that will actually be sent.
  const byteLength = (hex.length - 2) / 2;

  if (byteLength > MAX_DESTINATION_LEN) {
    return {
      ok: false,
      problem: "too-long",
      message: `A destination address must be at most ${MAX_DESTINATION_LEN} bytes; this one is ${byteLength}.`,
    };
  }

  return { ok: true, value: { hex, byteLength } };
}
