import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dismissAutomationCandidate,
  dismissAutomationCandidates,
  loadAutomationCandidateDetails,
  provideAutomationRecipient,
  searchForAutomationRecipient,
  searchForAutomationRecipients,
} from "./actions";
import { DEFAULT_REVIEW_PARAMS } from "@/lib/review-list";

import { ReviewQueue } from "./review-queue";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({
  approveAndSend: vi.fn(),
  dismissAutomationCandidate: vi.fn(),
  dismissAutomationCandidates: vi.fn(),
  dismissAutomationDraft: vi.fn(),
  keepAutomationDraft: vi.fn(),
  loadAutomationCandidateDetails: vi.fn(),
  markAutomationSent: vi.fn(),
  provideAutomationRecipient: vi.fn(),
  retryAutomationCandidate: vi.fn(),
  searchForAutomationRecipient: vi.fn(),
  searchForAutomationRecipients: vi.fn(),
}));

const item: ComponentProps<typeof ReviewQueue>["items"][number] = {
  id: "candidate-1",
  applicationId: null,
  status: "FILTERED",
  score: 82,
  issue: "The posting does not contain an explicit application email address.",
  canProvideRecipient: true,
  recipientOverride: "",
  company: "Example",
  role: "Engineer",
  place: "Berlin, Germany",
  remote: true,
  postingUrl: "https://jobs.example.com/engineer",
  source: "Daily search · JSEARCH",
  delivery: null,
  discoveredEmails: [],
  emailDiscoveryError: null,
  emailDiscoverySearched: false,
};

const defaults = {
  params: DEFAULT_REVIEW_PARAMS,
  page: 1,
  pages: 1,
  pageSize: 50,
  gmail: { configured: true, email: "sender@example.com" },
};

function renderQueue(items = [item], props: Partial<ComponentProps<typeof ReviewQueue>> = {}) {
  return render(<ReviewQueue items={items} total={items.length} filtered={items.length} {...defaults} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAutomationCandidateDetails).mockResolvedValue({
    ok: true,
    data: { postingText: "Build computer vision systems.", mandatory: ["Python"], email: null },
  });
  vi.mocked(provideAutomationRecipient).mockResolvedValue({ ok: true, data: null, toast: "Preparation queued." });
  vi.mocked(dismissAutomationCandidate).mockResolvedValue({ ok: true, data: null, toast: "Dismissed." });
  vi.mocked(dismissAutomationCandidates).mockResolvedValue({ ok: true, data: { dismissed: 2 }, toast: "2 review items dismissed." });
  vi.mocked(searchForAutomationRecipient).mockResolvedValue({ ok: true, data: null, toast: "Public email search queued." });
  vi.mocked(searchForAutomationRecipients).mockResolvedValue({ ok: true, data: { queued: 1, skipped: 0 }, toast: "1 email search queued." });
});
describe("ReviewQueue", () => {
  it("loads long review details only when a card is expanded and caches them", async () => {
    renderQueue([{ ...item, status: "FAILED", issue: "The model timed out." }]);
    expect(loadAutomationCandidateDetails).not.toHaveBeenCalled();

    const posting = screen.getByRole("button", { name: /Engineer/ });
    await userEvent.click(posting);
    expect(await screen.findByRole("region", { name: "Review details" })).toHaveTextContent("Build computer vision systems.");
    expect(screen.getByText("Python")).toBeVisible();
    expect(loadAutomationCandidateDetails).toHaveBeenCalledTimes(1);

    await userEvent.click(posting);
    await userEvent.click(posting);
    expect(loadAutomationCandidateDetails).toHaveBeenCalledTimes(1);
  });

  it("queues preparation with a supplied email without forcing a router refresh", async () => {
    renderQueue();
    await userEvent.type(screen.getByLabelText("Application email"), "jobs@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Use email and prepare" }));
    await waitFor(() => expect(provideAutomationRecipient).toHaveBeenCalledWith({ candidateId: "candidate-1", recipient: "jobs@example.com" }));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows discovered addresses and bulk searches only selected missing addresses", async () => {
    const found = {
      ...item,
      id: "candidate-2",
      role: "Designer",
      discoveredEmails: [{
        email: "careers@example.com",
        sourceUrl: "https://example.com/careers",
        sourceTitle: "Example careers",
        context: "Applications: careers@example.com",
        confidence: "HIGH" as const,
        reason: "The official careers page names this address.",
      }],
    };
    renderQueue([item, found], { emailSearchConfigured: true });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all shown (2)" }));
    expect(screen.getByRole("button", { name: "Search emails (1)" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Search emails (1)" }));
    await waitFor(() => expect(searchForAutomationRecipients).toHaveBeenCalledWith({ candidateIds: ["candidate-1"] }));
  });

  it("stores filters and sorting in the URL and resets to page one", async () => {
    renderQueue([item], { params: { ...DEFAULT_REVIEW_PARAMS, page: 3 }, page: 3, pages: 3 });
    await userEvent.selectOptions(screen.getByLabelText("Email status"), "not-found");
    expect(router.replace).toHaveBeenCalledWith("/review?email=not-found", { scroll: false });
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "highest");
    expect(router.replace).toHaveBeenCalledWith("/review?sort=highest", { scroll: false });
  });

  it("filters by status, remote and text through the URL and can clear them", async () => {
    renderQueue([item], { options: { sources: [], searches: [], statusCounts: { ready: 4, filtered: 3, queued: 2, failed: 1 } } });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "ready");
    expect(router.replace).toHaveBeenLastCalledWith("/review?status=ready", { scroll: false });
    await userEvent.selectOptions(screen.getByLabelText("Work mode"), "remote");
    expect(router.replace).toHaveBeenLastCalledWith("/review?remote=remote", { scroll: false });
    expect(screen.getByRole("option", { name: "Ready to review (4)" })).toBeInTheDocument();
  });

  it("debounces the text search and shows Clear filters only when something is active", async () => {
    const { rerender } = renderQueue();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search"), "bosch");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/review?q=bosch", { scroll: false }));
    rerender(<ReviewQueue items={[item]} total={1} filtered={1} {...defaults} params={{ ...DEFAULT_REVIEW_PARAMS, q: "bosch" }} />);
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeVisible();
  });

  it("shows total and server-filtered counts", () => {
    renderQueue([item], { total: 73, filtered: 12, pages: 1 });
    expect(screen.getByText("73 reviews waiting")).toBeVisible();
    expect(screen.getByText("12 matching reviews · Page 1 of 1")).toBeVisible();
  });

  it("removes selected reviews optimistically while the bulk action is pending", async () => {
    let finish!: (value: Awaited<ReturnType<typeof dismissAutomationCandidates>>) => void;
    vi.mocked(dismissAutomationCandidates).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const items = [item, { ...item, id: "candidate-2", role: "Designer", company: "Second", score: 42 }];
    renderQueue(items);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all shown (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss selected (2)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Dismiss 2 selected reviews?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Dismiss selected" }));

    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
    finish({ ok: true, data: { dismissed: 2 }, toast: "2 review items dismissed." });
    await waitFor(() => expect(dismissAutomationCandidates).toHaveBeenCalledWith({ candidateIds: ["candidate-1", "candidate-2"] }));
  });

  it("restores an optimistically dismissed review when the action fails", async () => {
    let finish!: (value: Awaited<ReturnType<typeof dismissAutomationCandidate>>) => void;
    vi.mocked(dismissAutomationCandidate).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderQueue();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
    finish({ ok: false, error: "Could not dismiss." });
    expect(await screen.findByRole("article")).toBeVisible();
  });
});
