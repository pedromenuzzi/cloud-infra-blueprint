import { edge, lit, newResource, ref } from '@blueprint/ir';
import { z } from 'zod';

import { defineTemplate } from './types.js';

export const webAppAws = defineTemplate({
  slug: 'web-app-aws',
  name: 'Web App on AWS',
  description: 'EC2 + RDS PostgreSQL behind a VPC with public subnets and security groups.',
  provider: 'aws',
  thumbnail: '/templates/web-app-aws.png',
  params: z.object({
    appName: z.string().min(1).default('my-app'),
    region: z.string().default('us-east-1'),
    dbSize: z.enum(['db.t3.micro', 'db.t3.small']).default('db.t3.micro'),
  }),
  build({ appName, dbSize }) {
    const vpc = newResource('aws_vpc', `${appName}-vpc`, {
      cidr_block: '10.0.0.0/16',
      enable_dns_support: true,
      enable_dns_hostnames: true,
      tags: { Name: `${appName}-vpc` },
    });
    const subnet = newResource('aws_subnet', `${appName}-pub-a`, {
      vpc_id: ref({ type: 'aws_vpc', name: `${appName}-vpc` }),
      cidr_block: '10.0.1.0/24',
      map_public_ip_on_launch: true,
      tags: { Name: `${appName}-pub-a` },
    });
    const sg = newResource('aws_security_group', `${appName}-sg`, {
      name: `${appName}-sg`,
      description: 'Web tier security group',
      vpc_id: ref({ type: 'aws_vpc', name: `${appName}-vpc` }),
    });
    const ec2 = newResource('aws_instance', `${appName}-web`, {
      ami: 'ami-0c55b159cbfafe1f0',
      instance_type: 't3.micro',
      subnet_id: ref({ type: 'aws_subnet', name: `${appName}-pub-a` }),
      vpc_security_group_ids: [ref({ type: 'aws_security_group', name: `${appName}-sg` })],
      tags: { Name: `${appName}-web` },
    });
    const rds = newResource('aws_db_instance', `${appName}-db`, {
      identifier: `${appName}-db`,
      engine: 'postgres',
      instance_class: dbSize,
      allocated_storage: 20,
      db_name: 'app',
      username: 'appuser',
      password: 'CHANGEME',
      skip_final_snapshot: true,
    });
    return {
      addResources: [vpc, subnet, sg, ec2, rds],
      addEdges: [
        edge(vpc, subnet, 'network', 'contains'),
        edge(subnet, ec2, 'network', 'hosts'),
        edge(sg, ec2, 'iam', 'protects'),
        edge(ec2, rds, 'network', 'connects to'),
      ],
      setProviders: { aws: { region: 'us-east-1' } },
      setVariables: {
        db_password: {
          type: lit('string'),
          description: 'RDS master password',
          sensitive: true,
          default: lit('CHANGEME'),
        },
      },
    };
  },
});
