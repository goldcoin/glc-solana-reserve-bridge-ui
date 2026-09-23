"use client";

import { useCallback } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { solanaConfirmationError, solanaSendError } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useWalletRuntime } from "./adapter/provider";
import {
  attachRecentBlockhash,
  findAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from "./deposit";
import { fetchTokenAccountBalance } from "./balances";
import { getConnection } from "./connection";
import type { WalletBalance } from "./types";

/**
 * Operator-only Solana reserve funding (`/admin/fund-reserve`).
 *
 * This is deliberately NOT a general "send tokens" tool: the destination is
 * one fixed, already-existing token account, never derived and never
 * user-editable. Phantom's normal Send flow previously derived a DIFFERENT
 * associated token account for this same destination address (treating it
 * as if it were a wallet OWNER rather than a token account itself) and sent
 * funds there instead of into the real reserve — this module exists
 * specifically to never make that mistake: it builds a raw `TransferChecked`
 * instruction naming the exact destination account directly, with no ATA
 * derivation anywhere on the recipient side, and no account-creation
 * instruction of any kind.
 */

/** The reserve's existing Solana Token-2022 account — production value,
 * intentionally hard-coded rather than configurable. This is the ONE and
 * ONLY acceptable destination for this feature; see `assertIsReserveTokenAccount`.
 *
 * Moved here by the Token-2022 asset migration, alongside the mint
 * (`GLCz…NX5HH`) and the bridge program (`H8So…RJgb`). The previous vault
 * (`5AFs…P2kp`) belonged to the retired mint and must never be funded
 * again: a transfer to it would be checked against a mint the reserve no
 * longer holds. */
export const RESERVE_TOKEN_ACCOUNT_ADDRESS =
  "DS7dJAFRZhwp9TbxkHtrXihmzaidMm8sqWFrshUr5r5W";

/** The canonical Solana GLC (Token-2022) mint's fixed, protocol-level
 * decimals — never derived from a live read for this feature, since a
 * `TransferChecked` instruction's whole purpose is to fail closed if the
 * caller's assumed decimals disagree with the mint's real ones. */
export const RESERVE_MINT_DECIMALS = 6;

export class DestinationMismatchError extends Error {
  constructor(actual: string) {
    super(
      `Refusing to build a funding transaction: destination "${actual}" is not the reserve token account "${RESERVE_TOKEN_ACCOUNT_ADDRESS}".`,
    );
    this.name = "DestinationMismatchError";
  }
}

/** Throws unless `destination` is EXACTLY the existing reserve token
 * account — the runtime check requirement 9 asks for, independent of
 * whatever this module's own constant says, so a future edit to this file
 * that accidentally changes the constant still has to pass this check
 * explicitly at every call site that matters. */
export function assertIsReserveTokenAccount(destination: PublicKey): void {
  if (destination.toBase58() !== RESERVE_TOKEN_ACCOUNT_ADDRESS) {
    throw new DestinationMismatchError(destination.toBase58());
  }
}

/**
 * Converts a decimal GLC amount (e.g. "1", "12.5") to the mint's atomic
 * base-unit string, at the mint's fixed 6 decimals. Never a float: parsed
 * digit-by-digit into a `bigint`, so "1" always yields exactly "1000000",
 * with no floating-point rounding anywhere in the path.
 */
export function glcToAtomic(amountGlc: string): bigint {
  const trimmed = amountGlc.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Amount must be a plain positive decimal number.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > RESERVE_MINT_DECIMALS) {
    throw new Error(`GLC supports at most ${RESERVE_MINT_DECIMALS} decimal places.`);
  }
  const paddedFraction = fraction.padEnd(RESERVE_MINT_DECIMALS, "0");
  const atomic =
    BigInt(whole || "0") * 10n ** BigInt(RESERVE_MINT_DECIMALS) +
    BigInt(paddedFraction || "0");
  if (atomic <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return atomic;
}

/**
 * Builds a raw Token-2022 `TransferChecked` instruction (SPL Token
 * instruction index 12: `[12, ...amount:u64LE, decimals:u8]`; accounts
 * `[source(w), mint(r), destination(w), authority(signer)]`) — hand-rolled,
 * matching `deposit.ts`'s own no-new-dependency style
 * (`@solana/spl-token` is excluded from this app's bundle entirely, see
 * eslint.config.mjs's wallet-containment rule), rather than deriving or
 * creating anything for the destination side. `destination` is used
 * EXACTLY as given — this function has no ATA-derivation logic for it at
 * all, unlike `source`, which the caller is expected to have already
 * derived via `findAssociatedTokenAddress` for the connected wallet.
 */
export function buildTransferCheckedInstruction(params: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amountAtomic: bigint;
  decimals: number;
}): TransactionInstruction {
  const { source, mint, destination, authority, amountAtomic, decimals } = params;
  assertIsReserveTokenAccount(destination);

  const amountBytes = new Uint8Array(8);
  new DataView(amountBytes.buffer).setBigUint64(0, amountAtomic, true);

  const data = Buffer.concat([
    Buffer.from([12]), // TransferChecked
    Buffer.from(amountBytes),
    Buffer.from([decimals]),
  ]);

  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    data,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
  });
}

export interface FundReserveParams {
  readonly amountGlc: string;
}

export interface FundReserveResult {
  readonly signature: string;
}

/**
 * The one function outside this module that crosses the wallet-adapter/
 * web3.js boundary for the funding action — mirrors `useDepositToReserve`
 * (`send.ts`) exactly: fetch a blockhash once, send through the connected
 * wallet, confirm against that same blockhash, and wrap every failure with
 * the transaction-specific error presentations (`solanaSendError`/
 * `solanaConfirmationError`) rather than ever letting a generic
 * page-loading error stand in for a funding failure.
 */
export function useFundReserve(): {
  readonly ready: boolean;
  readonly walletAddress: string | null;
  readonly canSign: boolean;
  readonly fund: (params: FundReserveParams) => Promise<FundReserveResult>;
} {
  const { connection } = useConnection();
  const adapter = useWallet();
  const { configured } = useWalletRuntime();
  const mounted = useIsMounted();
  const ready = configured && mounted;

  const canSign = ready && adapter.connected && Boolean(adapter.signTransaction);

  const fund = useCallback(
    async (params: FundReserveParams): Promise<FundReserveResult> => {
      if (!ready || !adapter.publicKey) throw new Error("Wallet is not connected");

      const walletPubkey = adapter.publicKey;
      const mint = new PublicKey(env.reserveMintAddress);
      const destination = new PublicKey(RESERVE_TOKEN_ACCOUNT_ADDRESS);
      const source = findAssociatedTokenAddress(walletPubkey, mint);
      const amountAtomic = glcToAtomic(params.amountGlc);

      const instruction = buildTransferCheckedInstruction({
        source,
        mint,
        destination,
        authority: walletPubkey,
        amountAtomic,
        decimals: RESERVE_MINT_DECIMALS,
      });

      const transaction = new Transaction().add(instruction);
      const { blockhash, lastValidBlockHeight, feePayer } = await attachRecentBlockhash(
        connection,
        walletPubkey,
      );
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = feePayer;

      let signature: string;
      try {
        signature = await adapter.sendTransaction(transaction, connection);
      } catch (cause) {
        throw solanaSendError(cause);
      }

      try {
        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
      } catch (cause) {
        throw solanaConfirmationError(cause, signature);
      }

      return { signature };
    },
    [ready, adapter, connection],
  );

  return {
    ready,
    walletAddress: ready ? (adapter.publicKey?.toBase58() ?? null) : null,
    canSign,
    fund,
  };
}

const RESERVE_BALANCE_POLL_MS = 30_000;

/** The reserve token account's own GLC balance — reads that ONE account
 * directly (`fetchTokenAccountBalance`), never an owner-derived sum. */
export function useReserveTokenAccountBalance(): UseQueryResult<WalletBalance> {
  return useQuery({
    queryKey: [
      "solana",
      "balance",
      "reserve-token-account",
      RESERVE_TOKEN_ACCOUNT_ADDRESS,
    ],
    refetchInterval: RESERVE_BALANCE_POLL_MS,
    queryFn: async () => {
      const connection = getConnection();
      if (!connection) throw new Error("Solana RPC is not configured");
      return fetchTokenAccountBalance(connection, RESERVE_TOKEN_ACCOUNT_ADDRESS, "GLC");
    },
  });
}
