import { allTemplates } from '@blueprint/templates';
import { Controller, Get, Module } from '@nestjs/common';

@Controller('templates')
class TemplatesController {
  @Get()
  list() {
    return allTemplates.map(({ slug, name, description, provider, thumbnail }) => ({
      slug,
      name,
      description,
      provider,
      thumbnail,
    }));
  }
}

@Module({ controllers: [TemplatesController] })
export class TemplatesModule {}
