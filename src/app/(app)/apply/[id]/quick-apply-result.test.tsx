import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveQuickApplyEmail, sendQuickApply } from "../actions";

import { QuickApplyResult } from "./quick-apply-result";

vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: <T,>(result: T) => result }));
vi.mock("../actions", () => ({ saveQuickApplyEmail: vi.fn(), sendQuickApply: vi.fn() }));

const props: ComponentProps<typeof QuickApplyResult> = {
  applicationId: "app-1",
  postingUrl: "https://ledgerly.example/jobs/1",
  score: { hit: 3, total: 4, percent: 75 },
  gaps: 1,
  advice: [
    { area: "Missing requirement", suggestion: 'The posting asks for: "ROS 2".', reason: "Not in your profile yet", from: "match" },
    { area: "Summary", suggestion: "Lead with your vision work.", reason: "The role is about vision.", from: "ai" },
  ],
  letter: ["I'd love to join Ledgerly.", "Here's why."],
  email: { to: "", subject: "Application: Vision Engineer", body: "Dear team,\n\nAttached." },
  delivery: null,
  gmail: { configured: true, email: "me@example.com" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveQuickApplyEmail).mockResolvedValue({ ok: true, data: null, toast: "Email saved." });
  vi.mocked(sendQuickApply).mockResolvedValue({ ok: true, data: null, toast: "Sent." });
});

describe("QuickApplyResult", () => {
  it("shows the CV advice, the letter and the match", () => {
    render(<QuickApplyResult {...props} />);
    expect(screen.getByText("75% match · 3 of 4 requirements · 1 missing")).toBeVisible();
    expect(screen.getByText("Lead with your vision work.")).toBeVisible();
    expect(screen.getByText("2 suggestions")).toBeVisible();
    expect(screen.getByText("I'd love to join Ledgerly.")).toBeVisible();
  });

  it("needs a recipient, saves the edited email, then sends it after confirming", async () => {
    render(<QuickApplyResult {...props} />);
    const send = screen.getByRole("button", { name: "Send with Gmail" });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText("To"), "jobs@ledgerly.example");
    await userEvent.click(send);
    await waitFor(() => expect(saveQuickApplyEmail).toHaveBeenCalledWith({ id: "app-1", ...props.email, to: "jobs@ledgerly.example" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Send this application?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send email" }));
    await waitFor(() => expect(sendQuickApply).toHaveBeenCalledWith({ id: "app-1", retryUnknown: false }));
  });

  it("asks to connect Gmail when it isn't, and shows a sent email as sent", () => {
    const { rerender } = render(<QuickApplyResult {...props} gmail={{ configured: true, email: null }} />);
    expect(screen.getByRole("link", { name: "Connect Gmail to send" })).toHaveAttribute("href", "/settings?section=automation");
    rerender(<QuickApplyResult {...props} delivery={{ status: "SENT", recipient: "jobs@ledgerly.example", sentAt: null, error: null }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sent to jobs@ledgerly.example");
    expect(screen.queryByRole("button", { name: "Send with Gmail" })).not.toBeInTheDocument();
  });
});
