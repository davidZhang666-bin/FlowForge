import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthService, type AuthRequest } from './auth.js';
import { WorkflowService } from './workflows.js';
import { ProcessService } from './processes.js';
import { OrganizationService } from './organization.js';
import { Database } from '../../../packages/data/src/index.js';

@Controller()
export class ApiController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(WorkflowService) private readonly workflows: WorkflowService, @Inject(ProcessService) private readonly processes: ProcessService, @Inject(OrganizationService) private readonly organization: OrganizationService, @Inject(Database) private readonly db: Database) {}
  @Get('health') async health() { await this.db.client.$queryRaw`SELECT 1`; return { status: 'ok', service: 'flowforge-api' }; }
  @Post('api/v1/auth/login') login(@Body() input: unknown, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) { return this.auth.login(input, req, res); }
  @Post('api/v1/auth/logout') logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res); }
  @Get('api/v1/session') me(@Req() req: AuthRequest) { return this.auth.me(req); }
  @Get('api/v1/tenants/:tenantId/dashboard') async dashboard(@Param('tenantId') tenantId: string, @Req() req: AuthRequest) { return this.processes.dashboard(await this.auth.actor(req, tenantId)); }
  @Get('api/v1/tenants/:tenantId/directory') async directory(@Param('tenantId') tenantId: string, @Req() req: AuthRequest) { return this.organization.directory(await this.auth.actor(req, tenantId)); }
  @Patch('api/v1/tenants/:tenantId/members/:userId') async membership(@Param('tenantId') tenantId: string, @Param('userId') userId: string, @Req() req: AuthRequest, @Body() input: unknown) { return this.organization.membership(await this.auth.actor(req, tenantId, true), userId, input); }
  @Get('api/v1/tenants/:tenantId/workflows') async workflowList(@Param('tenantId') tenantId: string, @Req() req: AuthRequest) { return this.workflows.list(await this.auth.actor(req, tenantId)); }
  @Get('api/v1/tenants/:tenantId/workflows/:id') async workflowDetail(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest) { return this.workflows.detail(await this.auth.actor(req, tenantId), id); }
  @Patch('api/v1/tenants/:tenantId/workflows/:id') async workflowSave(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest, @Body() input: unknown) { return this.workflows.save(await this.auth.actor(req, tenantId, true), id, input); }
  @Post('api/v1/tenants/:tenantId/workflows/:id/publish') async workflowPublish(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest, @Body() input: unknown) { return this.workflows.publish(await this.auth.actor(req, tenantId, true), id, input); }
  @Get('api/v1/tenants/:tenantId/instances') async instances(@Param('tenantId') tenantId: string, @Req() req: AuthRequest, @Query() query: unknown) { return this.processes.list(await this.auth.actor(req, tenantId), query); }
  @Post('api/v1/tenants/:tenantId/instances') async submit(@Param('tenantId') tenantId: string, @Req() req: AuthRequest, @Body() input: unknown) { return this.processes.submit(await this.auth.actor(req, tenantId, true), input, req.header('idempotency-key')); }
  @Get('api/v1/tenants/:tenantId/instances/:id') async instance(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest) { return this.processes.detail(await this.auth.actor(req, tenantId), id); }
  @Post('api/v1/tenants/:tenantId/instances/:id/commands') async command(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest, @Body() input: unknown) { return this.processes.command(await this.auth.actor(req, tenantId, true), id, input, req.header('idempotency-key')); }
  @Get('api/v1/tenants/:tenantId/instances/:id/events') async events(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest, @Res() res: Response) {
    z.string().uuid().parse(id);
    let actor = await this.auth.actor(req, tenantId);
    let after = z.coerce.number().int().nonnegative().parse(req.header('last-event-id') ?? req.query.after ?? 0);
    await this.processes.events(actor, id, after);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
    let closed = false; res.on('close', () => { closed = true; });
    while (!closed) {
      try {
        actor = await this.auth.actor(req, tenantId);
        const events = await this.processes.events(actor, id, after) as { sequence: number }[];
        for (const event of events) { if (closed) break; res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`); after = event.sequence; }
        if (!closed) res.write(': heartbeat\n\n');
      } catch { if (!closed) { res.write('event: access-revoked\ndata: {}\n\n'); res.end(); } return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  @Get('api/v1/tenants/:tenantId/notifications') async notifications(@Param('tenantId') tenantId: string, @Req() req: AuthRequest) { return this.organization.notifications(await this.auth.actor(req, tenantId)); }
  @Post('api/v1/tenants/:tenantId/notifications/:id/read') async read(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest) { return this.organization.read(await this.auth.actor(req, tenantId, true), id); }
  @Get('api/v1/tenants/:tenantId/outbox/failures') async failures(@Param('tenantId') tenantId: string, @Req() req: AuthRequest) { return this.organization.failures(await this.auth.actor(req, tenantId)); }
  @Post('api/v1/tenants/:tenantId/outbox/:id/replay') async replay(@Param('tenantId') tenantId: string, @Param('id') id: string, @Req() req: AuthRequest) { return this.organization.replay(await this.auth.actor(req, tenantId, true), id); }
}
