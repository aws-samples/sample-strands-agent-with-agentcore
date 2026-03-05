/**
 * Research Agent A2A Runtime Stack
 * Deploys Research Agent as AgentCore Runtime using CodeBuild pattern
 * A2A Protocol compatible - exposes HTTP endpoints via AgentCore Runtime
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
    // Step 1: ECR Repository for Research Agent
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
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          emptyOnDelete: true,
          imageScanOnPush: true,
          lifecycleRules: [
            {
              description: 'Keep last 10 images',
              maxImageCount: 10,
            },
          ],
        })

    // Artifact bucket name — shared with AgentRuntimeStack
    // Read from SSM if available (handles both old 'chatbot-docs' and new 'chatbot-artifact' buckets)
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

    // Bedrock Model Access (for research agent's LLM calls)
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

    // Code Interpreter Access (for chart generation)
    // Same permissions as main chatbot agent
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

    // S3 Access for Source and Artifact Storage
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3BucketAccess',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::${projectName}-research-src-${this.account}-${this.region}`,
          `arn:aws:s3:::${projectName}-research-src-${this.account}-${this.region}/*`,
          `arn:aws:s3:::${artifactBucketName}`,
          `arn:aws:s3:::${artifactBucketName}/*`,
        ],
      })
    )

    // ============================================================
    // Step 3: S3 Bucket for CodeBuild Source
    // ============================================================
    const sourceBucket = new s3.Bucket(this, 'ResearchAgentSourceBucket', {
      bucketName: `${projectName}-research-src-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          id: 'DeleteOldSources',
        },
      ],
    })

    // ============================================================
    // Step 4: CodeBuild Project
    // ============================================================
    const codeBuildRole = new iam.Role(this, 'ResearchAgentCodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for Research Agent container',
    })

    // ECR Permissions
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

    // CloudWatch Logs
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
        ],
      })
    )

    // S3 Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
      })
    )

    const buildProject = new codebuild.Project(this, 'ResearchAgentBuildProject', {
      projectName: `${projectName}-research-agent-builder`,
      description: 'Builds ARM64 container image for Research Agent A2A Runtime',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'research-agent-source/',
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
              'echo Building Research Agent Docker image for ARM64...',
              'docker build --platform linux/arm64 -t research-agent:latest .',
              `docker tag research-agent:latest ${repository.repositoryUri}:latest`,
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
    const agentSourcePath = '..'  // Parent directory (research-agent/)
    const agentSourceUpload = new s3deploy.BucketDeployment(this, 'ResearchAgentSourceUpload', {
      sources: [
        s3deploy.Source.asset(agentSourcePath, {
          exclude: [
            'venv/**',
            '.venv/**',
            '__pycache__/**',
            '*.pyc',
            '.git/**',
            'node_modules/**',
            '.DS_Store',
            '*.log',
            'cdk/**',
            'cdk.out/**',
          ],
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'research-agent-source/',
      prune: false,
      retainOnDelete: false,
    })

    // ============================================================
    // Step 6: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerResearchAgentCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`research-agent-build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`research-agent-build-${Date.now()}`),
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
    const buildWaiterFunction = new lambda.Function(this, 'ResearchAgentBuildWaiter', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { CodeBuildClient, BatchGetBuildsCommand } = require('@aws-sdk/client-codebuild');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', { Status: 'DELETED' });
  }

  const buildId = event.ResourceProperties.BuildId;
  const maxWaitMinutes = 14;
  const pollIntervalSeconds = 30;

  console.log('Waiting for build:', buildId);

  const client = new CodeBuildClient({});
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = response.builds[0];
      const status = build.buildStatus;

      console.log(\`Build status: \${status}\`);

      if (status === 'SUCCEEDED') {
        return await sendResponse(event, 'SUCCESS', { Status: 'SUCCEEDED' });
      } else if (['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED'].includes(status)) {
        return await sendResponse(event, 'FAILED', {}, \`Build failed with status: \${status}\`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));

    } catch (error) {
      console.error('Error:', error);
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

  console.log('Response:', responseBody);

  const https = require('https');
  const url = require('url');
  const parsedUrl = url.parse(event.ResponseURL);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length
      }
    };

    const request = https.request(options, (response) => {
      console.log(\`Status: \${response.statusCode}\`);
      resolve(data);
    });

    request.on('error', (error) => {
      console.error('Error:', error);
      reject(error);
    });

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

    const buildWaiter = new cdk.CustomResource(this, 'ResearchAgentBuildWaiterResource', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    })

    buildWaiter.node.addDependency(buildTrigger)

    // ============================================================
    // Step 8: Create AgentCore Runtime
    // ============================================================
    const runtimeName = projectName.replace(/-/g, '_') + '_research_agent_runtime'
    const runtime = new agentcore.CfnRuntime(this, 'ResearchAgentRuntime', {
      agentRuntimeName: runtimeName,
      description: 'Research Agent A2A Runtime - Web research and report generation',
      roleArn: executionRole.roleArn,

      // Container configuration
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },

      // Network configuration - PUBLIC for internet access (web search, Wikipedia)
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      // Protocol configuration - A2A protocol (Strands A2A Server)
      protocolConfiguration: 'A2A',

      // Environment variables
      environmentVariables: {
        LOG_LEVEL: 'INFO',
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        AWS_DEFAULT_REGION: this.region,
        AWS_REGION: this.region,
        ARTIFACT_BUCKET: artifactBucketName,
        // Workaround for OTEL botocore instrumentation bug (fixed in next ADOT release)
        // See: https://sim.amazon.com/issues/apm-telegen-2758
        OTEL_PYTHON_DISABLED_INSTRUMENTATIONS: 'boto,botocore',
      },

      tags: {
        Environment: environment,
        Application: `${projectName}-research-agent`,
        Type: 'A2A-Agent',
      },
    })

    // Ensure Runtime is created after build completes
    runtime.node.addDependency(executionRole)
    runtime.node.addDependency(buildWaiter)

    // Store the runtime reference
    this.runtime = runtime
    this.runtimeArn = runtime.attrAgentRuntimeArn

    // ============================================================
    // Step 9: Store Runtime Information in Parameter Store
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

    // Note: AgentCore Runtime does not expose direct HTTP URLs
    // Main agent will need to invoke via InvokeAgentRuntime SDK call using the ARN

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
