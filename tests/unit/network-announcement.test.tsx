import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkAnnouncement } from "@/components/layout/NetworkAnnouncement";
import { BridgeStatusBar } from "@/components/layout/BridgeStatusBar";
import {
  COMING_SOON_LABEL,
  NETWORK_ANNOUNCEMENT,
  type NetworkAnnouncement as NetworkAnnouncementConfig,
} from "@/lib/config/announcement";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import { renderWithQueryClient } from "./test-utils";

/**
 * The announcement's contract has two halves.
 *
 * The first is ordinary: it renders what the constant says, it can be turned
 * off, and it can be dismissed for the session.
 *
 * The second is the one that matters. This strip must stay completely
 * isolated from live bridge state — it describes an integration that does not
 * exist yet, so there is nothing about the running bridge it could honestly
 * reflect. That isolation is asserted three ways below: the strip renders
 * identically whatever the status endpoint says, it renders with no query
 * client at all, and its source imports nothing from the api, query, status
 * or solana layers.
 */

const config = NETWORK_ANNOUNCEMENT;

function status(overrides: Partial<BridgeStatusDto> = {}): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: false,
    vault_address: "vault",
    next_solana_obligation_index: 0,
    glc_to_sol_available: true,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "0",
    sol_to_glc_rolling_volume_remaining: "0",
    ...overrides,
  };
}

/** The strip is a session-scoped dismissal, so the store must not leak. */
afterEach(() => {
  window.sessionStorage.clear();
});

const banner = () => screen.getByRole("region", { name: "Network announcement" });

describe("rendering", () => {
  it("renders the coming-soon badge as text, not as colour alone", () => {
    render(<NetworkAnnouncement />);
    expect(within(banner()).getAllByText(COMING_SOON_LABEL)[0]).toBeInTheDocument();
  });

  it("renders the configured title as the section's heading", () => {
    render(<NetworkAnnouncement />);
    expect(
      screen.getByRole("heading", { name: config.title, level: 2 }),
    ).toBeInTheDocument();
    expect(banner()).toHaveAccessibleName("Network announcement");
  });

  it("renders the configured description as the strip's only line of copy", () => {
    render(<NetworkAnnouncement />);
    expect(within(banner()).getByText(config.description)).toBeInTheDocument();
    // The strip carried a second, quieter line ("More details soon.") beside
    // the description. It was removed rather than reworded, so nothing should
    // reintroduce a trailing aside next to the copy.
    expect(within(banner()).queryByText(/more details soon/i)).toBeNull();
    expect(within(banner()).getAllByText(/./, { selector: "p" })).toHaveLength(1);
  });

  it("renders nothing at all when the config is disabled", () => {
    const disabled: NetworkAnnouncementConfig = { ...config, enabled: false };
    const { container } = render(<NetworkAnnouncement announcement={disabled} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });
});

describe("artwork", () => {
  it("uses the mascot on the left and the Robinhood mark on the right", () => {
    render(<NetworkAnnouncement />);
    const sources = [...banner().querySelectorAll("img")].map((img) =>
      // next/image rewrites the attribute through its loader in some
      // configurations, so match on the underlying file rather than on an
      // exact src string.
      decodeURIComponent(img.getAttribute("src") ?? ""),
    );

    expect(sources.some((src) => src.includes("/branding/goldcoin-mascot.png"))).toBe(
      true,
    );
    expect(sources.some((src) => src.includes("/brands/robinhood-mark.png"))).toBe(true);
  });

  it("keeps both images decorative, so neither is announced", () => {
    render(<NetworkAnnouncement />);
    // An empty alt plus aria-hidden: the heading already names the network,
    // and the mascot carries no information the text does not.
    expect(within(banner()).queryAllByRole("img")).toHaveLength(0);
    for (const img of banner().querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("sets no width or height class that could distort either image", () => {
    render(<NetworkAnnouncement />);
    for (const img of banner().querySelectorAll("img")) {
      // Height is driven; width follows the intrinsic ratio.
      expect(img.className).toContain("w-auto");
    }
  });
});

describe("controls", () => {
  it("offers no call to action — there is no page to open", () => {
    render(<NetworkAnnouncement />);
    expect(
      within(banner()).queryByRole("button", { name: /learn more/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves dismissal as the strip's only control, disabled or otherwise", () => {
    render(<NetworkAnnouncement />);

    // A disabled button is still exposed to assistive technology, so this
    // catches a dead control being left behind as well as a live one.
    const controls = within(banner()).getAllByRole("button");
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName(
      `Dismiss the ${config.network} announcement`,
    );
  });

  it("does not reuse the badge's wording, so the two are never confused", () => {
    render(<NetworkAnnouncement />);
    expect(
      within(banner()).queryByRole("button", { name: /coming soon/i }),
    ).not.toBeInTheDocument();
  });

  it("renders no links whatsoever — a dead route is worse than no link", () => {
    render(<NetworkAnnouncement />);
    expect(within(banner()).queryAllByRole("link")).toHaveLength(0);
    expect(banner().querySelectorAll("a")).toHaveLength(0);
  });
});

describe("dismissal", () => {
  it("hides the strip when the labelled close button is pressed", async () => {
    const user = userEvent.setup();
    render(<NetworkAnnouncement />);

    await user.click(
      within(banner()).getByRole("button", {
        name: `Dismiss the ${config.network} announcement`,
      }),
    );

    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("stays hidden for the rest of the browser session", async () => {
    const user = userEvent.setup();
    const first = render(<NetworkAnnouncement />);
    await user.click(
      screen.getByRole("button", { name: `Dismiss the ${config.network} announcement` }),
    );
    first.unmount();

    render(<NetworkAnnouncement />);
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("still renders when session storage is unavailable", () => {
    const original = window.sessionStorage.getItem;
    window.sessionStorage.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      render(<NetworkAnnouncement />);
      expect(banner()).toBeInTheDocument();
    } finally {
      window.sessionStorage.getItem = original;
    }
  });
});

describe("isolation from live bridge state", () => {
  it("renders with no query client, so it cannot depend on one", () => {
    // Would throw "No QueryClient set" if any bridge hook were reachable.
    render(<NetworkAnnouncement />);
    expect(banner()).toBeInTheDocument();
  });

  it("leaves the operational bar intact beside it", async () => {
    renderWithQueryClient(
      <>
        <BridgeStatusBar initialStatus={status()} />
        <NetworkAnnouncement />
      </>,
    );

    expect(screen.getByText("Operational")).toBeInTheDocument();
    // Awaited, not synchronous: the route count comes from `GET /chains`,
    // which — unlike the status snapshot — is not hydrated server-side.
    expect(await screen.findByText("2 of 6 routes available.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View status" })).toHaveAttribute(
      "href",
      "/status",
    );
    expect(banner()).toBeInTheDocument();
  });

  it("renders identically whether the bridge is operational, degraded or paused", () => {
    const snapshots: readonly BridgeStatusDto[] = [
      status(),
      status({ glc_to_sol_available: false }),
      status({ goldcoin_paused: true, solana_paused: true }),
    ];

    const rendered = snapshots.map((snapshot) => {
      const view = renderWithQueryClient(
        <>
          <BridgeStatusBar initialStatus={snapshot} />
          <NetworkAnnouncement />
        </>,
      );
      // Text rather than markup: `useId` mints a fresh heading id on every
      // render, so identical output would still differ byte for byte.
      const text = screen.getByRole("region", {
        name: "Network announcement",
      }).textContent;
      view.unmount();
      return text;
    });

    expect(new Set(rendered).size).toBe(1);
  });

  it("imports nothing from the api, query, status, solana or wallet layers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/layout/NetworkAnnouncement.tsx"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

    for (const specifier of imports) {
      expect(
        /@\/lib\/(api|query|status|solana)|wallet-adapter|@\/features/.test(
          specifier ?? "",
        ),
        `NetworkAnnouncement must not import ${specifier}`,
      ).toBe(false);
    }
  });

  it("is configured by a constant that pulls in no runtime state", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/config/announcement.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^import /m);
  });
});
