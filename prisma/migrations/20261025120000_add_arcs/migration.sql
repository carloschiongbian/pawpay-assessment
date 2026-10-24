-- CreateTable
CREATE TABLE "Arc" (
    "id" TEXT NOT NULL,
    "fromLat" DOUBLE PRECISION NOT NULL,
    "fromLng" DOUBLE PRECISION NOT NULL,
    "toLat" DOUBLE PRECISION NOT NULL,
    "toLng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Arc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Arc_createdAt_idx" ON "Arc"("createdAt");

