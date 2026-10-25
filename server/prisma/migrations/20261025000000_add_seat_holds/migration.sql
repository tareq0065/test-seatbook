-- CreateTable
CREATE TABLE "SeatHold" (
    "id" SERIAL NOT NULL,
    "seatId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeatHold_seatId_expiresAt_idx" ON "SeatHold"("seatId", "expiresAt");

-- CreateIndex
CREATE INDEX "SeatHold_userId_idx" ON "SeatHold"("userId");

-- CreateIndex: PostgreSQL partial unique index ensuring active bookings are uniquely confirmed per seat
CREATE UNIQUE INDEX "unique_active_booking_per_seat" ON "Booking"("seatId") WHERE status = 'CONFIRMED';

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
