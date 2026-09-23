import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkAnnouncement } from "@/components/layout/NetworkAnnouncement";
import { BridgeStatusBar } from "@/components/layout/BridgeStatusBar";
import {
  ANNOUNCEMENT_STATUS_DESCRIPTION,
  ANNOUNCEMENT_STATUS_LABEL,
  NETWORK_ANNOUNCEMENT,
  networkAnnouncementStatus,
  type NetworkAnnouncement as NetworkAnnouncementConfig,
  type NetworkAnnouncementStatus,
} from "@/lib/config/announcement";
import { env } from "@/lib/config/env";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import { renderWithQueryClient } from "./test-utils";

/**
 * The integration strip's contract.
 *
 * The strip used to be a pure constant announcing a future integration,
 * and its tests pinned that isolation: it rendered identically whatever
 * the bridge was doing. That property was correct while the routes did not
 * exist and became the defect once they did — the strip went on saying
 * "COMING SOON … launches next week" about machinery that had shipped.
 *
 * So the contract is inverted here, and the cases below are the inversion:
 * the badge and the line of copy track `GET /chains`, an unanswered read
 * is `unknown` rather than available, and no launch language survives in
 * any state the strip can reach.
 */

/*
 * The shipped announcement, forced on.
 *
 * `NETWORK_ANNOUNCEMENT.enabled` is deployment configuration
 * (`NEXT_PUBLIC_ANNOUNCEMENT_ENABLED`) and is OFF in this build, which is
 * the point of the flag — so every case that asserts what the strip renders
 * passes this enabled copy explicitly. The cases that assert the flag
 * itself use `NETWORK_ANNOUNCEMENT` unchanged.
 */
const config: NetworkAnnouncementConfig = { ...NETWORK_ANNOUNCEMENT, enabled: true };

const getChains = vi.fn();
const getStatus = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getChains: (...args: unknown[]) => getChains(...args),
    getStatus: (...args: unknown[]) => getStatus(...args),
  },
}));

const now = () => new Date();

function status(overrides: Partial<BridgeStatusDto> = {}): BridgeStatusDto {
  return { ...fixtures.statusFixture(now), ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  getChains.mockResolvedValue(fixtures.chainsFixture(now));
  getStatus.mockResolvedValue(status());
});

/** The strip is a session-scoped dismissal, so the store must not leak. */
afterEach(() => {
  window.sessionStorage.clear();
});

const banner = () => screen.getByRole("region", { name: "Network announcement" });

/** Waits for `/chains` to land, so a case never asserts the `unknown` placeholder. */
async function settled(label: string) {
  return within(banner()).findByText(label);
}

describe("rendering", () => {
  it("renders the resolved status as text, not as colour alone", async () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    // Both Robinhood routes ship closed, so the honest badge is
    // "Unavailable" — never a promise about when they open.
    expect(await settled(ANNOUNCEMENT_STATUS_LABEL.unavailable)).toBeInTheDocument();
  });

  it("renders the configured title as the section's heading", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    expect(
      screen.getByRole("heading", { name: config.title, level: 2 }),
    ).toBeInTheDocument();
    expect(banner()).toHaveAccessibleName("Network announcement");
  });

  it("renders exactly one line of copy, resolved from the status", async () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    expect(
      await settled(ANNOUNCEMENT_STATUS_DESCRIPTION.unavailable(config.network)),
    ).toBeInTheDocument();
    expect(within(banner()).getAllByText(/./, { selector: "p" })).toHaveLength(1);
  });

  it("renders nothing at all when the config is disabled", () => {
    const disabled: NetworkAnnouncementConfig = { ...config, enabled: false };
    const { container } = renderWithQueryClient(
      <NetworkAnnouncement announcement={disabled} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });
});

describe("the enabled flag is deployment configuration, and fails closed", () => {
  /*
   * The Robinhood announcement is retired by configuration rather than by
   * deleting the feature, so these cases pin both halves of that: the
   * shipped config is off because the flag is unset, and the component
   * renders exactly nothing when it is — no landmark, no heading, no
   * dismissal control left behind for a screen reader to find.
   */
  it("takes `enabled` from NEXT_PUBLIC_ANNOUNCEMENT_ENABLED, not from a constant", () => {
    expect(NETWORK_ANNOUNCEMENT.enabled).toBe(env.announcementEnabled);
  });

  it("ships OFF: the flag is unset in this build, so the strip is hidden", () => {
    expect(NETWORK_ANNOUNCEMENT.enabled).toBe(false);

    const { container } = renderWithQueryClient(<NetworkAnnouncement />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
    expect(screen.queryByRole("heading", { name: config.title })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders the whole strip when the flag is on", async () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);

    expect(banner()).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: config.title, level: 2 }),
    ).toBeInTheDocument();
    expect(await settled(ANNOUNCEMENT_STATUS_LABEL.unavailable)).toBeInTheDocument();
  });

  it("is off for every value that is not exactly `true`, without failing", () => {
    // The parser's own cases live in env.test.ts; this is the component's
    // half of the contract — a flag that resolved to false hides the strip.
    for (const enabled of [false]) {
      const view = renderWithQueryClient(
        <NetworkAnnouncement announcement={{ ...config, enabled }} />,
      );
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
    }
  });
});

describe("no stale launch language survives", () => {
  const STALE = [/coming soon/i, /next week/i, /launch/i, /\bsoon\b/i];

  it("says none of it in any state the strip can reach", async () => {
    for (const chains of [
      fixtures.chainsFixture(now),
      fixtures.chainsFixture(now, { robinhoodOpen: true }),
      fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
    ]) {
      getChains.mockResolvedValue(chains);
      const view = renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
      await screen.findByRole("heading", { name: config.title, level: 2 });
      const text = banner().textContent;
      for (const pattern of STALE) {
        expect(text, `"${text}" still carries ${pattern}`).not.toMatch(pattern);
      }
      view.unmount();
    }
  });

  it("carries no such wording in the config's own strings either", () => {
    const strings = [
      config.title,
      config.network,
      ...Object.values(ANNOUNCEMENT_STATUS_LABEL),
      ...Object.values(ANNOUNCEMENT_STATUS_DESCRIPTION).map((line) =>
        line(config.network),
      ),
    ];
    for (const value of strings) {
      for (const pattern of STALE) {
        expect(value).not.toMatch(pattern);
      }
    }
  });
});

describe("status derivation from GET /chains", () => {
  const cases: readonly {
    readonly name: string;
    readonly chains: () => ChainsViewDto | undefined;
    readonly expected: NetworkAnnouncementStatus;
  }[] = [
    {
      name: "both routes available",
      chains: () => fixtures.chainsFixture(now, { robinhoodOpen: true }),
      expected: "available",
    },
    {
      name: "both routes closed",
      chains: () => fixtures.chainsFixture(now),
      expected: "unavailable",
    },
    {
      name: "enabled but held shut by the destination reserve",
      chains: () =>
        fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
      expected: "unavailable",
    },
    {
      name: "one available, one not",
      chains: () => {
        const chains = fixtures.chainsFixture(now, { robinhoodOpen: true });
        return {
          ...chains,
          routes: chains.routes.map((route) =>
            route.id === "RhnToGlc"
              ? { ...route, available: false, unavailable_reason: "closed" }
              : route,
          ),
        };
      },
      expected: "partial",
    },
    { name: "/chains has not answered", chains: () => undefined, expected: "unknown" },
  ];

  for (const { name, chains, expected } of cases) {
    it(`reports ${expected} when ${name}`, () => {
      expect(networkAnnouncementStatus(chains())).toBe(expected);
    });
  }

  it("fails closed when the backend publishes no `available` field", () => {
    // A deployment predating backend PR #76. `enabled: true` is not an
    // answer to "can this be used", and the strip must not read it as one.
    const chains = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const legacy: ChainsViewDto = {
      ...chains,
      routes: chains.routes.map((route) => {
        const { available: _available, unavailable_reason: _reason, ...rest } = route;
        return rest;
      }),
    };
    expect(networkAnnouncementStatus(legacy)).toBe("unavailable");
  });

  it("renders the available badge and copy once the backend opens both routes", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);

    expect(await settled(ANNOUNCEMENT_STATUS_LABEL.available)).toBeInTheDocument();
    expect(
      within(banner()).getByText(
        ANNOUNCEMENT_STATUS_DESCRIPTION.available(config.network),
      ),
    ).toBeInTheDocument();
    expect(
      within(banner()).queryByText(ANNOUNCEMENT_STATUS_LABEL.unavailable),
    ).toBeNull();
  });

  it("carries the state in words and an icon, never in colour alone", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    const badge = await settled(ANNOUNCEMENT_STATUS_LABEL.available);

    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain("success");
  });

  it("has a label and a line of copy for every status the union can hold", () => {
    const all: readonly NetworkAnnouncementStatus[] = [
      "available",
      "partial",
      "unavailable",
      "unknown",
    ];
    for (const value of all) {
      expect(ANNOUNCEMENT_STATUS_LABEL[value]).toBeTruthy();
      expect(ANNOUNCEMENT_STATUS_DESCRIPTION[value](config.network)).toBeTruthy();
    }
  });
});

describe("artwork", () => {
  /** next/image rewrites `src` through its loader, so match the file. */
  const sources = () =>
    [...banner().querySelectorAll("img")].map((img) =>
      decodeURIComponent(img.getAttribute("src") ?? ""),
    );

  it("uses the mascot on the left and the configured network mark on the right", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);

    expect(sources().some((src) => src.includes("/branding/goldcoin-mascot.png"))).toBe(
      true,
    );
    expect(config.mark).not.toBeNull();
    expect(sources().some((src) => src.includes(config.mark!.src))).toBe(true);
  });

  it("takes the mark from the config rather than naming a network in the component", () => {
    // The same strip announcing a different launch: only the config moves.
    const other: NetworkAnnouncementConfig = {
      ...config,
      mark: { src: "/branding/goldcoin-logo.png", width: 512, height: 512 },
    };
    renderWithQueryClient(<NetworkAnnouncement announcement={other} />);

    expect(sources().some((src) => src.includes("/branding/goldcoin-logo.png"))).toBe(
      true,
    );
    expect(sources().some((src) => src.includes("/brands/robinhood-mark.png"))).toBe(
      false,
    );
  });

  it("renders the strip with no mark at all when the config carries none", () => {
    const markless: NetworkAnnouncementConfig = { ...config, mark: null };
    renderWithQueryClient(<NetworkAnnouncement announcement={markless} />);

    expect(banner()).toBeInTheDocument();
    expect(sources()).toEqual([expect.stringContaining("/branding/goldcoin-mascot.png")]);
  });

  it("keeps both images decorative, so neither is announced", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    // An empty alt plus aria-hidden: the heading already names the network,
    // and the mascot carries no information the text does not.
    expect(within(banner()).queryAllByRole("img")).toHaveLength(0);
    for (const img of banner().querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("sets no width or height class that could distort either image", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    for (const img of banner().querySelectorAll("img")) {
      // Height is driven; width follows the intrinsic ratio.
      expect(img.className).toContain("w-auto");
    }
  });
});

describe("controls", () => {
  it("offers no call to action — there is no page to open", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    expect(
      within(banner()).queryByRole("button", { name: /learn more/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves dismissal as the strip's only control, disabled or otherwise", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);

    // A disabled button is still exposed to assistive technology, so this
    // catches a dead control being left behind as well as a live one.
    const controls = within(banner()).getAllByRole("button");
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName(
      `Dismiss the ${config.network} announcement`,
    );
  });

  it("renders no links whatsoever — a dead route is worse than no link", () => {
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    expect(within(banner()).queryAllByRole("link")).toHaveLength(0);
    expect(banner().querySelectorAll("a")).toHaveLength(0);
  });
});

describe("dismissal", () => {
  it("hides the strip when the labelled close button is pressed", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);

    await user.click(
      within(banner()).getByRole("button", {
        name: `Dismiss the ${config.network} announcement`,
      }),
    );

    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("stays hidden for the rest of the browser session", async () => {
    const user = userEvent.setup();
    const first = renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    await user.click(
      screen.getByRole("button", { name: `Dismiss the ${config.network} announcement` }),
    );
    first.unmount();

    renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("still renders when session storage is unavailable", () => {
    const original = window.sessionStorage.getItem;
    window.sessionStorage.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      renderWithQueryClient(<NetworkAnnouncement announcement={config} />);
      expect(banner()).toBeInTheDocument();
    } finally {
      window.sessionStorage.getItem = original;
    }
  });
});

describe("beside the global trust strip", () => {
  it("stays a separate landmark, scoped to one network", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(
      <>
        <BridgeStatusBar initialStatus={status()} />
        <NetworkAnnouncement announcement={config} />
      </>,
    );

    // The bridge-wide strip counts every executable route — all six; the
    // integration strip speaks only for the four touching Robinhood.
    // Neither is the other.
    expect(await screen.findByText("6 of 6 routes available.")).toBeInTheDocument();
    expect(
      within(banner()).getByText(ANNOUNCEMENT_STATUS_LABEL.available),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View status" })).toHaveAttribute(
      "href",
      "/status",
    );
  });

  it("does not track the bridge-wide status snapshot", async () => {
    // A Solana-side pause is not a statement about Robinhood's routes, and
    // this strip must not repeat it. `/chains` is the only input.
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    getStatus.mockResolvedValue(fixtures.pausedStatusFixture());
    renderWithQueryClient(
      <>
        <BridgeStatusBar initialStatus={fixtures.pausedStatusFixture()} />
        <NetworkAnnouncement announcement={config} />
      </>,
    );

    expect(
      await within(banner()).findByText(ANNOUNCEMENT_STATUS_LABEL.available),
    ).toBeInTheDocument();
  });
});
