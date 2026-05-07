import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { type CreateProjectDto, type UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Query('orgId') orgId: string) {
    return this.projects.list(orgId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Post()
  create(@Query('orgId') orgId: string, @Body() dto: CreateProjectDto) {
    return this.projects.create(orgId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.projects.remove(id);
  }
}
