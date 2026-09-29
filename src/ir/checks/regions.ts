/**
 * Region consistency: an AWS subnet's availability zone must belong to the
 * region its provider deploys to, and a GCP instance (or GKE cluster) must
 * live in its subnetwork's region.
 */
import { messagesFor } from '@/i18n/messages';
import type { IR, ResourceNode } from '../types';
import { checkMessages } from './messages';
import { providerFor, providerLabel, refTarget, resolveString, type Resolved } from './resolve';
import type { CheckContext } from './types';

const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+/;
const GCP_REGION = /^[a-z]+-[a-z]+\d+$/;
const GCP_ZONE = /^([a-z]+-[a-z]+\d+)-[a-z]$/;

/** `us-east-1a` → `us-east-1` (Local and Wavelength Zones too: `us-east-1-bos-1a`); undefined for AZ IDs like `use1-az1`. */
export function awsRegionOfZone(zone: string): string | undefined {
  const region = AWS_REGION.exec(zone)?.[0];
  if (!region) return undefined;
  const rest = zone.slice(region.length);
  return /^[a-z]$/.test(rest) || rest.startsWith('-') ? region : undefined;
}

/** The region a GCP location names: `us-central1-a` → `us-central1`, `us-central1` → itself. */
export function gcpRegionOf(location: string): string | undefined {
  if (GCP_REGION.test(location)) return location;
  return GCP_ZONE.exec(location)?.[1];
}

const t = () => messagesFor(checkMessages);
const via = (r: Resolved) => (r.via ? t().from(r.via) : '');

function awsZoneChecks(ctx: CheckContext) {
  for (const node of ctx.ir.resources) {
    if (node.type !== 'aws_subnet') continue;
    const zone = resolveString(ctx.ir, node.args.availability_zone);
    const zoneRegion = zone && awsRegionOfZone(zone.value);
    if (!zone || !zoneRegion) continue;
    const region = resolveString(ctx.ir, providerFor(ctx.ir, node, 'aws')?.args.region);
    if (!region || !AWS_REGION.test(region.value) || region.value === zoneRegion) continue;
    ctx.warn(
      node,
      'availability_zone',
      t().awsZoneRegion(zone.value, via(zone), zoneRegion, providerLabel(node, 'AWS'), region.value, via(region)),
    );
  }
}

/** A subnetwork's region: its own `region`, else its provider's. */
function subnetworkRegion(ir: IR, subnetwork: ResourceNode): Resolved | undefined {
  const own = resolveString(ir, subnetwork.args.region);
  if (own || subnetwork.args.region) return own;
  return resolveString(ir, providerFor(ir, subnetwork, 'google')?.args.region);
}

function subnetworkOf(ir: IR, node: ResourceNode): ResourceNode | undefined {
  const nic = node.args.network_interface;
  const body = nic?.kind === 'block' ? nic.body : nic?.kind === 'blocks' ? nic.items[0] : undefined;
  const target = refTarget(ir, node.type === 'google_compute_instance' ? body?.subnetwork : node.args.subnetwork);
  return target?.type === 'google_compute_subnetwork' ? target : undefined;
}

function gcpZoneChecks(ctx: CheckContext) {
  for (const node of ctx.ir.resources) {
    const field = node.type === 'google_compute_instance' ? 'zone' : node.type === 'google_container_cluster' ? 'location' : undefined;
    if (!field) continue;
    const location = resolveString(ctx.ir, node.args[field]);
    if (!location) continue;
    if (field === 'zone' && GCP_REGION.test(location.value)) {
      ctx.warn(node, field, t().gcpZoneIsRegion(location.value, via(location)));
      continue;
    }
    const region = gcpRegionOf(location.value);
    const subnetwork = subnetworkOf(ctx.ir, node);
    const subnetRegion = subnetwork && subnetworkRegion(ctx.ir, subnetwork);
    if (!region || !subnetRegion || !GCP_REGION.test(subnetRegion.value) || subnetRegion.value === region) continue;
    const kind = node.type === 'google_compute_instance' ? 'instance' : 'cluster';
    ctx.warn(
      node,
      field,
      t().gcpRegionMismatch(field, location.value, via(location), region, subnetwork.id, subnetRegion.value, via(subnetRegion), kind),
    );
  }
}

export function regionChecks(ctx: CheckContext) {
  awsZoneChecks(ctx);
  gcpZoneChecks(ctx);
}
