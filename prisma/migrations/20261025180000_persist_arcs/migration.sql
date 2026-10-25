-- Arcs now live as long as their connection, so they need to know whose it is.
-- Existing rows are short-lived animations with no owner; drop them.
DELETE FROM "Arc";

-- DropIndex
DROP INDEX "Arc_createdAt_idx";

-- AlterTable
ALTER TABLE "Arc" ADD COLUMN     "aId" TEXT NOT NULL,
ADD COLUMN     "bId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Arc_aId_idx" ON "Arc"("aId");

-- CreateIndex
CREATE INDEX "Arc_bId_idx" ON "Arc"("bId");
