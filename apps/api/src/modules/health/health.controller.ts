import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';

interface HealthChecks {
  db: 'ok' | 'down' | 'unknown';
  api: 'ok';
}

interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  checks: HealthChecks;
  /** First non-ok check's diagnostic message, if any. */
  detail?: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<HealthPayload> {
    const checks: HealthChecks = { api: 'ok', db: 'unknown' };
    let detail: string | undefined;

    if (!this.prisma.connected) {
      checks.db = 'down';
      detail = 'Prisma did not connect at boot. Run `pnpm infra:up && pnpm db:migrate`.';
    } else {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        checks.db = 'ok';
      } catch (err) {
        checks.db = 'down';
        detail = (err as Error).message;
      }
    }

    const status = (Object.values(checks) as string[]).every((v) => v === 'ok') ? 'ok' : 'degraded';

    return {
      status,
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.round(process.uptime()),
      checks,
      ...(detail ? { detail } : {}),
    };
  }
}
