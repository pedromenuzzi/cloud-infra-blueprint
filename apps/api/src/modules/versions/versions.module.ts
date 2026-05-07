import { Controller, Get, Module, Param, Post } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';

/**
 * Project versioning. F4 wires automatic snapshots every N saves
 * (or via manual button) into `ProjectVersion`.
 */
@Controller('projects/:projectId/versions')
class VersionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Param('projectId') projectId: string) {
    return this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Post()
  async snapshot(@Param('projectId') projectId: string) {
    const proj = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    return this.prisma.projectVersion.create({
      data: {
        projectId,
        ir: proj.ir as object,
        files: proj.files as object,
        message: 'manual snapshot',
      },
    });
  }
}

@Module({ controllers: [VersionsController] })
export class VersionsModule {}
