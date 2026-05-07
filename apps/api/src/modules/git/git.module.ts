import { Controller, Get, Module, Param } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';

/**
 * GitHub / GitLab integration. F5 implements:
 *   - OAuth dance to obtain user token.
 *   - AES-GCM encrypt token before persisting in `GitIntegration.tokenEnc`.
 *   - Push: create branch `blueprint/sync`, commit `.tf` files, open PR.
 *   - Pull (read-only): import existing `.tf` from a repo into the canvas.
 */
@Controller('git')
class GitController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':projectId/integration')
  get(@Param('projectId') projectId: string) {
    return this.prisma.gitIntegration.findUnique({ where: { projectId } });
  }
}

@Module({ controllers: [GitController] })
export class GitModule {}
