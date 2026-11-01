/** Read-only comparison of saved manual and AI LinkedIn searches. Never starts paid runs. */
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { buildQueries } from "../src/lib/linkedin-posts/queries";

config({ quiet: true });
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured for this terminal.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 }) });
  try {
    const [manual, campaigns] = await Promise.all([
      db.linkedInPostSearch.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      db.linkedInCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 3, include: { attempts: { orderBy: { position: "asc" } }, _count: { select: { posts: true } } } }),
    ]);
    console.log(JSON.stringify({
      manual: manual.map((row) => {
        const query = row.query as { keywords: string[]; countries?: string[] };
        return { id: row.id, status: row.status, createdAt: row.createdAt, query, actualQueries: buildQueries(query.keywords, query.countries ?? []), count: Array.isArray(row.posts) ? row.posts.length : 0, error: row.error, runId: row.runId };
      }),
      campaigns: campaigns.map((row) => ({ id: row.id, createdAt: row.createdAt, status: row.status, input: row.input, found: row._count.posts, error: row.error,
        attempts: row.attempts.map((a) => ({ country: a.country, round: a.round, status: a.status, queries: a.queries, strategy: a.strategy, fetched: a.fetched, fresh: a.fresh, relevant: a.relevant, error: a.error, capUsd: String(a.capUsd), runId: a.runId })) })),
    }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  console.error(`Read-only diagnosis failed (${code}). Check that the application's database is running and reachable.`);
  process.exitCode = 1;
});
