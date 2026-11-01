import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProfileFitState } from "@/lib/linkedin-posts/profile-fit-data";
import { ProfileFitControls, ProfileFitDetails } from "./profile-fit-controls";
import { loadProfileMatch, startProfileMatch, stopProfileMatch } from "./profile-fit-actions";

vi.mock("./profile-fit-actions", () => ({ loadProfileMatch: vi.fn(), startProfileMatch: vi.fn(), stopProfileMatch: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: (r: unknown) => r }));
const scope = { kind: "manual" as const, id: "search" };
const base: ProfileFitState = { scope: "manual:search", available: true, profileReady: true, profileHash: "current", run: null, results: {} };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadProfileMatch).mockResolvedValue({ ok: true, data: base }); });

it("starts matching saved posts and enables the conservative suitability filter", async () => {
  const onModeChange = vi.fn();
  const running = { ...base, run: { id: "review", status: "RUNNING", active: true, processed: 0, total: 20, error: null } };
  vi.mocked(startProfileMatch).mockResolvedValue({ ok: true, data: running });
  render(<ProfileFitControls scope={scope} mode="all" onModeChange={onModeChange} onChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Match my profile" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Match my profile" }));
  expect(startProfileMatch).toHaveBeenCalledWith(scope);
  expect(onModeChange).toHaveBeenCalledWith("hide_unsuitable");
  expect(screen.getByRole("status")).toHaveTextContent("0 / 20");
  expect(screen.getByRole("button", { name: "Stop matching" })).toBeEnabled();
});

it("requires a professional profile before starting and keeps filter selection available", async () => {
  vi.mocked(loadProfileMatch).mockResolvedValue({ ok: true, data: { ...base, profileReady: false } });
  const change = vi.fn();
  render(<ProfileFitControls scope={scope} mode="all" onModeChange={change} onChange={vi.fn()} />);
  expect(await screen.findByRole("link", { name: "Add your skills and experience in Profile" })).toHaveAttribute("href", "/profile");
  expect(screen.getByRole("button", { name: "Match my profile" })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Profile fit in manual search"), "review");
  expect(change).toHaveBeenCalledWith("review");
  expect(startProfileMatch).not.toHaveBeenCalled();
});

it("stops matching and retains progress", async () => {
  const run = { id: "review", status: "RUNNING", active: true, processed: 3, total: 20, error: null };
  vi.mocked(loadProfileMatch).mockResolvedValue({ ok: true, data: { ...base, run } });
  vi.mocked(stopProfileMatch).mockResolvedValue({ ok: true, data: { ...base, run: { ...run, status: "CANCELLED", active: false } } });
  render(<ProfileFitControls scope={scope} mode="all" onModeChange={vi.fn()} onChange={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "Stop matching" }));
  expect(stopProfileMatch).toHaveBeenCalledWith(scope);
  expect(screen.getByRole("status")).toHaveTextContent("3 / 20 posts reviewed or skipped · cancelled");
});

it("shows original evidence on demand without hiding uncertain matches", async () => {
  render(<ProfileFitDetails fit={{ verdict: "review", summary: "Language level needs review", requirements: [{ requirement: "German C1", quote: "German C1 required", required: true, category: "language", result: "unknown", profileEvidence: null }], evaluatedAt: "2026-10-30T00:00:00Z", provider: "LOCAL", model: "ollama" }} />);
  expect(screen.getByText("Profile fit: Needs review")).toBeVisible();
  expect(screen.getByText("Language level needs review")).not.toBeVisible();
  await userEvent.click(screen.getByText("Why this match?"));
  expect(screen.getByText("Language level needs review")).toBeVisible();
  expect(screen.getByText("Post: “German C1 required”")).toBeVisible();
  expect(screen.getByText(/No verified profile evidence/)).toBeVisible();
});
