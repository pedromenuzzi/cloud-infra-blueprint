/**
 * The price tables, as one module: loaded on demand (load.ts) so the editor's
 * first paint never waits for them. Written by ../refresh/refresh-prices.ts.
 */
import type { PriceBook } from '../types';
import aws from './aws.json';
import azure from './azure.json';
import gcp from './gcp.json';

// typed, not cast: a table that drifts from ../types.ts fails the typecheck
export const PRICE_BOOK: PriceBook = { aws, azure, gcp };
