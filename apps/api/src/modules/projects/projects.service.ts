import { emptyIR } from '@blueprint/ir';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { type CreateProjectDto, type UpdateProjectDto } from './projects.dto';

import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // Centralizing the "is the DB up?" check keeps every method symmetrical:
  // when Postgres is down (dev mode without `pnpm infra:up`), reads return
  // an empty list and writes throw a typed 503 — much friendlier than the
  // raw Prisma stack trace.
  private ensureDb(action: 'read' | 'write'): void {
    if (this.prisma.connected) return;
    if (action === 'read') return;
    throw new ServiceUnavailableException(
      'Database is not connected. Run `pnpm infra:up && pnpm db:migrate` and try again.',
    );
  }

  async list(orgId: string) {
    this.ensureDb('read');
    if (!this.prisma.connected) return [];
    return this.prisma.project.findMany({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(id: string) {
    this.ensureDb('read');
    if (!this.prisma.connected) throw new NotFoundException(`Project ${id} not found`);
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`Project ${id} not found`);
    return p;
  }

  create(orgId: string, dto: CreateProjectDto) {
    this.ensureDb('write');
    return this.prisma.project.create({
      data: {
        orgId,
        name: dto.name,
        description: dto.description,
        defaultProvider: dto.defaultProvider ?? 'aws',
        ir: emptyIR() as object,
        files: {},
      },
    });
  }

  update(id: string, dto: UpdateProjectDto) {
    this.ensureDb('write');
    return this.prisma.project.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        ir: dto.ir as object | undefined,
        files: dto.files as object | undefined,
      },
    });
  }

  remove(id: string) {
    this.ensureDb('write');
    return this.prisma.project.delete({ where: { id } });
  }
}
