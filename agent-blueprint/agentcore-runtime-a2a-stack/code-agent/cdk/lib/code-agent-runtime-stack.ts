/**
 * Code Agent A2A Runtime Stack
 * Deploys Code Agent (Claude Agent SDK wrapper) as AgentCore A2A Runtime
 * Based on research-agent pattern - no S3 chart bucket or Code Interpreter needed
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'

export interface CodeAgentRuntimeStackProps extends cdk.StackProps {
  projectName?: string
  environment?: string
  anthropicModel?: string
}

export class CodeAgentRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly runtimeArn: string

  constructor(scope: Construct, id: string, props?: CodeAgentRuntimeStackProps) {
    super(scope, id, props)

    const projectName = props?.projectName || 'strands-agent-chatbot'
    const environment = props?.environment || 'dev'
    const anthropicModel = props?.anthropicModel || 'us.anthropic.claude-sonnet-4-6'

    // ============================================================
    // Step 1: ECR Repository
    // ============================================================
    const useExistingEcr = process.env.USE_EXISTING_ECR === 'true'
    const repository = useExistingEcr
      ? ecr.Repository.fromRepositoryName(
          this,
          'CodeAgentRepository',
          `${projectName}-code-agent`
        )
      : new ecr.Repository(this, 'CodeAgentRepository', {
          repositoryName: `${projectName}-code-agent`,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          imageScanOnPush: true,
          lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
        })

    // ============================================================
    // Step 2: IAM Execution Role
    // ============================================================
    const executionRole = new iam.Role(this, 'CodeAgentExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for Code Agent AgentCore Runtime',
    })

    // ECR Access
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRImageAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:GetAuthorizationToken'],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`, '*'],
      })
    )

    // CloudWatch Logs
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

    // X-Ray and CloudWatch Metrics
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

    // Bedrock Model Access (Claude Agent SDK calls Bedrock via IAM role)
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

    // Parameter Store (for configuration)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
        ],
      })
    )

    // S3 Document Bucket Access (read uploaded files + write workspace output)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3DocumentBucketAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [
          `arn:aws:s3:::${projectName}-*`,
          `arn:aws:s3:::${projectName}-*/*`,
        ],
      })
    )

    // Import document bucket name from main AgentCore Runtime stack export
    const documentBucketName = cdk.Fn.importValue(`${projectName}-document-bucket`)

    // ============================================================
    // Step 3: S3 Bucket for CodeBuild Source
    // ============================================================
    const sourceBucket = new s3.Bucket(this, 'CodeAgentSourceBucket', {
      bucketName: `${projectName}-code-agent-src-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7), id: 'DeleteOldSources' }],
    })

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3SourceAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
      })
    )

    // ============================================================
    // Step 4: CodeBuild Project
    // ============================================================
    const codeBuildRole = new iam.Role(this, 'CodeAgentCodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for Code Agent container',
    })

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: [
          '*',
          `arn:aws:ecr:${this.region}:${this.account}:repository/${repository.repositoryName}`,
        ],
      })
    )

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
        ],
      })
    )

    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
      })
    )

    const buildProject = new codebuild.Project(this, 'CodeAgentBuildProject', {
      projectName: `${projectName}-code-agent-builder`,
      description: 'Builds ARM64 container image for Code Agent A2A Runtime',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'code-agent-source/',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              'echo Building Code Agent Docker image for ARM64...',
              'docker build --platform linux/arm64 -t code-agent:latest .',
              `docker tag code-agent:latest ${repository.repositoryUri}:latest`,
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image to ECR...',
              `docker push ${repository.repositoryUri}:latest`,
              'echo Build completed successfully',
            ],
          },
        },
      }),
    })

    // ============================================================
    // Step 5: Upload Source to S3
    // ============================================================
    const agentSourceUpload = new s3deploy.BucketDeployment(this, 'CodeAgentSourceUpload', {
      sources: [
        s3deploy.Source.asset('..', {
          exclude: [
            'venv/**', '.venv/**', '__pycache__/**', '*.pyc',
            '.git/**', 'node_modules/**', '.DS_Store', '*.log',
            'cdk/**', 'cdk.out/**',
          ],
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'code-agent-source/',
      prune: false,
      retainOnDelete: false,
    })

    // ============================================================
    // Step 6: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerCodeAgentCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`code-agent-build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: { projectName: buildProject.projectName },
        physicalResourceId: cr.PhysicalResourceId.of(`code-agent-build-${Date.now()}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
          resources: [buildProject.projectArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(5),
    })

    buildTrigger.node.addDependency(agentSourceUpload)

    // ============================================================
    // Step 7: Wait for Build Completion
    // ============================================================
    const buildWaiterFunction = new lambda.Function(this, 'CodeAgentBuildWaiter', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { CodeBuildClient, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', { Status: 'DELETED' });
  }

  const buildId = event.ResourceProperties.BuildId;
  const maxWaitMinutes = 14;
  const pollIntervalSeconds = 30;
  const client = new CodeBuildClient({});
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = response.builds[0];
      const status = build.buildStatus;

      if (status === 'SUCCEEDED') {
        return await sendResponse(event, 'SUCCESS', { Status: 'SUCCEEDED' });
      } else if (['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'].includes(status)) {
        return await sendResponse(event, 'FAILED', {}, \`Build failed: \${status}\`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    } catch (error) {
      return await sendResponse(event, 'FAILED', {}, error.message);
    }
  }

  return await sendResponse(event, 'FAILED', {}, \`Build timeout after \${maxWaitMinutes} minutes\`);
};

async function sendResponse(event, status, data, reason) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason || \`See CloudWatch Log Stream: \${event.LogStreamName}\`,
    PhysicalResourceId: event.PhysicalResourceId || event.RequestId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  const https = require('https');
  const url = require('url');
  const parsedUrl = url.parse(event.ResponseURL);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: { 'Content-Type': '', 'Content-Length': responseBody.length }
    };
    const request = https.request(options, (response) => { resolve(data); });
    request.on('error', (error) => { reject(error); });
    request.write(responseBody);
    request.end();
  });
}
      `),
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
    })

    buildWaiterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:BatchGetBuilds'],
        resources: [buildProject.projectArn],
      })
    )

    const buildWaiter = new cdk.CustomResource(this, 'CodeAgentBuildWaiterResource', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: { BuildId: buildTrigger.getResponseField('build.id') },
    })

    buildWaiter.node.addDependency(buildTrigger)

    // ============================================================
    // Step 8: Create AgentCore Runtime (A2A protocol)
    // ============================================================
    const runtimeName = projectName.replace(/-/g, '_') + '_code_agent_runtime'
    const runtime = new agentcore.CfnRuntime(this, 'CodeAgentRuntime', {
      agentRuntimeName: runtimeName,
      description: 'Code Agent A2A Runtime - Autonomous coding with Claude Agent SDK',
      roleArn: executionRole.roleArn,

      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },

      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      // A2A protocol (same as research-agent)
      protocolConfiguration: 'A2A',

      environmentVariables: {
        LOG_LEVEL: 'INFO',
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        AWS_DEFAULT_REGION: this.region,
        AWS_REGION: this.region,
        // Claude Agent SDK Bedrock authentication
        CLAUDE_CODE_USE_BEDROCK: '1',
        ANTHROPIC_MODEL: anthropicModel,
        OTEL_PYTHON_DISABLED_INSTRUMENTATIONS: 'boto,botocore',
        // S3 bucket for syncing workspace output after each task
        DOCUMENT_BUCKET: documentBucketName,
        // Forces CloudFormation to detect a change on every deploy,
        // so the Runtime pulls the latest image from ECR each time.
        BUILD_TIMESTAMP: new Date().toISOString(),
      },

      tags: {
        Environment: environment,
        Application: `${projectName}-code-agent`,
        Type: 'A2A-Agent',
      },
    })

    runtime.node.addDependency(executionRole)
    runtime.node.addDependency(buildWaiter)

    this.runtime = runtime
    this.runtimeArn = runtime.attrAgentRuntimeArn

    // ============================================================
    // Step 9: Store Runtime ARN in Parameter Store
    // ============================================================
    new ssm.StringParameter(this, 'CodeAgentRuntimeArnParameter', {
      parameterName: `/${projectName}/${environment}/a2a/code-agent-runtime-arn`,
      stringValue: runtime.attrAgentRuntimeArn,
      description: 'Code Agent AgentCore Runtime ARN',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'CodeAgentRuntimeIdParameter', {
      parameterName: `/${projectName}/${environment}/a2a/code-agent-runtime-id`,
      stringValue: runtime.attrAgentRuntimeId,
      description: 'Code Agent AgentCore Runtime ID',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for Code Agent container',
      exportName: `${projectName}-code-agent-repo-uri`,
    })

    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: runtime.attrAgentRuntimeArn,
      description: 'Code Agent AgentCore Runtime ARN',
      exportName: `${projectName}-code-agent-runtime-arn`,
    })

    new cdk.CfnOutput(this, 'RuntimeId', {
      value: runtime.attrAgentRuntimeId,
      description: 'Code Agent AgentCore Runtime ID',
      exportName: `${projectName}-code-agent-runtime-id`,
    })
  }
}
