import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Database } from '../../../packages/data/src/index.js';
import { createToken, digest, verifyPassword } from '../../../packages/data/src/security.js';
import type { Actor, DataScope, Role } from '../../../packages/contracts/src/index.js';

export interface AuthRequest extends Request {
  cookies: Record<string, string>;
}
@Injectable()
export class AuthService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async login(input: unknown, req: AuthRequest, res: Response): Promise<{ csrfToken: string }> {
    const { email, password } = z
      .object({
        email: z
          .string()
          .email()
          .max(200)
          .transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .strict()
      .parse(input);
    const key = digest(`${req.ip ?? 'unknown'}:${email}`);
    const attempts = await this.db.client.$queryRaw<
      { attempts: number }[]
    >`INSERT INTO login_attempts (key, attempts, "windowStart") VALUES (${key}, 1, NOW()) ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN login_attempts."windowStart" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE login_attempts.attempts + 1 END, "windowStart" = CASE WHEN login_attempts."windowStart" < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE login_attempts."windowStart" END RETURNING attempts`;
    if ((attempts[0]?.attempts ?? 100) > 10)
      throw new HttpException('尝试次数过多，请稍后重试', 429);
    const user = await this.db.client.user.findUnique({ where: { email } });
    const valid = await verifyPassword(password, user?.passwordHash ?? 'missing');
    if (!user?.active || !valid) throw new UnauthorizedException('邮箱或密码错误');
    const token = createToken();
    const csrfToken = createToken();
    await this.db.client.session.create({
      data: {
        tokenHash: digest(token),
        csrfHash: digest(csrfToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 8 * 3600000),
      },
    });
    await this.db.client.loginAttempt.delete({ where: { key } });
    res.cookie('ff_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 3600000,
      path: '/',
    });
    return { csrfToken };
  }
  async identity(
    req: AuthRequest,
    mutation = false,
  ): Promise<{ userId: string; tokenHash: string }> {
    const token = req.cookies.ff_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException('请先登录');
    const session = await this.db.client.session.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('登录已过期');
    const user = await this.db.client.user.findUnique({ where: { id: session.userId } });
    if (!user?.active) throw new UnauthorizedException('账号已停用');
    if (mutation) {
      const csrf = req.header('x-csrf-token');
      if (!csrf || digest(csrf) !== session.csrfHash)
        throw new ForbiddenException('CSRF 校验失败，请重新登录');
    }
    return { userId: user.id, tokenHash: session.tokenHash };
  }
  async actor(req: AuthRequest, tenantId: string, mutation = false): Promise<Actor> {
    z.string().uuid().parse(tenantId);
    const { userId } = await this.identity(req, mutation);
    return this.db.tenant(tenantId, async (tx) => {
      const member = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (!member?.active) throw new ForbiddenException('没有该企业的访问权限');
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      return {
        tenantId,
        userId,
        departmentId: member.departmentId,
        role: member.role as Role,
        scope: member.scope as DataScope,
        name: user.name,
      };
    });
  }
  async me(req: AuthRequest): Promise<unknown> {
    const { userId } = await this.identity(req);
    const user = await this.db.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    const tenants = await this.db.client.tenant.findMany({ orderBy: { name: 'asc' } });
    const memberships = [];
    for (const tenant of tenants) {
      const membership = await this.db.tenant(tenant.id, (tx) =>
        tx.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId } } }),
      );
      if (membership?.active)
        memberships.push({
          ...tenant,
          role: membership.role,
          scope: membership.scope,
          departmentId: membership.departmentId,
        });
    }
    return { user, tenants: memberships };
  }
  async logout(req: AuthRequest, res: Response): Promise<void> {
    const { tokenHash } = await this.identity(req, true);
    await this.db.client.session.delete({ where: { tokenHash } });
    res.clearCookie('ff_session', { path: '/' });
  }
}
