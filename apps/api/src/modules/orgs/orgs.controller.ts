import { Controller, Get } from '@nestjs/common';

import { OrgsService } from './orgs.service';

@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list() {
    return this.orgs.list('placeholder-user-id');
  }
}
