import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './modules/auth/auth.module';
import { CostModule } from './modules/cost/cost.module';
import { ExportModule } from './modules/export/export.module';
import { GitModule } from './modules/git/git.module';
import { HealthController } from './modules/health/health.controller';
import { OrgsModule } from './modules/orgs/orgs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ShareModule } from './modules/share/share.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { VersionsModule } from './modules/versions/versions.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    OrgsModule,
    ProjectsModule,
    VersionsModule,
    ShareModule,
    GitModule,
    ExportModule,
    TemplatesModule,
    RealtimeModule,
    CostModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
