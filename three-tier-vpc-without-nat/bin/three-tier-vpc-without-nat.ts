#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { ThreeTierVpcWithoutNatStack } from '../lib/three-tier-vpc-without-nat-stack'

const app = new cdk.App()
new ThreeTierVpcWithoutNatStack(app, 'ThreeTierVpcWithoutNatStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})
