import { expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

/**
 * Shared render helper for component tests.
 *
 * A fresh, retry-disabled QueryClient per render: the app's own
 * `createQueryClient` (src/lib/query/provider.tsx) retries retryable
 * failures twice with exponential backoff, which is correct in production
 * but would make every error-path test take several real seconds for no
 * benefit here.
 */
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );

  return {
    queryClient,
    ...result,
    /**
     * Re-renders inside the same provider.
     *
     * Testing Library's own `rerender` replaces the whole tree, which would
     * drop the QueryClientProvider this helper added — so a test that
     * re-renders to simulate a wallet or account change would fail with
     * "No QueryClient set" rather than exercising what it meant to.
     */
    rerender: (next: ReactElement) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>,
      ),
  };
}

/**
 * Picks a network in one of the bridge form's two selectors.
 *
 * The selector is a listbox: a trigger button named for its side, and
 * options named for the network. Tests go through it exactly as a user
 * does — opening it and choosing — rather than reaching for internal
 * state, so a change that breaks the interaction breaks the tests.
 */
export async function selectNetwork(
  user: ReturnType<typeof userEvent.setup>,
  selector: "Source network" | "Destination network",
  networkName: RegExp,
) {
  const trigger = screen.getByRole("button", { name: selector });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const listbox = await screen.findByRole("listbox", { name: selector });
  await user.click(within(listbox).getByRole("option", { name: networkName }));
}

/**
 * Waits until `GET /chains` has answered.
 *
 * Every route is unusable before that — unknown availability fails closed
 * — so asserting on availability too early would pass for the wrong
 * reason. The summary leaving its "Checking…" state is the signal that a
 * real verdict has arrived.
 */
export async function waitForRouteVerdict() {
  await waitFor(() => {
    expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
  });
}

/**
 * The form's single primary button.
 *
 * Its LABEL is contextual by design — it states what pressing it would do
 * right now ("Enter an amount", "Connect wallet", "Route unavailable",
 * "Bridge GLC") rather than staying generic, which is also what makes it
 * useful to a screen reader. Tests therefore cannot look it up by one
 * fixed name, and this helper both finds it and pins the vocabulary: a
 * label outside this set is a bug, not a passing test.
 */
export function primaryCta(): HTMLElement {
  // Scoped to the form's own landmark: the app header carries its own
  // "Connect wallet" control, and an unscoped lookup would match both.
  return within(screen.getByRole("region", { name: "Bridge transfer" })).getByRole(
    "button",
    {
      name: /^(Bridge GLC|Route unavailable|Connect wallet|Enter destination|Enter an amount|Choose networks)$/i,
    },
  );
}
