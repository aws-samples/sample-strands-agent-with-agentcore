/**
 * MCP 3LO Runtime Stack
 * Deploys MCP Server with 3LO OAuth as AgentCore Runtime using CodeBuild pattern.
 * MCP Protocol - exposes Gmail (and future 3LO services) tools via AgentCore Runtime.
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

export interface Mcp3loRuntimeStackProps extends cdk.StackProps {
  projectName?: string
  environment?: string
  cognitoUserPoolId?: string
  cognitoClientId?: string
}

export class Mcp3loRuntimeStack extends cdk.Stack {
  public readonly runtime: agentcore.CfnRuntime
  public readonly runtimeArn: string

  constructor(scope: Construct, id: string, props?: Mcp3loRuntimeStackProps) {
    super(scope, id, props)

    const projectName = props?.projectName || 'strands-agent-chatbot'
    const environment = props?.environment || 'dev'

    // Unique build tag to force Runtime to pull new image on each deployment
    const buildTag = Date.now().toString()

    // Cognito configuration for JWT inbound auth (required for 3LO user identity)
    const cognitoUserPoolId = props?.cognitoUserPoolId || process.env.COGNITO_USER_POOL_ID || ''
    const cognitoClientId = props?.cognitoClientId || process.env.COGNITO_CLIENT_ID || ''

    // ============================================================
    // Step 1: ECR Repository (always import — created by deploy.sh)
    // ============================================================
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'Mcp3loRepository',
      `${projectName}-mcp-3lo-server`
    )

    // ============================================================
    // Step 2: IAM Execution Role for AgentCore Runtime
    // ============================================================
    const executionRole = new iam.Role(this, 'Mcp3loExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for MCP 3LO Server AgentCore Runtime',
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

    // OAuth outbound auth permissions
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'OAuthIdentityAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetResourceOauth2Token',
          'bedrock-agentcore:CreateWorkloadIdentity',
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
        ],
        resources: ['*'],
      })
    )

    // Secrets Manager (for OAuth credential provider secrets)
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerAccess',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
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

    // ============================================================
    // Step 3: S3 Bucket for CodeBuild Source
    // ============================================================
    const sourceBucket = new s3.Bucket(this, 'Mcp3loSourceBucket', {
      bucketName: `${projectName}-mcp3lo-src-${this.account}-${this.region}`,
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
    const codeBuildRole = new iam.Role(this, 'Mcp3loCodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for MCP 3LO Server container',
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

    const buildProject = new codebuild.Project(this, 'Mcp3loBuildProject', {
      projectName: `${projectName}-mcp-3lo-builder`,
      description: 'Builds ARM64 container image for MCP 3LO Server Runtime',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'mcp-3lo-source/',
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
              'echo Building MCP 3LO Server Docker image for ARM64...',
              'docker build --platform linux/arm64 -t mcp-3lo-server:latest .',
              `docker tag mcp-3lo-server:latest ${repository.repositoryUri}:latest`,
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
    const agentSourcePath = '..'
    const agentSourceUpload = new s3deploy.BucketDeployment(this, 'Mcp3loSourceUpload', {
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
      destinationKeyPrefix: 'mcp-3lo-source/',
      prune: false,
      retainOnDelete: false,
    })

    // ============================================================
    // Step 6: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerMcp3loCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`mcp-3lo-build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`mcp-3lo-build-${Date.now()}`),
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
    const buildWaiterFunction = new lambda.Function(this, 'Mcp3loBuildWaiter', {
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

    const buildWaiter = new cdk.CustomResource(this, 'Mcp3loBuildWaiterResource', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    })

    buildWaiter.node.addDependency(buildTrigger)

    // ============================================================
    // Step 8: Create AgentCore Runtime (MCP Protocol)
    // ============================================================
    const runtimeName = projectName.replace(/-/g, '_') + '_mcp_3lo_runtime'
    const runtime = new agentcore.CfnRuntime(this, 'Mcp3loRuntime', {
      agentRuntimeName: runtimeName,
      description: 'MCP 3LO Server Runtime - Gmail and external OAuth service tools',
      roleArn: executionRole.roleArn,

      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${repository.repositoryUri}:latest`,
        },
      },

      networkConfiguration: {
        networkMode: 'PUBLIC',
      },

      protocolConfiguration: 'MCP',

      // JWT inbound auth - Cognito validates user identity for 3LO OAuth flows
      // Note: Only allowedAudience is used (validates 'aud' claim in id_token)
      // allowedClients is NOT used because Cognito id_token doesn't have 'client_id' claim
      ...(cognitoUserPoolId && cognitoClientId ? {
        authorizerConfiguration: {
          customJwtAuthorizer: {
            discoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${cognitoUserPoolId}/.well-known/openid-configuration`,
            allowedAudience: [cognitoClientId],
          },
        },
      } : {}),

      environmentVariables: {
        LOG_LEVEL: 'INFO',
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        AWS_DEFAULT_REGION: this.region,
        AWS_REGION: this.region,
        OTEL_PYTHON_DISABLED_INSTRUMENTATIONS: 'boto,botocore',
        // Build timestamp to force Runtime update on each deployment
        BUILD_TIMESTAMP: new Date().toISOString(),
      },

      tags: {
        Environment: environment,
        Application: `${projectName}-mcp-3lo-server`,
        Type: 'MCP-3LO-Server',
      },
    })

    runtime.node.addDependency(executionRole)
    runtime.node.addDependency(buildWaiter)

    this.runtime = runtime
    this.runtimeArn = runtime.attrAgentRuntimeArn

    // ============================================================
    // Step 9: Store Runtime Information in Parameter Store
    // ============================================================
    new ssm.StringParameter(this, 'Mcp3loRuntimeArnParameter', {
      parameterName: `/${projectName}/${environment}/mcp/mcp-3lo-runtime-arn`,
      stringValue: runtime.attrAgentRuntimeArn,
      description: 'MCP 3LO Server AgentCore Runtime ARN',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'Mcp3loRuntimeIdParameter', {
      parameterName: `/${projectName}/${environment}/mcp/mcp-3lo-runtime-id`,
      stringValue: runtime.attrAgentRuntimeId,
      description: 'MCP 3LO Server AgentCore Runtime ID',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'RepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for MCP 3LO Server container',
      exportName: `${projectName}-mcp-3lo-repo-uri`,
    })

    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: runtime.attrAgentRuntimeArn,
      description: 'MCP 3LO Server AgentCore Runtime ARN',
      exportName: `${projectName}-mcp-3lo-runtime-arn`,
    })

    new cdk.CfnOutput(this, 'RuntimeId', {
      value: runtime.attrAgentRuntimeId,
      description: 'MCP 3LO Server AgentCore Runtime ID',
      exportName: `${projectName}-mcp-3lo-runtime-id`,
    })

    new cdk.CfnOutput(this, 'ParameterStorePrefix', {
      value: `/${projectName}/${environment}/mcp`,
      description: 'Parameter Store prefix for MCP 3LO Server configuration',
    })
  }
}
