import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostSearchView } from "@/lib/linkedin-posts/data";
import { LinkedInPostsScreen } from "./posts-screen";
import { loadLinkedInSearch, runLinkedInSearch } from "./actions";
import { dismissPost, loadDismissedPosts } from "./dismissal-actions";

vi.mock("./actions", () => ({ loadLinkedInSearch: vi.fn(), runLinkedInSearch: vi.fn(), refreshLinkedInSearch: vi.fn(), cancelLinkedInSearch: vi.fn(), deleteLinkedInSearch: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("./dismissal-actions", () => ({ dismissPost: vi.fn(), restorePost: vi.fn(), loadDismissedPosts: vi.fn() }));
vi.mock("./campaign-panel", () => ({ CampaignPanel: () => null }));
vi.mock("./campaign-actions", () => ({ startLinkedInCampaign: vi.fn() }));
vi.mock("./profile-fit-actions", () => ({
  loadProfileMatch: vi.fn().mockResolvedValue({ ok: true, data: { scope: "", available: true, profileReady: true, profileHash: "test", run: null, results: {} } }),
  startProfileMatch: vi.fn(), stopProfileMatch: vi.fn(),
}));
const saved: PostSearchView = {
  id: "search", query: { keywords: ["engineer"], authors: [], postedWithin: "month", since: "", maxPosts: 25 },
  status: "SUCCEEDED", error: null, createdAt: "2026-10-30T10:00:00Z",
  posts: [
    { id: "1", url: "https://www.linkedin.com/posts/1", text: "We are hiring React engineers. Remote in Ljubljana.", postedAt: null, author: { name: "Acme", type: "company", url: null }, likes: 1, commentsCount: 2, query: "engineer" },
    { id: "2", url: "https://www.linkedin.com/posts/2", text: "A day in our Berlin office.", postedAt: null, author: { name: "Jane", type: "person", url: null }, likes: 3, commentsCount: 0, query: "engineer" },
  ],
};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadLinkedInSearch).mockResolvedValue({ ok: true, data: saved }); });

describe("LinkedIn posts screen", () => {
  it("links to Settings and disables search without a token", () => {
    render(<LinkedInPostsScreen keyState="none" initialSearches={[]} />);
    expect(screen.getByRole("link", { name: "Set up Apify →" })).toHaveAttribute("href", "/settings?section=linkedin");
    expect(screen.getByRole("button", { name: "Start AI search" })).toBeDisabled();
  });
  it("starts a search with date, author and limit fields", async () => {
    vi.mocked(runLinkedInSearch).mockResolvedValue({ ok: true, data: saved });
    render(<LinkedInPostsScreen keyState="set" initialSearches={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Optimize with AI"));
    await user.type(screen.getByLabelText("Keyword 1"), "hiring React");
    await user.type(screen.getByLabelText("People or companies"), "acme");
    await user.selectOptions(screen.getByLabelText("Posted within"), "week");
    await user.click(screen.getByRole("button", { name: "Search LinkedIn posts" }));
    await waitFor(() => expect(runLinkedInSearch).toHaveBeenCalledWith({ keywords: ["hiring React"], countries: [], authors: ["acme"], postedWithin: "week", since: "", maxPosts: 20 }));
    expect(await screen.findByText("Showing 2 of 2 posts")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Filter results"));
  });
  it("reopens stored results and filters locally without starting a paid run", async () => {
    render(<LinkedInPostsScreen keyState="set" initialSearches={[{ ...saved, posts: [], count: 2 }]} />);
    expect(await screen.findByText("Showing 2 of 2 posts")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Mentions remote work"));
    expect(screen.getByText("Showing 1 of 2 posts")).toBeInTheDocument();
    expect(screen.queryByText("A day in our Berlin office.")).not.toBeInTheDocument();
    expect(runLinkedInSearch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Showing 2 of 2 posts")).toBeInTheDocument();
  });
  it("keeps the composer closed while reviewing history and exposes separate review tabs", async () => {
    render(<LinkedInPostsScreen keyState="set" initialSearches={[{ ...saved, posts: [], count: 2 }]} />);
    await screen.findByText("Showing 2 of 2 posts");
    expect(screen.getByLabelText("Keyword 1")).not.toBeVisible();
    expect(screen.getByRole("tab", { name: "Manual searches" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "AI searches" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dismissed" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ New search" }));
    expect(screen.getByLabelText("Keyword 1")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Keyword 1"), "Computer Vision");
    await userEvent.click(screen.getByRole("button", { name: "Close search form" }));
    expect(screen.getByLabelText("Keyword 1")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "+ New search" }));
    expect(screen.getByLabelText("Keyword 1")).toHaveValue("Computer Vision");
  });
  it("dismisses a manual result into the shared Dismissed view without re-running a search", async () => {
    vi.mocked(dismissPost).mockResolvedValue({ ok: true, data: { key: "https://www.linkedin.com/feed/update/urn:li:activity:1" } });
    vi.mocked(loadDismissedPosts).mockResolvedValue({ ok: true, data: { total: 1, page: 1, pages: 1, posts: [{ key: "https://www.linkedin.com/feed/update/urn:li:activity:1", post: saved.posts[0], dismissedAt: saved.createdAt }] } });
    render(<LinkedInPostsScreen keyState="set" initialSearches={[{ ...saved, posts: [], count: 2 }]} />);
    await screen.findByText("Showing 2 of 2 posts");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss post by Acme" }));
    expect(await screen.findByText("Showing 1 of 1 posts · 1 dismissed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Dismissed (1)" }));
    expect(await screen.findByRole("button", { name: "Restore post by Acme" })).toBeInTheDocument();
    expect(runLinkedInSearch).not.toHaveBeenCalled();
  });
});


it("hydrates saved search timestamps when server and browser Intl literals differ", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const errors: unknown[] = [];
  let root: Root | undefined;
  const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
  let combinedLabel = "30 Oct 2026, 11:00";
  Object.defineProperty(Intl.DateTimeFormat.prototype, "format", { ...descriptor, get: () => () => combinedLabel });
  try {
    const view = <LinkedInPostsScreen keyState="set" initialSearches={[{ ...saved, posts: [], count: 2 }]} timeZone="Europe/Ljubljana" />;
    container.innerHTML = renderToString(view);
    expect(container.textContent).toContain("30 Oct 2026, 11:00");
    combinedLabel = "30 Oct 2026 at 11:00";
    await act(async () => {
      root = hydrateRoot(container, view, { onRecoverableError: (error) => errors.push(error) });
    });
    await waitFor(() => expect(container.textContent).toContain("Showing 2 of 2 posts"));
    expect(errors).toEqual([]);
    expect(container.textContent).toContain("30 Oct 2026, 11:00");
  } finally {
    if (root) act(() => root!.unmount());
    container.remove(); Object.defineProperty(Intl.DateTimeFormat.prototype, "format", descriptor);
  }
});
