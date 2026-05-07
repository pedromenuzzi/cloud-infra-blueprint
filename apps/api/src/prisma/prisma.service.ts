import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Whether the underlying connection succeeded at boot time. */
  public connected = false;

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('Prisma connected');
    } catch (err) {
      // Don't crash the API just because Postgres is down — that lets the
      // dev experience continue (templates, /health) and surfaces the
      // missing dependency on /health rather than at boot. Production
      // deploys still fail visibly because /health returns degraded.
      this.connected = false;
      this.logger.warn(
        `Prisma failed to connect: ${(err as Error).message}. ` +
          `API will boot in degraded mode; /health will report db: down.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.$disconnect();
  }
}
