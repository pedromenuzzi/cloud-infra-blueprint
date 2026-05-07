# Catálogo de recursos

## Estrutura declarativa

Cada recurso é um arquivo em `packages/resources/src/<provider>/<arquivo>.ts`:

```ts
import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsInstance = defineResource({
  provider: 'aws',
  type: 'aws_instance',
  category: 'Compute',
  displayName: 'EC2 Instance',
  icon: '/icons/aws/ec2.svg',
  description: 'Amazon EC2 virtual machine.',
  tags: ['compute', 'vm', 'server'],
  schema: z.object({
    ami: z.string().describe('AMI id'),
    instance_type: z.enum(['t3.micro', 't3.small', 't3.medium', 'm5.large']),
    subnet_id: z.string().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { instance_type: 't3.micro' },
  ports: {
    in: [{ kind: 'network', label: 'subnet', acceptsTypes: ['aws_subnet'] }],
    out: [
      { kind: 'network', label: 'connects to' },
      { kind: 'iam', label: 'role' },
    ],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_instance', res.name], res.args);
  },
});
```

## MVP

| Provider | Compute                         | Storage                   | Network                                                | Database                       | Identity                              |
| -------- | ------------------------------- | ------------------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| AWS      | `aws_instance`                  | `aws_s3_bucket`           | `aws_vpc` + `aws_subnet`                               | `aws_db_instance`              | `aws_iam_role` + `aws_security_group` |
| Azure    | `azurerm_linux_virtual_machine` | `azurerm_storage_account` | `azurerm_virtual_network` + `azurerm_subnet`           | `azurerm_mssql_database`       | `azurerm_resource_group`              |
| GCP      | `google_compute_instance`       | `google_storage_bucket`   | `google_compute_network` + `google_compute_subnetwork` | `google_sql_database_instance` | `google_service_account`              |

## Pós-MVP (priorizado)

### AWS

- ECS Fargate (`aws_ecs_cluster`, `aws_ecs_service`, `aws_ecs_task_definition`)
- EKS (`aws_eks_cluster`, `aws_eks_node_group`)
- Lambda (`aws_lambda_function`)
- Load balancers (`aws_lb`, `aws_lb_listener`, `aws_lb_target_group`)
- DNS / TLS (`aws_route53_zone`, `aws_route53_record`, `aws_acm_certificate`)
- Storage (`aws_dynamodb_table`)
- Messaging (`aws_sqs_queue`, `aws_sns_topic`)
- CDN (`aws_cloudfront_distribution`)

### Azure

- AKS (`azurerm_kubernetes_cluster`)
- Functions (`azurerm_function_app`)
- App Service (`azurerm_app_service`)
- Cosmos DB (`azurerm_cosmosdb_account`)
- Service Bus (`azurerm_servicebus_namespace`)
- Front Door (`azurerm_frontdoor`)

### GCP

- GKE (`google_container_cluster`)
- Cloud Run (`google_cloud_run_service`)
- Cloud Functions (`google_cloudfunctions_function`)
- BigQuery (`google_bigquery_dataset`, `google_bigquery_table`)
- Pub/Sub (`google_pubsub_topic`, `google_pubsub_subscription`)
- LB (`google_compute_global_address`, `google_compute_target_https_proxy`)

### Transversais

- `random_password`
- `tls_private_key`, `tls_self_signed_cert`
- `kubernetes_*` (deployment, service, ingress)
- `helm_release`

## Convenções

1. **Pareto 80/20.** Cubra 5–15 campos por recurso, não 200. O que não couber vai para `raw` e o usuário escreve no editor.
2. **Schema Zod = form gerado.** O Inspector usa `react-hook-form` + `zodResolver`.
3. **`defaults`** se aplicam ao arrastar da paleta.
4. **`ports`** descrevem onde edges fazem sentido (in/out + kind).
5. **`emit`** geralmente é uma linha. Customize só para sintaxe especial (blocos aninhados, `dynamic` block, heredocs).

## Adicionando um recurso (passo a passo)

1. Crie o arquivo TS em `packages/resources/src/<provider>/<nome>.ts`.
2. Importe no `<provider>/index.ts` e adicione ao array do catálogo.
3. Adicione ícone SVG em `apps/web/public/icons/<provider>/<nome>.svg` (placeholder OK).
4. Crie `__tests__/<nome>.test.ts` com:
   - parse de exemplo válido,
   - emit não joga,
   - round-trip preserva campos.
5. Abra PR usando o template `[resource]: <provider>_<tipo>`.
