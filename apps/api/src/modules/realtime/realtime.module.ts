import { Module } from '@nestjs/common';

import { RealtimeGateway } from './realtime.gateway';

/**
 * F4: WebSocket gateway implementing the y-websocket protocol so multiple
 * users editing the same project converge via Yjs CRDT.
 *
 * Authentication: JWT in `?token=` query param of the WS upgrade.
 * Rooms: one per `projectId`. Hibernate idle sockets to keep the server cheap.
 */
@Module({ providers: [RealtimeGateway] })
export class RealtimeModule {}
