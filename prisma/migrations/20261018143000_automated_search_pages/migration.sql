-- AlterTable
ALTER TABLE "AutomatedSearch" ADD COLUMN "pagesPerRun" INTEGER NOT NULL DEFAULT 1;

-- Keep imported or manually edited values inside the supported range.
ALTER TABLE "AutomatedSearch" ADD CONSTRAINT "AutomatedSearch_pagesPerRun_check" CHECK ("pagesPerRun" BETWEEN 1 AND 3);
