import 'reflect-metadata';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';

async function bootstrap() {
  // bufferLogs:false in dev so we see boot progress immediately; enable it
  // again in prod when an external log sink (pino/Datadog) is the consumer.
  const bufferLogs = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { bufferLogs },
  );

  // The official Fastify plugins are typed against the latest Fastify, but
  // @nestjs/platform-fastify@10 still pins v4 — the types diverge on a few
  // augmentation properties. Functionally compatible at runtime; cast to
  // FastifyPluginCallback to silence the spurious overload errors.
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(helmet as any, { contentSecurityPolicy: false });

  await fastify.register(cors as any, {
    origin: process.env.FRONTEND_URL?.split(',') ?? true,
    credentials: true,
  });

  await fastify.register(cookie as any);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api', { exclude: ['health'] });

  const port = Number.parseInt(process.env.API_PORT ?? '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`Cloud Blueprint API listening on http://0.0.0.0:${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error('Fatal during bootstrap', err);
  process.exit(1);
});
