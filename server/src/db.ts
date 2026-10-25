import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://seatbook:seatbook@localhost:5433/seatbook',
    },
  },
});

export default prisma;
