import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignView } from "@/lib/linkedin-posts/campaign-data";
import { CampaignPanel } from "./campaign-panel";
import { cancelLinkedInCampaign, listLinkedInCampaigns, loadLinkedInCampaign, resumeLinkedInCampaign } from "./campaign-actions";

vi.mock("./campaign-actions", () => ({ listLinkedInCampaigns: vi.fn(), loadLinkedInCampaign: vi.fn(), cancelLinkedInCampaign: vi.fn(), resumeLinkedInCampaign: vi.fn(), deleteLinkedInCampaign: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: (r: unknown) => r }));
vi.mock("./dismissal-actions", () => ({ dismissPost: vi.fn(), restorePost: vi.fn(), loadDismissedPosts: vi.fn() }));
vi.mock("./profile-fit-actions", () => ({
  loadProfileMatch: vi.fn().mockResolvedValue({ ok: true, data: { scope: "", available: true, profileReady: true, profileHash: "test", run: null, results: {} } }),
  startProfileMatch: vi.fn(), stopProfileMatch: vi.fn(),
}));
const view: CampaignView = {
  id: "campaign", input: { keywords: ["vision"], countries: ["Slovenia"], rounds: 3, budgetUsd: 1, maxPosts: 20, authors: [], postedWithin: "month", since: "" },
  status: "RUNNING", error: null, provider: "LOCAL", model: "ollama-test", completed: 1, total: 3, reservedUsd: 0.333333,
  createdAt: "2026-10-30T10:00:00Z", found: 25, filtered: 25, page: 1, pages: 2,
  attempts: [{ id: "round-1", country: "Slovenia", round: 1, status: "COMPLETE", queries: ["zaposlimo razvijalca"], strategy: "Try local language", fetched: 25, fresh: 25, duplicates: 0, relevant: 10, error: null, capUsd: 0.333333, runId: "run-1" }],
  posts: [{ id: "post-1", post: { id: "123", url: "https://www.linkedin.com/posts/123", text: "Hiring vision engineers", author: { name: "Acme", type: "company", url: null }, postedAt: null, likes: 1, commentsCount: 0, query: "vision" },
    assessments: [{ country: "Slovenia", relevant: true, hiring: true, confidence: "uncertain", reason: "No explicit location", evidence: null }], occurrences: [{ country: "Slovenia", round: 1, queries: ["zaposlimo razvijalca"] }] }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listLinkedInCampaigns).mockResolvedValue({ ok: true, data: [view] });
  vi.mocked(loadLinkedInCampaign).mockResolvedValue({ ok: true, data: view });
  vi.mocked(cancelLinkedInCampaign).mockResolvedValue({ ok: true, data: null });
  vi.mocked(resumeLinkedInCampaign).mockResolvedValue({ ok: true, data: null });
});
describe("campaign progress and results", () => {
  it("shows round statistics and uncertain matches without hiding them", async () => {
    render(<CampaignPanel initial={[view]} selectedId={null} onActiveChange={vi.fn()} onReuse={vi.fn()} />);
    expect(await screen.findByText("Hiring vision engineers")).toBeInTheDocument();
    expect(screen.getByText("No explicit location")).toBeInTheDocument();
    expect(screen.getByText("Slovenia · uncertain", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("No explicit location")).not.toBeVisible();
    expect(screen.getByRole("progressbar", { name: "AI search progress" })).toHaveAttribute("value", "1");
    await userEvent.click(screen.getByText("AI notes & sources"));
    expect(screen.getByText("No explicit location")).toBeVisible();
    expect(screen.getByText("ollama-test", { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByText("More filters"));
    expect(screen.getByRole("checkbox", { name: "Relevant hiring opportunities" })).not.toBeChecked();
  });
  it("changes server-side confidence filters and pages without starting a search", async () => {
    render(<CampaignPanel initial={[view]} selectedId={null} onActiveChange={vi.fn()} onReuse={vi.fn()} />);
    await screen.findByText("Hiring vision engineers");
    await userEvent.click(screen.getByText("More filters"));
    await userEvent.selectOptions(screen.getByLabelText("Country confidence"), "confirmed");
    await waitFor(() => expect(loadLinkedInCampaign).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ confidence: "confirmed" }), page: 1 })));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(loadLinkedInCampaign).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });
  it("cancels the selected campaign and resumes paused work explicitly", async () => {
    const { unmount } = render(<CampaignPanel initial={[view]} selectedId={null} onActiveChange={vi.fn()} onReuse={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel AI search" }));
    expect(cancelLinkedInCampaign).toHaveBeenCalledWith({ id: "campaign" }); unmount();
    const paused = { ...view, status: "PAUSED" };
    vi.mocked(loadLinkedInCampaign).mockResolvedValue({ ok: true, data: paused });
    render(<CampaignPanel initial={[paused]} selectedId={null} onActiveChange={vi.fn()} onReuse={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
    expect(resumeLinkedInCampaign).toHaveBeenCalledWith({ id: "campaign" });
  });
});
