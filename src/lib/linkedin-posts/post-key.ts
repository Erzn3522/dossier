import type { LinkedInPost } from "./data";

/** Shared with the browser and SQL-backed campaign identity; no tracking parameters. */
export function linkedInPostKey(post: Pick<LinkedInPost, "id" | "url">): string {
  const url = new URL(post.url);
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Keep malformed external escapes as literal path text. */ }
  const activity = path.match(/(?:activity[-:]|ugcPost:)(\d+)/i)?.[1];
  const id = activity ?? (/^\d+$/.test(post.id) ? post.id : null);
  if (id) return `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
  url.hostname = "www.linkedin.com";
  url.search = ""; url.hash = "";
  return url.href.replace(/\/$/, "");
}
