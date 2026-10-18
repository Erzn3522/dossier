-- CreateEnum
CREATE TYPE "ApplicationReviewState" AS ENUM ('NORMAL', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationCandidateStatus" AS ENUM ('DISCOVERED', 'ANALYZING', 'FILTERED', 'PREPARING', 'READY', 'FAILED', 'SENT');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENDING', 'SENT', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "reviewState" "ApplicationReviewState" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "AutomatedSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "query" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomatedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "found" INTEGER NOT NULL DEFAULT 0,
    "eligible" INTEGER NOT NULL DEFAULT 0,
    "prepared" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "applicationId" TEXT,
    "status" "AutomationCandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
    "matchHit" INTEGER,
    "matchTotal" INTEGER,
    "reason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'SENDING',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "gmailMessageId" TEXT,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomatedSearch_enabled_idx" ON "AutomatedSearch"("enabled");
CREATE INDEX "AutomationRun_searchId_startedAt_idx" ON "AutomationRun"("searchId", "startedAt");
CREATE INDEX "AutomationRun_status_idx" ON "AutomationRun"("status");
CREATE UNIQUE INDEX "AutomationCandidate_postingId_key" ON "AutomationCandidate"("postingId");
CREATE UNIQUE INDEX "AutomationCandidate_applicationId_key" ON "AutomationCandidate"("applicationId");
CREATE INDEX "AutomationCandidate_runId_status_idx" ON "AutomationCandidate"("runId", "status");
CREATE INDEX "AutomationCandidate_status_updatedAt_idx" ON "AutomationCandidate"("status", "updatedAt");
CREATE UNIQUE INDEX "EmailDelivery_applicationId_key" ON "EmailDelivery"("applicationId");
CREATE INDEX "EmailDelivery_status_idx" ON "EmailDelivery"("status");

ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "AutomatedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationCandidate" ADD CONSTRAINT "AutomationCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationCandidate" ADD CONSTRAINT "AutomationCandidate_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "Posting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationCandidate" ADD CONSTRAINT "AutomationCandidate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
