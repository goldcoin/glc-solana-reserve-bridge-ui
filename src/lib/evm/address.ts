import { getAddress, isAddress, type Address } from "viem";

/**
 * EVM recipient address validation, for the `GlcToRhn` destination field.
 *
 * The same role `@/lib/bridge/glc-address` plays for Goldcoin: this is the
 * gate in front of an irreversible payout, so the submit action stays
 * disabled until it passes. It is the client-side mirror of what the
 * backend does with the field — `CreateTransferInput::recipient` is parsed
 * as an `EvmAddress` for `GlcToRhn`, and the all-zero address is refused
 * there explicitly, because it is not a payout destination
 * (`service/src/api.rs`). Getting the same answer here means the user
 * learns it while typing rather than from a 400.
 *
 * What it CAN catch: a wrong-length paste, a non-hex character, a Solana
 * address in the EVM field, a corrupted mixed-case address whose EIP-55
 * checksum no longer matches, and the all-zero address.
 *
 * What it CANNOT catch — and no address validator can — is an address the
 * user does not actually control, or a custodial deposit address that does
 * not credit bridge payouts. Those stay the job of the same warnings the
 * other directions already carry.
 */

export type EvmAddressProblem =
  "empty" | "not-hex" | "wrong-length" | "bad-checksum" | "zero-address";

export interface EvmAddressValidation {
  readonly valid: boolean;
  readonly problem: EvmAddressProblem | null;
  readonly message: string | null;
  /** The EIP-55 checksummed form, once the address is known good. */
  readonly checksummed: Address | null;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function reject(problem: EvmAddressProblem, message: string): EvmAddressValidation {
  return { valid: false, problem, message, checksummed: null };
}

export function validateEvmAddress(input: string): EvmAddressValidation {
  const address = input.trim();

  if (address.length === 0) {
    return { valid: false, problem: "empty", message: null, checksummed: null };
  }

  // Shape first, so the message names the actual defect rather than
  // reporting every malformed string as a checksum failure.
  if (!/^0x[0-9a-fA-F]*$/.test(address)) {
    return reject(
      "not-hex",
      "That is not a valid Robinhood Network address. It must start with 0x and contain only hexadecimal characters.",
    );
  }
  if (address.length !== 42) {
    return reject(
      "wrong-length",
      `A Robinhood Network address is 42 characters (0x and 40 hex digits); this one is ${address.length}. It may have been truncated when copied.`,
    );
  }

  // `strict: true` verifies the EIP-55 checksum for a MIXED-case address.
  // An all-lowercase or all-uppercase address carries no checksum to
  // verify and is accepted — that is the standard's own rule, not a
  // relaxation: rejecting it would reject the form most tools export.
  if (!isAddress(address, { strict: true })) {
    return reject(
      "bad-checksum",
      "That address's checksum does not match. A single mistyped or altered character causes this — re-copy it from your wallet rather than editing it by hand.",
    );
  }

  if (address.toLowerCase() === ZERO_ADDRESS) {
    return reject(
      "zero-address",
      "That is the all-zero address, which no one controls. GLC sent there is destroyed permanently and cannot be recovered by anyone.",
    );
  }

  return {
    valid: true,
    problem: null,
    message: null,
    // Normalised to the checksummed spelling so what is submitted is a
    // canonical address regardless of how it was pasted.
    checksummed: getAddress(address),
  };
}

/** Shape-only check, for values that are already known-good (config, wallet accounts). */
export function isEvmAddress(value: string): value is Address {
  return isAddress(value, { strict: false });
}

/** `0xabcd…1234`, for compact display. Never used where the full address matters. */
export function shortenEvmAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
