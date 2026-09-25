import {
  AppWindow,
  Antenna,
  Archive,
  ArrowBigRightDash,
  ArrowRightLeft,
  BadgeCheck,
  Boxes,
  BrickWall,
  ChartColumn,
  Cloud,
  Container,
  Cpu,
  Cylinder,
  Database,
  DatabaseZap,
  EthernetPort,
  FileKey,
  FolderOpen,
  Globe,
  KeyRound,
  Layers2,
  Layers3,
  LockKeyhole,
  Mail,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Merge,
  Milestone,
  Package,
  PackageOpen,
  Plug,
  Rocket,
  Route,
  Router,
  ScrollText,
  Server,
  ShieldCheck,
  ShipWheel,
  SignpostBig,
  Split,
  Table2,
  Target,
  UserCog,
  Vault,
  Webhook,
  Workflow,
  Zap,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { Provider } from '@/ir/types';
import { cn } from '@/lib/utils';
import type { Category } from './types';

export const PROVIDER_COLORS: Record<Provider, string> = {
  aws: '#FF9900',
  azure: '#0078D4',
  gcp: '#4285F4',
  other: '#64748B',
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  other: 'Other',
};

/**
 * Category palette, in the spirit of cloud architecture icon sets: every
 * service sits on a tile colored by what it *is*, so a diagram reads at a
 * glance regardless of provider (the provider shows as a small badge).
 */
export const CATEGORY_COLORS: Record<Category, { from: string; to: string; solid: string }> = {
  compute: { from: '#FB923C', to: '#EA580C', solid: '#F97316' },
  storage: { from: '#4ADE80', to: '#15803D', solid: '#16A34A' },
  network: { from: '#C084FC', to: '#7E22CE', solid: '#9333EA' },
  database: { from: '#818CF8', to: '#4338CA', solid: '#4F46E5' },
  containers: { from: '#2DD4BF', to: '#0F766E', solid: '#0D9488' },
  integration: { from: '#F472B6', to: '#BE185D', solid: '#DB2777' },
  identity: { from: '#F87171', to: '#B91C1C', solid: '#DC2626' },
  edge: { from: '#38BDF8', to: '#0369A1', solid: '#0284C7' },
};

type GlyphProps = Pick<LucideProps, 'className' | 'strokeWidth'>;
type Glyph = ComponentType<GlyphProps>;

function customGlyph(paths: React.ReactNode, name: string): Glyph {
  const G = ({ className, strokeWidth = 2 }: GlyphProps) => (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
  G.displayName = name;
  return G;
}

const LambdaGlyph = customGlyph(
  <>
    <path d="M5.5 4h3.2c.7 0 1.3.4 1.6 1L18.5 20" />
    <path d="M12.4 10.2 6.5 20" />
  </>,
  'LambdaGlyph',
);

const BucketGlyph = customGlyph(
  <>
    <path d="M4.5 6.5h15l-1.6 12.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8Z" />
    <ellipse cx="12" cy="6.5" rx="7.5" ry="2.6" />
  </>,
  'BucketGlyph',
);

const QueueGlyph = customGlyph(
  <>
    <rect x="6" y="7" width="12" height="10" rx="1.5" />
    <path d="M10 7v10M14 7v10" />
    <path d="M2 12h3M19 12h3M20.5 10.5 22 12l-1.5 1.5" />
  </>,
  'QueueGlyph',
);

/** Fallback glyph per category (unknown / non-catalog resource types). */
const CATEGORY_GLYPHS: Record<Category, Glyph> = {
  compute: Server,
  storage: BucketGlyph,
  network: Cloud,
  database: Database,
  containers: Container,
  integration: QueueGlyph,
  identity: ShieldCheck,
  edge: Globe,
};

/** One recognizable glyph per service. */
const SERVICE_GLYPHS: Record<string, Glyph> = {
  // --- AWS
  aws_vpc: Cloud,
  aws_subnet: Layers2,
  aws_security_group: ShieldCheck,
  aws_internet_gateway: Router,
  aws_nat_gateway: ArrowRightLeft,
  aws_eip: MapPin,
  aws_lb: Split,
  aws_lb_target_group: Target,
  aws_lb_listener: Antenna,
  aws_instance: Server,
  aws_lambda_function: LambdaGlyph,
  aws_s3_bucket: BucketGlyph,
  aws_db_instance: Database,
  aws_dynamodb_table: Table2,
  aws_elasticache_cluster: DatabaseZap,
  aws_ecr_repository: PackageOpen,
  aws_ecs_cluster: Boxes,
  aws_ecs_service: Container,
  aws_ecs_task_definition: ScrollText,
  aws_eks_cluster: ShipWheel,
  aws_eks_node_group: Layers3,
  aws_apigatewayv2_api: Webhook,
  aws_apigatewayv2_integration: Plug,
  aws_apigatewayv2_route: Route,
  aws_apigatewayv2_stage: Rocket,
  aws_sqs_queue: QueueGlyph,
  aws_sns_topic: Megaphone,
  aws_sns_topic_subscription: Mail,
  aws_iam_role: UserCog,
  aws_iam_role_policy: FileKey,
  aws_lambda_permission: BadgeCheck,
  aws_kms_key: KeyRound,
  aws_secretsmanager_secret: LockKeyhole,
  aws_cloudfront_distribution: Globe,
  aws_route53_zone: SignpostBig,
  aws_route53_record: Milestone,
  // --- Azure
  azurerm_resource_group: FolderOpen,
  azurerm_virtual_network: Cloud,
  azurerm_subnet: Layers2,
  azurerm_network_security_group: ShieldCheck,
  azurerm_network_interface: EthernetPort,
  azurerm_public_ip: MapPin,
  azurerm_linux_virtual_machine: Server,
  azurerm_service_plan: Cpu,
  azurerm_linux_web_app: AppWindow,
  azurerm_linux_function_app: LambdaGlyph,
  azurerm_storage_account: Archive,
  azurerm_mssql_server: Database,
  azurerm_mssql_database: Cylinder,
  azurerm_postgresql_flexible_server: Database,
  azurerm_redis_cache: DatabaseZap,
  azurerm_kubernetes_cluster: ShipWheel,
  azurerm_container_registry: PackageOpen,
  azurerm_servicebus_namespace: Workflow,
  azurerm_servicebus_queue: QueueGlyph,
  azurerm_key_vault: Vault,
  azurerm_cdn_profile: Globe,
  azurerm_cdn_endpoint: Zap,
  // --- GCP
  google_compute_network: Cloud,
  google_compute_subnetwork: Layers2,
  google_compute_firewall: BrickWall,
  google_compute_router: Router,
  google_compute_router_nat: ArrowRightLeft,
  google_compute_instance: Server,
  google_cloudfunctions2_function: LambdaGlyph,
  google_storage_bucket: BucketGlyph,
  google_sql_database_instance: Database,
  google_redis_instance: DatabaseZap,
  google_bigquery_dataset: ChartColumn,
  google_artifact_registry_repository: PackageOpen,
  google_cloud_run_v2_service: Container,
  google_container_cluster: ShipWheel,
  google_container_node_pool: Layers3,
  google_pubsub_topic: Megaphone,
  google_pubsub_subscription: Mail,
  google_service_account: UserCog,
  google_secret_manager_secret: LockKeyhole,
  google_compute_backend_bucket: Package,
  google_compute_url_map: MapIcon,
  google_compute_target_http_proxy: Merge,
  google_compute_global_forwarding_rule: ArrowBigRightDash,
  google_dns_managed_zone: SignpostBig,
  google_dns_record_set: Milestone,
};

export function hasServiceGlyph(type: string): boolean {
  return type in SERVICE_GLYPHS;
}

export function CategoryGlyph({
  category,
  type,
  className,
  strokeWidth = 1.9,
}: {
  category: Category;
  /** resource type — picks the service glyph when known */
  type?: string;
  className?: string;
  strokeWidth?: number;
}) {
  const G = (type && SERVICE_GLYPHS[type]) || CATEGORY_GLYPHS[category];
  return <G className={className} strokeWidth={strokeWidth} />;
}

/** Category-colored gradient tile with the service glyph — nodes, palette, inspector. */
export function ResourceIcon({
  category,
  type,
  size = 32,
  className,
}: {
  category: Category;
  type?: string;
  /** kept for call-site compatibility; the tile color follows the category */
  provider?: Provider;
  size?: number;
  className?: string;
}) {
  const c = CATEGORY_COLORS[category];
  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center text-white', className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(5, Math.round(size * 0.26)),
        background: `linear-gradient(145deg, ${c.from}, ${c.to})`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.28), 0 1px 2px rgb(15 23 42 / 0.18), 0 2px 8px -2px color-mix(in srgb, ${c.solid} 55%, transparent)`,
      }}
    >
      <CategoryGlyph
        category={category}
        type={type}
        className="h-[58%] w-[58%] drop-shadow-[0_1px_0_rgb(0_0_0/0.12)]"
        strokeWidth={size < 24 ? 2.2 : 1.9}
      />
    </span>
  );
}

/** Small provider mark (colored square) used in tabs and badges. */
export function ProviderDot({ provider, size = 10 }: { provider: Provider; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-[3px]"
      style={{ width: size, height: size, background: PROVIDER_COLORS[provider] }}
    />
  );
}

/** Compact provider wordmark chip ("AWS", "Azure", "GCP") for nodes and cards. */
export function ProviderChip({ provider, className }: { provider: Provider; className?: string }) {
  const color = PROVIDER_COLORS[provider];
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center rounded-[4px] px-1 text-[9px] font-bold uppercase leading-none tracking-wide',
        className,
      )}
      style={{
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {PROVIDER_LABELS[provider]}
    </span>
  );
}
