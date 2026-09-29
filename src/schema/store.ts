/**
 * Provider schemas, loaded on demand — one lazy chunk per provider, fetched
 * the first time a resource of that provider is in the project (or opened).
 * Lookups are synchronous and return undefined until the chunk arrives;
 * nothing ever waits on it, so editing is never blocked. Subscribers (the
 * inspector, validation) re-render when `revision` moves.
 */
import { create } from 'zustand';
import { ProviderSchema } from './lookup';
import type { SchemaBlock, SchemaData, SchemaProvider } from './types';

export type SchemaStatus = 'loading' | 'ready' | 'error';

interface SchemaState {
  schemas: Partial<Record<SchemaProvider, ProviderSchema>>;
  status: Partial<Record<SchemaProvider, SchemaStatus>>;
  /** bumped whenever a schema arrives */
  revision: number;
}

export const useSchemas = create<SchemaState>(() => ({ schemas: {}, status: {}, revision: 0 }));

// one chunk per provider — Vite splits each JSON file into its own lazy module
const LOADERS = import.meta.glob<SchemaData>('./data/*.json', { import: 'default' });

const loader = (provider: SchemaProvider) => LOADERS[`./data/${provider}.json`];

/** a failed load (offline, stale deploy) is retried at most this often */
const RETRY_MS = 30_000;
const pending = new Map<SchemaProvider, Promise<ProviderSchema | undefined>>();
const failedAt = new Map<SchemaProvider, number>();

/** the provider whose schema describes a resource type (`aws_instance` → aws) */
export function schemaProviderOf(type: string): SchemaProvider | undefined {
  if (type.startsWith('aws_')) return 'aws';
  if (type.startsWith('azurerm_')) return 'azurerm';
  if (type.startsWith('google_')) return 'google';
  return undefined;
}

/** make a schema available synchronously (tests, and the loader itself) */
export function registerSchema(data: SchemaData): ProviderSchema {
  const schema = new ProviderSchema(data);
  useSchemas.setState((s) => ({
    schemas: { ...s.schemas, [data.provider]: schema },
    status: { ...s.status, [data.provider]: 'ready' },
    revision: s.revision + 1,
  }));
  return schema;
}

/** `retry`: try again right away after a failure (a user asked) */
export function loadSchema(provider: SchemaProvider, options: { retry?: boolean } = {}): Promise<ProviderSchema | undefined> {
  const loaded = useSchemas.getState().schemas[provider];
  if (loaded) return Promise.resolve(loaded);
  const inFlight = pending.get(provider);
  if (inFlight) return inFlight;
  const load = loader(provider);
  if (!load) return Promise.resolve(undefined);
  const failed = failedAt.get(provider);
  if (failed !== undefined && !options.retry && Date.now() - failed < RETRY_MS) return Promise.resolve(undefined);

  useSchemas.setState((s) => ({ status: { ...s.status, [provider]: 'loading' } }));
  const promise = load().then(
    (data) => {
      pending.delete(provider);
      // undefined: Vite handed the failure to the stale-deploy reload (src/lib/chunkReload.ts)
      if (!data) return undefined;
      failedAt.delete(provider);
      return registerSchema(data);
    },
    () => {
      // the editor works the same without it — the catalog still drives everything
      pending.delete(provider);
      failedAt.set(provider, Date.now());
      useSchemas.setState((s) => ({ status: { ...s.status, [provider]: 'error' } }));
      return undefined;
    },
  );
  pending.set(provider, promise);
  return promise;
}

/** start loading the schemas these resource types need (fire and forget) */
export function requestSchemasFor(types: Iterable<string>): void {
  const wanted = new Set<SchemaProvider>();
  for (const type of types) {
    const provider = schemaProviderOf(type);
    if (provider) wanted.add(provider);
  }
  const { schemas } = useSchemas.getState();
  for (const provider of wanted) if (!schemas[provider]) void loadSchema(provider);
}

export function getProviderSchema(provider: SchemaProvider): ProviderSchema | undefined {
  return useSchemas.getState().schemas[provider];
}

/** the loaded schema that knows this resource type, if any */
export function schemaFor(type: string): ProviderSchema | undefined {
  const provider = schemaProviderOf(type);
  const schema = provider ? useSchemas.getState().schemas[provider] : undefined;
  return schema?.has(type) ? schema : undefined;
}

/** the resource's body schema — undefined while its provider isn't loaded (or the type is unknown) */
export function resourceSchema(type: string): SchemaBlock | undefined {
  return schemaFor(type)?.resource(type);
}

/** React: the schema for a resource type, re-rendering when it arrives */
export function useResourceSchema(type: string): { block?: SchemaBlock; schema?: ProviderSchema; status?: SchemaStatus } {
  const provider = schemaProviderOf(type);
  const schema = useSchemas((s) => (provider ? s.schemas[provider] : undefined));
  const status = useSchemas((s) => (provider ? s.status[provider] : undefined));
  if (!schema?.has(type)) return { status, schema };
  return { block: schema.resource(type), schema, status };
}
