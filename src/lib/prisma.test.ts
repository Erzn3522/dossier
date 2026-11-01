import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ created: vi.fn(), adapter: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: "postgresql://test.invalid/test" } }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class { constructor(options: unknown) { mocks.adapter(options); } } }));
vi.mock("@/generated/prisma/client", () => ({
  Prisma: { ModelName: { Setting: "Setting", LinkedInPostSearch: "LinkedInPostSearch" } },
  PrismaClient: class {
    setting = { findMany: vi.fn() };
    linkedInPostSearch = { findMany: vi.fn() };
    $disconnect = vi.fn().mockResolvedValue(undefined);
    constructor() { mocks.created(this); }
    $testBinding() { return this; }
  },
}));

const globals = globalThis as unknown as { prisma?: unknown };
let previous: unknown;
beforeEach(() => {
  previous = globals.prisma;
  delete globals.prisma;
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => { globals.prisma = previous; });

describe("Prisma cache after hot reload", () => {
  it("creates a client lazily and reuses it across hot reloads", async () => {
    const first = await import("./prisma");
    expect(mocks.created).not.toHaveBeenCalled();
    const delegate = first.prisma.linkedInPostSearch;
    expect(mocks.created).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const reloaded = await import("./prisma");
    expect(reloaded.prisma.linkedInPostSearch).toBe(delegate);
    expect(mocks.created).toHaveBeenCalledTimes(1);
  });
  it("replaces the old client when it lacks a newly generated model", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    globals.prisma = { setting: {}, $disconnect: disconnect };
    const { prisma } = await import("./prisma");
    expect(prisma.linkedInPostSearch.findMany).toBeTypeOf("function");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(mocks.created).toHaveBeenCalledOnce();
    // Further property reads keep the same client.
    expect(prisma.setting).toBeDefined();
    expect(mocks.created).toHaveBeenCalledOnce();
  });
  it("keeps client methods bound to the actual instance", async () => {
    const { prisma } = await import("./prisma");
    const method = Reflect.get(prisma, "$testBinding") as () => unknown;
    expect(method()).toBe(globals.prisma);
  });
});
