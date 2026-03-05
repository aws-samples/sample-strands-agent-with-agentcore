"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeAgentRuntimeStack = void 0;
/**
 * Code Agent A2A Runtime Stack
 * Deploys Code Agent (Claude Agent SDK wrapper) as AgentCore A2A Runtime
 * Based on research-agent pattern - no S3 chart bucket or Code Interpreter needed
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
class CodeAgentRuntimeStack extends cdk.Stack {
    runtime;
    runtimeArn;
    constructor(scope, id, props) {
        super(scope, id, props);
        const projectName = props?.projectName || 'strands-agent-chatbot';
        const environment = props?.environment || 'dev';
        const anthropicModel = props?.anthropicModel || 'us.anthropic.claude-sonnet-4-6';
        // ============================================================
        // Step 1: ECR Repository
        // ============================================================
        const useExistingEcr = process.env.USE_EXISTING_ECR === 'true';
        const repository = useExistingEcr
            ? ecr.Repository.fromRepositoryName(this, 'CodeAgentRepository', `${projectName}-code-agent`)
            : new ecr.Repository(this, 'CodeAgentRepository', {
                repositoryName: `${projectName}-code-agent`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
                emptyOnDelete: true,
                imageScanOnPush: true,
                lifecycleRules: [{ description: 'Keep last 10 images', maxImageCount: 10 }],
            });
        // ============================================================
        // Step 2: IAM Execution Role
        // ============================================================
        const executionRole = new iam.Role(this, 'CodeAgentExecutionRole', {
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            description: 'Execution role for Code Agent AgentCore Runtime',
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
        // Bedrock Model Access (Claude Agent SDK calls Bedrock via IAM role)
        executionRole.addToPolicy(new iam.PolicyStatement({
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
        }));
        // Parameter Store (for configuration)
        executionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/*`,
            ],
        }));
        // S3 Document Bucket Access (read uploaded files + write workspace output)
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'S3DocumentBucketAccess',
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
            resources: [
                `arn:aws:s3:::${projectName}-*`,
                `arn:aws:s3:::${projectName}-*/*`,
            ],
        }));
        // DynamoDB: Read and clear stop signal (phase 2 of two-phase stop protocol)
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'DynamoDBStopSignalAccess',
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-users-v2`,
            ],
        }));
        // Read artifact bucket name from SSM (same pattern as research-agent)
        const artifactBucketSsmValue = ssm.StringParameter.valueFromLookup(this, `/${projectName}/${environment}/agentcore/artifact-bucket`);
        const documentBucketName = artifactBucketSsmValue.startsWith('dummy-value-for-')
            ? `${projectName}-artifact-${this.account}-${this.region}`
            : artifactBucketSsmValue;
        // ============================================================
        // Step 3: S3 Bucket for CodeBuild Source
        // ============================================================
        const sourceBucket = new s3.Bucket(this, 'CodeAgentSourceBucket', {
            bucketName: `${projectName}-code-agent-src-${this.account}-${this.region}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [{ expiration: cdk.Duration.days(7), id: 'DeleteOldSources' }],
        });
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'S3SourceAccess',
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:ListBucket'],
            resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
        }));
        // ============================================================
        // Step 4: CodeBuild Project
        // ============================================================
        const codeBuildRole = new iam.Role(this, 'CodeAgentCodeBuildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            description: 'Build role for Code Agent container',
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
        });
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
        });
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
        });
        buildTrigger.node.addDependency(agentSourceUpload);
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
        });
        buildWaiterFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['codebuild:BatchGetBuilds'],
            resources: [buildProject.projectArn],
        }));
        const buildWaiter = new cdk.CustomResource(this, 'CodeAgentBuildWaiterResource', {
            serviceToken: buildWaiterFunction.functionArn,
            properties: { BuildId: buildTrigger.getResponseField('build.id') },
        });
        buildWaiter.node.addDependency(buildTrigger);
        // ============================================================
        // Step 8: Create AgentCore Runtime (A2A protocol)
        // ============================================================
        const runtimeName = projectName.replace(/-/g, '_') + '_code_agent_runtime';
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
                // DynamoDB table for out-of-band stop signal polling
                DYNAMODB_USERS_TABLE: `${projectName}-users-v2`,
                // Forces CloudFormation to detect a change on every deploy,
                // so the Runtime pulls the latest image from ECR each time.
                BUILD_TIMESTAMP: new Date().toISOString(),
            },
            tags: {
                Environment: environment,
                Application: `${projectName}-code-agent`,
                Type: 'A2A-Agent',
            },
        });
        runtime.node.addDependency(executionRole);
        runtime.node.addDependency(buildWaiter);
        this.runtime = runtime;
        this.runtimeArn = runtime.attrAgentRuntimeArn;
        // ============================================================
        // Step 9: Store Runtime ARN in Parameter Store
        // ============================================================
        new ssm.StringParameter(this, 'CodeAgentRuntimeArnParameter', {
            parameterName: `/${projectName}/${environment}/a2a/code-agent-runtime-arn`,
            stringValue: runtime.attrAgentRuntimeArn,
            description: 'Code Agent AgentCore Runtime ARN',
            tier: ssm.ParameterTier.STANDARD,
        });
        new ssm.StringParameter(this, 'CodeAgentRuntimeIdParameter', {
            parameterName: `/${projectName}/${environment}/a2a/code-agent-runtime-id`,
            stringValue: runtime.attrAgentRuntimeId,
            description: 'Code Agent AgentCore Runtime ID',
            tier: ssm.ParameterTier.STANDARD,
        });
        // ============================================================
        // Outputs
        // ============================================================
        new cdk.CfnOutput(this, 'RepositoryUri', {
            value: repository.repositoryUri,
            description: 'ECR Repository URI for Code Agent container',
            exportName: `${projectName}-code-agent-repo-uri`,
        });
        new cdk.CfnOutput(this, 'RuntimeArn', {
            value: runtime.attrAgentRuntimeArn,
            description: 'Code Agent AgentCore Runtime ARN',
            exportName: `${projectName}-code-agent-runtime-arn`,
        });
        new cdk.CfnOutput(this, 'RuntimeId', {
            value: runtime.attrAgentRuntimeId,
            description: 'Code Agent AgentCore Runtime ID',
            exportName: `${projectName}-code-agent-runtime-id`,
        });
    }
}
exports.CodeAgentRuntimeStack = CodeAgentRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7O0dBSUc7QUFDSCxtQ0FBa0M7QUFDbEMsOERBQTZEO0FBQzdELDJDQUEwQztBQUMxQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywwREFBeUQ7QUFDekQsdURBQXNEO0FBQ3RELG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFTaEQsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNsQyxPQUFPLENBQXNCO0lBQzdCLFVBQVUsQ0FBUTtJQUVsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtDO1FBQzFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksdUJBQXVCLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUE7UUFDL0MsTUFBTSxjQUFjLEdBQUcsS0FBSyxFQUFFLGNBQWMsSUFBSSxnQ0FBZ0MsQ0FBQTtRQUVoRiwrREFBK0Q7UUFDL0QseUJBQXlCO1FBQ3pCLCtEQUErRDtRQUMvRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixLQUFLLE1BQU0sQ0FBQTtRQUM5RCxNQUFNLFVBQVUsR0FBRyxjQUFjO1lBQy9CLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUMvQixJQUFJLEVBQ0oscUJBQXFCLEVBQ3JCLEdBQUcsV0FBVyxhQUFhLENBQzVCO1lBQ0gsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7Z0JBQzlDLGNBQWMsRUFBRSxHQUFHLFdB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SSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDcEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxtQkFBbUI7WUFDbEMsV0FBVyxFQUFFLGtDQUFrQztZQUMvQyxVQUFVLEVBQUUsR0FBRyxXQUFXLHlCQUF5QjtTQUNwRCxDQUFDLENBQUE7UUFFRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGtCQUFrQjtZQUNqQyxXQUFXLEVBQUUsaUNBQWlDO1lBQzlDLFVBQVUsRUFBRSxHQUFHLFdBQVcsd0JBQXdCO1NBQ25ELENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRjtBQTVkRCxzREE0ZEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENvZGUgQWdlbnQgQTJBIFJ1bnRpbWUgU3RhY2tcbiAqIERlcGxveXMgQ29kZSBBZ2VudCAoQ2xhdWRlIEFnZW50IFNESyB3cmFwcGVyKSBhcyBBZ2VudENvcmUgQTJBIFJ1bnRpbWVcbiAqIEJhc2VkIG9uIHJlc2VhcmNoLWFnZW50IHBhdHRlcm4gLSBubyBTMyBjaGFydCBidWNrZXQgb3IgQ29kZSBJbnRlcnByZXRlciBuZWVkZWRcbiAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYWdlbnRjb3JlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1iZWRyb2NrYWdlbnRjb3JlJ1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnXG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCdcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUFnZW50UnVudGltZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHByb2plY3ROYW1lPzogc3RyaW5nXG4gIGVudmlyb25tZW50Pzogc3RyaW5nXG4gIGFudGhyb3BpY01vZGVsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBDb2RlQWdlbnRSdW50aW1lU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgcnVudGltZTogYWdlbnRjb3JlLkNmblJ1bnRpbWVcbiAgcHVibGljIHJlYWRvbmx5IHJ1bnRpbWVBcm46IHN0cmluZ1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQ29kZUFnZW50UnVudGltZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKVxuXG4gICAgY29uc3QgcHJvamVjdE5hbWUgPSBwcm9wcz8ucHJvamVjdE5hbWUgfHwgJ3N0cmFuZHMtYWdlbnQtY2hhdGJvdCdcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHByb3BzPy5lbnZpcm9ubWVudCB8fCAnZGV2J1xuICAgIGNvbnN0IGFudGhyb3BpY01vZGVsID0gcHJvcHM/LmFudGhyb3BpY01vZGVsIHx8ICd1cy5hbnRocm9waWMuY2xhdWRlLXNvbm5ldC00LTYnXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDE6IEVDUiBSZXBvc2l0b3J5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgdXNlRXhpc3RpbmdFY3IgPSBwcm9jZXNzLmVudi5VU0VfRVhJU1RJTkdfRUNSID09PSAndHJ1ZSdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gdXNlRXhpc3RpbmdFY3JcbiAgICAgID8gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgJ0NvZGVBZ2VudFJlcG9zaXRvcnknLFxuICAgICAgICAgIGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50YFxuICAgICAgICApXG4gICAgICA6IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnQ29kZUFnZW50UmVwb3NpdG9yeScsIHtcbiAgICAgICAgICByZXBvc2l0b3J5TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnRgLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICAgICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsIG1heEltYWdlQ291bnQ6IDEwIH1dLFxuICAgICAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCAyOiBJQU0gRXhlY3V0aW9uIFJvbGVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2RlQWdlbnRFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXhlY3V0aW9uIHJvbGUgZm9yIENvZGUgQWdlbnQgQWdlbnRDb3JlIFJ1bnRpbWUnLFxuICAgIH0pXG5cbiAgICAvLyBFQ1IgQWNjZXNzXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnRUNSSW1hZ2VBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLCAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czplY3I6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJlcG9zaXRvcnkvKmAsICcqJ10sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL3J1bnRpbWVzLypgLFxuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gWC1SYXkgYW5kIENsb3VkV2F0Y2ggTWV0cmljc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgICAgICdjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBCZWRyb2NrIE1vZGVsIEFjY2VzcyAoQ2xhdWRlIEFnZW50IFNESyBjYWxscyBCZWRyb2NrIHZpYSBJQU0gcm9sZSlcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdCZWRyb2NrTW9kZWxJbnZvY2F0aW9uJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJyxcbiAgICAgICAgICAnYmVkcm9jazpDb252ZXJzZScsXG4gICAgICAgICAgJ2JlZHJvY2s6Q29udmVyc2VTdHJlYW0nLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvKmAsXG4gICAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06KmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFBhcmFtZXRlciBTdG9yZSAoZm9yIGNvbmZpZ3VyYXRpb24pXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NzbTpHZXRQYXJhbWV0ZXInLCAnc3NtOkdldFBhcmFtZXRlcnMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIvJHtwcm9qZWN0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFMzIERvY3VtZW50IEJ1Y2tldCBBY2Nlc3MgKHJlYWQgdXBsb2FkZWQgZmlsZXMgKyB3cml0ZSB3b3Jrc3BhY2Ugb3V0cHV0KVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ1MzRG9jdW1lbnRCdWNrZXRBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0JywgJ3MzOkRlbGV0ZU9iamVjdCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OiR7cHJvamVjdE5hbWV9LSpgLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHtwcm9qZWN0TmFtZX0tKi8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gRHluYW1vREI6IFJlYWQgYW5kIGNsZWFyIHN0b3Agc2lnbmFsIChwaGFzZSAyIG9mIHR3by1waGFzZSBzdG9wIHByb3RvY29sKVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0R5bmFtb0RCU3RvcFNpZ25hbEFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpHZXRJdGVtJywgJ2R5bmFtb2RiOkRlbGV0ZUl0ZW0nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6ZHluYW1vZGI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnRhYmxlLyR7cHJvamVjdE5hbWV9LXVzZXJzLXYyYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gUmVhZCBhcnRpZmFjdCBidWNrZXQgbmFtZSBmcm9tIFNTTSAoc2FtZSBwYXR0ZXJuIGFzIHJlc2VhcmNoLWFnZW50KVxuICAgIGNvbnN0IGFydGlmYWN0QnVja2V0U3NtVmFsdWUgPSBzc20uU3RyaW5nUGFyYW1ldGVyLnZhbHVlRnJvbUxvb2t1cChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L2FnZW50Y29yZS9hcnRpZmFjdC1idWNrZXRgXG4gICAgKVxuICAgIGNvbnN0IGRvY3VtZW50QnVja2V0TmFtZSA9IGFydGlmYWN0QnVja2V0U3NtVmFsdWUuc3RhcnRzV2l0aCgnZHVtbXktdmFsdWUtZm9yLScpXG4gICAgICA/IGAke3Byb2plY3ROYW1lfS1hcnRpZmFjdC0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn1gXG4gICAgICA6IGFydGlmYWN0QnVja2V0U3NtVmFsdWVcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgMzogUzMgQnVja2V0IGZvciBDb2RlQnVpbGQgU291cmNlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3Qgc291cmNlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQ29kZUFnZW50U291cmNlQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtc3JjLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3sgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksIGlkOiAnRGVsZXRlT2xkU291cmNlcycgfV0sXG4gICAgfSlcblxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ1MzU291cmNlQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpMaXN0QnVja2V0J10sXG4gICAgICAgIHJlc291cmNlczogW3NvdXJjZUJ1Y2tldC5idWNrZXRBcm4sIGAke3NvdXJjZUJ1Y2tldC5idWNrZXRBcm59LypgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA0OiBDb2RlQnVpbGQgUHJvamVjdFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGNvZGVCdWlsZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0NvZGVBZ2VudENvZGVCdWlsZFJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgcm9sZSBmb3IgQ29kZSBBZ2VudCBjb250YWluZXInLFxuICAgIH0pXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLFxuICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICAgJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJyxcbiAgICAgICAgICAnZWNyOlB1dEltYWdlJyxcbiAgICAgICAgICAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLFxuICAgICAgICAgICdlY3I6VXBsb2FkTGF5ZXJQYXJ0JyxcbiAgICAgICAgICAnZWNyOkNvbXBsZXRlTGF5ZXJVcGxvYWQnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAnKicsXG4gICAgICAgICAgYGFybjphd3M6ZWNyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpyZXBvc2l0b3J5LyR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZX1gLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnbG9nczpDcmVhdGVMb2dHcm91cCcsICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9jb2RlYnVpbGQvJHtwcm9qZWN0TmFtZX0tKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvZGVCdWlsZFJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkxpc3RCdWNrZXQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbc291cmNlQnVja2V0LmJ1Y2tldEFybiwgYCR7c291cmNlQnVja2V0LmJ1Y2tldEFybn0vKmBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb25zdCBidWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ0NvZGVBZ2VudEJ1aWxkUHJvamVjdCcsIHtcbiAgICAgIHByb2plY3ROYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudC1idWlsZGVyYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGRzIEFSTTY0IGNvbnRhaW5lciBpbWFnZSBmb3IgQ29kZSBBZ2VudCBBMkEgUnVudGltZScsXG4gICAgICByb2xlOiBjb2RlQnVpbGRSb2xlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl9BUk1fMyxcbiAgICAgICAgY29tcHV0ZVR5cGU6IGNvZGVidWlsZC5Db21wdXRlVHlwZS5TTUFMTCxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHNvdXJjZUJ1Y2tldCxcbiAgICAgICAgcGF0aDogJ2NvZGUtYWdlbnQtc291cmNlLycsXG4gICAgICB9KSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gTG9nZ2luZyBpbiB0byBBbWF6b24gRUNSLi4uJyxcbiAgICAgICAgICAgICAgYGF3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICR7dGhpcy5yZWdpb259IHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJHt0aGlzLmFjY291bnR9LmRrci5lY3IuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkaW5nIENvZGUgQWdlbnQgRG9ja2VyIGltYWdlIGZvciBBUk02NC4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLS1wbGF0Zm9ybSBsaW51eC9hcm02NCAtdCBjb2RlLWFnZW50OmxhdGVzdCAuJyxcbiAgICAgICAgICAgICAgYGRvY2tlciB0YWcgY29kZS1hZ2VudDpsYXRlc3QgJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyBEb2NrZXIgaW1hZ2UgdG8gRUNSLi4uJyxcbiAgICAgICAgICAgICAgYGRvY2tlciBwdXNoICR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgLFxuICAgICAgICAgICAgICAnZWNobyBCdWlsZCBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0pXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDU6IFVwbG9hZCBTb3VyY2UgdG8gUzNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBhZ2VudFNvdXJjZVVwbG9hZCA9IG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdDb2RlQWdlbnRTb3VyY2VVcGxvYWQnLCB7XG4gICAgICBzb3VyY2VzOiBbXG4gICAgICAgIHMzZGVwbG95LlNvdXJjZS5hc3NldCgnLi4nLCB7XG4gICAgICAgICAgZXhjbHVkZTogW1xuICAgICAgICAgICAgJ3ZlbnYvKionLCAnLnZlbnYvKionLCAnX19weWNhY2hlX18vKionLCAnKi5weWMnLFxuICAgICAgICAgICAgJy5naXQvKionLCAnbm9kZV9tb2R1bGVzLyoqJywgJy5EU19TdG9yZScsICcqLmxvZycsXG4gICAgICAgICAgICAnY2RrLyoqJywgJ2Nkay5vdXQvKionLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBzb3VyY2VCdWNrZXQsXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJ2NvZGUtYWdlbnQtc291cmNlLycsXG4gICAgICBwcnVuZTogZmFsc2UsXG4gICAgICByZXRhaW5PbkRlbGV0ZTogZmFsc2UsXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNjogVHJpZ2dlciBDb2RlQnVpbGRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFRyaWdnZXIgPSBuZXcgY3IuQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgJ1RyaWdnZXJDb2RlQWdlbnRDb2RlQnVpbGQnLCB7XG4gICAgICBvbkNyZWF0ZToge1xuICAgICAgICBzZXJ2aWNlOiAnQ29kZUJ1aWxkJyxcbiAgICAgICAgYWN0aW9uOiAnc3RhcnRCdWlsZCcsXG4gICAgICAgIHBhcmFtZXRlcnM6IHsgcHJvamVjdE5hbWU6IGJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZihgY29kZS1hZ2VudC1idWlsZC0ke0RhdGUubm93KCl9YCksXG4gICAgICB9LFxuICAgICAgb25VcGRhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0NvZGVCdWlsZCcsXG4gICAgICAgIGFjdGlvbjogJ3N0YXJ0QnVpbGQnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7IHByb2plY3ROYW1lOiBidWlsZFByb2plY3QucHJvamVjdE5hbWUgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoYGNvZGUtYWdlbnQtYnVpbGQtJHtEYXRlLm5vdygpfWApLFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogY3IuQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnLCAnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbYnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSlcblxuICAgIGJ1aWxkVHJpZ2dlci5ub2RlLmFkZERlcGVuZGVuY3koYWdlbnRTb3VyY2VVcGxvYWQpXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDc6IFdhaXQgZm9yIEJ1aWxkIENvbXBsZXRpb25cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFdhaXRlckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29kZUFnZW50QnVpbGRXYWl0ZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuY29uc3QgeyBDb2RlQnVpbGRDbGllbnQsIEJhdGNoR2V0QnVpbGRzQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWNvZGVidWlsZCcpO1xuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgaWYgKGV2ZW50LlJlcXVlc3RUeXBlID09PSAnRGVsZXRlJykge1xuICAgIHJldHVybiBzZW5kUmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgeyBTdGF0dXM6ICdERUxFVEVEJyB9KTtcbiAgfVxuXG4gIGNvbnN0IGJ1aWxkSWQgPSBldmVudC5SZXNvdXJjZVByb3BlcnRpZXMuQnVpbGRJZDtcbiAgY29uc3QgbWF4V2FpdE1pbnV0ZXMgPSAxNDtcbiAgY29uc3QgcG9sbEludGVydmFsU2Vjb25kcyA9IDMwO1xuICBjb25zdCBjbGllbnQgPSBuZXcgQ29kZUJ1aWxkQ2xpZW50KHt9KTtcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgbWF4V2FpdE1zID0gbWF4V2FpdE1pbnV0ZXMgKiA2MCAqIDEwMDA7XG5cbiAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydFRpbWUgPCBtYXhXYWl0TXMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChuZXcgQmF0Y2hHZXRCdWlsZHNDb21tYW5kKHsgaWRzOiBbYnVpbGRJZF0gfSkpO1xuICAgICAgY29uc3QgYnVpbGQgPSByZXNwb25zZS5idWlsZHNbMF07XG4gICAgICBjb25zdCBzdGF0dXMgPSBidWlsZC5idWlsZFN0YXR1cztcblxuICAgICAgaWYgKHN0YXR1cyA9PT0gJ1NVQ0NFRURFRCcpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ1NVQ0NFU1MnLCB7IFN0YXR1czogJ1NVQ0NFRURFRCcgfSk7XG4gICAgICB9IGVsc2UgaWYgKFsnRkFJTEVEJywgJ0ZBVUxUJywgJ1RJTUVEX09VVCcsICdTVE9QUEVEJ10uaW5jbHVkZXMoc3RhdHVzKSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIGZhaWxlZDogXFwke3N0YXR1c31cXGApO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgcG9sbEludGVydmFsU2Vjb25kcyAqIDEwMDApKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBlcnJvci5tZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIHRpbWVvdXQgYWZ0ZXIgXFwke21heFdhaXRNaW51dGVzfSBtaW51dGVzXFxgKTtcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRSZXNwb25zZShldmVudCwgc3RhdHVzLCBkYXRhLCByZWFzb24pIHtcbiAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIFN0YXR1czogc3RhdHVzLFxuICAgIFJlYXNvbjogcmVhc29uIHx8IFxcYFNlZSBDbG91ZFdhdGNoIExvZyBTdHJlYW06IFxcJHtldmVudC5Mb2dTdHJlYW1OYW1lfVxcYCxcbiAgICBQaHlzaWNhbFJlc291cmNlSWQ6IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCBldmVudC5SZXF1ZXN0SWQsXG4gICAgU3RhY2tJZDogZXZlbnQuU3RhY2tJZCxcbiAgICBSZXF1ZXN0SWQ6IGV2ZW50LlJlcXVlc3RJZCxcbiAgICBMb2dpY2FsUmVzb3VyY2VJZDogZXZlbnQuTG9naWNhbFJlc291cmNlSWQsXG4gICAgRGF0YTogZGF0YVxuICB9KTtcblxuICBjb25zdCBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7XG4gIGNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xuICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UoZXZlbnQuUmVzcG9uc2VVUkwpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiBwYXJzZWRVcmwuaG9zdG5hbWUsXG4gICAgICBwb3J0OiA0NDMsXG4gICAgICBwYXRoOiBwYXJzZWRVcmwucGF0aCxcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnJywgJ0NvbnRlbnQtTGVuZ3RoJzogcmVzcG9uc2VCb2R5Lmxlbmd0aCB9XG4gICAgfTtcbiAgICBjb25zdCByZXF1ZXN0ID0gaHR0cHMucmVxdWVzdChvcHRpb25zLCAocmVzcG9uc2UpID0+IHsgcmVzb2x2ZShkYXRhKTsgfSk7XG4gICAgcmVxdWVzdC5vbignZXJyb3InLCAoZXJyb3IpID0+IHsgcmVqZWN0KGVycm9yKTsgfSk7XG4gICAgcmVxdWVzdC53cml0ZShyZXNwb25zZUJvZHkpO1xuICAgIHJlcXVlc3QuZW5kKCk7XG4gIH0pO1xufVxuICAgICAgYCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgfSlcblxuICAgIGJ1aWxkV2FpdGVyRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgIHJlc291cmNlczogW2J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29uc3QgYnVpbGRXYWl0ZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdDb2RlQWdlbnRCdWlsZFdhaXRlclJlc291cmNlJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFdhaXRlckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczogeyBCdWlsZElkOiBidWlsZFRyaWdnZXIuZ2V0UmVzcG9uc2VGaWVsZCgnYnVpbGQuaWQnKSB9LFxuICAgIH0pXG5cbiAgICBidWlsZFdhaXRlci5ub2RlLmFkZERlcGVuZGVuY3koYnVpbGRUcmlnZ2VyKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA4OiBDcmVhdGUgQWdlbnRDb3JlIFJ1bnRpbWUgKEEyQSBwcm90b2NvbClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBydW50aW1lTmFtZSA9IHByb2plY3ROYW1lLnJlcGxhY2UoLy0vZywgJ18nKSArICdfY29kZV9hZ2VudF9ydW50aW1lJ1xuICAgIGNvbnN0IHJ1bnRpbWUgPSBuZXcgYWdlbnRjb3JlLkNmblJ1bnRpbWUodGhpcywgJ0NvZGVBZ2VudFJ1bnRpbWUnLCB7XG4gICAgICBhZ2VudFJ1bnRpbWVOYW1lOiBydW50aW1lTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBMkEgUnVudGltZSAtIEF1dG9ub21vdXMgY29kaW5nIHdpdGggQ2xhdWRlIEFnZW50IFNESycsXG4gICAgICByb2xlQXJuOiBleGVjdXRpb25Sb2xlLnJvbGVBcm4sXG5cbiAgICAgIGFnZW50UnVudGltZUFydGlmYWN0OiB7XG4gICAgICAgIGNvbnRhaW5lckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBjb250YWluZXJVcmk6IGAke3JlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG5cbiAgICAgIG5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIG5ldHdvcmtNb2RlOiAnUFVCTElDJyxcbiAgICAgIH0sXG5cbiAgICAgIC8vIEEyQSBwcm90b2NvbCAoc2FtZSBhcyByZXNlYXJjaC1hZ2VudClcbiAgICAgIHByb3RvY29sQ29uZmlndXJhdGlvbjogJ0EyQScsXG5cbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgIExPR19MRVZFTDogJ0lORk8nLFxuICAgICAgICBQUk9KRUNUX05BTUU6IHByb2plY3ROYW1lLFxuICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFXU19ERUZBVUxUX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICAvLyBDbGF1ZGUgQWdlbnQgU0RLIEJlZHJvY2sgYXV0aGVudGljYXRpb25cbiAgICAgICAgQ0xBVURFX0NPREVfVVNFX0JFRFJPQ0s6ICcxJyxcbiAgICAgICAgQU5USFJPUElDX01PREVMOiBhbnRocm9waWNNb2RlbCxcbiAgICAgICAgT1RFTF9QWVRIT05fRElTQUJMRURfSU5TVFJVTUVOVEFUSU9OUzogJ2JvdG8sYm90b2NvcmUnLFxuICAgICAgICAvLyBTMyBidWNrZXQgZm9yIHN5bmNpbmcgd29ya3NwYWNlIG91dHB1dCBhZnRlciBlYWNoIHRhc2tcbiAgICAgICAgRE9DVU1FTlRfQlVDS0VUOiBkb2N1bWVudEJ1Y2tldE5hbWUsXG4gICAgICAgIC8vIER5bmFtb0RCIHRhYmxlIGZvciBvdXQtb2YtYmFuZCBzdG9wIHNpZ25hbCBwb2xsaW5nXG4gICAgICAgIERZTkFNT0RCX1VTRVJTX1RBQkxFOiBgJHtwcm9qZWN0TmFtZX0tdXNlcnMtdjJgLFxuICAgICAgICAvLyBGb3JjZXMgQ2xvdWRGb3JtYXRpb24gdG8gZGV0ZWN0IGEgY2hhbmdlIG9uIGV2ZXJ5IGRlcGxveSxcbiAgICAgICAgLy8gc28gdGhlIFJ1bnRpbWUgcHVsbHMgdGhlIGxhdGVzdCBpbWFnZSBmcm9tIEVDUiBlYWNoIHRpbWUuXG4gICAgICAgIEJVSUxEX1RJTUVTVEFNUDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcblxuICAgICAgdGFnczoge1xuICAgICAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFwcGxpY2F0aW9uOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudGAsXG4gICAgICAgIFR5cGU6ICdBMkEtQWdlbnQnLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koZXhlY3V0aW9uUm9sZSlcbiAgICBydW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShidWlsZFdhaXRlcilcblxuICAgIHRoaXMucnVudGltZSA9IHJ1bnRpbWVcbiAgICB0aGlzLnJ1bnRpbWVBcm4gPSBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgOTogU3RvcmUgUnVudGltZSBBUk4gaW4gUGFyYW1ldGVyIFN0b3JlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0NvZGVBZ2VudFJ1bnRpbWVBcm5QYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L2EyYS9jb2RlLWFnZW50LXJ1bnRpbWUtYXJuYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZGUgQWdlbnQgQWdlbnRDb3JlIFJ1bnRpbWUgQVJOJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pXG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnQ29kZUFnZW50UnVudGltZUlkUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb2plY3ROYW1lfS8ke2Vudmlyb25tZW50fS9hMmEvY29kZS1hZ2VudC1ydW50aW1lLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBJRCcsXG4gICAgICB0aWVyOiBzc20uUGFyYW1ldGVyVGllci5TVEFOREFSRCxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNSIFJlcG9zaXRvcnkgVVJJIGZvciBDb2RlIEFnZW50IGNvbnRhaW5lcicsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudC1yZXBvLXVyaWAsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtcnVudGltZS1hcm5gLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUnVudGltZUlkJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2RlIEFnZW50IEFnZW50Q29yZSBSdW50aW1lIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50LXJ1bnRpbWUtaWRgLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==