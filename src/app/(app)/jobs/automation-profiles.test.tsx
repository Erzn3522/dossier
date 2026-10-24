import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";

import { addAutomatedSearch, changeAutomatedSearchPages } from "./actions";
import { AutomationProfiles } from "./automation-profiles";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("./actions", () => ({
  addAutomatedSearch: vi.fn(),
  changeAutomatedSearchPages: vi.fn(),
  removeAutomatedSearch: vi.fn(),
  runAutomatedSearchNow: vi.fn(),
  toggleAutomatedSearch: vi.fn(),
}));

const query = { ...EMPTY_QUERY, keywords: "computer vision", country: "nl" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(addAutomatedSearch).mockResolvedValue({ ok: true, data: { id: "search-1" }, toast: "Saved." });
  vi.mocked(changeAutomatedSearchPages).mockResolvedValue({ ok: true, data: null });
});

describe("AutomationProfiles search depth", () => {
  it("saves a new profile with a 30-job limit", async () => {
    render(<AutomationProfiles profiles={[]} query={query} />);
    await userEvent.click(screen.getByRole("button", { name: "Save current search" }));
    await userEvent.selectOptions(screen.getByLabelText("Jobs per run"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addAutomatedSearch).toHaveBeenCalledWith({
      name: "computer vision",
      pagesPerRun: 3,
      query,
    }));
  });

  it("changes the page depth of an existing profile", async () => {
    render(<AutomationProfiles profiles={[{
      id: "search-1",
      name: "Netherlands",
      enabled: true,
      pagesPerRun: 1,
      query,
      lastRunAt: null,
      lastSourceStats: [],
    }]} query={query} />);

    await userEvent.selectOptions(screen.getByLabelText("Jobs per run for Netherlands"), "3");
    await waitFor(() => expect(changeAutomatedSearchPages).toHaveBeenCalledWith({ id: "search-1", pagesPerRun: 3 }));
  });
});
