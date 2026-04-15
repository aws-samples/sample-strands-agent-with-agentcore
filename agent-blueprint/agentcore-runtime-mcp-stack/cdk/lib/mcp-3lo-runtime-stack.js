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
        // Step 1: ECR Repository (always import — created by deploy.sh)
        // ============================================================
        const repository = ecr.Repository.fromRepositoryName(this, 'Mcp3loRepository', `${projectName}-mcp-3lo-server`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLTNsby1ydW50aW1lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibWNwLTNsby1ydW50aW1lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7O0dBSUc7QUFDSCxtQ0FBa0M7QUFDbEMsOERBQTZEO0FBQzdELDJDQUEwQztBQUMxQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywwREFBeUQ7QUFDekQsdURBQXNEO0FBQ3RELG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFVaEQsTUFBYSxrQkFBbUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMvQixPQUFPLENBQXNCO0lBQzdCLFVBQVUsQ0FBUTtJQUVsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksdUJBQXVCLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUE7UUFFL0MseUVBQXlFO1FBQ3pFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQTtRQUV0Qyw4RUFBOEU7UUFDOUUsTUFBTSxpQkFBaUIsR0FBRyxLQUFLLEVBQUUsaUJBQWlCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsSUFBSSxFQUFFLENBQUE7UUFDNUYsTUFBTSxlQUFlLEdBQUcsS0FBSyxFQUFFLGVBQWUsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLEVBQUUsQ0FBQTtRQUVyRiwrREFBK0Q7UUFDL0QsZ0VBQWdFO1FBQ2hFLCtEQUErRDtRQUMvRCxNQUFNLFVBQVUsR0FBRyxHQUFHLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUNsRCxJQUFJLEVBQ0osa0JBQWtC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QkFBbUI7U0FDOUMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDcEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxtQkFBbUI7WUFDbEMsV0FBVyxFQUFFLHNDQUFzQztZQUNuRCxVQUFVLEVBQUUsR0FBRyxXQUFXLHNCQUFzQjtTQUNqRCxDQUFDLENBQUE7UUFFRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGtCQUFrQjtZQUNqQyxXQUFXLEVBQUUscUNBQXFDO1lBQ2xELFVBQVUsRUFBRSxHQUFHLFdBQVcscUJBQXFCO1NBQ2hELENBQUMsQ0FBQTtRQUVGLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLElBQUksV0FBVyxJQUFJLFdBQVcsTUFBTTtZQUMzQyxXQUFXLEVBQUUseURBQXlEO1NBQ3ZFLENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRjtBQXplRCxnREF5ZUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIE1DUCAzTE8gUnVudGltZSBTdGFja1xuICogRGVwbG95cyBNQ1AgU2VydmVyIHdpdGggM0xPIE9BdXRoIGFzIEFnZW50Q29yZSBSdW50aW1lIHVzaW5nIENvZGVCdWlsZCBwYXR0ZXJuLlxuICogTUNQIFByb3RvY29sIC0gZXhwb3NlcyBHbWFpbCAoYW5kIGZ1dHVyZSAzTE8gc2VydmljZXMpIHRvb2xzIHZpYSBBZ2VudENvcmUgUnVudGltZS5cbiAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYWdlbnRjb3JlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1iZWRyb2NrYWdlbnRjb3JlJ1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnXG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCdcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWNwM2xvUnVudGltZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHByb2plY3ROYW1lPzogc3RyaW5nXG4gIGVudmlyb25tZW50Pzogc3RyaW5nXG4gIGNvZ25pdG9Vc2VyUG9vbElkPzogc3RyaW5nXG4gIGNvZ25pdG9DbGllbnRJZD86IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgTWNwM2xvUnVudGltZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHJ1bnRpbWU6IGFnZW50Y29yZS5DZm5SdW50aW1lXG4gIHB1YmxpYyByZWFkb25seSBydW50aW1lQXJuOiBzdHJpbmdcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IE1jcDNsb1J1bnRpbWVTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcylcblxuICAgIGNvbnN0IHByb2plY3ROYW1lID0gcHJvcHM/LnByb2plY3ROYW1lIHx8ICdzdHJhbmRzLWFnZW50LWNoYXRib3QnXG4gICAgY29uc3QgZW52aXJvbm1lbnQgPSBwcm9wcz8uZW52aXJvbm1lbnQgfHwgJ2RldidcblxuICAgIC8vIFVuaXF1ZSBidWlsZCB0YWcgdG8gZm9yY2UgUnVudGltZSB0byBwdWxsIG5ldyBpbWFnZSBvbiBlYWNoIGRlcGxveW1lbnRcbiAgICBjb25zdCBidWlsZFRhZyA9IERhdGUubm93KCkudG9TdHJpbmcoKVxuXG4gICAgLy8gQ29nbml0byBjb25maWd1cmF0aW9uIGZvciBKV1QgaW5ib3VuZCBhdXRoIChyZXF1aXJlZCBmb3IgM0xPIHVzZXIgaWRlbnRpdHkpXG4gICAgY29uc3QgY29nbml0b1VzZXJQb29sSWQgPSBwcm9wcz8uY29nbml0b1VzZXJQb29sSWQgfHwgcHJvY2Vzcy5lbnYuQ09HTklUT19VU0VSX1BPT0xfSUQgfHwgJydcbiAgICBjb25zdCBjb2duaXRvQ2xpZW50SWQgPSBwcm9wcz8uY29nbml0b0NsaWVudElkIHx8IHByb2Nlc3MuZW52LkNPR05JVE9fQ0xJRU5UX0lEIHx8ICcnXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDE6IEVDUiBSZXBvc2l0b3J5IChhbHdheXMgaW1wb3J0IOKAlCBjcmVhdGVkIGJ5IGRlcGxveS5zaClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCByZXBvc2l0b3J5ID0gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgdGhpcyxcbiAgICAgICdNY3AzbG9SZXBvc2l0b3J5JyxcbiAgICAgIGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLXNlcnZlcmBcbiAgICApXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDI6IElBTSBFeGVjdXRpb24gUm9sZSBmb3IgQWdlbnRDb3JlIFJ1bnRpbWVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdNY3AzbG9FeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXhlY3V0aW9uIHJvbGUgZm9yIE1DUCAzTE8gU2VydmVyIEFnZW50Q29yZSBSdW50aW1lJyxcbiAgICB9KVxuXG4gICAgLy8gRUNSIEFjY2Vzc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0VDUkltYWdlQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2VjcjpCYXRjaEdldEltYWdlJywgJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJywgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZWNyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpyZXBvc2l0b3J5LypgLCAnKiddLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZ3NcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnbG9nczpDcmVhdGVMb2dHcm91cCcsXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAgICdsb2dzOkRlc2NyaWJlTG9nU3RyZWFtcycsXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dHcm91cHMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9ydW50aW1lcy8qYCxcbiAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6KmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFgtUmF5IGFuZCBDbG91ZFdhdGNoIE1ldHJpY3NcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgICAgICAnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gT0F1dGggb3V0Ym91bmQgYXV0aCBwZXJtaXNzaW9uc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ09BdXRoSWRlbnRpdHlBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0UmVzb3VyY2VPYXV0aDJUb2tlbicsXG4gICAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkNyZWF0ZVdvcmtsb2FkSWRlbnRpdHknLFxuICAgICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRXb3JrbG9hZEFjY2Vzc1Rva2VuJyxcbiAgICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0V29ya2xvYWRBY2Nlc3NUb2tlbkZvclVzZXJJZCcsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFNlY3JldHMgTWFuYWdlciAoZm9yIE9BdXRoIGNyZWRlbnRpYWwgcHJvdmlkZXIgc2VjcmV0cylcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdTZWNyZXRzTWFuYWdlckFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06c2VjcmV0OipgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBQYXJhbWV0ZXIgU3RvcmUgKGZvciBjb25maWd1cmF0aW9uKVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzc206R2V0UGFyYW1ldGVyJywgJ3NzbTpHZXRQYXJhbWV0ZXJzJ10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyLyR7cHJvamVjdE5hbWV9LypgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDM6IFMzIEJ1Y2tldCBmb3IgQ29kZUJ1aWxkIFNvdXJjZVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHNvdXJjZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ01jcDNsb1NvdXJjZUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGAke3Byb2plY3ROYW1lfS1tY3AzbG8tc3JjLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICAgICAgaWQ6ICdEZWxldGVPbGRTb3VyY2VzJyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNDogQ29kZUJ1aWxkIFByb2plY3RcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBjb2RlQnVpbGRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdNY3AzbG9Db2RlQnVpbGRSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2NvZGVidWlsZC5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIHJvbGUgZm9yIE1DUCAzTE8gU2VydmVyIGNvbnRhaW5lcicsXG4gICAgfSlcblxuICAgIGNvZGVCdWlsZFJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJyxcbiAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICAgJ2VjcjpCYXRjaEdldEltYWdlJyxcbiAgICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAgICdlY3I6UHV0SW1hZ2UnLFxuICAgICAgICAgICdlY3I6SW5pdGlhdGVMYXllclVwbG9hZCcsXG4gICAgICAgICAgJ2VjcjpVcGxvYWRMYXllclBhcnQnLFxuICAgICAgICAgICdlY3I6Q29tcGxldGVMYXllclVwbG9hZCcsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICcqJyxcbiAgICAgICAgICBgYXJuOmF3czplY3I6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJlcG9zaXRvcnkvJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lfWAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvZGVCdWlsZFJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkNyZWF0ZUxvZ0dyb3VwJywgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgJ2xvZ3M6UHV0TG9nRXZlbnRzJ10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2NvZGVidWlsZC8ke3Byb2plY3ROYW1lfS0qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29kZUJ1aWxkUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpQdXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtzb3VyY2VCdWNrZXQuYnVja2V0QXJuLCBgJHtzb3VyY2VCdWNrZXQuYnVja2V0QXJufS8qYF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvbnN0IGJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdCh0aGlzLCAnTWNwM2xvQnVpbGRQcm9qZWN0Jywge1xuICAgICAgcHJvamVjdE5hbWU6IGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLWJ1aWxkZXJgLFxuICAgICAgZGVzY3JpcHRpb246ICdCdWlsZHMgQVJNNjQgY29udGFpbmVyIGltYWdlIGZvciBNQ1AgM0xPIFNlcnZlciBSdW50aW1lJyxcbiAgICAgIHJvbGU6IGNvZGVCdWlsZFJvbGUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yX0FSTV8zLFxuICAgICAgICBjb21wdXRlVHlwZTogY29kZWJ1aWxkLkNvbXB1dGVUeXBlLlNNQUxMLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHNvdXJjZTogY29kZWJ1aWxkLlNvdXJjZS5zMyh7XG4gICAgICAgIGJ1Y2tldDogc291cmNlQnVja2V0LFxuICAgICAgICBwYXRoOiAnbWNwLTNsby1zb3VyY2UvJyxcbiAgICAgIH0pLFxuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICAgICAgICB2ZXJzaW9uOiAnMC4yJyxcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgcHJlX2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBMb2dnaW5nIGluIHRvIEFtYXpvbiBFQ1IuLi4nLFxuICAgICAgICAgICAgICBgYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gJHt0aGlzLnJlZ2lvbn0gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXMuYWNjb3VudH0uZGtyLmVjci4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tYCxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gQnVpbGRpbmcgTUNQIDNMTyBTZXJ2ZXIgRG9ja2VyIGltYWdlIGZvciBBUk02NC4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLS1wbGF0Zm9ybSBsaW51eC9hcm02NCAtdCBtY3AtM2xvLXNlcnZlcjpsYXRlc3QgLicsXG4gICAgICAgICAgICAgIGBkb2NrZXIgdGFnIG1jcC0zbG8tc2VydmVyOmxhdGVzdCAke3JlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YCxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIERvY2tlciBpbWFnZSB0byBFQ1IuLi4nLFxuICAgICAgICAgICAgICBgZG9ja2VyIHB1c2ggJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNTogVXBsb2FkIFNvdXJjZSB0byBTM1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGFnZW50U291cmNlUGF0aCA9ICcuLidcbiAgICBjb25zdCBhZ2VudFNvdXJjZVVwbG9hZCA9IG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdNY3AzbG9Tb3VyY2VVcGxvYWQnLCB7XG4gICAgICBzb3VyY2VzOiBbXG4gICAgICAgIHMzZGVwbG95LlNvdXJjZS5hc3NldChhZ2VudFNvdXJjZVBhdGgsIHtcbiAgICAgICAgICBleGNsdWRlOiBbXG4gICAgICAgICAgICAndmVudi8qKicsXG4gICAgICAgICAgICAnLnZlbnYvKionLFxuICAgICAgICAgICAgJ19fcHljYWNoZV9fLyoqJyxcbiAgICAgICAgICAgICcqLnB5YycsXG4gICAgICAgICAgICAnLmdpdC8qKicsXG4gICAgICAgICAgICAnbm9kZV9tb2R1bGVzLyoqJyxcbiAgICAgICAgICAgICcuRFNfU3RvcmUnLFxuICAgICAgICAgICAgJyoubG9nJyxcbiAgICAgICAgICAgICdjZGsvKionLFxuICAgICAgICAgICAgJ2Nkay5vdXQvKionLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBzb3VyY2VCdWNrZXQsXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJ21jcC0zbG8tc291cmNlLycsXG4gICAgICBwcnVuZTogZmFsc2UsXG4gICAgICByZXRhaW5PbkRlbGV0ZTogZmFsc2UsXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNjogVHJpZ2dlciBDb2RlQnVpbGRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFRyaWdnZXIgPSBuZXcgY3IuQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgJ1RyaWdnZXJNY3AzbG9Db2RlQnVpbGQnLCB7XG4gICAgICBvbkNyZWF0ZToge1xuICAgICAgICBzZXJ2aWNlOiAnQ29kZUJ1aWxkJyxcbiAgICAgICAgYWN0aW9uOiAnc3RhcnRCdWlsZCcsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBwcm9qZWN0TmFtZTogYnVpbGRQcm9qZWN0LnByb2plY3ROYW1lLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZihgbWNwLTNsby1idWlsZC0ke0RhdGUubm93KCl9YCksXG4gICAgICB9LFxuICAgICAgb25VcGRhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0NvZGVCdWlsZCcsXG4gICAgICAgIGFjdGlvbjogJ3N0YXJ0QnVpbGQnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgcHJvamVjdE5hbWU6IGJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoYG1jcC0zbG8tYnVpbGQtJHtEYXRlLm5vdygpfWApLFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogY3IuQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnLCAnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbYnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSlcblxuICAgIGJ1aWxkVHJpZ2dlci5ub2RlLmFkZERlcGVuZGVuY3koYWdlbnRTb3VyY2VVcGxvYWQpXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDc6IFdhaXQgZm9yIEJ1aWxkIENvbXBsZXRpb25cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFdhaXRlckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWNwM2xvQnVpbGRXYWl0ZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuY29uc3QgeyBDb2RlQnVpbGRDbGllbnQsIEJhdGNoR2V0QnVpbGRzQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWNvZGVidWlsZCcpO1xuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgY29uc29sZS5sb2coJ0V2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG5cbiAgaWYgKGV2ZW50LlJlcXVlc3RUeXBlID09PSAnRGVsZXRlJykge1xuICAgIHJldHVybiBzZW5kUmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgeyBTdGF0dXM6ICdERUxFVEVEJyB9KTtcbiAgfVxuXG4gIGNvbnN0IGJ1aWxkSWQgPSBldmVudC5SZXNvdXJjZVByb3BlcnRpZXMuQnVpbGRJZDtcbiAgY29uc3QgbWF4V2FpdE1pbnV0ZXMgPSAxNDtcbiAgY29uc3QgcG9sbEludGVydmFsU2Vjb25kcyA9IDMwO1xuXG4gIGNvbnNvbGUubG9nKCdXYWl0aW5nIGZvciBidWlsZDonLCBidWlsZElkKTtcblxuICBjb25zdCBjbGllbnQgPSBuZXcgQ29kZUJ1aWxkQ2xpZW50KHt9KTtcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgbWF4V2FpdE1zID0gbWF4V2FpdE1pbnV0ZXMgKiA2MCAqIDEwMDA7XG5cbiAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydFRpbWUgPCBtYXhXYWl0TXMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChuZXcgQmF0Y2hHZXRCdWlsZHNDb21tYW5kKHsgaWRzOiBbYnVpbGRJZF0gfSkpO1xuICAgICAgY29uc3QgYnVpbGQgPSByZXNwb25zZS5idWlsZHNbMF07XG4gICAgICBjb25zdCBzdGF0dXMgPSBidWlsZC5idWlsZFN0YXR1cztcblxuICAgICAgY29uc29sZS5sb2coXFxgQnVpbGQgc3RhdHVzOiBcXCR7c3RhdHVzfVxcYCk7XG5cbiAgICAgIGlmIChzdGF0dXMgPT09ICdTVUNDRUVERUQnKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBzZW5kUmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgeyBTdGF0dXM6ICdTVUNDRUVERUQnIH0pO1xuICAgICAgfSBlbHNlIGlmIChbJ0ZBSUxFRCcsICdGQVVMVCcsICdUSU1FRF9PVVQnLCAnU1RPUFBFRCddLmluY2x1ZGVzKHN0YXR1cykpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBcXGBCdWlsZCBmYWlsZWQgd2l0aCBzdGF0dXM6IFxcJHtzdGF0dXN9XFxgKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHBvbGxJbnRlcnZhbFNlY29uZHMgKiAxMDAwKSk7XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3I6JywgZXJyb3IpO1xuICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBlcnJvci5tZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIHRpbWVvdXQgYWZ0ZXIgXFwke21heFdhaXRNaW51dGVzfSBtaW51dGVzXFxgKTtcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRSZXNwb25zZShldmVudCwgc3RhdHVzLCBkYXRhLCByZWFzb24pIHtcbiAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIFN0YXR1czogc3RhdHVzLFxuICAgIFJlYXNvbjogcmVhc29uIHx8IFxcYFNlZSBDbG91ZFdhdGNoIExvZyBTdHJlYW06IFxcJHtldmVudC5Mb2dTdHJlYW1OYW1lfVxcYCxcbiAgICBQaHlzaWNhbFJlc291cmNlSWQ6IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCBldmVudC5SZXF1ZXN0SWQsXG4gICAgU3RhY2tJZDogZXZlbnQuU3RhY2tJZCxcbiAgICBSZXF1ZXN0SWQ6IGV2ZW50LlJlcXVlc3RJZCxcbiAgICBMb2dpY2FsUmVzb3VyY2VJZDogZXZlbnQuTG9naWNhbFJlc291cmNlSWQsXG4gICAgRGF0YTogZGF0YVxuICB9KTtcblxuICBjb25zb2xlLmxvZygnUmVzcG9uc2U6JywgcmVzcG9uc2VCb2R5KTtcblxuICBjb25zdCBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7XG4gIGNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xuICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UoZXZlbnQuUmVzcG9uc2VVUkwpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiBwYXJzZWRVcmwuaG9zdG5hbWUsXG4gICAgICBwb3J0OiA0NDMsXG4gICAgICBwYXRoOiBwYXJzZWRVcmwucGF0aCxcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnJyxcbiAgICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogcmVzcG9uc2VCb2R5Lmxlbmd0aFxuICAgICAgfVxuICAgIH07XG5cbiAgICBjb25zdCByZXF1ZXN0ID0gaHR0cHMucmVxdWVzdChvcHRpb25zLCAocmVzcG9uc2UpID0+IHtcbiAgICAgIGNvbnNvbGUubG9nKFxcYFN0YXR1czogXFwke3Jlc3BvbnNlLnN0YXR1c0NvZGV9XFxgKTtcbiAgICAgIHJlc29sdmUoZGF0YSk7XG4gICAgfSk7XG5cbiAgICByZXF1ZXN0Lm9uKCdlcnJvcicsIChlcnJvcikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3I6JywgZXJyb3IpO1xuICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICB9KTtcblxuICAgIHJlcXVlc3Qud3JpdGUocmVzcG9uc2VCb2R5KTtcbiAgICByZXF1ZXN0LmVuZCgpO1xuICB9KTtcbn1cbiAgICAgIGApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgIH0pXG5cbiAgICBidWlsZFdhaXRlckZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpCYXRjaEdldEJ1aWxkcyddLFxuICAgICAgICByZXNvdXJjZXM6IFtidWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvbnN0IGJ1aWxkV2FpdGVyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnTWNwM2xvQnVpbGRXYWl0ZXJSZXNvdXJjZScsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogYnVpbGRXYWl0ZXJGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQnVpbGRJZDogYnVpbGRUcmlnZ2VyLmdldFJlc3BvbnNlRmllbGQoJ2J1aWxkLmlkJyksXG4gICAgICB9LFxuICAgIH0pXG5cbiAgICBidWlsZFdhaXRlci5ub2RlLmFkZERlcGVuZGVuY3koYnVpbGRUcmlnZ2VyKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA4OiBDcmVhdGUgQWdlbnRDb3JlIFJ1bnRpbWUgKE1DUCBQcm90b2NvbClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBydW50aW1lTmFtZSA9IHByb2plY3ROYW1lLnJlcGxhY2UoLy0vZywgJ18nKSArICdfbWNwXzNsb19ydW50aW1lJ1xuICAgIGNvbnN0IHJ1bnRpbWUgPSBuZXcgYWdlbnRjb3JlLkNmblJ1bnRpbWUodGhpcywgJ01jcDNsb1J1bnRpbWUnLCB7XG4gICAgICBhZ2VudFJ1bnRpbWVOYW1lOiBydW50aW1lTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIDNMTyBTZXJ2ZXIgUnVudGltZSAtIEdtYWlsIGFuZCBleHRlcm5hbCBPQXV0aCBzZXJ2aWNlIHRvb2xzJyxcbiAgICAgIHJvbGVBcm46IGV4ZWN1dGlvblJvbGUucm9sZUFybixcblxuICAgICAgYWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgY29udGFpbmVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGNvbnRhaW5lclVyaTogYCR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgLFxuICAgICAgICB9LFxuICAgICAgfSxcblxuICAgICAgbmV0d29ya0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgbmV0d29ya01vZGU6ICdQVUJMSUMnLFxuICAgICAgfSxcblxuICAgICAgcHJvdG9jb2xDb25maWd1cmF0aW9uOiAnTUNQJyxcblxuICAgICAgLy8gSldUIGluYm91bmQgYXV0aCAtIENvZ25pdG8gdmFsaWRhdGVzIHVzZXIgaWRlbnRpdHkgZm9yIDNMTyBPQXV0aCBmbG93c1xuICAgICAgLy8gTm90ZTogT25seSBhbGxvd2VkQXVkaWVuY2UgaXMgdXNlZCAodmFsaWRhdGVzICdhdWQnIGNsYWltIGluIGlkX3Rva2VuKVxuICAgICAgLy8gYWxsb3dlZENsaWVudHMgaXMgTk9UIHVzZWQgYmVjYXVzZSBDb2duaXRvIGlkX3Rva2VuIGRvZXNuJ3QgaGF2ZSAnY2xpZW50X2lkJyBjbGFpbVxuICAgICAgLi4uKGNvZ25pdG9Vc2VyUG9vbElkICYmIGNvZ25pdG9DbGllbnRJZCA/IHtcbiAgICAgICAgYXV0aG9yaXplckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBjdXN0b21Kd3RBdXRob3JpemVyOiB7XG4gICAgICAgICAgICBkaXNjb3ZlcnlVcmw6IGBodHRwczovL2NvZ25pdG8taWRwLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vJHtjb2duaXRvVXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgICAgYWxsb3dlZEF1ZGllbmNlOiBbY29nbml0b0NsaWVudElkXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSA6IHt9KSxcblxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgTE9HX0xFVkVMOiAnSU5GTycsXG4gICAgICAgIFBST0pFQ1RfTkFNRTogcHJvamVjdE5hbWUsXG4gICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgQVdTX0RFRkFVTFRfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgIE9URUxfUFlUSE9OX0RJU0FCTEVEX0lOU1RSVU1FTlRBVElPTlM6ICdib3RvLGJvdG9jb3JlJyxcbiAgICAgICAgLy8gQnVpbGQgdGltZXN0YW1wIHRvIGZvcmNlIFJ1bnRpbWUgdXBkYXRlIG9uIGVhY2ggZGVwbG95bWVudFxuICAgICAgICBCVUlMRF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0sXG5cbiAgICAgIHRhZ3M6IHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgICAgICBBcHBsaWNhdGlvbjogYCR7cHJvamVjdE5hbWV9LW1jcC0zbG8tc2VydmVyYCxcbiAgICAgICAgVHlwZTogJ01DUC0zTE8tU2VydmVyJyxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIHJ1bnRpbWUubm9kZS5hZGREZXBlbmRlbmN5KGV4ZWN1dGlvblJvbGUpXG4gICAgcnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koYnVpbGRXYWl0ZXIpXG5cbiAgICB0aGlzLnJ1bnRpbWUgPSBydW50aW1lXG4gICAgdGhpcy5ydW50aW1lQXJuID0gcnVudGltZS5hdHRyQWdlbnRSdW50aW1lQXJuXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDk6IFN0b3JlIFJ1bnRpbWUgSW5mb3JtYXRpb24gaW4gUGFyYW1ldGVyIFN0b3JlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ01jcDNsb1J1bnRpbWVBcm5QYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L21jcC9tY3AtM2xvLXJ1bnRpbWUtYXJuYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCAzTE8gU2VydmVyIEFnZW50Q29yZSBSdW50aW1lIEFSTicsXG4gICAgICB0aWVyOiBzc20uUGFyYW1ldGVyVGllci5TVEFOREFSRCxcbiAgICB9KVxuXG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ01jcDNsb1J1bnRpbWVJZFBhcmFtZXRlcicsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHtwcm9qZWN0TmFtZX0vJHtlbnZpcm9ubWVudH0vbWNwL21jcC0zbG8tcnVudGltZS1pZGAsXG4gICAgICBzdHJpbmdWYWx1ZTogcnVudGltZS5hdHRyQWdlbnRSdW50aW1lSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ01DUCAzTE8gU2VydmVyIEFnZW50Q29yZSBSdW50aW1lIElEJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1IgUmVwb3NpdG9yeSBVUkkgZm9yIE1DUCAzTE8gU2VydmVyIGNvbnRhaW5lcicsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcm9qZWN0TmFtZX0tbWNwLTNsby1yZXBvLXVyaWAsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIDNMTyBTZXJ2ZXIgQWdlbnRDb3JlIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS1tY3AtM2xvLXJ1bnRpbWUtYXJuYCxcbiAgICB9KVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1J1bnRpbWVJZCcsIHtcbiAgICAgIHZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTUNQIDNMTyBTZXJ2ZXIgQWdlbnRDb3JlIFJ1bnRpbWUgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LW1jcC0zbG8tcnVudGltZS1pZGAsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQYXJhbWV0ZXJTdG9yZVByZWZpeCcsIHtcbiAgICAgIHZhbHVlOiBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L21jcGAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1BhcmFtZXRlciBTdG9yZSBwcmVmaXggZm9yIE1DUCAzTE8gU2VydmVyIGNvbmZpZ3VyYXRpb24nLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==