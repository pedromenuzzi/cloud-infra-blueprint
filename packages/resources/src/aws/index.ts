import { awsInstance } from './ec2.js';
import { awsIamRole, awsSecurityGroup } from './iam.js';
import { awsDbInstance } from './rds.js';
import { awsS3Bucket } from './s3.js';
import { awsSubnet, awsVpc } from './vpc.js';

export { awsInstance } from './ec2.js';
export { awsIamRole, awsSecurityGroup } from './iam.js';
export { awsDbInstance } from './rds.js';
export { awsS3Bucket } from './s3.js';
export { awsSubnet, awsVpc } from './vpc.js';

export const awsCatalog = [
  awsVpc,
  awsSubnet,
  awsInstance,
  awsS3Bucket,
  awsDbInstance,
  awsIamRole,
  awsSecurityGroup,
];
