/**
 * Research Agent A2A Runtime Stack
 * Deploys Research Agent as AgentCore Runtime.
 * Docker image is built and pushed by deploy.sh before CDK deploy.
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

export interface ResearchAgentRuntimeStackProps extends cdk.StackProps {
  projectName?: string
  environment?: string
}

export class ResearchAgentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly runtimeArn: string

  constructor(scope: Construct, id: string, props?: ResearchAgentRuntimeStackProps) {
    super(scope, id, props)

    const projectName = props?.projectName || 'strands-agent-chatbot'
    const environment = props?.environment || 'dev'

    // ============================================================
    // Step 1: ECR Repository (created by deploy.sh, imported here)
    // ============================================================
    const useExistingEcr = process.env.USE_EXISTING_ECR === 'true'
    const repository = useExistingEcr
      ? ecr.Repository.fromRepositoryName(
          this,
          'ResearchAgentRepository',
          `${projectName}-research-agent`
        )
      : new ecr.Repository(this, 'ResearchAgentRepository', {
          repositoryName: `${projectName}-research-agent`,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          imageScanOnPush: true,
          lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        })

    // Artifact bucket name — shared with AgentRuntimeStack
    const artifactBucketSsmValue = ssm.StringParameter.valueFromLookup(
      this,
      `/${projectName}/${environment}/agentcore/artifact-bucket`
    )
    const artifactBucketName = artifactBucketSsmValue.startsWith('dummy-value-for-')
      ? `${projectName}-artifact-${this.account}-${this.region}`
      : artifactBucketSsmValue

    // ============================================================
    // Step 2: IAM Execution Role for AgentCore Runtime
    // ============================================================
    const executionRole = new iam.Role(this, 'ResearchAgentExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for Research Agent AgentCore Runtime',
    })

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRImageAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:GetAuthorizationToken'],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`, '*'],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelInvocation',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:${this.region}:${this.account}:*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CodeInterpreterAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:CreateCodeInterpreter',
          'bedrock-agentcore:StartCodeInterpreterSession',
          'bedrock-agentcore:InvokeCodeInterpreter',
          'bedrock-agentcore:StopCodeInterpreterSession',
          'bedrock-agentcore:DeleteCodeInterpreter',
          'bedrock-agentcore:ListCodeInterpreters',
          'bedrock-agentcore:GetCodeInterpreter',
          'bedrock-agentcore:GetCodeInterpreterSession',
          'bedrock-agentcore:ListCodeInterpreterSessions',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:*:aws:code-interpreter/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:code-interpreter/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:code-interpreter-custom/*`,
        ],
      })
    )

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3BucketAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::${artifactBucketName}`,
          `arn:aws:s3:::${artifactBucketName}/*`,
        ],
      })
    )

    // ============================================================
    // Step 3: Create AgentCore Runtime
    // ============================================================
    const runtimeName = projectName.replace(/-/g, '_') + '_research_agent_runtime'
    const runtime = new agentcore.CfnRuntime(this, 'ResearchAgentRuntime', {
      agentRuntimeName: runtimeName,
      description: 'Research Agent A2A Runtime - Web research and report generation',
      roleArn: executionRole.roleArn,

      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },

      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      protocolConfiguration: 'A2A',

      environmentVariables: {
        LOG_LEVEL: 'INFO',
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        AWS_DEFAULT_REGION: this.region,
        AWS_REGION: this.region,
        ARTIFACT_BUCKET: artifactBucketName,
        OTEL_PYTHON_DISABLED_INSTRUMENTATIONS: 'boto,botocore',
      },

      tags: {
        Environment: environment,
        Application: `${projectName}-research-agent`,
        Type: 'A2A-Agent',
      },
    })

    runtime.node.addDependency(executionRole)

    this.runtime = runtime
    this.runtimeArn = runtime.attrAgentRuntimeArn

    // ============================================================
    // Step 4: Store Runtime Information in Parameter Store
    // ============================================================
    new ssm.StringParameter(this, 'ResearchAgentRuntimeArnParameter', {
      parameterName: `/${projectName}/${environment}/a2a/research-agent-runtime-arn`,
      stringValue: runtime.attrAgentRuntimeArn,
      description: 'Research Agent AgentCore Runtime ARN',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'ResearchAgentRuntimeIdParameter', {
      parameterName: `/${projectName}/${environment}/a2a/research-agent-runtime-id`,
      stringValue: runtime.attrAgentRuntimeId,
      description: 'Research Agent AgentCore Runtime ID',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for Research Agent container',
      exportName: `${projectName}-research-agent-repo-uri`,
    })

    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: runtime.attrAgentRuntimeArn,
      description: 'Research Agent AgentCore Runtime ARN',
      exportName: `${projectName}-research-agent-runtime-arn`,
    })

    new cdk.CfnOutput(this, 'RuntimeId', {
      value: runtime.attrAgentRuntimeId,
      description: 'Research Agent AgentCore Runtime ID',
      exportName: `${projectName}-research-agent-runtime-id`,
    })

    new cdk.CfnOutput(this, 'ParameterStorePrefix', {
      value: `/${projectName}/${environment}/a2a`,
      description: 'Parameter Store prefix for Research Agent configuration',
    })

    new cdk.CfnOutput(this, 'IntegrationNote', {
      value: 'Main agent can invoke Research Agent via InvokeAgentRuntime API using the Runtime ARN',
      description: 'Integration Information',
    })
  }
}
