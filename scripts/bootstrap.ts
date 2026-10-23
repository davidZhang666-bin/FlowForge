import 'dotenv/config';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Database, json } from '../packages/data/src/index.js';
import { hashPassword } from '../packages/data/src/security.js';
import { createTemplate } from '../packages/core/src/index.js';
import { applicationTypes, typeLabels } from '../packages/contracts/src/index.js';

const input = z
  .object({
    tenant: z.string().trim().min(2).max(80),
    email: z
      .string()
      .email()
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(200),
  })
  .parse({
    tenant: process.env.BOOTSTRAP_TENANT_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
if (!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL required');
const db = new Database(process.env.DATABASE_ADMIN_URL);
try {
  const passwordHash = await hashPassword(input.password);
  const disabledHash = await hashPassword(randomUUID());
  const tenant = await db.client.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: input.email } }))
      throw new Error('Admin email already exists; bootstrap never replaces existing accounts');
    const tenant = await tx.tenant.create({ data: { name: input.tenant } });
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const department = await tx.department.create({
      data: { tenantId: tenant.id, name: '默认部门' },
    });
    const user = await tx.user.create({
      data: { name: '企业管理员', email: input.email, passwordHash },
    });
    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        departmentId: department.id,
        role: 'admin',
        scope: 'TENANT',
      },
    });
    const system = await tx.user.upsert({
      where: { email: 'system@flowforge.invalid' },
      create: {
        email: 'system@flowforge.invalid',
        name: '系统调度器',
        active: false,
        passwordHash: disabledHash,
      },
      update: {},
    });
    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: system.id,
        departmentId: department.id,
        role: 'employee',
        scope: 'SELF',
        active: false,
      },
    });
    for (const type of applicationTypes) {
      const graph = json(createTemplate(type));
      const definition = await tx.flowDefinition.create({
        data: {
          tenantId: tenant.id,
          type,
          name: `${typeLabels[type]}流程`,
          draft: graph,
          latestVersion: 1,
        },
      });
      await tx.flowVersion.create({
        data: {
          tenantId: tenant.id,
          definitionId: definition.id,
          number: 1,
          graph,
          publishedBy: user.id,
        },
      });
    }
    return tenant;
  });
  console.log(
    `Organization created: ${tenant.name} (${tenant.id}). Configure members and assignees before submitting requests.`,
  );
} finally {
  await db.close();
}
