import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewProgress } from "@/lib/review-list";

import { ReviewProgressPanel } from "./review-progress";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const progress: ReviewProgress = { searching: false, profilesSearched: 35, profilesTotal: 35, scanned: 480, candidates: 140, analyzed: 35, analyzing: 1, etaMinutes: 61 };

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("ReviewProgressPanel", () => {
  it("shows the scan and AI numbers and refreshes while active", () => {
    render(<ReviewProgressPanel progress={progress} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "35 of 140 postings reviewed");
    expect(screen.getByText("480")).toBeVisible();
    expect(screen.getByText("35 / 140 · 1 in progress")).toBeVisible();
    expect(screen.getByText("About 61 min left")).toBeVisible();
    vi.advanceTimersByTime(10_000);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("renders nothing and doesn't poll when the automation is idle", () => {
    const { container } = render(<ReviewProgressPanel progress={null} />);
    vi.advanceTimersByTime(20_000);
    expect(container).toBeEmptyDOMElement();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
