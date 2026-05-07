import { Controller, Get, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { nanoid } from 'nanoid';

import { PrismaService } from '@/prisma/prisma.service';

@Controller('share')
class ShareController {
  constructor(private readonly prisma: PrismaService) {}

  @Post(':projectId')
  create(@Param('projectId') projectId: string) {
    return this.prisma.shareLink.create({
      data: { projectId, token: nanoid(24), readOnly: true },
    });
  }

  @Get(':token')
  async open(@Param('token') token: string) {
    const link = await this.prisma.shareLink.findUnique({
      where: { token },
      include: { project: true },
    });
    if (!link) throw new NotFoundException();
    if (link.expiresAt && link.expiresAt < new Date()) throw new NotFoundException();
    return { readOnly: link.readOnly, project: link.project };
  }
}

@Module({ controllers: [ShareController] })
export class ShareModule {}
