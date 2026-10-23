import 'dotenv/config';
import { z } from 'zod';
import { Database } from '../packages/data/src/index.js';
import { hashPassword } from '../packages/data/src/security.js';
import { roles, scopes } from '../packages/contracts/src/index.js';

const input = z
  .object({
    tenantId: z.string().uuid(),
    departmentId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    email: z
      .string()
      .email()
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(200),
    role: z.enum(roles).default('employee'),
    scope: z.enum(scopes).default('SELF'),
  })
  .parse({
    tenantId: process.env.MEMBER_TENANT_ID,
    departmentId: process.env.MEMBER_DEPARTMENT_ID,
    name: process.env.MEMBER_NAME,
    email: process.env.MEMBER_EMAIL,
    password: process.env.MEMBER_PASSWORD,
    role: process.env.MEMBER_ROLE,
    scope: process.env.MEMBER_SCOPE,
  });
if (!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL required');
const db = new Database(process.env.DATABASE_ADMIN_URL);
try {
  const passwordHash = await hashPassword(input.password);
  await db.client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;
    const departments = await tx.department.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.departmentId ? { id: input.departmentId } : {}),
      },
    });
    if (departments.length !== 1)
      throw new Error('Specify a department in this organization with MEMBER_DEPARTMENT_ID');
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing)
      throw new Error(
        'Email already exists; member provisioning never overwrites an existing identity',
      );
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });
    await tx.membership.create({
      data: {
        tenantId: input.tenantId,
        departmentId: departments[0]!.id,
        userId: user.id,
        role: input.role,
        scope: input.scope,
      },
    });
  });
  console.log('Member created. Existing identities and passwords were not changed.');
} finally {
  await db.close();
}
