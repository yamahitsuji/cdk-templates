import {
  aws_stepfunctions,
  aws_stepfunctions_tasks,
  Stack,
  StackProps,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'

export class StepFunctionsAthenaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const startQueryExecutionJob =
      new aws_stepfunctions_tasks.AthenaStartQueryExecution(
        this,
        'Start Athena Query',
        {
          queryString: aws_stepfunctions.JsonPath.stringAt('$.queryString'),
          integrationPattern: aws_stepfunctions.IntegrationPattern.RUN_JOB,
          workGroup: 'primary',
          resultConfiguration: {
            outputLocation: {
              bucketName: 'query-results-bucket',
              objectKey: 'folder',
            },
          },
        }
      )

    const stateMachine = new aws_stepfunctions.StateMachine(
      this,
      'stateMachine',
      {
        stateMachineName: 'stateMachine',
        definition: startQueryExecutionJob,
      }
    )
  }
}
