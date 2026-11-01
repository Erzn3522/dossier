ALTER TABLE "LinkedInCampaignPost" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
UPDATE "LinkedInCampaignPost" SET "contentHash" = md5("text");
CREATE TABLE "LinkedInProfileFit" (
  "key" TEXT NOT NULL, "profileHash" TEXT NOT NULL, "postHash" TEXT NOT NULL,
  "result" JSONB NOT NULL, "verdict" TEXT NOT NULL, "provider" TEXT NOT NULL, "model" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedInProfileFit_pkey" PRIMARY KEY ("key", "profileHash", "postHash")
);
CREATE INDEX "LinkedInProfileFit_profileHash_verdict_idx" ON "LinkedInProfileFit"("profileHash", "verdict");
CREATE TABLE "LinkedInProfileReview" (
  "id" TEXT NOT NULL PRIMARY KEY, "scope" TEXT NOT NULL, "profileHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "model" TEXT, "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "total" INTEGER NOT NULL, "processed" INTEGER NOT NULL DEFAULT 0, "jobId" TEXT, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "LinkedInProfileReview_scope_key" ON "LinkedInProfileReview"("scope");
CREATE INDEX "LinkedInProfileReview_status_idx" ON "LinkedInProfileReview"("status");
