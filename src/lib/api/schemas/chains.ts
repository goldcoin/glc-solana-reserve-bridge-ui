import { z } from "zod";
import { unixSecondsSchema } from "./common";

/**
 * `GET /chains` — the chain/route registry, and the ONLY authoritative
 * answer to "can a user start a transfer this way right now".
 *
 * # Why this endpoint is the availability boundary
 *
 * `enabled` is the server's own `RouteGate` verdict — the same gate
 * `POST /quote` and `POST /transfers` enforce, evaluated per request and
 * never cached (`service/src/routes.rs`). It is the AND of three
 * independent gates: the service config, the ledger's `bridge_routes`
 * table, and the chain adapter's capability. For anything touching the
 * Robinhood custody contract there is a fourth gate this service does
 * not control at all — the contract's own `routeEnabled`, read live
 * before every broadcast.
 *
 * A UI must render availability from this field and must never re-derive
 * it from its own configuration. That is what makes enabling a route
 * later a backend-only change: no frontend deploy, no env var, no
 * hardcoded list of "routes we support" to go stale.
 *
 * # Why this endpoint's ids are open strings, unlike every other schema
 *
 * `/chains` is the DISCOVERY endpoint: its entire job is to tell a client
 * about networks and routes, including ones the client may not know. So a
 * chain or route id here is an open string, and a backend that adds a
 * fourth network ships it to an unchanged frontend without breaking the
 * page — the new network simply lists as one this build cannot use yet.
 *
 * That is the opposite of the rule for settlement records. A
 * `TransferView.direction` outside the known `Route` enum is a contract
 * break worth surfacing loudly, and stays strictly validated. Discovery is
 * open; anything describing money that has already moved is closed.
 */

/** One chain. Names only — the backend exposes no RPC URL, contract address or explorer host here. */
export const chainViewSchema = z.object({
  /** Stable identifier — `goldcoin`/`solana`/`robinhood` today, open by design. */
  id: z.string().min(1),
  /** Human-readable. Never parse this. */
  display_name: z.string().min(1),
});

export type ChainViewDto = z.infer<typeof chainViewSchema>;

export const routeViewSchema = z.object({
  id: z.string().min(1),
  source_chain: z.string().min(1),
  destination_chain: z.string().min(1),
  /** The server's verdict. The only availability signal this UI may use. */
  enabled: z.boolean(),
  /**
   * Cause-agnostic end-user copy when `enabled` is false; null when
   * enabled. It deliberately never names which gate refused, and this UI
   * must not try to infer one — it renders the sentence as given.
   */
  disabled_reason: z.string().nullable(),
  /**
   * Whether the route has settlement machinery at all
   * (`Route::as_direction().is_some()`). `false` means structurally inert
   * in this build, not merely switched off — which is exactly the
   * distinction between "Coming soon" and "temporarily unavailable", and
   * it is available WITHOUT parsing `disabled_reason`.
   */
  implemented: z.boolean(),
});

export type RouteViewDto = z.infer<typeof routeViewSchema>;

export const chainsViewSchema = z.object({
  chains: z.array(chainViewSchema),
  routes: z.array(routeViewSchema),
  as_of: unixSecondsSchema,
});

export type ChainsViewDto = z.infer<typeof chainsViewSchema>;
