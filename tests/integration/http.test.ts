import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.js';
import { createApp } from '../../apps/api/src/main.js';
import { Database } from '../../packages/data/src/index.js';

let f: Awaited<ReturnType<typeof fixture>>;
let app: INestApplication;
let origin: string;
type Login = { cookie: string; csrf: string };
async function login(email: string, password: string): Promise<Login> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { csrfToken: string };
  return { cookie: response.headers.getSetCookie()[0]!.split(';')[0]!, csrf: body.csrfToken };
}
function request(path: string, session?: Login, init: RequestInit = {}) {
  return fetch(`${origin}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...init.headers,
    },
  });
}
beforeAll(async () => {
  f = await fixture();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (app) {
    await app.close();
    await app.get(Database).close();
  }
  await f?.runtime.close();
  await f?.control.close();
});

describe('authenticated HTTP boundary', () => {
  it('requires a valid server-side session and scopes the tenant list', async () => {
    expect((await request('/session')).status).toBe(401);
    const session = await login(f.emails.employee, f.password);
    const me = (await (await request('/session', session)).json()) as { tenants: { id: string }[] };
    expect(me.tenants.map((t) => t.id)).toEqual([f.tenantId]);
    expect((await request(`/tenants/${f.otherTenantId}/dashboard`, session)).status).toBe(403);
    const cookie = (
      await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.emails.admin, password: f.password }),
      })
    ).headers.getSetCookie()[0]!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });
  it('rejects CSRF, untrusted origins and unauthorized management', async () => {
    const session = await login(f.emails.employee, f.password);
    const path = `/tenants/${f.tenantId}/instances`;
    expect(
      (
        await request(path, session, {
          method: 'POST',
          headers: { 'x-csrf-token': '' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(path, session, {
          method: 'POST',
          headers: { Origin: 'https://untrusted.invalid' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/tenants/${f.tenantId}/workflows/${f.definitions.EXPENSE}`, session)).status,
    ).toBe(403);
    expect((await request(`/tenants/${f.tenantId}/outbox/failures`, session)).status).toBe(403);
  });
  it('validates commands and protects unrelated instance identifiers', async () => {
    const employee = await login(f.emails.employee, f.password);
    const outsider = await login(f.emails.outsider, f.password);
    const path = `/tenants/${f.tenantId}/instances`;
    expect((await request(path, employee, { method: 'POST', body: '{}' })).status).toBe(400);
    const response = await request(path, employee, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        data: { type: 'EXPENSE', title: 'HTTP workflow test', amountCents: 12345 },
      }),
    });
    expect(response.status).toBe(201);
    const result = (await response.json()) as { id: string };
    expect((await request(`${path}/${result.id}`, outsider)).status).toBe(404);
    expect((await request(`${path}/${result.id}/events`, outsider)).status).toBe(404);
    const detail = await request(`${path}/${result.id}`, employee);
    expect(detail.status).toBe(200);
    expect(detail.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('rechecks membership changes on subsequent requests', async () => {
    const session = await login(f.emails.manager, f.password);
    await f.control.client.membership.update({
      where: { tenantId_userId: { tenantId: f.tenantId, userId: f.actors.manager.userId } },
      data: { active: false },
    });
    try {
      expect((await request(`/tenants/${f.tenantId}/dashboard`, session)).status).toBe(403);
    } finally {
      await f.control.client.membership.update({
        where: { tenantId_userId: { tenantId: f.tenantId, userId: f.actors.manager.userId } },
        data: { active: true },
      });
    }
  });
  it('supports SSE replay from Last-Event-ID and closes cleanly', async () => {
    const session = await login(f.emails.employee, f.password);
    const response = await request(`/tenants/${f.tenantId}/instances`, session, {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        data: { title: 'SSE replay scenario', type: 'EXPENSE', amountCents: 100 },
      }),
    });
    const { id } = (await response.json()) as { id: string };
    const stream = await request(`/tenants/${f.tenantId}/instances/${id}/events`, session, {
      headers: { 'Last-Event-ID': '1' },
    });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const reader = stream.body!.getReader();
    let text = '';
    try {
      for (let i = 0; i < 10 && !text.includes('data:'); i++) {
        const chunk = await reader.read();
        text += new TextDecoder().decode(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    expect(text).toContain('id: 2');
    expect(text).not.toMatch(/id: 1\n/);
  });
  it('revokes the session on logout', async () => {
    const session = await login(f.emails.agent, f.password);
    expect((await request('/auth/logout', session, { method: 'POST', body: '{}' })).status).toBe(
      201,
    );
    expect((await request('/session', session)).status).toBe(401);
  });
  it('throttles repeated incorrect credentials', async () => {
    let status = 0;
    for (let i = 0; i < 11; i++)
      status = (
        await request('/auth/login', undefined, {
          method: 'POST',
          body: JSON.stringify({ email: 'missing@test.invalid', password: 'wrong' }),
        })
      ).status;
    expect(status).toBe(429);
  });
});
