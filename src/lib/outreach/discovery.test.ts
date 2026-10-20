import { describe, expect, it } from "vitest";

import { campaignCountries, campaignSearchPlan, companyCandidate, companySearchQueries, discoverCompanySites, QUERIES_PER_RUN } from "./discovery";

const campaign = { keywords: ["computer vision", "machine vision"], countries: ["Europe"], remote: false };
const result = (url: string, title: string, content = "") => ({ url, title, content });

describe("outreach company discovery", () => {
  it("expands a region into countries and cities, with local-language queries", () => {
    const plan = campaignSearchPlan(campaign);
    expect(plan.slice(0, 4)).toEqual(['"computer vision" company Germany', "Computer Vision Unternehmen Deutschland", '"computer vision" company Netherlands', '"computer vision" company France']);
    expect(plan).toContain("industrielle Bildverarbeitung Unternehmen Deutschland");
    expect(plan).toContain("vision industrielle entreprise France");
    expect(plan).toContain('"machine vision" company Munich');
    expect(plan).toContain('"computer vision" company Ljubljana');
    expect(plan.some((query) => /\bEurope\b|\bremote\b/.test(query))).toBe(false);
  });

  it("uses unknown places as typed and adds remote-first queries only when asked", () => {
    expect(campaignSearchPlan({ keywords: ["OCR"], countries: ["Tyrol"], remote: true })).toEqual(['"OCR" company Tyrol', '"OCR" remote-first company']);
    expect(campaignSearchPlan({ keywords: ["OCR"], countries: ["Munich"], remote: false })).toEqual(['"OCR" company Munich']);
  });

  it("continues the plan on each run instead of repeating the same queries", () => {
    const first = companySearchQueries(campaign, 0);
    const second = companySearchQueries(campaign, 1);
    expect(first).toHaveLength(QUERIES_PER_RUN);
    expect(second[0]).toBe(campaignSearchPlan(campaign)[QUERIES_PER_RUN]);
    expect(second.some((query) => first.includes(query))).toBe(false);
  });

  it("rejects directories, rankings, job boards, research bodies and universities", () => {
    const terms = ["computer vision"];
    for (const rejected of [
      result("https://ensun.io/search/computer-vision/germany", "Top 100 Computer Vision Companies in Germany (2026)"),
      result("https://www.f6s.com/companies/computer-vision/spain", "17 Top Computer Vision Companies in Spain"),
      result("https://de.indeed.com/q-computer-vision-jobs.html", "Computer Vision Jobs in München"),
      result("https://www.stepstone.de/jobs/computer-vision", "Computer Vision Engineer"),
      result("https://www.hhi.fraunhofer.de/cv", "Computer Vision & Graphics"),
      result("https://www.utwente.nl/en/eemcs/", "Universiteit Twente"),
      result("https://www.esa.int/Applications/Observation", "Earth observation"),
      result("https://www.example-insights.com/report", "Digital Image Processing Market Size, Share, Growth, 2034"),
      result("https://www.aisuperior.com/computer-vision-companies-munich/", "Top Computer Vision Companies in Munich"),
    ]) expect(companyCandidate(rejected, terms), rejected.url).toBeNull();
  });

  it("ranks a company's own home page above a deep page that merely mentions the topic", () => {
    const terms = ["computer vision"];
    const home = companyCandidate(result("https://www.covisys.com/", "COVISYS Computer Vision Systems GmbH", "We build computer vision systems."), terms);
    const blog = companyCandidate(result("https://www.konecranes.com/blog/vision", "Smarter cranes", "Cranes and hoists."), terms);
    expect(home).toMatchObject({ domain: "covisys.com", website: "https://www.covisys.com/" });
    expect(home!.score).toBeGreaterThan(blog!.score);
  });

  it("skips known domains, survives one failed query and returns the best candidates first", async () => {
    const answers: Record<string, ReturnType<typeof result>[]> = {
      "Computer Vision Unternehmen Deutschland": [
        result("https://ensun.io/x", "Top 100 Computer Vision Companies"),
        result("https://known.example/", "Known Vision GmbH"),
        result("https://vision-a.example/products/cameras/line", "Cameras"),
        result("https://vision-b.example/", "Vision B GmbH", "We build computer vision inspection."),
      ],
      '"computer vision" company France': [result("https://vision-a.example/", "Vision A", "Computer vision for industry.")],
    };
    const provider = { search: async (query: string) => {
      if (query.includes("Netherlands")) throw new Error("engine down");
      return answers[query] ?? [];
    } };
    const found = await discoverCompanySites(campaign, 2, { skip: new Set(["known.example"]), provider });
    expect(found.map((entry) => entry.domain)).toEqual(["vision-a.example", "vision-b.example"]);
  });

  it("reports the search failure when no query could be answered", async () => {
    const provider = { search: async () => { throw new Error("SearXNG is down"); } };
    await expect(discoverCompanySites(campaign, 2, { provider })).rejects.toThrow("SearXNG is down");
  });
});

describe("news, associations and labs", () => {
  const terms = ["computer vision"];
  it("rejects national editions of news sites, headlines, articles, associations and university labs", () => {
    for (const rejected of [
      result("https://forbes.cz/muchna-veri-ai/", "Muchna věří AI. Startupu na kontrolu aut posílá spolu s dalšími fondy ..."),
      result("https://www.heise.de/news/vision-123.html", "Bildverarbeitung im Werk"),
      result("https://asociace.ai/clanky/od-retailu/", "Od retailu po stavebnictví: Jak čtyři české firmy nasadily AI, která ..."),
      result("https://www.vicos.si/", "ViCoS Lab"),
      result("https://vision.example/2024/05/launch", "Vision Example launches a camera"),
      result("https://vision.example/", "Vision Example", "12. 3. 2024 — The company announced"),
    ]) expect(companyCandidate(rejected, terms), rejected.url).toBeNull();
  });

  it("keeps companies whose names contain legal forms or a company lab", () => {
    expect(companyCandidate(result("https://theailab.dk/", "AI Lab ApS – AI and computer vision for the real world"), terms)).not.toBeNull();
    expect(companyCandidate(result("https://vdlmv.nl/", "Van De Loosdrecht Machine Vision B.V. Deep learning"), terms)).not.toBeNull();
    expect(companyCandidate(result("https://www.smartview.cz/", "Smart View: Specializujeme se na oblast strojového vidění"), terms)).not.toBeNull();
  });

  it("lists a campaign's countries for searching one at a time", () => {
    expect(campaignCountries(["DACH"])).toEqual(["Germany", "Austria", "Switzerland"]);
    expect(campaignCountries(["Slovenia", "Tyrol"])).toEqual(["Slovenia", "Tyrol"]);
    expect(campaignSearchPlan({ keywords: ["OCR"], countries: ["Slovenia"], remote: false })).toEqual(['"OCR" company Slovenia', '"OCR" company Ljubljana']);
  });
});
