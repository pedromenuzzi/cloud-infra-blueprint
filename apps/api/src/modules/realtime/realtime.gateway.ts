import { Injectable, Logger } from '@nestjs/common';

/**
 * Skeleton placeholder. Real implementation in F3/F4 wires `y-websocket`'s
 * `setupWSConnection` against Fastify's underlying WebSocket server,
 * authenticated via JWT. We keep this file tiny on purpose so F0 builds
 * cleanly without extra deps.
 */
@Injectable()
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);

  ping(): string {
    this.logger.debug('Realtime gateway placeholder');
    return 'ok';
  }
}
