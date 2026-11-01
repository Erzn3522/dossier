CREATE TABLE "LinkedInPostSearch" (
    "id" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "posts" JSONB NOT NULL DEFAULT '[]',
    "runId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LinkedInPostSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LinkedInPostSearch_createdAt_idx" ON "LinkedInPostSearch"("createdAt");
