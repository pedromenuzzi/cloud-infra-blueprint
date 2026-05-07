import { Controller, Get, Module, Param, Res } from '@nestjs/common';
import JSZip from 'jszip';

import type { FastifyReply } from 'fastify';

import { PrismaService } from '@/prisma/prisma.service';

/**
 * Generate a downloadable .zip with the project's .tf files.
 * F5 promotes this to BullMQ for large projects + R2 upload.
 */
@Controller('export')
class ExportController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':projectId/zip')
  async zip(@Param('projectId') projectId: string, @Res() reply: FastifyReply) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const files = (project.files ?? {}) as Record<string, string>;
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) {
      zip.file(name, content);
    }
    zip.file(
      'README.md',
      [
        `# ${project.name}`,
        '',
        'Exported by Cloud Infra Blueprint.',
        '',
        '```bash',
        'terraform init',
        'terraform plan',
        'terraform apply',
        '```',
        '',
      ].join('\n'),
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${project.name}.zip"`)
      .send(buf);
  }
}

@Module({ controllers: [ExportController] })
export class ExportModule {}
