import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as elbv2targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets'
import { Duration, RemovalPolicy } from 'aws-cdk-lib'

const availabilityZones = ['ap-northeast-1a', 'ap-northeast-1c']
const vpcCidr = '10.1.0.0/16'

export class Ec2AppStack extends cdk.Stack {
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
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
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

    const dbSG = new ec2.SecurityGroup(this, 'SecurityGroupForRDS', {
      vpc,
      description: 'SG for RDS',
      allowAllOutbound: true,
    })
    dbSG.addIngressRule(
      ec2.Peer.securityGroupId(ec2SG.securityGroupId),
      ec2.Port.tcp(3306),
      'Allow EC2 to access RDS'
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
      // install mysql client for test
      'rpm --import https://repo.mysql.com/RPM-GPG-KEY-mysql-2022',
      'yum install -y https://dev.mysql.com/get/mysql80-community-release-el7-3.noarch.rpm',
      'yum install -y mysql-community-client',
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
    const tg = new elbv2.ApplicationTargetGroup(this, 'EC2TargetGroup', {
      targetType: elbv2.TargetType.INSTANCE,
      port: 80,
      vpc,
      targets,
    })

    const lb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
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

    const subnetGroup = new rds.SubnetGroup(this, 'MySubnetGroup', {
      description: 'cdk example',
      vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      subnetGroupName: 'mySubnetGroup',
      vpcSubnets: {
        availabilityZones,
        onePerAz: false,
        subnets: vpc.privateSubnets,
      },
    })

    const rdsCredential = rds.Credentials.fromGeneratedSecret('admin')
    new rds.DatabaseInstance(this, 'InstanceWithSecretLogin', {
      engine: rds.DatabaseInstanceEngine.MYSQL,
      vpc,
      allocatedStorage: 30,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(1),
      copyTagsToSnapshot: true,
      credentials: rdsCredential,
      deleteAutomatedBackups: true,
      deletionProtection: false,
      enablePerformanceInsights: false,
      iamAuthentication: false,
      instanceIdentifier: 'instance-identifier2',
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      maxAllocatedStorage: 100,
      multiAz: true,
      preferredBackupWindow: '17:00-17:30',
      preferredMaintenanceWindow: 'Tue:17:30-Tue:18:00',
      publiclyAccessible: false,
      removalPolicy: RemovalPolicy.DESTROY,
      securityGroups: [dbSG],
      storageEncrypted: true,
      storageType: rds.StorageType.GP2,
      subnetGroup,
    })
  }
}
