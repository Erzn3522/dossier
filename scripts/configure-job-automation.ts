// Replaces the automation profiles with the planned city searches and turns
// the daily run on: `docker/bin/yarn configure-job-automation`.
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { resetJobAutomation } from "../src/lib/automation/reset";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

resetJobAutomation(prisma)
  .then(({ profiles, time, timeZone, instant }) =>
    console.log(`Configured ${profiles} profiles. Daily automation is enabled for ${time} ${timeZone}; first run ${instant.toISOString()}.`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
