import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/flowforge' } });
