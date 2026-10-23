import { randomUUID } from 'node:crypto';
import { Database, json } from '../../packages/data/src/index.js';
import { hashPassword } from '../../packages/data/src/security.js';
import {
  applicationTypes,
  type Actor,
  type DataScope,
  type Role,
} from '../../packages/contracts/src/index.js';
import { createTemplate } from '../../packages/core/src/index.js';

export async function fixture() {
  const control = new Database(process.env.DATABASE_ADMIN_URL);
  const runtime = new Database();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const departmentId = randomUUID();
  const otherDepartmentId = randomUUID();
  await control.client.tenant.createMany({
    data: [
      { id: tenantId, name: 'Integration A' },
      { id: otherTenantId, name: 'Integration B' },
    ],
  });
  await control.client.department.createMany({
    data: [
      { id: departmentId, tenantId, name: 'Engineering' },
      { id: otherDepartmentId, tenantId, name: 'Finance', parentId: departmentId },
    ],
  });
  const profiles = {
    admin: ['admin', 'TENANT'],
    employee: ['employee', 'SELF'],
    manager: ['manager', 'DEPARTMENT'],
    manager2: ['manager', 'DEPARTMENT'],
    reviewer1: ['approver', 'SELF'],
    reviewer2: ['approver', 'SELF'],
    agent: ['agent', 'SELF'],
    outsider: ['employee', 'SELF'],
  } as const;
  const actors = {} as Record<keyof typeof profiles, Actor>;
  const emails = {} as Record<keyof typeof profiles, string>;
  const password = 'Integration-password-2026!';
  for (const [key, [role, scope]] of Object.entries(profiles)) {
    const userId = randomUUID();
    const email = `${key}-${tenantId}@test.invalid`;
    const dept = key === 'outsider' ? otherDepartmentId : departmentId;
    await control.client.user.create({
      data: { id: userId, email, name: key, passwordHash: await hashPassword(password) },
    });
    await control.client.membership.create({
      data: { tenantId, userId, departmentId: dept, role, scope },
    });
    actors[key as keyof typeof profiles] = {
      userId,
      tenantId,
      departmentId: dept,
      role: role as Role,
      scope: scope as DataScope,
      name: key,
    };
    emails[key as keyof typeof profiles] = email;
  }
  const system =
    (await control.client.user.findUnique({ where: { email: 'system@flowforge.invalid' } })) ??
    (await control.client.user.create({
      data: {
        email: 'system@flowforge.invalid',
        name: 'System',
        active: false,
        passwordHash: await hashPassword('disabled'),
      },
    }));
  await control.client.membership.create({
    data: {
      tenantId,
      userId: system.id,
      departmentId,
      role: 'employee',
      scope: 'SELF',
      active: false,
    },
  });
  const definitions: Record<string, string> = {};
  for (const type of applicationTypes) {
    const definition = await control.client.flowDefinition.create({
      data: { tenantId, type, name: type, draft: json(createTemplate(type)), latestVersion: 1 },
    });
    definitions[type] = definition.id;
    await control.client.flowVersion.create({
      data: {
        tenantId,
        definitionId: definition.id,
        number: 1,
        graph: json(createTemplate(type)),
        publishedBy: actors.admin.userId,
      },
    });
  }
  return {
    control,
    runtime,
    tenantId,
    otherTenantId,
    departmentId,
    otherDepartmentId,
    actors,
    emails,
    password,
    definitions,
  };
}
