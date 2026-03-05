"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mcp3loRuntimeStack = void 0;
/**
 * MCP 3LO Runtime Stack
 * Deploys MCP Server with 3LO OAuth as AgentCore Runtime using CodeBuild pattern.
 * MCP Protocol - exposes Gmail (and future 3LO services) tools via AgentCore Runtime.
 */
const cdk = require("aws-cdk-lib");
const agentcore = require("aws-cdk-lib/aws-bedrockagentcore");
const ecr = require("aws-cdk-lib/aws-ecr");
const iam = require("aws-cdk-lib/aws-iam");
const ssm = require("aws-cdk-lib/aws-ssm");
const s3 = require("aws-cdk-lib/aws-s3");
const s3deploy = require("aws-cdk-lib/aws-s3-deployment");
const codebuild = require("aws-cdk-lib/aws-codebuild");
const cr = require("aws-cdk-lib/custom-resources");
const lambda = require("aws-cdk-lib/aws-lambda");
class Mcp3loRuntimeStack extends cdk.Stack {
    runtime;
    runtimeArn;
    constructor(scope, id, props) {
        super(scope, id, props);
        const projectName = props?.projectName || 'strands-agent-chatbot';
        const environment = props?.environment || 'dev';
        // Unique build tag to force Runtime to pull new image on each deployment
        const buildTag = Date.now().toString();
        // Cognito configuration for JWT inbound auth (required for 3LO user identity)
        const cognitoUserPoolId = props?.cognitoUserPoolId || process.env.COGNITO_USER_POOL_ID || '';
        const cognitoClientId = props?.cognitoClientId || process.env.COGNITO_CLIENT_ID || '';
        // ============================================================
        // Step 1: ECR Repository
        // ============================================================
        const useExistingEcr = process.env.USE_EXISTING_ECR === 'true';
        const repository = useExistingEcr
            ? ecr.Repository.fromRepositoryName(this, 'Mcp3loRepository', `${projectName}-mcp-3lo-server`)
            : new ecr.Repository(this, 'Mcp3loRepository', {
                repositoryName: `${projectName}-mcp-3lo-server`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                emptyOnDelete: true,
                imageScanOnPush: true,
                lifecycleRules: [
                    {
                        description: 'Keep last 10 images',
                        maxImageCount: 10,
                    },
                ],
            });
        // ============================================================
        // Step 2: IAM Execution Role for AgentCore Runtime
        // ============================================================
        const executionRole = new iam.Role(this, 'Mcp3loExecutionRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'Execution role for MCP 3LO Server AgentCore Runtime',
        });
        // ECR Access
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'ECRImageAccess',
            effect: iam.Effect.ALLOW,
            actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:GetAuthorizationToken'],
            resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/*`, '*'],
        }));
        // CloudWatch Logs
        executionRole.addToPolicy(new iam.PolicyStatement({
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
        }));
        // X-Ray and CloudWatch Metrics
        executionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'cloudwatch:PutMetricData',
            ],
            resources: ['*'],
        }));
        // OAuth outbound auth permissions
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'OAuthIdentityAccess',
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:GetResourceOauth2Token',
                'bedrock-agentcore:CreateWorkloadIdentity',
                'bedrock-agentcore:GetWorkloadAccessToken',
                'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
            ],
            resources: ['*'],
        }));
        // Secrets Manager (for OAuth credential provider secrets)
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'SecretsManagerAccess',
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
            ],
        }));
        // Parameter Store (for configuration)
        executionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
            ],
        }));
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
        });
        // ============================================================
        // Step 4: CodeBuild Project
        // ============================================================
        const codeBuildRole = new iam.Role(this, 'Mcp3loCodeBuildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            description: 'Build role for MCP 3LO Server container',
        });
        codeBuildRole.addToPolicy(new iam.PolicyStatement({
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
        }));
        codeBuildRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
            ],
        }));
        codeBuildRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
            resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
        }));
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
        });
        // ============================================================
        // Step 5: Upload Source to S3
        // ============================================================
        const agentSourcePath = '..';
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
        });
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
        });
        buildTrigger.node.addDependency(agentSourceUpload);
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
        });
        buildWaiterFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [buildProject.projectArn],
        }));
        const buildWaiter = new cdk.CustomResource(this, 'Mcp3loBuildWaiterResource', {
            serviceToken: buildWaiterFunction.functionArn,
            properties: {
                BuildId: buildTrigger.getResponseField('build.id'),
            },
        });
        buildWaiter.node.addDependency(buildTrigger);
        // ============================================================
        // Step 8: Create AgentCore Runtime (MCP Protocol)
        // ============================================================
        const runtimeName = projectName.replace(/-/g, '_') + '_mcp_3lo_runtime';
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
        });
        runtime.node.addDependency(executionRole);
        runtime.node.addDependency(buildWaiter);
        this.runtime = runtime;
        this.runtimeArn = runtime.attrAgentRuntimeArn;
        // ============================================================
        // Step 9: Store Runtime Information in Parameter Store
        // ============================================================
        new ssm.StringParameter(this, 'Mcp3loRuntimeArnParameter', {
            parameterName: `/${projectName}/${environment}/mcp/mcp-3lo-runtime-arn`,
            stringValue: runtime.attrAgentRuntimeArn,
            description: 'MCP 3LO Server AgentCore Runtime ARN',
            tier: ssm.ParameterTier.STANDARD,
        });
        new ssm.StringParameter(this, 'Mcp3loRuntimeIdParameter', {
            parameterName: `/${projectName}/${environment}/mcp/mcp-3lo-runtime-id`,
            stringValue: runtime.attrAgentRuntimeId,
            description: 'MCP 3LO Server AgentCore Runtime ID',
            tier: ssm.ParameterTier.STANDARD,
        });
        // ============================================================
        // Outputs
        // ============================================================
        new cdk.CfnOutput(this, 'RepositoryUri', {
            value: repository.repositoryUri,
            description: 'ECR Repository URI for MCP 3LO Server container',
            exportName: `${projectName}-mcp-3lo-repo-uri`,
        });
        new cdk.CfnOutput(this, 'RuntimeArn', {
            value: runtime.attrAgentRuntimeArn,
            description: 'MCP 3LO Server AgentCore Runtime ARN',
            exportName: `${projectName}-mcp-3lo-runtime-arn`,
        });
        new cdk.CfnOutput(this, 'RuntimeId', {
            value: runtime.attrAgentRuntimeId,
            description: 'MCP 3LO Server AgentCore Runtime ID',
            exportName: `${projectName}-mcp-3lo-runtime-id`,
        });
        new cdk.CfnOutput(this, 'ParameterStorePrefix', {
            value: `/${projectName}/${environment}/mcp`,
            description: 'Parameter Store prefix for MCP 3LO Server configuration',
        });
    }
}
exports.Mcp3loRuntimeStack = Mcp3loRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLTNsby1ydW50aW1lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibWNwLTNsby1ydW50aW1lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7O0dBSUc7QUFDSCxtQ0FBa0M7QUFDbEMsOERBQTZEO0FBQzdELDJDQUEwQztBQUMxQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywwREFBeUQ7QUFDekQsdURBQXNEO0FBQ3RELG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFVaEQsTUFBYSxrQkFBbUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMvQixPQUFPLENBQXNCO0lBQzdCLFVBQVUsQ0FBUTtJQUVsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksdUJBQXVCLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUE7UUFFL0MseUVBQXlFO1FBQ3pFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUV0Qyw4RUFBOEU7UUFDOUUsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLEVBQUUsaUJBQWlCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsSUFBSSxFQUFFLENBQUE7UUFDNUYsTUFBTSxlQUFlLEdBQUcsS0FBSyxFQUFFLGVBQWUsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLEVBQUUsQ0FBQTtRQUVyRiwrREFBK0Q7UUFDL0QseUJBQXlCO1FBQ3pCLCtEQUErRDtRQUMvRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixLQUFLLE1BQU0sQ0FBQTtRQUM5RCxN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ICogRGVwbG95cyBNQ1AgU2VydmVyIHdpdGggM0xPIE9BdXRoIGFzIEFnZW50Q29yZSBSdW50aW1lIHVzaW5nIENvZGVCdWlsZCBwYXR0ZXJuLlxuICogTUNQIFByb3RvY29sIC0gZXhwb3NlcyBHbWFpbCAoYW5kIGZ1dHVyZSAzTE8gc2VydmljZXMpIHRvb2xzIHZpYSBBZ2VudENvcmUgUnVudGltZS5cbiAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYWdlbnRjb3JlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1iZWRyb2NrYWdlbnRjb3JlJ1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnXG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCdcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWNwM2xvUnVudGltZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHByb2plY3ROYW1lPzogc3RyaW5nXG4gIGVudmlyb25tZW50Pzogc3RyaW5nXG4gIGNvZ25pdG9Vc2VyUG9vbElkPzogc3RyaW5nXG4gIGNvZ25pdG9DbGllbnRJZD86IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgTWNwM2xvUnVudGltZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHJ1bnRpbWU6IGFnZW50Y29yZS5DZm5SdW50aW1lXG4gIHB1YmxpYyByZWFkb25seSBydW50aW1lQXJuOiBzdHJpbmdcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IE1jcDNsb1J1bnRpbWVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcylcblxuICAgIGNvbnN0IHByb2plY3ROYW1lID0gcHJvcHM/LnByb2plY3ROYW1lIHx8ICdzdHJhbmRzLWFnZW50LWNoYXRib3QnXG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSBwcm9wcz8uZW52aXJvbm1lbnQgfHwgJ2RldidcblxuICAgIC8vIFVuaXF1ZSBidWlsZCB0YWcgdG8gZm9yY2UgUnVudGltZSB0byBwdWxsIG5ldyBpbWFnZSBvbiBlYWNoIGRlcGxveW1lbnRcbiAgICBjb25zdCBidWlsZFRhZyA9IERhdGUubm93KCkudG9TdHJpbmcoKVxuXG4gICAgLy8gQ29nbml0byBjb25maWd1cmF0aW9uIGZvciBKV1QgaW5ib3VuZCBhdXRoIChyZXF1aXJlZCBmb3IgM0xPIHVzZXIgaWRlbnRpdHkpXG4gICAgY29uc3QgY29nbml0b1VzZXJQb29sSWQgPSBwcm9wcz8uY29nbml0b1VzZXJQb29sSWQgfHwgcHJvY2Vzcy5lbnYuQ09HTklUT19VU0VSX1BPT0xfSUQgfHwgJydcbiAgICBjb25zdCBjb2duaXRvQ2xpZW50SWQgPSBwcm9wcz8uY29nbml0b0NsaWVudElkIHx8IHByb2Nlc3MuZW52LkNPR05JVE9fQ0xJRU5UX0lEIHx8ICcnXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDE6IEVDUiBSZXBvc2l0b3J5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgdXNlRXhpc3RpbmdFY3IgPSBwcm9jZXNzLmVudi5VU0VfRVhJU1RJTkdfRUNSID09PSAndHJ1ZSdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gdXNlRXhpc3RpbmdFY3JcbiAgICAgID8gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgJ01jcDNsb1JlcG9zaXRvcnknLFxuICAgICAgICAgIGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLXNlcnZlcmBcbiAgICAgICAgKVxuICAgICAgOiBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ01jcDNsb1JlcG9zaXRvcnknLCB7XG4gICAgICAgICAgcmVwb3NpdG9yeU5hbWU6IGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLXNlcnZlcmAsXG4gICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0tlZXAgbGFzdCAxMCBpbWFnZXMnLFxuICAgICAgICAgICAgICBtYXhJbWFnZUNvdW50OiAxMCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgMjogSUFNIEV4ZWN1dGlvbiBSb2xlIGZvciBBZ2VudENvcmUgUnVudGltZVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ01jcDNsb0V4ZWN1dGlvblJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdFeGVjdXRpb24gcm9sZSBmb3IgTUNQIDNMTyBTZXJ2ZXIgQWdlbnRDb3JlIFJ1bnRpbWUnLFxuICAgIH0pXG5cbiAgICAvLyBFQ1IgQWNjZXNzXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnRUNSSW1hZ2VBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLCAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czplY3I6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJlcG9zaXRvcnkvKmAsICcqJ10sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL3J1bnRpbWVzLypgLFxuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gWC1SYXkgYW5kIENsb3VkV2F0Y2ggTWV0cmljc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgICAgICdjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBPQXV0aCBvdXRib3VuZCBhdXRoIHBlcm1pc3Npb25zXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnT0F1dGhJZGVudGl0eUFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRSZXNvdXJjZU9hdXRoMlRva2VuJyxcbiAgICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6Q3JlYXRlV29ya2xvYWRJZGVudGl0eScsXG4gICAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFdvcmtsb2FkQWNjZXNzVG9rZW4nLFxuICAgICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRXb3JrbG9hZEFjY2Vzc1Rva2VuRm9yVXNlcklkJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIChmb3IgT0F1dGggY3JlZGVudGlhbCBwcm92aWRlciBzZWNyZXRzKVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ1NlY3JldHNNYW5hZ2VyQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnNlY3JldHNtYW5hZ2VyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzZWNyZXQ6KmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFBhcmFtZXRlciBTdG9yZSAoZm9yIGNvbmZpZ3VyYXRpb24pXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NzbTpHZXRQYXJhbWV0ZXInLCAnc3NtOkdldFBhcmFtZXRlcnMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIvJHtwcm9qZWN0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgMzogUzMgQnVja2V0IGZvciBDb2RlQnVpbGQgU291cmNlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3Qgc291cmNlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnTWNwM2xvU291cmNlQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYCR7cHJvamVjdE5hbWV9LW1jcDNsby1zcmMtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgICAgICBpZDogJ0RlbGV0ZU9sZFNvdXJjZXMnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA0OiBDb2RlQnVpbGQgUHJvamVjdFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGNvZGVCdWlsZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ01jcDNsb0NvZGVCdWlsZFJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgcm9sZSBmb3IgTUNQIDNMTyBTZXJ2ZXIgY29udGFpbmVyJyxcbiAgICB9KVxuXG4gICAgY29kZUJ1aWxkUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgICAgICAnZWNyOkJhdGNoR2V0SW1hZ2UnLFxuICAgICAgICAgICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsXG4gICAgICAgICAgJ2VjcjpQdXRJbWFnZScsXG4gICAgICAgICAgJ2VjcjpJbml0aWF0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgICAnZWNyOlVwbG9hZExheWVyUGFydCcsXG4gICAgICAgICAgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgJyonLFxuICAgICAgICAgIGBhcm46YXdzOmVjcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cmVwb3NpdG9yeS8ke3JlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWV9YCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29kZUJ1aWxkUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvY29kZWJ1aWxkLyR7cHJvamVjdE5hbWV9LSpgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0J10sXG4gICAgICAgIHJlc291cmNlczogW3NvdXJjZUJ1Y2tldC5idWNrZXRBcm4sIGAke3NvdXJjZUJ1Y2tldC5idWNrZXRBcm59LypgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29uc3QgYnVpbGRQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdNY3AzbG9CdWlsZFByb2plY3QnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogYCR7cHJvamVjdE5hbWV9LW1jcC0zbG8tYnVpbGRlcmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0J1aWxkcyBBUk02NCBjb250YWluZXIgaW1hZ2UgZm9yIE1DUCAzTE8gU2VydmVyIFJ1bnRpbWUnLFxuICAgICAgcm9sZTogY29kZUJ1aWxkUm9sZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfQVJNXzMsXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgc291cmNlOiBjb2RlYnVpbGQuU291cmNlLnMzKHtcbiAgICAgICAgYnVja2V0OiBzb3VyY2VCdWNrZXQsXG4gICAgICAgIHBhdGg6ICdtY3AtM2xvLXNvdXJjZS8nLFxuICAgICAgfSksXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gQW1hem9uIEVDUi4uLicsXG4gICAgICAgICAgICAgIGBhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAke3RoaXMucmVnaW9ufSB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICR7dGhpcy5hY2NvdW50fS5ka3IuZWNyLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZGluZyBNQ1AgM0xPIFNlcnZlciBEb2NrZXIgaW1hZ2UgZm9yIEFSTTY0Li4uJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBidWlsZCAtLXBsYXRmb3JtIGxpbnV4L2FybTY0IC10IG1jcC0zbG8tc2VydmVyOmxhdGVzdCAuJyxcbiAgICAgICAgICAgICAgYGRvY2tlciB0YWcgbWNwLTNsby1zZXJ2ZXI6bGF0ZXN0ICR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBvc3RfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIFB1c2hpbmcgRG9ja2VyIGltYWdlIHRvIEVDUi4uLicsXG4gICAgICAgICAgICAgIGBkb2NrZXIgcHVzaCAke3JlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YCxcbiAgICAgICAgICAgICAgJ2VjaG8gQnVpbGQgY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA1OiBVcGxvYWQgU291cmNlIHRvIFMzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYWdlbnRTb3VyY2VQYXRoID0gJy4uJ1xuICAgIGNvbnN0IGFnZW50U291cmNlVXBsb2FkID0gbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ01jcDNsb1NvdXJjZVVwbG9hZCcsIHtcbiAgICAgIHNvdXJjZXM6IFtcbiAgICAgICAgczNkZXBsb3kuU291cmNlLmFzc2V0KGFnZW50U291cmNlUGF0aCwge1xuICAgICAgICAgIGV4Y2x1ZGU6IFtcbiAgICAgICAgICAgICd2ZW52LyoqJyxcbiAgICAgICAgICAgICcudmVudi8qKicsXG4gICAgICAgICAgICAnX19weWNhY2hlX18vKionLFxuICAgICAgICAgICAgJyoucHljJyxcbiAgICAgICAgICAgICcuZ2l0LyoqJyxcbiAgICAgICAgICAgICdub2RlX21vZHVsZXMvKionLFxuICAgICAgICAgICAgJy5EU19TdG9yZScsXG4gICAgICAgICAgICAnKi5sb2cnLFxuICAgICAgICAgICAgJ2Nkay8qKicsXG4gICAgICAgICAgICAnY2RrLm91dC8qKicsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IHNvdXJjZUJ1Y2tldCxcbiAgICAgIGRlc3RpbmF0aW9uS2V5UHJlZml4OiAnbWNwLTNsby1zb3VyY2UvJyxcbiAgICAgIHBydW5lOiBmYWxzZSxcbiAgICAgIHJldGFpbk9uRGVsZXRlOiBmYWxzZSxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA2OiBUcmlnZ2VyIENvZGVCdWlsZFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGJ1aWxkVHJpZ2dlciA9IG5ldyBjci5Bd3NDdXN0b21SZXNvdXJjZSh0aGlzLCAnVHJpZ2dlck1jcDNsb0NvZGVCdWlsZCcsIHtcbiAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6ICdDb2RlQnVpbGQnLFxuICAgICAgICBhY3Rpb246ICdzdGFydEJ1aWxkJyxcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIHByb2plY3ROYW1lOiBidWlsZFByb2plY3QucHJvamVjdE5hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogY3IuUGh5c2ljYWxSZXNvdXJjZUlkLm9mKGBtY3AtM2xvLWJ1aWxkLSR7RGF0ZS5ub3coKX1gKSxcbiAgICAgIH0sXG4gICAgICBvblVwZGF0ZToge1xuICAgICAgICBzZXJ2aWNlOiAnQ29kZUJ1aWxkJyxcbiAgICAgICAgYWN0aW9uOiAnc3RhcnRCdWlsZCcsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBwcm9qZWN0TmFtZTogYnVpbGRQcm9qZWN0LnByb2plY3ROYW1lLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZihgbWNwLTNsby1idWlsZC0ke0RhdGUubm93KCl9YCksXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBjci5Bd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU3RhdGVtZW50cyhbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6U3RhcnRCdWlsZCcsICdjb2RlYnVpbGQ6QmF0Y2hHZXRCdWlsZHMnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtidWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICB9KVxuXG4gICAgYnVpbGRUcmlnZ2VyLm5vZGUuYWRkRGVwZW5kZW5jeShhZ2VudFNvdXJjZVVwbG9hZClcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNzogV2FpdCBmb3IgQnVpbGQgQ29tcGxldGlvblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGJ1aWxkV2FpdGVyRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdNY3AzbG9CdWlsZFdhaXRlcicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXG5jb25zdCB7IENvZGVCdWlsZENsaWVudCwgQmF0Y2hHZXRCdWlsZHNDb21tYW5kIH0gPSByZXF1aXJlKCdAYXdzLXNkay9jbGllbnQtY29kZWJ1aWxkJyk7XG5cbmV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xuICBjb25zb2xlLmxvZygnRXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcblxuICBpZiAoZXZlbnQuUmVxdWVzdFR5cGUgPT09ICdEZWxldGUnKSB7XG4gICAgcmV0dXJuIHNlbmRSZXNwb25zZShldmVudCwgJ1NVQ0NFU1MnLCB7IFN0YXR1czogJ0RFTEVURUQnIH0pO1xuICB9XG5cbiAgY29uc3QgYnVpbGRJZCA9IGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5CdWlsZElkO1xuICBjb25zdCBtYXhXYWl0TWludXRlcyA9IDE0O1xuICBjb25zdCBwb2xsSW50ZXJ2YWxTZWNvbmRzID0gMzA7XG5cbiAgY29uc29sZS5sb2coJ1dhaXRpbmcgZm9yIGJ1aWxkOicsIGJ1aWxkSWQpO1xuXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBDb2RlQnVpbGRDbGllbnQoe30pO1xuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICBjb25zdCBtYXhXYWl0TXMgPSBtYXhXYWl0TWludXRlcyAqIDYwICogMTAwMDtcblxuICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IG1heFdhaXRNcykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNsaWVudC5zZW5kKG5ldyBCYXRjaEdldEJ1aWxkc0NvbW1hbmQoeyBpZHM6IFtidWlsZElkXSB9KSk7XG4gICAgICBjb25zdCBidWlsZCA9IHJlc3BvbnNlLmJ1aWxkc1swXTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGJ1aWxkLmJ1aWxkU3RhdHVzO1xuXG4gICAgICBjb25zb2xlLmxvZyhcXGBCdWlsZCBzdGF0dXM6IFxcJHtzdGF0dXN9XFxgKTtcblxuICAgICAgaWYgKHN0YXR1cyA9PT0gJ1NVQ0NFRURFRCcpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ1NVQ0NFU1MnLCB7IFN0YXR1czogJ1NVQ0NFRURFRCcgfSk7XG4gICAgICB9IGVsc2UgaWYgKFsnRkFJTEVEJywgJ0ZBVUxUJywgJ1RJTUVEX09VVCcsICdTVE9QUEVEJ10uaW5jbHVkZXMoc3RhdHVzKSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIGZhaWxlZCB3aXRoIHN0YXR1czogXFwke3N0YXR1c31cXGApO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgcG9sbEludGVydmFsU2Vjb25kcyAqIDEwMDApKTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvcjonLCBlcnJvcik7XG4gICAgICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIGVycm9yLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhd2FpdCBzZW5kUmVzcG9uc2UoZXZlbnQsICdGQUlMRUQnLCB7fSwgXFxgQnVpbGQgdGltZW91dCBhZnRlciBcXCR7bWF4V2FpdE1pbnV0ZXN9IG1pbnV0ZXNcXGApO1xufTtcblxuYXN5bmMgZnVuY3Rpb24gc2VuZFJlc3BvbnNlKGV2ZW50LCBzdGF0dXMsIGRhdGEsIHJlYXNvbikge1xuICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgU3RhdHVzOiBzdGF0dXMsXG4gICAgUmVhc29uOiByZWFzb24gfHwgXFxgU2VlIENsb3VkV2F0Y2ggTG9nIFN0cmVhbTogXFwke2V2ZW50LkxvZ1N0cmVhbU5hbWV9XFxgLFxuICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkIHx8IGV2ZW50LlJlcXVlc3RJZCxcbiAgICBTdGFja0lkOiBldmVudC5TdGFja0lkLFxuICAgIFJlcXVlc3RJZDogZXZlbnQuUmVxdWVzdElkLFxuICAgIExvZ2ljYWxSZXNvdXJjZUlkOiBldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCxcbiAgICBEYXRhOiBkYXRhXG4gIH0pO1xuXG4gIGNvbnNvbGUubG9nKCdSZXNwb25zZTonLCByZXNwb25zZUJvZHkpO1xuXG4gIGNvbnN0IGh0dHBzID0gcmVxdWlyZSgnaHR0cHMnKTtcbiAgY29uc3QgdXJsID0gcmVxdWlyZSgndXJsJyk7XG4gIGNvbnN0IHBhcnNlZFVybCA9IHVybC5wYXJzZShldmVudC5SZXNwb25zZVVSTCk7XG5cbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgaG9zdG5hbWU6IHBhcnNlZFVybC5ob3N0bmFtZSxcbiAgICAgIHBvcnQ6IDQ0MyxcbiAgICAgIHBhdGg6IHBhcnNlZFVybC5wYXRoLFxuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICcnLFxuICAgICAgICAnQ29udGVudC1MZW5ndGgnOiByZXNwb25zZUJvZHkubGVuZ3RoXG4gICAgICB9XG4gICAgfTtcblxuICAgIGNvbnN0IHJlcXVlc3QgPSBodHRwcy5yZXF1ZXN0KG9wdGlvbnMsIChyZXNwb25zZSkgPT4ge1xuICAgICAgY29uc29sZS5sb2coXFxgU3RhdHVzOiBcXCR7cmVzcG9uc2Uuc3RhdHVzQ29kZX1cXGApO1xuICAgICAgcmVzb2x2ZShkYXRhKTtcbiAgICB9KTtcblxuICAgIHJlcXVlc3Qub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvcjonLCBlcnJvcik7XG4gICAgICByZWplY3QoZXJyb3IpO1xuICAgIH0pO1xuXG4gICAgcmVxdWVzdC53cml0ZShyZXNwb25zZUJvZHkpO1xuICAgIHJlcXVlc3QuZW5kKCk7XG4gIH0pO1xufVxuICAgICAgYCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgfSlcblxuICAgIGJ1aWxkV2FpdGVyRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgIHJlc291cmNlczogW2J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29uc3QgYnVpbGRXYWl0ZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdNY3AzbG9CdWlsZFdhaXRlclJlc291cmNlJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFdhaXRlckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBCdWlsZElkOiBidWlsZFRyaWdnZXIuZ2V0UmVzcG9uc2VGaWVsZCgnYnVpbGQuaWQnKSxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGJ1aWxkV2FpdGVyLm5vZGUuYWRkRGVwZW5kZW5jeShidWlsZFRyaWdnZXIpXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDg6IENyZWF0ZSBBZ2VudENvcmUgUnVudGltZSAoTUNQIFByb3RvY29sKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHJ1bnRpbWVOYW1lID0gcHJvamVjdE5hbWUucmVwbGFjZSgvLS9nLCAnXycpICsgJ19tY3BfM2xvX3J1bnRpbWUnXG4gICAgY29uc3QgcnVudGltZSA9IG5ldyBhZ2VudGNvcmUuQ2ZuUnVudGltZSh0aGlzLCAnTWNwM2xvUnVudGltZScsIHtcbiAgICAgIGFnZW50UnVudGltZU5hbWU6IHJ1bnRpbWVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdNQ1AgM0xPIFNlcnZlciBSdW50aW1lIC0gR21haWwgYW5kIGV4dGVybmFsIE9BdXRoIHNlcnZpY2UgdG9vbHMnLFxuICAgICAgcm9sZUFybjogZXhlY3V0aW9uUm9sZS5yb2xlQXJuLFxuXG4gICAgICBhZ2VudFJ1bnRpbWVBcnRpZmFjdDoge1xuICAgICAgICBjb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgY29udGFpbmVyVXJpOiBgJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuXG4gICAgICBuZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBuZXR3b3JrTW9kZTogJ1BVQkxJQycsXG4gICAgICB9LFxuXG4gICAgICBwcm90b2NvbENvbmZpZ3VyYXRpb246ICdNQ1AnLFxuXG4gICAgICAvLyBKV1QgaW5ib3VuZCBhdXRoIC0gQ29nbml0byB2YWxpZGF0ZXMgdXNlciBpZGVudGl0eSBmb3IgM0xPIE9BdXRoIGZsb3dzXG4gICAgICAvLyBOb3RlOiBPbmx5IGFsbG93ZWRBdWRpZW5jZSBpcyB1c2VkICh2YWxpZGF0ZXMgJ2F1ZCcgY2xhaW0gaW4gaWRfdG9rZW4pXG4gICAgICAvLyBhbGxvd2VkQ2xpZW50cyBpcyBOT1QgdXNlZCBiZWNhdXNlIENvZ25pdG8gaWRfdG9rZW4gZG9lc24ndCBoYXZlICdjbGllbnRfaWQnIGNsYWltXG4gICAgICAuLi4oY29nbml0b1VzZXJQb29sSWQgJiYgY29nbml0b0NsaWVudElkID8ge1xuICAgICAgICBhdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGN1c3RvbUp3dEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIGRpc2NvdmVyeVVybDogYGh0dHBzOi8vY29nbml0by1pZHAuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke2NvZ25pdG9Vc2VyUG9vbElkfS8ud2VsbC1rbm93bi9vcGVuaWQtY29uZmlndXJhdGlvbmAsXG4gICAgICAgICAgICBhbGxvd2VkQXVkaWVuY2U6IFtjb2duaXRvQ2xpZW50SWRdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9IDoge30pLFxuXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICBMT0dfTEVWRUw6ICdJTkZPJyxcbiAgICAgICAgUFJPSkVDVF9OQU1FOiBwcm9qZWN0TmFtZSxcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgICBBV1NfREVGQVVMVF9SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICBBV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgT1RFTF9QWVRIT05fRElTQUJMRURfSU5TVFJVTUVOVEFUSU9OUzogJ2JvdG8sYm90b2NvcmUnLFxuICAgICAgICAvLyBCdWlsZCB0aW1lc3RhbXAgdG8gZm9yY2UgUnVudGltZSB1cGRhdGUgb24gZWFjaCBkZXBsb3ltZW50XG4gICAgICAgIEJVSUxEX1RJTUVTVEFNUDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcblxuICAgICAgdGFnczoge1xuICAgICAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFwcGxpY2F0aW9uOiBgJHtwcm9qZWN0TmFtZX0tbWNwLTNsby1zZXJ2ZXJgLFxuICAgICAgICBUeXBlOiAnTUNQLTNMTy1TZXJ2ZXInLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koZXhlY3V0aW9uUm9sZSlcbiAgICBydW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShidWlsZFdhaXRlcilcblxuICAgIHRoaXMucnVudGltZSA9IHJ1bnRpbWVcbiAgICB0aGlzLnJ1bnRpbWVBcm4gPSBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgOTogU3RvcmUgUnVudGltZSBJbmZvcm1hdGlvbiBpbiBQYXJhbWV0ZXIgU3RvcmVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnTWNwM2xvUnVudGltZUFyblBhcmFtZXRlcicsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHtwcm9qZWN0TmFtZX0vJHtlbnZpcm9ubWVudH0vbWNwL21jcC0zbG8tcnVudGltZS1hcm5gLFxuICAgICAgc3RyaW5nVmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIDNMTyBTZXJ2ZXIgQWdlbnRDb3JlIFJ1bnRpbWUgQVJOJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pXG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnTWNwM2xvUnVudGltZUlkUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb2plY3ROYW1lfS8ke2Vudmlyb25tZW50fS9tY3AvbWNwLTNsby1ydW50aW1lLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIDNMTyBTZXJ2ZXIgQWdlbnRDb3JlIFJ1bnRpbWUgSUQnLFxuICAgICAgdGllcjogc3NtLlBhcmFtZXRlclRpZXIuU1RBTkRBUkQsXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgIHZhbHVlOiByZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUiBSZXBvc2l0b3J5IFVSSSBmb3IgTUNQIDNMTyBTZXJ2ZXIgY29udGFpbmVyJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLXJlcG8tdXJpYCxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1J1bnRpbWVBcm4nLCB7XG4gICAgICB2YWx1ZTogcnVudGltZS5hdHRyQWdlbnRSdW50aW1lQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdNQ1AgM0xPIFNlcnZlciBBZ2VudENvcmUgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LW1jcC0zbG8tcnVudGltZS1hcm5gLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUnVudGltZUlkJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdNQ1AgM0xPIFNlcnZlciBBZ2VudENvcmUgUnVudGltZSBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcm9qZWN0TmFtZX0tbWNwLTNsby1ydW50aW1lLWlkYCxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1BhcmFtZXRlclN0b3JlUHJlZml4Jywge1xuICAgICAgdmFsdWU6IGAvJHtwcm9qZWN0TmFtZX0vJHtlbnZpcm9ubWVudH0vbWNwYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUGFyYW1ldGVyIFN0b3JlIHByZWZpeCBmb3IgTUNQIDNMTyBTZXJ2ZXIgY29uZmlndXJhdGlvbicsXG4gICAgfSlcbiAgfVxufVxuIl19