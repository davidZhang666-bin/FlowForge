import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '../../../packages/core/src/index.js';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message: unknown = '服务暂时不可用，请稍后重试';
    if (error instanceof HttpException) {
      status = error.getStatus();
      code = `HTTP_${status}`;
      const response = error.getResponse();
      message =
        typeof response === 'string' ? response : (response as Record<string, unknown>).message;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    } else if (error instanceof DomainError) {
      status =
        error.code === 'FORBIDDEN'
          ? 403
          : ['REVISION_CONFLICT', 'PROCESS_CLOSED', 'TASK_CLOSED'].includes(error.code)
            ? 409
            : 422;
      code = error.code;
      message = error.message;
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = '记录发生冲突，请刷新后重试';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = '记录不存在';
    }
    if (status === 500) console.error(error);
    res.status(status).json({ error: { code, message, requestId: res.getHeader('x-request-id') } });
  }
}
