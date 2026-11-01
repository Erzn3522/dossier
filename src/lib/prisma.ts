import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// Reuse one client across hot reloads in development instead of opening a new
// connection pool on every change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const modelDelegates = Object.values(Prisma.ModelName).map((name) => name[0].toLowerCase() + name.slice(1));
let checkedClient: PrismaClient | undefined;

function client(): PrismaClient {
  // Hot reload preserves globalThis, including clients created before a new
  // model was generated. Check that cached client once per module reload;
  // otherwise a new delegate (e.g. linkedInPostSearch) stays undefined.
  const cached = globalForPrisma.prisma;
  if (cached && cached !== checkedClient && modelDelegates.some((name) => Reflect.get(cached, name) === undefined)) {
    globalForPrisma.prisma = undefined;
    void cached.$disconnect().catch(() => {});
  }
  globalForPrisma.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  checkedClient = globalForPrisma.prisma;
  return globalForPrisma.prisma;
}

/**
 * The shared database client. It's created on first use rather than on
 * import, so `next build`, which imports every page, works without the
 * secrets that reading `env` requires.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, key) {
    const target = client();
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
