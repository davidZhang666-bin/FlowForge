import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';

export type Transaction = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class Database {
  readonly client: PrismaClient;
  constructor(url = process.env.DATABASE_URL) {
    if (!url) throw new Error('DATABASE_URL is required; run pnpm setup first');
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 12 }) });
  }
  async tenant<T>(tenantId: string, operation: (tx: Transaction) => Promise<T>): Promise<T> {
    z.string().uuid().parse(tenantId);
    return this.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return operation(tx);
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
