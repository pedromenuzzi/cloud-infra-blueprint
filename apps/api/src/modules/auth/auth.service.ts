import { Injectable } from '@nestjs/common';

/**
 * Auth service abstraction. Default impl is a no-op suitable for local dev;
 * F0 swaps it for Clerk OR Auth.js based on `AUTH_PROVIDER` env var.
 *
 * Spec section 12: "Lock-in em Clerk - encapsular tudo em modulo Auth interno;
 * trocar por Auth.js leva 1-2 dias se preciso."
 */
@Injectable()
export class AuthService {
  async getCurrentUser(): Promise<{ id: string; email: string } | null> {
    return null;
  }
}
