import 'reflect-metadata';
import 'dotenv/config';
import { BadRequestException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json as expressJson } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Database } from '../../../packages/data/src/index.js';
import { AuthService } from './auth.js';
import { WorkflowService } from './workflows.js';
import { ProcessService } from './processes.js';
import { OrganizationService } from './organization.js';
import { ApiController } from './controller.js';
import { ErrorFilter } from './errors.js';

@Module({
  controllers: [ApiController],
  providers: [
    AuthService,
    WorkflowService,
    ProcessService,
    OrganizationService,
    { provide: Database, useFactory: () => new Database() },
  ],
})
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: process.env.FLOWFORGE_TEST === '1' ? false : ['error', 'warn', 'log'],
  });
  app.use(helmet());
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin, credentials: true });
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      res.setHeader('x-request-id', randomUUID());
      const started = performance.now();
      res.on('finish', () => {
        if (process.env.FLOWFORGE_TEST !== '1')
          console.log(
            JSON.stringify({
              service: 'api',
              event: 'http.completed',
              requestId: res.getHeader('x-request-id'),
              method: req.method,
              path: req.path,
              status: res.statusCode,
              durationMs: Math.round(performance.now() - started),
            }),
          );
      });
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        req.headers.origin &&
        req.headers.origin !== origin
      ) {
        res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: '请求来源不受信任' } });
        return;
      }
      next();
    },
  );
  app.use(expressJson({ limit: '128kb' }));
  app.use(
    (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      // Reject extreme nesting before recursive schema validation; never evaluate input expressions.
      const pending: { value: unknown; depth: number }[] = [{ value: req.body, depth: 0 }];
      while (pending.length) {
        const item = pending.pop()!;
        if (item.depth > 24) return next(new BadRequestException('JSON 嵌套层级过深'));
        if (item.value && typeof item.value === 'object') {
          for (const value of Object.values(item.value))
            pending.push({ value, depth: item.depth + 1 });
        }
      }
      next();
    },
  );
  app.use(cookieParser());
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
if (process.env.FLOWFORGE_TEST !== '1') {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');
}
