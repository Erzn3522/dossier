import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { provideAutomationRecipient } from "./actions";
import { ReviewQueue } from "./review-queue";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({
  approveAndSend: vi.fn(),
  dismissAutomationCandidate: vi.fn(),
  dismissAutomationDraft: vi.fn(),
  keepAutomationDraft: vi.fn(),
  markAutomationSent: vi.fn(),
  provideAutomationRecipient: vi.fn(),
  retryAutomationCandidate: vi.fn(),
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
  postingText: "Build computer vision systems.",
  source: "Daily search · JSEARCH",
  mandatory: [],
  to: "",
  subject: "",
  body: "",
  delivery: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(provideAutomationRecipient).mockResolvedValue({ ok: true, data: null, toast: "Preparation queued." });
});

describe("ReviewQueue automation issues", () => {
  it("opens a failed posting so its source text and original link can be inspected", async () => {
    render(<ReviewQueue items={[{ ...item, status: "FAILED", issue: "The model timed out." }]} gmail={{ configured: true, email: "sender@example.com" }} />);

    const posting = screen.getByRole("button", { name: /Engineer/ });
    expect(posting).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(posting);

    expect(posting).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Original posting" })).toHaveTextContent("Build computer vision systems.");
    expect(screen.getByRole("link", { name: /Open original posting/ })).toHaveAttribute("href", "https://jobs.example.com/engineer");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("shows the filter reason and queues preparation with a user-supplied email", async () => {
    render(<ReviewQueue items={[item]} gmail={{ configured: true, email: "sender@example.com" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("does not contain an explicit application email address");
    await userEvent.type(screen.getByLabelText("Application email"), "jobs@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Use email and prepare" }));

    await waitFor(() => expect(provideAutomationRecipient).toHaveBeenCalledWith({
      candidateId: "candidate-1",
      recipient: "jobs@example.com",
    }));
    expect(router.refresh).toHaveBeenCalled();
  });
});
