import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSearchSettingsView } from "@/lib/job-search/sources";

import { saveJobSearchDetails, saveJobSource, saveJobSourceKey, testJobSource } from "./actions";
import { JobSearchSection } from "./job-search-section";

vi.mock("./actions", () => ({
  saveJobSource: vi.fn(),
  saveJobSearchDetails: vi.fn(),
  saveJobSourceKey: vi.fn(),
  testJobSource: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const off: JobSearchSettingsView = { source: "OFF", jsearch: { host: "openwebninja", keyState: "none" }, adzuna: { appId: "", keyState: "none" } };
const withSource = (view: Partial<JobSearchSettingsView>): JobSearchSettingsView => ({ ...off, ...view });

beforeEach(() => {
  vi.mocked(saveJobSource).mockReset().mockImplementation(async ({ source }) => ({ ok: true, data: withSource({ source }) }));
  vi.mocked(saveJobSearchDetails).mockReset().mockImplementation(async ({ jsearchHost = "openwebninja", adzunaAppId = "" }) => ({
    ok: true,
    data: withSource({ source: "JSEARCH", jsearch: { host: jsearchHost, keyState: "none" }, adzuna: { appId: adzunaAppId, keyState: "none" } }),
  }));
  vi.mocked(saveJobSourceKey).mockReset().mockResolvedValue({ ok: true, data: withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "set" } }) });
  vi.mocked(testJobSource).mockReset().mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.8 } });
});

describe("JobSearchSection", () => {
  it("offers every source and Off, as a radio group, Off by default", () => {
    render(<JobSearchSection initial={off} />);
    expect(screen.getByRole("heading", { name: "Job search" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "JSearch",
      "Adzuna",
      "Bundesagentur für Arbeit",
      "Remote OK",
      "Remotive",
      "We Work Remotely",
      "Himalayas",
      "Jobicy",
      "Arbeitnow",
      "Off",
    ]);
    expect(screen.getByRole("radio", { name: "Off" })).toBeChecked();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  it("saves a source at once and says what's sent to it", async () => {
    render(<JobSearchSection initial={off} />);
    await userEvent.click(screen.getByRole("radio", { name: "JSearch" }));
    expect(saveJobSource).toHaveBeenCalledWith({ source: "JSEARCH" });
    expect(screen.getByRole("note")).toHaveTextContent("Your searches (keywords, place and filters) go to JSearch. Nothing from your profile does.");
    expect(screen.getByRole("link", { name: "OpenWeb Ninja" })).toHaveAttribute("href", "https://www.openwebninja.com/api/jsearch");
  });

  it("saves a key when you leave the field, then forgets it in the browser", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret");
    await userEvent.tab();
    expect(saveJobSourceKey).toHaveBeenCalledWith({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveJobSourceKey).toHaveBeenLastCalledWith({ source: "JSEARCH", change: { action: "clear" } });
  });

  it("saves a key on Enter too", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret{Enter}");
    expect(saveJobSourceKey).toHaveBeenCalledTimes(1);
  });

  it("switches where the JSearch key is from", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.click(screen.getByRole("radio", { name: "RapidAPI" }));
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ jsearchHost: "rapidapi" });
    expect(await screen.findByRole("link", { name: "JSearch on RapidAPI" })).toBeInTheDocument();
  });

  it("asks Adzuna for an app ID and key, saving the ID when you leave it", async () => {
    vi.mocked(saveJobSearchDetails).mockResolvedValue({ ok: true, data: withSource({ source: "ADZUNA", adzuna: { appId: "app-1", keyState: "none" } }) });
    render(<JobSearchSection initial={withSource({ source: "ADZUNA" })} />);
    await userEvent.type(screen.getByLabelText("App ID"), "app-1");
    await userEvent.tab();
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ adzunaAppId: "app-1" });
    expect(screen.getByLabelText("App key")).toHaveAttribute("type", "password");
  });

  it("needs no key for the Arbeitsagentur, and says it isn't official", () => {
    render(<JobSearchSection initial={withSource({ source: "ARBEITSAGENTUR" })} />);
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
    expect(screen.getByText(/isn't an official API/)).toBeInTheDocument();
  });

  it("needs no key for public remote feeds and explains local filtering", () => {
    render(<JobSearchSection initial={withSource({ source: "REMOTIVE" })} />);
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Your search and profile aren't sent.");
    expect(screen.getByText(/applies your country, date and keyword filters locally/)).toBeInTheDocument();
  });

  it("shows keys from the environment and keys that can't be read", () => {
    const { unmount } = render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "env" } })} />);
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
    unmount();
    render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "unreadable" } })} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and says how it went", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "set" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("a test uses one search from your plan");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected · JSearch answered in 0.8 s")).toBeInTheDocument();

    vi.mocked(testJobSource).mockResolvedValue({ ok: true, data: { connected: false, message: "JSearch didn't accept your key." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("JSearch didn't accept your key.")).toBeInTheDocument();

    vi.mocked(testJobSource).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Something went wrong on the server. Please try again.")).toBeInTheDocument();
  });
});
