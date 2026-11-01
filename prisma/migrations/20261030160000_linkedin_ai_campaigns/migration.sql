CREATE TABLE "LinkedInCampaign" (
  "id" TEXT NOT NULL PRIMARY KEY, "input" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "provider" TEXT NOT NULL, "model" TEXT, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LinkedInCampaign_status_idx" ON "LinkedInCampaign"("status");
CREATE TABLE "LinkedInAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY, "campaignId" TEXT NOT NULL, "country" TEXT NOT NULL, "round" INTEGER NOT NULL,
  "position" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "queries" JSONB NOT NULL DEFAULT '[]',
  "strategy" TEXT, "capUsd" DECIMAL(12,6) NOT NULL, "runId" TEXT, "jobId" TEXT,
  "fetched" INTEGER NOT NULL DEFAULT 0, "fresh" INTEGER NOT NULL DEFAULT 0, "duplicates" INTEGER NOT NULL DEFAULT 0,
  "relevant" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinkedInAttempt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LinkedInCampaign"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "LinkedInAttempt_campaignId_position_key" ON "LinkedInAttempt"("campaignId", "position");
CREATE TABLE "LinkedInCampaignPost" (
  "id" TEXT NOT NULL PRIMARY KEY, "campaignId" TEXT NOT NULL, "url" TEXT NOT NULL, "post" JSONB NOT NULL,
  "text" TEXT NOT NULL, "authorName" TEXT NOT NULL, "authorType" TEXT NOT NULL, "likes" INTEGER NOT NULL DEFAULT 0,
  "postedAt" TIMESTAMP(3), "hiring" BOOLEAN NOT NULL DEFAULT false, "remote" BOOLEAN NOT NULL DEFAULT false,
  "relevant" BOOLEAN NOT NULL DEFAULT false, "confidence" TEXT NOT NULL DEFAULT 'uncertain',
  "assessments" JSONB NOT NULL DEFAULT '[]', "occurrences" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LinkedInCampaignPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LinkedInCampaign"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "LinkedInCampaignPost_campaignId_url_key" ON "LinkedInCampaignPost"("campaignId", "url");
CREATE INDEX "LinkedInCampaignPost_campaignId_createdAt_idx" ON "LinkedInCampaignPost"("campaignId", "createdAt");
