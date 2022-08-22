import { Stack, StackProps, aws_ec2 as ec2 } from 'aws-cdk-lib'
import { Construct } from 'constructs'
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ThreeTierVpcWithoutNatStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const vpcCidr = '10.10.0.0/16'

    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: vpcCidr,
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    })
  }
}
