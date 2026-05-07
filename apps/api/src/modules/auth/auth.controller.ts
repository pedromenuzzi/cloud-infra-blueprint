import { Controller, Get } from '@nestjs/common';

import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  async me(): Promise<{ id: string; email: string } | null> {
    return this.auth.getCurrentUser();
  }
}
