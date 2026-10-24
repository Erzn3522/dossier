import { expect, test } from "@playwright/test";

import { fakeJobSearches, resetData, sql } from "./support";

// Find jobs (E14) against the fake job sources: search from the profile's
// role and city, come back to the kept search without asking again, save,
// dismiss and undo, then start an application from a posting and see it
// marked as applied for.
test.beforeAll(resetData);

test("searches, keeps postings, and starts an application from one", async ({ page }) => {
  await page.goto("/jobs");
  const form = page.getByRole("search", { name: "Search postings" });
  // The first search starts from the current role and the profile's city and country.
  await expect(form.getByLabel("What")).toHaveValue("Senior Product Designer");
  await expect(form.getByLabel("Where")).toHaveValue("Rotterdam");
  await expect(form.getByLabel("Country")).toHaveValue("nl");
  await form.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/jobs\?search=c/);
  const list = page.getByRole("list", { name: "Postings" });
  await expect(list.getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await expect(page.getByText("Ledgerly · Rotterdam · EUR 75,000–90,000 a year")).toBeVisible();
  await expect(page.getByRole("region", { name: "Posting text" })).toContainText("Strong prototyping skills in Figma");

  // The next page, through the cursor.
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(list.getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);

  // The search is kept with both pages (E14-10): coming back to it asks the source nothing.
  const asked = await fakeJobSearches();
  await page.getByRole("link", { name: /^Past searches/ }).click();
  const today = page.getByRole("region", { name: "Today" });
  await expect(today.getByRole("link")).toHaveText(/Senior Product Designer · Rotterdam, 25 km.*4 postings · JSearch/);
  await today.getByRole("link").click();
  await expect(list.getByRole("button")).toHaveCount(4);
  await page.goto("/jobs");
  await expect(list.getByRole("button")).toHaveCount(4);
  await expect(page.getByText(/4 postings from JSearch · searched today at \d\d:\d\d/)).toBeVisible();
  expect(await fakeJobSearches()).toBe(asked);

  // Save the first; dismiss the second, then undo it.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(list.getByRole("button", { name: /Senior Product Designer, Payments/ })).toContainText("Saved");
  await list.getByRole("button", { name: /Product Designer, Logistics/ }).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(list.getByRole("button", { name: /Product Designer, Logistics/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("button", { name: /Product Designer, Logistics/ })).toBeVisible();

  // The saved posting is in Saved.
  await page.getByRole("link", { name: /^Saved/ }).click();
  await expect(page).toHaveURL(/\/jobs\?view=saved/);
  await expect(page.getByText("1 saved posting")).toBeVisible();

  // Start an application from it: the posting is filled in, to check first.
  await page.getByRole("button", { name: "Start application →" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByLabel("Job posting")).toHaveValue(/^Ledgerly: Senior Product Designer, Payments\n\nRotterdam · EUR 75,000–90,000 a year\n\nLedgerly is hiring/);
  await expect(page.getByLabel(/^Link to the posting/)).toHaveValue("https://jobs.example/e2e-ledgerly");
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  const applicationId = new URL(page.url()).pathname.split("/").pop()!;

  // The posting now knows its application, and says so.
  const [posting] = await sql<{ applicationId: string | null }>(`SELECT "applicationId" FROM "Posting" WHERE "externalId" = 'e2e-ledgerly'`);
  expect(posting.applicationId).toBe(applicationId);
  await page.goto("/jobs?view=saved");
  await expect(page.getByRole("list", { name: "Postings" }).getByRole("button")).toContainText("Applied");
  await expect(page.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", `/applications/${applicationId}`);
});

test("says when nothing was found", async ({ page }) => {
  // A search written in the URL only fills in the form.
  await page.goto("/jobs?q=nothing&where=Rotterdam&country=nl");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No postings for “nothing” within 25 km of Rotterdam. Try a bigger radius or fewer words.")).toBeVisible();
});

test("tests the connection in Settings → Job search", async ({ page }) => {
  await page.goto("/settings?section=jobs");
  await expect(page.getByRole("radio", { name: "JSearch" })).toBeChecked();
  await expect(page.getByLabel("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Connected · JSearch answered in/)).toBeVisible();
});

test("saves an automatic search, runs it and reviews its prepared drafts", async ({ page }) => {
  await resetData();
  await page.goto("/jobs?q=product%20designer&where=Rotterdam&country=nl");
  await page.getByRole("button", { name: "Save current search" }).click();
  await page.getByLabel("Profile name").fill("Daily design roles");
  await page.getByLabel("Jobs per run").selectOption("2");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Daily design roles")).toBeVisible();
  await expect(page.getByLabel("Jobs per run for Daily design roles")).toHaveValue("2");

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/postings queued for review/)).toBeVisible();
  await expect.poll(async () => Number((await sql<{ count: string }>(`SELECT count(*) FROM "AutomationCandidate" WHERE status = 'READY'`))[0].count), { timeout: 60_000 }).toBe(4);

  await page.goto("/review");
  await expect(page.getByRole("article")).toHaveCount(4);
  await page.getByRole("button", { name: "Keep as draft" }).first().click();
  await expect(page.getByText("Moved to Applications as a draft.")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await expect(page.getByText(/will not be prepared again/)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);

  await page.goto("/settings?section=automation");
  await page.getByRole("switch", { name: "Run daily job searches" }).click();
  await expect.poll(async () => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'automationEnabled'`))[0]?.value).toBe("true");
  await expect(page.getByRole("heading", { name: "Gmail sending" })).toBeVisible();
});
