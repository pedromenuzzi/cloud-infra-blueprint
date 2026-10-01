/**
 * Provider schemas, loaded on demand — one lazy chunk per provider, fetched
 * the first time a resource of that provider is in the project (or opened);
 * its data sources are a chunk of their own (`<provider>.data.json`),
 * fetched the first time a `data` block of that provider is.
 * Lookups are synchronous and return undefined until the chunk arrives;
 * nothing ever waits on it, so editing is never blocked. Subscribers (the
 * inspector, validation) re-render when `revision` moves.
 */
import { create } from 'zustand';
import { ProviderSchema } from './lookup';
import { DATA_SOURCE_USUAL_ATTRIBUTE } from './popular';
import type { SchemaBlock, SchemaData, SchemaProvider } from './types';

export type SchemaStatus = 'loading' | 'ready' | 'error';

interface SchemaState {
  schemas: Partial<Record<SchemaProvider, ProviderSchema>>;
  status: Partial<Record<SchemaProvider, SchemaStatus>>;
  /** data sources, per provider (their own chunks) */
  dataSchemas: Partial<Record<SchemaProvider, ProviderSchema>>;
  dataStatus: Partial<Record<SchemaProvider, SchemaStatus>>;
  /** bumped whenever a schema arrives (resources or data sources) */
  revision: number;
}

export const useSchemas = create<SchemaState>(() => ({ schemas: {}, status: {}, dataSchemas: {}, dataStatus: {}, revision: 0 }));

// one chunk per provider — Vite splits each JSON file into its own lazy module
const LOADERS = import.meta.glob<SchemaData>('./data/*.json', { import: 'default' });

const loader = (provider: SchemaProvider, data = false) => LOADERS[`./data/${provider}${data ? '.data' : ''}.json`];

/** a failed load (offline, stale deploy) is retried at most this often */
const RETRY_MS = 30_000;
/** keyed by chunk: `aws` (resources), `aws.data` (data sources) */
const pending = new Map<string, Promise<ProviderSchema | undefined>>();
const failedAt = new Map<string, number>();

/** the provider whose schema describes a resource type (`aws_instance` → aws) */
export function schemaProviderOf(type: string): SchemaProvider | undefined {
  if (type.startsWith('aws_')) return 'aws';
  if (type.startsWith('azurerm_')) return 'azurerm';
  if (type.startsWith('google_')) return 'google';
  return undefined;
}

/** make a schema available synchronously (tests, and the loader itself); a `kind: 'data'` file holds data sources */
export function registerSchema(data: SchemaData): ProviderSchema {
  const schema = new ProviderSchema(data);
  useSchemas.setState((s) =>
    data.kind === 'data'
      ? {
          dataSchemas: { ...s.dataSchemas, [data.provider]: schema },
          dataStatus: { ...s.dataStatus, [data.provider]: 'ready' },
          revision: s.revision + 1,
        }
      : {
          schemas: { ...s.schemas, [data.provider]: schema },
          status: { ...s.status, [data.provider]: 'ready' },
          revision: s.revision + 1,
        },
  );
  return schema;
}

function loadChunk(provider: SchemaProvider, data: boolean, retry: boolean): Promise<ProviderSchema | undefined> {
  const loaded = data ? useSchemas.getState().dataSchemas[provider] : useSchemas.getState().schemas[provider];
  if (loaded) return Promise.resolve(loaded);
  const key = data ? `${provider}.data` : provider;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const load = loader(provider, data);
  if (!load) return Promise.resolve(undefined);
  const failed = failedAt.get(key);
  if (failed !== undefined && !retry && Date.now() - failed < RETRY_MS) return Promise.resolve(undefined);

  const setStatus = (status: SchemaStatus) =>
    useSchemas.setState((s) =>
      data ? { dataStatus: { ...s.dataStatus, [provider]: status } } : { status: { ...s.status, [provider]: status } },
    );
  setStatus('loading');
  const promise = load().then(
    (file) => {
      pending.delete(key);
      // undefined: Vite handed the failure to the stale-deploy reload (src/lib/chunkReload.ts)
      if (!file) return undefined;
      failedAt.delete(key);
      return registerSchema(file);
    },
    () => {
      // the editor works the same without it — the catalog still drives everything
      pending.delete(key);
      failedAt.set(key, Date.now());
      setStatus('error');
      return undefined;
    },
  );
  pending.set(key, promise);
  return promise;
}

/** `retry`: try again right away after a failure (a user asked) */
export function loadSchema(provider: SchemaProvider, options: { retry?: boolean } = {}): Promise<ProviderSchema | undefined> {
  return loadChunk(provider, false, options.retry === true);
}

/** the provider's data sources (their own chunk); `retry` as for loadSchema */
export function loadDataSchema(provider: SchemaProvider, options: { retry?: boolean } = {}): Promise<ProviderSchema | undefined> {
  return loadChunk(provider, true, options.retry === true);
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

/* ------------------------------------------------------------ data sources */

/** start loading the data-source chunks these data source types need (fire and forget) */
export function requestDataSchemasFor(types: Iterable<string>): void {
  const wanted = new Set<SchemaProvider>();
  for (const type of types) {
    const provider = schemaProviderOf(type);
    if (provider) wanted.add(provider);
  }
  const { dataSchemas } = useSchemas.getState();
  for (const provider of wanted) if (!dataSchemas[provider]) void loadDataSchema(provider);
}

export function getDataSchema(provider: SchemaProvider): ProviderSchema | undefined {
  return useSchemas.getState().dataSchemas[provider];
}

/** the loaded data-source schema that knows this data source type (`aws_ami`), if any */
export function dataSchemaFor(type: string): ProviderSchema | undefined {
  const provider = schemaProviderOf(type);
  const schema = provider ? useSchemas.getState().dataSchemas[provider] : undefined;
  return schema?.has(type) ? schema : undefined;
}

/** a data source's body schema: undefined while its provider's data chunk isn't loaded (or the type is unknown) */
export function dataSourceSchema(type: string): SchemaBlock | undefined {
  return dataSchemaFor(type)?.resource(type);
}

/** React: the schema of a data source type, re-rendering when it arrives */
export function useDataSourceSchema(type: string): { block?: SchemaBlock; schema?: ProviderSchema; status?: SchemaStatus } {
  const provider = schemaProviderOf(type);
  const schema = useSchemas((s) => (provider ? s.dataSchemas[provider] : undefined));
  const status = useSchemas((s) => (provider ? s.dataStatus[provider] : undefined));
  if (!schema?.has(type)) return { status, schema };
  return { block: schema.resource(type), schema, status };
}

/**
 * The attribute a data source is usually read through (`names` for
 * `aws_availability_zones`, `json` for `aws_iam_policy_document`): the
 * curated one, else the first attribute it only exposes (once its schema is
 * loaded), else `id`.
 */
export function usualDataAttribute(type: string): string {
  const curated = Object.hasOwn(DATA_SOURCE_USUAL_ATTRIBUTE, type) ? DATA_SOURCE_USUAL_ATTRIBUTE[type] : undefined;
  if (curated) return curated;
  const block = dataSourceSchema(type);
  const exposed = block && Object.values(block.attributes).find((a) => a.computed && !a.optional && !a.required && a.name !== 'id');
  return exposed?.name ?? 'id';
}
