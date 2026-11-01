import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/toast";
import type { LinkedInPost } from "@/lib/linkedin-posts/data";
import { linkedInPostKey } from "@/lib/linkedin-posts/post-key";
import { DismissalProvider } from "./dismissal-context";
import { PostCard } from "./post-card";
import { DismissedPanel } from "./dismissed-panel";
import { dismissPost, loadDismissedPosts, restorePost } from "./dismissal-actions";

vi.mock("./dismissal-actions", () => ({ dismissPost: vi.fn(), restorePost: vi.fn(), loadDismissedPosts: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (r: unknown) => r }));
const post: LinkedInPost = { id: "123", url: "https://www.linkedin.com/posts/example", text: "Hiring vision engineers", postedAt: null, author: { name: "Acme", type: "company", url: null }, likes: 1, commentsCount: 0, query: "vision" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dismissPost).mockResolvedValue({ ok: true, data: { key: linkedInPostKey(post) } });
  vi.mocked(restorePost).mockResolvedValue({ ok: true, data: { key: linkedInPostKey(post) } });
  vi.mocked(loadDismissedPosts).mockResolvedValue({ ok: true, data: { page: 1, pages: 1, total: 1, posts: [{ key: linkedInPostKey(post), post, dismissedAt: "2026-10-30T10:00:00Z" }] } });
});
describe("dismiss and restore post review flow", () => {
  it("hides all copies of a post and Undo restores them without a new search", async () => {
    render(<DismissalProvider initialKeys={[]}><PostCard post={post} /><PostCard post={{ ...post, url: "https://www.linkedin.com/posts/other-slug?tracking=1" }} /></DismissalProvider>);
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss post by Acme" })[0]);
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
    expect(dismissPost).toHaveBeenCalledOnce();
    const undo = vi.mocked(toast).mock.calls.find((call) => call[1]?.action?.label === "Undo")?.[1]?.action;
    expect(undo).toBeDefined();
    undo!.onClick();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(restorePost).toHaveBeenCalledWith({ key: linkedInPostKey(post) });
  });
  it("keeps the post visible if persistence fails", async () => {
    vi.mocked(dismissPost).mockResolvedValue({ ok: false, error: "Could not save" });
    render(<DismissalProvider initialKeys={[]}><PostCard post={post} /></DismissalProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss post by Acme" }));
    expect(screen.getByRole("article")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss post by Acme" })).toBeEnabled();
  });
  it("keeps persisted dismissals hidden after reload and restores from Dismissed", async () => {
    render(<DismissalProvider initialKeys={[linkedInPostKey(post)]}><PostCard post={post} /><DismissedPanel timeZone="UTC" /></DismissalProvider>);
    expect(await screen.findByRole("button", { name: "Restore post by Acme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss post by Acme" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore post by Acme" }));
    expect(await screen.findByRole("button", { name: "Dismiss post by Acme" })).toBeInTheDocument();
  });
});
