import { defineResource } from '@blueprint/ir';
import { z } from 'zod';

export const awsVpc = defineResource({
  provider: 'aws',
  type: 'aws_vpc',
  category: 'Network',
  displayName: 'VPC',
  description: 'Virtual Private Cloud — isolated network in a region.',
  icon: '/icons/aws/vpc.svg',
  tags: ['network', 'vpc'],
  schema: z.object({
    cidr_block: z.string().describe('IPv4 CIDR, e.g. 10.0.0.0/16'),
    enable_dns_support: z.boolean().optional(),
    enable_dns_hostnames: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { cidr_block: '10.0.0.0/16', enable_dns_support: true, enable_dns_hostnames: true },
  ports: {
    in: [],
    out: [{ kind: 'network', label: 'contains' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_vpc', res.name], res.args);
  },
});

export const awsSubnet = defineResource({
  provider: 'aws',
  type: 'aws_subnet',
  category: 'Network',
  displayName: 'Subnet',
  description: 'Subnet within a VPC.',
  icon: '/icons/aws/subnet.svg',
  tags: ['network', 'subnet'],
  schema: z.object({
    vpc_id: z.string(),
    cidr_block: z.string(),
    availability_zone: z.string().optional(),
    map_public_ip_on_launch: z.boolean().optional(),
    tags: z.record(z.string()).optional(),
  }),
  defaults: { map_public_ip_on_launch: true },
  ports: {
    in: [{ kind: 'network', label: 'parent vpc', acceptsTypes: ['aws_vpc'] }],
    out: [{ kind: 'network', label: 'hosts' }],
  },
  emit(res, ctx) {
    return ctx.block('resource', ['aws_subnet', res.name], res.args);
  },
});
