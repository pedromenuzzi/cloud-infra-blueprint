import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emitIR } from '@blueprint/hcl';
import { Injectable, Logger } from '@nestjs/common';

import { bucketForMonthlyCost, type CostEstimateResponse, type ResourceCost } from './cost.types';

import type { IR } from '@blueprint/ir';

/**
 * Hard cap on resources we'll send to Infracost in a single request.
 *
 * Infracost itself scales fine, but we don't want a malicious or runaway
 * IR to spend minutes inside the worker tying up the cost endpoint.
 * 500 resources comfortably covers any realistic Terraform project a
 * user would design in the canvas.
 */
const MAX_RESOURCES_PER_REQUEST = 500;

/** Process-level timeout (ms) for the `infracost breakdown` invocation. */
const INFRACOST_TIMEOUT_MS = 30_000;

/**
 * Cost estimation service backed by the **open-source Infracost CLI**.
 *
 * Why Infracost CLI (not the SaaS): the binary is Apache 2.0, ships an
 * embedded price database for AWS / Azure / GCP, and runs entirely
 * offline — no Infracost API key required for public cloud pricing. See
 * `docs/adr/0007-cost-via-infracost.md` for the design discussion.
 *
 * Two execution modes, picked at module init:
 *
 * 1. **Disabled mode** (default).
 *    Set when `BLUEPRINT_COST_ENABLED` is not `"1"`. The endpoint returns
 *    a structurally valid response with all-zero costs and a warning.
 *    The frontend renders nothing in this mode, so users without the
 *    optional Docker container never see broken UI.
 *
 * 2. **Local-binary mode**.
 *    Spawns `infracost` directly when `BLUEPRINT_COST_BINARY` points at
 *    an executable on the host (or it's on `PATH`). This is the path the
 *    `infracost` Docker Compose service uses — the API container shares
 *    the workspace volume and just shells out.
 */
@Injectable()
export class CostService {
  private readonly logger = new Logger(CostService.name);

  private readonly enabled: boolean;
  private readonly binaryPath: string;
  private readonly extraArgs: string[];

  constructor() {
    this.enabled = process.env.BLUEPRINT_COST_ENABLED === '1';
    this.binaryPath = process.env.BLUEPRINT_COST_BINARY ?? 'infracost';
    this.extraArgs = (process.env.BLUEPRINT_COST_EXTRA_ARGS ?? '')
      .split(' ')
      .map((a) => a.trim())
      .filter(Boolean);
  }

  /**
   * Estimate the monthly cost of every resource in `ir`.
   *
   * Never throws on Infracost-side failures: a missing binary, timeout,
   * or non-zero exit returns a structurally valid response with the
   * `warning` field populated, so the UI can surface a degraded state
   * without breaking the canvas.
   */
  async estimate(ir: IR): Promise<CostEstimateResponse> {
    const generatedAt = new Date().toISOString();

    if (!this.enabled) {
      return this.disabledResponse(
        generatedAt,
        'Cost estimation disabled (set BLUEPRINT_COST_ENABLED=1).',
      );
    }

    if (ir.resources.length === 0) {
      return {
        totalMonthlyCost: 0,
        currency: 'USD',
        byResource: {},
        unsupported: [],
        provider: 'infracost',
        generatedAt,
      };
    }

    if (ir.resources.length > MAX_RESOURCES_PER_REQUEST) {
      return this.disabledResponse(
        generatedAt,
        `Too many resources for a single estimate (${ir.resources.length} > ${MAX_RESOURCES_PER_REQUEST}). Split the project.`,
      );
    }

    const workdir = await mkdtemp(join(tmpdir(), 'blueprint-cost-'));
    try {
      const files = emitIR(ir);
      await Promise.all(
        Object.entries(files).map(async ([name, contents]) => {
          const filepath = join(workdir, name);
          await mkdir(join(filepath, '..'), { recursive: true });
          await writeFile(filepath, contents, 'utf8');
        }),
      );

      const json = await this.runInfracost(workdir);
      return this.parseInfracostJson(json, generatedAt);
    } catch (err) {
      this.logger.warn(`infracost failed: ${(err as Error).message}`);
      return this.disabledResponse(generatedAt, `Infracost unavailable: ${(err as Error).message}`);
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private disabledResponse(generatedAt: string, warning: string): CostEstimateResponse {
    return {
      totalMonthlyCost: 0,
      currency: 'USD',
      byResource: {},
      unsupported: [],
      provider: 'disabled',
      generatedAt,
      warning,
    };
  }

  private runInfracost(workdir: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const args = ['breakdown', '--path', workdir, '--format', 'json', ...this.extraArgs];
      const child = spawn(this.binaryPath, args, {
        env: {
          ...process.env,
          INFRACOST_SKIP_UPDATE_CHECK: 'true',
          INFRACOST_NO_COLOR: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`infracost timed out after ${INFRACOST_TIMEOUT_MS}ms`));
      }, INFRACOST_TIMEOUT_MS);

      child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b));
      child.stderr.on('data', (b: Buffer) => stderrChunks.push(b));
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
          reject(new Error(`infracost exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdoutChunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`infracost JSON parse failed: ${(err as Error).message}`));
        }
      });
    });
  }

  /**
   * Translate Infracost's report into our `CostEstimateResponse`.
   *
   * The response shape we accept is intentionally narrow — Infracost
   * exposes ~30 fields per resource we don't need. We only read the bits
   * the UI actually renders: address, monthly cost, components.
   */
  private parseInfracostJson(json: unknown, generatedAt: string): CostEstimateResponse {
    const projects = (json as { projects?: Array<{ breakdown?: { resources?: unknown[] } }> })
      .projects;
    const byResource: Record<string, ResourceCost> = {};
    const unsupported: string[] = [];
    let total = 0;

    for (const project of projects ?? []) {
      for (const raw of project.breakdown?.resources ?? []) {
        const r = raw as {
          name?: string;
          monthlyCost?: string | number | null;
          hourlyCost?: string | number | null;
          costComponents?: Array<{
            name?: string;
            monthlyCost?: string | number | null;
            unit?: string;
          }>;
        };
        const address = typeof r.name === 'string' ? r.name : null;
        if (!address) continue;
        const monthlyCost = toNumber(r.monthlyCost);
        if (monthlyCost === null) {
          unsupported.push(address);
          continue;
        }
        total += monthlyCost;
        const cost: ResourceCost = {
          address,
          monthlyCost,
        };
        const hourly = toNumber(r.hourlyCost);
        if (hourly !== null) cost.hourlyCost = hourly;
        if (Array.isArray(r.costComponents)) {
          cost.components = r.costComponents
            .map((c) => {
              const componentCost = toNumber(c.monthlyCost);
              if (componentCost === null) return null;
              return {
                name: typeof c.name === 'string' ? c.name : 'unnamed',
                monthlyCost: componentCost,
                ...(typeof c.unit === 'string' ? { unit: c.unit } : {}),
              };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);
        }
        byResource[address] = cost;
      }
    }

    return {
      totalMonthlyCost: round2(total),
      currency: 'USD',
      byResource,
      unsupported,
      provider: 'infracost',
      generatedAt,
    };
  }
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { bucketForMonthlyCost };
