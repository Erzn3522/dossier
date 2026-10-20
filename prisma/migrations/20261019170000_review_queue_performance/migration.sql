ALTER TABLE "AutomationCandidate"
ADD COLUMN "matchPercent" INTEGER,
ADD COLUMN "discoveredEmailCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "AutomationCandidate"
SET "matchPercent" = CASE
  WHEN "matchTotal" IS NOT NULL AND "matchTotal" > 0
    THEN ROUND(COALESCE("matchHit", 0) * 100.0 / "matchTotal")::INTEGER
  ELSE NULL
END,
"discoveredEmailCount" = CASE
  WHEN jsonb_typeof("emailDiscovery" -> 'candidates') = 'array'
    THEN jsonb_array_length("emailDiscovery" -> 'candidates')
  ELSE 0
END;

CREATE INDEX "AutomationCandidate_status_createdAt_idx"
ON "AutomationCandidate"("status", "createdAt");

CREATE INDEX "AutomationCandidate_status_matchPercent_idx"
ON "AutomationCandidate"("status", "matchPercent");

CREATE INDEX "AutomationCandidate_status_discoveredEmailCount_idx"
ON "AutomationCandidate"("status", "discoveredEmailCount");
