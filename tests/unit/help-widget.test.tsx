import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpWidget } from "@/components/help/HelpWidget";
import FaqPage from "../../app/faq/page";
import { FAQ_ENTRIES, FAQ_SHORTCUTS } from "@/lib/content/faq";
import { routes } from "@/lib/config/links";

/**
 * The widget's behavioural contract: it opens, it closes by every route a
 * dialog must close by, it filters the real catalogue, and every link it
 * offers points at a route this app actually serves.
 *
 * Outside-click dismissal and the focus ring are proved in the browser
 * (tests/e2e/help-widget.spec.ts) rather than here — jsdom has no layout, so
 * "clicked outside the panel" is not a question it can answer honestly.
 */

const openPanel = async () => {
  const user = userEvent.setup();
  render(<HelpWidget />);
  await user.click(screen.getByRole("button", { name: "Help" }));
  return { user, panel: await screen.findByRole("dialog", { name: "Goldcoin Help" }) };
};

describe("opening and closing", () => {
  it("starts closed, with only the launcher on the page", () => {
    render(<HelpWidget />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a dialog titled Goldcoin Help", async () => {
    const { panel } = await openPanel();
    expect(within(panel).getByText("Goldcoin Help")).toBeInTheDocument();
  });

  it("closes with the X button, and returns focus to the launcher", async () => {
    const { user, panel } = await openPanel();

    await user.click(within(panel).getByRole("button", { name: "Close help" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toHaveFocus();
  });

  it("closes with Escape", async () => {
    const { user } = await openPanel();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("panel contents", () => {
  it("offers the six curated questions before anything is typed", async () => {
    const { panel } = await openPanel();
    for (const entry of FAQ_SHORTCUTS) {
      expect(within(panel).getByRole("link", { name: entry.question })).toHaveAttribute(
        "href",
        `${routes.faq}#${entry.id}`,
      );
    }
  });

  it("offers the four shortcuts, and no live chat it cannot honour", async () => {
    const { panel } = await openPanel();

    for (const [label, href] of [
      ["Check transfer status", routes.activity],
      ["View bridge status", routes.status],
      ["Open full FAQ", routes.faq],
      ["Support", routes.support],
    ] as const) {
      expect(within(panel).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }

    expect(panel.textContent).not.toMatch(/chat/i);
  });
});

describe("FAQ search", () => {
  it("filters the list to matching questions", async () => {
    const { user, panel } = await openPanel();

    await user.type(
      within(panel).getByRole("searchbox", { name: "Search the FAQ" }),
      "fee",
    );

    expect(within(panel).getByRole("link", { name: "What is the fee?" })).toBeVisible();
    expect(
      within(panel).queryByRole("link", { name: "Where are my funds?" }),
    ).not.toBeInTheDocument();
  });

  it("reaches questions that are not among the six shortcuts", async () => {
    const { user, panel } = await openPanel();

    // Not a shortcut, so it is only reachable through search.
    expect(
      within(panel).queryByRole("link", { name: "Why was my transfer refused?" }),
    ).not.toBeInTheDocument();

    await user.type(within(panel).getByRole("searchbox"), "refused");

    expect(
      within(panel).getByRole("link", { name: "Why was my transfer refused?" }),
    ).toBeVisible();
  });

  it("says so when nothing matches, and still offers the full FAQ and support", async () => {
    const { user, panel } = await openPanel();

    await user.type(within(panel).getByRole("searchbox"), "zzzznotaquestion");

    expect(within(panel).getByText(/nothing in the faq matches that/i)).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Open full FAQ" })).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Support" })).toBeVisible();
  });

  it("forgets the query once the panel is closed and reopened", async () => {
    const { user, panel } = await openPanel();

    await user.type(within(panel).getByRole("searchbox"), "fee");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Help" }));

    const reopened = await screen.findByRole("dialog", { name: "Goldcoin Help" });
    expect(within(reopened).getByRole("searchbox")).toHaveValue("");
    expect(
      within(reopened).getByRole("link", { name: "Where are my funds?" }),
    ).toBeVisible();
  });
});

/**
 * The link-integrity check that matters most: the widget sends a reader to
 * `/faq#some-anchor`, and this proves the anchor is really rendered by the
 * FAQ page. A compile-time map guarantees every question HAS an answer; this
 * guarantees the anchor it is published under is the one the widget links to.
 */
describe("every FAQ link lands on a real section", () => {
  it("renders a section for every catalogue entry, at the linked id", () => {
    const { container } = render(<FaqPage />);

    for (const entry of FAQ_ENTRIES) {
      const section = container.querySelector(`#${entry.id}`);
      expect(section, entry.id).not.toBeNull();
      expect(section?.textContent).toContain(entry.question);
    }
  });
});
