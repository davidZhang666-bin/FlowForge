import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
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
    logger: ['error', 'warn', 'log'],
  });
  app.use(helmet());
  app.use(expressJson({ limit: '128kb' }));
  app.use(cookieParser());
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin, credentials: true });
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      res.setHeader('x-request-id', randomUUID());
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
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
if (process.env.FLOWFORGE_TEST !== '1') {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');
}
