import type { EIP1193Provider } from "viem";

/**
 * Injected EVM wallet discovery.
 *
 * Injected wallets only, deliberately: no WalletConnect, no relay, no
 * connector framework. The Robinhood route ships disabled and its contract
 * is not deployed, so this needs to be correct and small, not broad — and
 * every additional connector is a third-party bridge in the path of a
 * signing request.
 *
 * Discovery prefers **EIP-6963**, the multi-injected-provider standard, so
 * a browser with several wallet extensions lets the user pick rather than
 * silently handing whichever one won the race for `window.ethereum`. A
 * single legacy `window.ethereum` is used as a fallback when no wallet
 * announces itself, which covers older extensions that never adopted 6963.
 */

/** EIP-6963's provider info record. */
export interface InjectedWalletInfo {
  /** Stable per-extension UUID, unique to this page session. */
  readonly uuid: string;
  /** Reverse-DNS identifier, e.g. `io.metamask`. */
  readonly rdns: string;
  readonly name: string;
  /** Data-URI icon supplied by the wallet. Rendered only as an <img> src. */
  readonly icon: string;
}

export interface InjectedWallet {
  readonly info: InjectedWalletInfo;
  readonly provider: EIP1193Provider;
}

/**
 * The announce event's payload, typed as what it actually is: data from a
 * browser extension this app does not control. Every field is optional
 * here so the runtime guard below is a real check rather than a formality
 * the type system has already assumed away.
 */
type Eip6963AnnounceEvent = CustomEvent<
  | {
      info?: Partial<InjectedWalletInfo>;
      provider?: EIP1193Provider;
    }
  | undefined
>;

const ANNOUNCE_EVENT = "eip6963:announceProvider";
const REQUEST_EVENT = "eip6963:requestProvider";

/** The legacy single-provider injection, when a wallet exposes one. */
function legacyProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as { ethereum?: EIP1193Provider }).ethereum;
  return injected ?? null;
}

/**
 * Subscribes to EIP-6963 announcements and returns an unsubscribe function.
 *
 * Wallets announce in response to the request event, and may announce again
 * later (an extension enabled mid-session), so this stays subscribed rather
 * than resolving a one-shot promise. Duplicate announcements are keyed out
 * by `uuid`, which the standard defines as unique per page session.
 */
export function subscribeToInjectedWallets(
  onChange: (wallets: readonly InjectedWallet[]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const byUuid = new Map<string, InjectedWallet>();

  const emit = () => {
    const announced = [...byUuid.values()];
    if (announced.length > 0) {
      onChange(announced);
      return;
    }
    // Nothing announced: fall back to a legacy injection if one exists, so
    // a pre-6963 wallet is still usable. Given a synthetic info record —
    // there is no standard one to read, and the UI needs something to label
    // the button with.
    const legacy = legacyProvider();
    onChange(
      legacy
        ? [
            {
              info: {
                uuid: "legacy-window-ethereum",
                rdns: "unknown",
                name: "Browser wallet",
                icon: "",
              },
              provider: legacy,
            },
          ]
        : [],
    );
  };

  const onAnnounce = (event: Event) => {
    const { detail } = event as Eip6963AnnounceEvent;
    const info = detail?.info;
    const provider = detail?.provider;
    // A malformed announcement is ignored rather than stored as a wallet
    // with missing fields — a nameless entry in a wallet picker is worse
    // than one fewer option.
    if (!info?.uuid || !info.name || !provider) return;
    byUuid.set(info.uuid, {
      info: {
        uuid: info.uuid,
        rdns: info.rdns ?? "unknown",
        name: info.name,
        icon: info.icon ?? "",
      },
      provider,
    });
    emit();
  };

  window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
  // Ask any already-loaded wallet to announce itself. Wallets that load
  // later announce unprompted, which the listener above still catches.
  window.dispatchEvent(new Event(REQUEST_EVENT));
  emit();

  return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
}
