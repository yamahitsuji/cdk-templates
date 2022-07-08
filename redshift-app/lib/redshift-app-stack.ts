import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as elbv2targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets'
import * as redshift from 'aws-cdk-lib/aws-redshift'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'

const availabilityZones = [
  'ap-northeast-1a',
  'ap-northeast-1c',
  'ap-northeast-1d',
]

const vpcCidr = '10.1.0.0/16'

export class RedshiftAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = new ec2.Vpc(this, 'VPC', {
      cidr: vpcCidr,
      availabilityZones,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'protected',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    })

    const albSG = new ec2.SecurityGroup(this, 'SecurityGroupForAlb', {
      vpc,
      description: 'SG for Alb',
      allowAllOutbound: true,
    })
    albSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow Public Web Access'
    )

    const ec2SG = new ec2.SecurityGroup(this, 'SecurityGroupForEC2', {
      vpc,
      description: 'SG for EC2',
      allowAllOutbound: true,
    })
    ec2SG.addIngressRule(
      ec2.Peer.securityGroupId(albSG.securityGroupId),
      ec2.Port.tcp(80),
      'Allow ALB to access EC2'
    )

    const redshiftSG = new ec2.SecurityGroup(this, 'SecurityGroupForRedshift', {
      vpc,
      description: 'SG for Redshift',
      allowAllOutbound: true,
    })
    redshiftSG.addIngressRule(
      ec2.Peer.securityGroupId(ec2SG.securityGroupId),
      ec2.Port.tcp(5439),
      'Allow EC2 to access Redshift'
    )

    const role = new iam.Role(this, 'ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    })
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    )

    const ami = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64,
    })

    const commands = [
      // install apache
      'yum update -y',
      'yum install -y httpd',
      'systemctl start httpd.service',
      'systemctl enable httpd.service',
      'echo "Hello World from $(hostname -f)" > /var/www/html/index.html',
      // install postgresql client for test
      'amazon-linux-extras install -y postgresql14',
    ]
    const userData = ec2.UserData.forLinux()
    userData.addCommands(...commands)

    const instances = vpc.privateSubnets.map(
      (sn) =>
        new ec2.Instance(this, `Instance${sn.availabilityZone}`, {
          vpc,
          instanceType: ec2.InstanceType.of(
            ec2.InstanceClass.T4G,
            ec2.InstanceSize.MICRO
          ),
          machineImage: ami,
          securityGroup: ec2SG,
          role,
          vpcSubnets: {
            subnets: [sn],
          },
          userData,
        })
    )

    const targets = instances.map(
      (instance) => new elbv2targets.InstanceTarget(instance, 80)
    )
    const tg = new elbv2.ApplicationTargetGroup(this, 'ec2TargetGroup', {
      targetType: elbv2.TargetType.INSTANCE,
      port: 80,
      vpc,
      targets,
    })

    const lb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSG,
      vpcSubnets: {
        subnets: vpc.publicSubnets,
      },
    })

    const listener = lb.addListener('Listener', {
      port: 80,
    })

    listener.addTargetGroups('tg1', {
      targetGroups: [tg],
    })

    const redshiftSubnetGroup = new redshift.CfnClusterSubnetGroup(
      this,
      'RedshiftSubnetGroup',
      {
        description: 'description',
        subnetIds: vpc.isolatedSubnets.map((sn) => sn.subnetId),
      }
    )

    const cfnSecret = new secretsmanager.CfnSecret(this, 'MyCfnSecret', {
      description: 'secrets for redshift',
      generateSecretString: {
        excludeCharacters: '\'"\\/@',
        excludeLowercase: false,
        excludeNumbers: false,
        excludePunctuation: false,
        excludeUppercase: false,
        generateStringKey: 'password',
        includeSpace: false,
        passwordLength: 32,
        requireEachIncludedType: true,
        secretStringTemplate: '{"username": "admin"}',
      },
      name: 'myClusterSecret',
    })
    cfnSecret.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)

    const cluster = new redshift.CfnCluster(this, 'MyCfnCluster', {
      clusterType: 'multi-node',
      dbName: 'dev',
      masterUsername: `{{resolve:secretsmanager:${cfnSecret.ref}:SecretString:username}}`,
      masterUserPassword: `{{resolve:secretsmanager:${cfnSecret.ref}:SecretString:password}}`,
      nodeType: 'dc2.large',
      allowVersionUpgrade: false,
      aquaConfigurationStatus: 'auto',
      automatedSnapshotRetentionPeriod: 1,
      availabilityZone: availabilityZones[0],
      // available only for ra3. https://docs.aws.amazon.com/ja_jp/redshift/latest/mgmt/managing-cluster-recovery.html
      // availabilityZoneRelocation: true,
      // availabilityZoneRelocationStatus: "100000",
      classic: false,
      clusterIdentifier: 'myexamplecluster',
      vpcSecurityGroupIds: [redshiftSG.securityGroupId],
      clusterSubnetGroupName: redshiftSubnetGroup.ref,
      clusterVersion: '1.0',
      encrypted: true,
      enhancedVpcRouting: false,
      iamRoles: [],
      numberOfNodes: 2,
      port: 5439,
      preferredMaintenanceWindow: 'Tue:18:00-Tue:19:00',
      publiclyAccessible: false,
      snapshotCopyRetentionPeriod: -1,
    })

    new secretsmanager.CfnSecretTargetAttachment(
      this,
      'RedshiftSecretAttachment',
      {
        secretId: cfnSecret.ref,
        targetId: cluster.ref,
        targetType: secretsmanager.AttachmentTargetType.REDSHIFT_CLUSTER,
      }
    )
  }
}
