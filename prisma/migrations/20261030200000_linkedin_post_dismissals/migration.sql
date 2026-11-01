CREATE TABLE "LinkedInPostDismissal" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "post" JSONB NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LinkedInPostDismissal_dismissedAt_idx" ON "LinkedInPostDismissal"("dismissedAt");
