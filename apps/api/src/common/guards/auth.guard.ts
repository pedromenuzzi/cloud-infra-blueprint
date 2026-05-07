import { Injectable } from '@nestjs/common';

import type { CanActivate, ExecutionContext } from '@nestjs/common';

/**
 * No-op guard placeholder. F0 implements real Clerk/Auth.js verification
 * (validate session cookie / Bearer token, attach `request.user`).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}
