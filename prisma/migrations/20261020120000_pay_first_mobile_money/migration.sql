-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('STAFF', 'PROVIDER');

-- CreateEnum
CREATE TYPE "PaymentTiming" AS ENUM ('PAY_FIRST', 'PAY_AFTER');

-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('MTN_MOMO', 'AIRTEL_MONEY');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MobileMoneyEnvironment" AS ENUM ('SIMULATOR', 'SANDBOX', 'PRODUCTION');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PAYMENT';

-- DropForeignKey
ALTER TABLE "PaymentRecord" DROP CONSTRAINT "PaymentRecord_recordedById_fkey";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentDueBy" TIMESTAMP(3),
ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RestaurantSettings" ADD COLUMN     "paymentTiming" "PaymentTiming" NOT NULL DEFAULT 'PAY_FIRST',
ADD COLUMN     "unpaidOrderTimeoutMinutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "MobileMoneyAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" "MobileMoneyEnvironment" NOT NULL DEFAULT 'SIMULATOR',
    "credentialsEnc" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileMoneyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL,
    "environment" "MobileMoneyEnvironment" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "payerPhone" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "failureReason" TEXT,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "paymentRecordId" TEXT,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileMoneyAccount_tenantId_provider_key" ON "MobileMoneyAccount"("tenantId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_providerReference_key" ON "PaymentIntent"("providerReference");

-- CreateIndex
CREATE INDEX "PaymentIntent_tenantId_orderId_idx" ON "PaymentIntent"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_createdAt_idx" ON "PaymentIntent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_tenantId_branchId_status_idx" ON "PaymentIntent"("tenantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_tenantId_id_key" ON "PaymentIntent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_tenantId_paymentRecordId_key" ON "PaymentIntent"("tenantId", "paymentRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_tenantId_id_key" ON "PaymentRecord"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "MobileMoneyAccount" ADD CONSTRAINT "MobileMoneyAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "Order"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_paymentRecordId_fkey" FOREIGN KEY ("tenantId", "paymentRecordId") REFERENCES "PaymentRecord"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Zawli hand-written constraints
-- At most one in-flight mobile money request per order.
CREATE UNIQUE INDEX "PaymentIntent_one_pending_per_order" ON "PaymentIntent" ("orderId") WHERE "status" = 'PENDING';
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "RestaurantSettings" ADD CONSTRAINT "RestaurantSettings_unpaid_timeout_range"
  CHECK ("unpaidOrderTimeoutMinutes" BETWEEN 5 AND 120);
-- Staff-recorded payments must name the staff member; provider payments may not.
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_source_actor"
  CHECK (("source" = 'STAFF' AND "recordedById" IS NOT NULL) OR "source" = 'PROVIDER');
