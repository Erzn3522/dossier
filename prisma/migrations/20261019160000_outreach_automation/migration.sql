CREATE TYPE "OutreachRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');
CREATE TYPE "OutreachLeadStatus" AS ENUM ('DISCOVERED', 'RESEARCHING', 'FILTERED', 'READY', 'APPROVED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'DISMISSED', 'SUPPRESSED');
CREATE TYPE "OutreachDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'UNKNOWN');
CREATE TYPE "OutreachSuppressionKind" AS ENUM ('EMAIL', 'DOMAIN');

CREATE TABLE "OutreachCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "keywords" TEXT[] NOT NULL,
  "countries" TEXT[] NOT NULL,
  "remote" BOOLEAN NOT NULL DEFAULT true,
  "targetRole" TEXT NOT NULL,
  "opportunity" TEXT NOT NULL,
  "pitch" TEXT NOT NULL,
  "cta" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'English',
  "fitThreshold" INTEGER NOT NULL DEFAULT 70,
  "dailyDiscoveryLimit" INTEGER NOT NULL DEFAULT 10,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachRun" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "status" "OutreachRunStatus" NOT NULL DEFAULT 'RUNNING',
  "found" INTEGER NOT NULL DEFAULT 0,
  "qualified" INTEGER NOT NULL DEFAULT 0,
  "prepared" INTEGER NOT NULL DEFAULT 0,
  "filtered" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachLead" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "runId" TEXT,
  "companyName" TEXT NOT NULL DEFAULT '',
  "domain" TEXT NOT NULL,
  "website" TEXT NOT NULL,
  "research" JSONB,
  "researchedWith" TEXT,
  "fitScore" INTEGER,
  "fitReason" TEXT,
  "contacts" JSONB,
  "rankedWith" TEXT,
  "selectedEmail" TEXT,
  "selectedName" TEXT,
  "selectedTitle" TEXT,
  "contactSourceUrl" TEXT,
  "emailSubject" TEXT,
  "emailBody" TEXT,
  "emailWrittenWith" TEXT,
  "resumeUnits" JSONB,
  "resumeWrittenWith" TEXT,
  "status" "OutreachLeadStatus" NOT NULL DEFAULT 'DISCOVERED',
  "error" TEXT,
  "approvedAt" TIMESTAMP(3),
  "queuedFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachDelivery" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "status" "OutreachDeliveryStatus" NOT NULL DEFAULT 'SENDING',
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "gmailMessageId" TEXT,
  "error" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachSuppression" (
  "id" TEXT NOT NULL,
  "kind" "OutreachSuppressionKind" NOT NULL,
  "value" CITEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Job" ADD COLUMN "outreachLeadId" TEXT;

CREATE UNIQUE INDEX "OutreachLead_domain_key" ON "OutreachLead"("domain");
CREATE UNIQUE INDEX "OutreachDelivery_leadId_key" ON "OutreachDelivery"("leadId");
CREATE UNIQUE INDEX "OutreachSuppression_value_key" ON "OutreachSuppression"("value");
CREATE INDEX "OutreachCampaign_enabled_idx" ON "OutreachCampaign"("enabled");
CREATE INDEX "OutreachRun_campaignId_startedAt_idx" ON "OutreachRun"("campaignId", "startedAt");
CREATE INDEX "OutreachRun_status_idx" ON "OutreachRun"("status");
CREATE INDEX "OutreachLead_campaignId_status_idx" ON "OutreachLead"("campaignId", "status");
CREATE INDEX "OutreachLead_runId_status_idx" ON "OutreachLead"("runId", "status");
CREATE INDEX "OutreachLead_status_queuedFor_idx" ON "OutreachLead"("status", "queuedFor");
CREATE INDEX "OutreachDelivery_status_idx" ON "OutreachDelivery"("status");
CREATE INDEX "OutreachSuppression_kind_idx" ON "OutreachSuppression"("kind");
CREATE INDEX "Job_outreachLeadId_idx" ON "Job"("outreachLeadId");

ALTER TABLE "OutreachRun" ADD CONSTRAINT "OutreachRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachLead" ADD CONSTRAINT "OutreachLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachLead" ADD CONSTRAINT "OutreachLead_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OutreachRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutreachDelivery" ADD CONSTRAINT "OutreachDelivery_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "OutreachLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_outreachLeadId_fkey" FOREIGN KEY ("outreachLeadId") REFERENCES "OutreachLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OutreachCampaign" (
  "id", "name", "enabled", "keywords", "countries", "remote", "targetRole", "opportunity", "pitch", "cta", "language", "fitThreshold", "dailyDiscoveryLimit", "updatedAt"
) VALUES (
  'default-computer-vision',
  'Computer vision companies',
  true,
  ARRAY['computer vision', 'image processing', 'machine vision', 'visual inspection', 'video analytics', 'OCR', '3D vision'],
  ARRAY['Europe'],
  true,
  'Computer Vision / Machine Learning Engineer',
  'Full-time employment or a relevant engineering opportunity',
  'Introduce my relevant computer vision and image processing experience using only facts from my profile.',
  'Ask whether a short introductory conversation would be useful.',
  'English',
  70,
  10,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
