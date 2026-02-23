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
                removalPolicy: cdk.RemovalPolicy.RETAIN,
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
        // Import document bucket name from main AgentCore Runtime stack export
        const documentBucketName = cdk.Fn.importValue(`${projectName}-document-bucket`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7O0dBSUc7QUFDSCxtQ0FBa0M7QUFDbEMsOERBQTZEO0FBQzdELDJDQUEwQztBQUMxQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywwREFBeUQ7QUFDekQsdURBQXNEO0FBQ3RELG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFTaEQsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNsQyxPQUFPLENBQXNCO0lBQzdCLFVBQVUsQ0FBUTtJQUVsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtDO1FBQzFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksdUJBQXVCLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUE7UUFDL0MsTUFBTSxjQUFjLEdBQUcsS0FBSyxFQUFFLGNBQWMsSUFBSSxnQ0FBZ0MsQ0FBQTtRQUVoRiwrREFBK0Q7UUFDL0QseUJBQXlCO1FBQ3pCLCtEQUErRDtRQUMvRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixLQUFLLE1BQU0sQ0FBQTtRQUM5RCxNQUFNLFVBQVUsR0FBRyxjQUFjO1lBQy9CLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUMvQixJQUFJLEVBQ0oscUJBQXFCLEVBQ3JCLEdBQUcsV0FBVyxhQUFhLENBQzVCO1lBQ0gsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7Z0JBQzlDLGNBQWMsRUFBRSxHQUFHLFdB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SUFBSSxFQUFFLDZCQUE2QixFQUFFO1lBQzNELGFBQWEsRUFBRSxJQUFJLFdBQVcsSUFBSSxXQUFXLDRCQUE0QjtZQUN6RSxXQUFXLEVBQUUsT0FBTyxDQUFDLGtCQUFrQjtZQUN2QyxXQUFXLEVBQUUsaUNBQWlDO1lBQzlDLElBQUksRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLFFBQVE7U0FDakMsQ0FBQyxDQUFBO1FBRUYsK0RBQStEO1FBQy9ELFVBQVU7UUFDViwrREFBK0Q7UUFDL0QsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxhQUFhO1lBQy9CLFdBQVcsRUFBRSw2Q0FBNkM7WUFDMUQsVUFBVSxFQUFFLEdBQUcsV0FBVyxzQkFBc0I7U0FDakQsQ0FBQyxDQUFBO1FBRUYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDcEMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxtQkFBbUI7WUFDbEMsV0FBVyxFQUFFLGtDQUFrQztZQUMvQyxVQUFVLEVBQUUsR0FBRyxXQUFXLHlCQUF5QjtTQUNwRCxDQUFDLENBQUE7UUFFRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFdBQVcsRUFBRTtZQUNuQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGtCQUFrQjtZQUNqQyxXQUFXLEVBQUUsaUNBQWlDO1lBQzlDLFVBQVUsRUFBRSxHQUFHLFdBQVcsd0JBQXdCO1NBQ25ELENBQUMsQ0FBQTtJQUNKLENBQUM7Q0FDRjtBQXZjRCxzREF1Y0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIENvZGUgQWdlbnQgQTJBIFJ1bnRpbWUgU3RhY2tcbiAqIERlcGxveXMgQ29kZSBBZ2VudCAoQ2xhdWRlIEFnZW50IFNESyB3cmFwcGVyKSBhcyBBZ2VudENvcmUgQTJBIFJ1bnRpbWVcbiAqIEJhc2VkIG9uIHJlc2VhcmNoLWFnZW50IHBhdHRlcm4gLSBubyBTMyBjaGFydCBidWNrZXQgb3IgQ29kZSBJbnRlcnByZXRlciBuZWVkZWRcbiAqL1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJ1xuaW1wb3J0ICogYXMgYWdlbnRjb3JlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1iZWRyb2NrYWdlbnRjb3JlJ1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSdcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJ1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJ1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnXG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCdcbmltcG9ydCAqIGFzIGNyIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUFnZW50UnVudGltZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHByb2plY3ROYW1lPzogc3RyaW5nXG4gIGVudmlyb25tZW50Pzogc3RyaW5nXG4gIGFudGhyb3BpY01vZGVsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBjbGFzcyBDb2RlQWdlbnRSdW50aW1lU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgcnVudGltZTogYWdlbnRjb3JlLkNmblJ1bnRpbWVcbiAgcHVibGljIHJlYWRvbmx5IHJ1bnRpbWVBcm46IHN0cmluZ1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQ29kZUFnZW50UnVudGltZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKVxuXG4gICAgY29uc3QgcHJvamVjdE5hbWUgPSBwcm9wcz8ucHJvamVjdE5hbWUgfHwgJ3N0cmFuZHMtYWdlbnQtY2hhdGJvdCdcbiAgICBjb25zdCBlbnZpcm9ubWVudCA9IHByb3BzPy5lbnZpcm9ubWVudCB8fCAnZGV2J1xuICAgIGNvbnN0IGFudGhyb3BpY01vZGVsID0gcHJvcHM/LmFudGhyb3BpY01vZGVsIHx8ICd1cy5hbnRocm9waWMuY2xhdWRlLXNvbm5ldC00LTYnXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDE6IEVDUiBSZXBvc2l0b3J5XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgdXNlRXhpc3RpbmdFY3IgPSBwcm9jZXNzLmVudi5VU0VfRVhJU1RJTkdfRUNSID09PSAndHJ1ZSdcbiAgICBjb25zdCByZXBvc2l0b3J5ID0gdXNlRXhpc3RpbmdFY3JcbiAgICAgID8gZWNyLlJlcG9zaXRvcnkuZnJvbVJlcG9zaXRvcnlOYW1lKFxuICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgJ0NvZGVBZ2VudFJlcG9zaXRvcnknLFxuICAgICAgICAgIGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50YFxuICAgICAgICApXG4gICAgICA6IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnQ29kZUFnZW50UmVwb3NpdG9yeScsIHtcbiAgICAgICAgICByZXBvc2l0b3J5TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnRgLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsIG1heEltYWdlQ291bnQ6IDEwIH1dLFxuICAgICAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCAyOiBJQU0gRXhlY3V0aW9uIFJvbGVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2RlQWdlbnRFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXhlY3V0aW9uIHJvbGUgZm9yIENvZGUgQWdlbnQgQWdlbnRDb3JlIFJ1bnRpbWUnLFxuICAgIH0pXG5cbiAgICAvLyBFQ1IgQWNjZXNzXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnRUNSSW1hZ2VBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLCAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbiddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czplY3I6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnJlcG9zaXRvcnkvKmAsICcqJ10sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJyxcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ0dyb3VwcycsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2JlZHJvY2stYWdlbnRjb3JlL3J1bnRpbWVzLypgLFxuICAgICAgICAgIGBhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gWC1SYXkgYW5kIENsb3VkV2F0Y2ggTWV0cmljc1xuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgICAgICdjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBCZWRyb2NrIE1vZGVsIEFjY2VzcyAoQ2xhdWRlIEFnZW50IFNESyBjYWxscyBCZWRyb2NrIHZpYSBJQU0gcm9sZSlcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdCZWRyb2NrTW9kZWxJbnZvY2F0aW9uJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJyxcbiAgICAgICAgICAnYmVkcm9jazpDb252ZXJzZScsXG4gICAgICAgICAgJ2JlZHJvY2s6Q29udmVyc2VTdHJlYW0nLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvKmAsXG4gICAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06KmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFBhcmFtZXRlciBTdG9yZSAoZm9yIGNvbmZpZ3VyYXRpb24pXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3NzbTpHZXRQYXJhbWV0ZXInLCAnc3NtOkdldFBhcmFtZXRlcnMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIvJHtwcm9qZWN0TmFtZX0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIFMzIERvY3VtZW50IEJ1Y2tldCBBY2Nlc3MgKHJlYWQgdXBsb2FkZWQgZmlsZXMgKyB3cml0ZSB3b3Jrc3BhY2Ugb3V0cHV0KVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ1MzRG9jdW1lbnRCdWNrZXRBY2Nlc3MnLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0JywgJ3MzOkRlbGV0ZU9iamVjdCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzMzo6OiR7cHJvamVjdE5hbWV9LSpgLFxuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHtwcm9qZWN0TmFtZX0tKi8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gSW1wb3J0IGRvY3VtZW50IGJ1Y2tldCBuYW1lIGZyb20gbWFpbiBBZ2VudENvcmUgUnVudGltZSBzdGFjayBleHBvcnRcbiAgICBjb25zdCBkb2N1bWVudEJ1Y2tldE5hbWUgPSBjZGsuRm4uaW1wb3J0VmFsdWUoYCR7cHJvamVjdE5hbWV9LWRvY3VtZW50LWJ1Y2tldGApXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDM6IFMzIEJ1Y2tldCBmb3IgQ29kZUJ1aWxkIFNvdXJjZVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHNvdXJjZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0NvZGVBZ2VudFNvdXJjZUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50LXNyYy0ke3RoaXMuYWNjb3VudH0tJHt0aGlzLnJlZ2lvbn1gLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7IGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLCBpZDogJ0RlbGV0ZU9sZFNvdXJjZXMnIH1dLFxuICAgIH0pXG5cbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdTM1NvdXJjZUFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6TGlzdEJ1Y2tldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtzb3VyY2VCdWNrZXQuYnVja2V0QXJuLCBgJHtzb3VyY2VCdWNrZXQuYnVja2V0QXJufS8qYF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNDogQ29kZUJ1aWxkIFByb2plY3RcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBjb2RlQnVpbGRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2RlQWdlbnRDb2RlQnVpbGRSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2NvZGVidWlsZC5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIHJvbGUgZm9yIENvZGUgQWdlbnQgY29udGFpbmVyJyxcbiAgICB9KVxuXG4gICAgY29kZUJ1aWxkUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgICAgICAnZWNyOkJhdGNoR2V0SW1hZ2UnLFxuICAgICAgICAgICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsXG4gICAgICAgICAgJ2VjcjpQdXRJbWFnZScsXG4gICAgICAgICAgJ2VjcjpJbml0aWF0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgICAnZWNyOlVwbG9hZExheWVyUGFydCcsXG4gICAgICAgICAgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgJyonLFxuICAgICAgICAgIGBhcm46YXdzOmVjcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cmVwb3NpdG9yeS8ke3JlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWV9YCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29kZUJ1aWxkUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvY29kZWJ1aWxkLyR7cHJvamVjdE5hbWV9LSpgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0JywgJ3MzOlB1dE9iamVjdCcsICdzMzpMaXN0QnVja2V0J10sXG4gICAgICAgIHJlc291cmNlczogW3NvdXJjZUJ1Y2tldC5idWNrZXRBcm4sIGAke3NvdXJjZUJ1Y2tldC5idWNrZXRBcm59LypgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29uc3QgYnVpbGRQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdDb2RlQWdlbnRCdWlsZFByb2plY3QnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtYnVpbGRlcmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0J1aWxkcyBBUk02NCBjb250YWluZXIgaW1hZ2UgZm9yIENvZGUgQWdlbnQgQTJBIFJ1bnRpbWUnLFxuICAgICAgcm9sZTogY29kZUJ1aWxkUm9sZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfQVJNXzMsXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgc291cmNlOiBjb2RlYnVpbGQuU291cmNlLnMzKHtcbiAgICAgICAgYnVja2V0OiBzb3VyY2VCdWNrZXQsXG4gICAgICAgIHBhdGg6ICdjb2RlLWFnZW50LXNvdXJjZS8nLFxuICAgICAgfSksXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gQW1hem9uIEVDUi4uLicsXG4gICAgICAgICAgICAgIGBhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAke3RoaXMucmVnaW9ufSB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICR7dGhpcy5hY2NvdW50fS5ka3IuZWNyLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZGluZyBDb2RlIEFnZW50IERvY2tlciBpbWFnZSBmb3IgQVJNNjQuLi4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIGJ1aWxkIC0tcGxhdGZvcm0gbGludXgvYXJtNjQgLXQgY29kZS1hZ2VudDpsYXRlc3QgLicsXG4gICAgICAgICAgICAgIGBkb2NrZXIgdGFnIGNvZGUtYWdlbnQ6bGF0ZXN0ICR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHBvc3RfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIFB1c2hpbmcgRG9ja2VyIGltYWdlIHRvIEVDUi4uLicsXG4gICAgICAgICAgICAgIGBkb2NrZXIgcHVzaCAke3JlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YCxcbiAgICAgICAgICAgICAgJ2VjaG8gQnVpbGQgY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA1OiBVcGxvYWQgU291cmNlIHRvIFMzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYWdlbnRTb3VyY2VVcGxvYWQgPSBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnQ29kZUFnZW50U291cmNlVXBsb2FkJywge1xuICAgICAgc291cmNlczogW1xuICAgICAgICBzM2RlcGxveS5Tb3VyY2UuYXNzZXQoJy4uJywge1xuICAgICAgICAgIGV4Y2x1ZGU6IFtcbiAgICAgICAgICAgICd2ZW52LyoqJywgJy52ZW52LyoqJywgJ19fcHljYWNoZV9fLyoqJywgJyoucHljJyxcbiAgICAgICAgICAgICcuZ2l0LyoqJywgJ25vZGVfbW9kdWxlcy8qKicsICcuRFNfU3RvcmUnLCAnKi5sb2cnLFxuICAgICAgICAgICAgJ2Nkay8qKicsICdjZGsub3V0LyoqJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogc291cmNlQnVja2V0LFxuICAgICAgZGVzdGluYXRpb25LZXlQcmVmaXg6ICdjb2RlLWFnZW50LXNvdXJjZS8nLFxuICAgICAgcHJ1bmU6IGZhbHNlLFxuICAgICAgcmV0YWluT25EZWxldGU6IGZhbHNlLFxuICAgIH0pXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDY6IFRyaWdnZXIgQ29kZUJ1aWxkXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYnVpbGRUcmlnZ2VyID0gbmV3IGNyLkF3c0N1c3RvbVJlc291cmNlKHRoaXMsICdUcmlnZ2VyQ29kZUFnZW50Q29kZUJ1aWxkJywge1xuICAgICAgb25DcmVhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0NvZGVCdWlsZCcsXG4gICAgICAgIGFjdGlvbjogJ3N0YXJ0QnVpbGQnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7IHByb2plY3ROYW1lOiBidWlsZFByb2plY3QucHJvamVjdE5hbWUgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoYGNvZGUtYWdlbnQtYnVpbGQtJHtEYXRlLm5vdygpfWApLFxuICAgICAgfSxcbiAgICAgIG9uVXBkYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6ICdDb2RlQnVpbGQnLFxuICAgICAgICBhY3Rpb246ICdzdGFydEJ1aWxkJyxcbiAgICAgICAgcGFyYW1ldGVyczogeyBwcm9qZWN0TmFtZTogYnVpbGRQcm9qZWN0LnByb2plY3ROYW1lIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogY3IuUGh5c2ljYWxSZXNvdXJjZUlkLm9mKGBjb2RlLWFnZW50LWJ1aWxkLSR7RGF0ZS5ub3coKX1gKSxcbiAgICAgIH0sXG4gICAgICBwb2xpY3k6IGNyLkF3c0N1c3RvbVJlc291cmNlUG9saWN5LmZyb21TdGF0ZW1lbnRzKFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpTdGFydEJ1aWxkJywgJ2NvZGVidWlsZDpCYXRjaEdldEJ1aWxkcyddLFxuICAgICAgICAgIHJlc291cmNlczogW2J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgIH0pXG5cbiAgICBidWlsZFRyaWdnZXIubm9kZS5hZGREZXBlbmRlbmN5KGFnZW50U291cmNlVXBsb2FkKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA3OiBXYWl0IGZvciBCdWlsZCBDb21wbGV0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgYnVpbGRXYWl0ZXJGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NvZGVBZ2VudEJ1aWxkV2FpdGVyJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmNvbnN0IHsgQ29kZUJ1aWxkQ2xpZW50LCBCYXRjaEdldEJ1aWxkc0NvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1jb2RlYnVpbGQnKTtcblxuZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGlmIChldmVudC5SZXF1ZXN0VHlwZSA9PT0gJ0RlbGV0ZScpIHtcbiAgICByZXR1cm4gc2VuZFJlc3BvbnNlKGV2ZW50LCAnU1VDQ0VTUycsIHsgU3RhdHVzOiAnREVMRVRFRCcgfSk7XG4gIH1cblxuICBjb25zdCBidWlsZElkID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzLkJ1aWxkSWQ7XG4gIGNvbnN0IG1heFdhaXRNaW51dGVzID0gMTQ7XG4gIGNvbnN0IHBvbGxJbnRlcnZhbFNlY29uZHMgPSAzMDtcbiAgY29uc3QgY2xpZW50ID0gbmV3IENvZGVCdWlsZENsaWVudCh7fSk7XG4gIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gIGNvbnN0IG1heFdhaXRNcyA9IG1heFdhaXRNaW51dGVzICogNjAgKiAxMDAwO1xuXG4gIHdoaWxlIChEYXRlLm5vdygpIC0gc3RhcnRUaW1lIDwgbWF4V2FpdE1zKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LnNlbmQobmV3IEJhdGNoR2V0QnVpbGRzQ29tbWFuZCh7IGlkczogW2J1aWxkSWRdIH0pKTtcbiAgICAgIGNvbnN0IGJ1aWxkID0gcmVzcG9uc2UuYnVpbGRzWzBdO1xuICAgICAgY29uc3Qgc3RhdHVzID0gYnVpbGQuYnVpbGRTdGF0dXM7XG5cbiAgICAgIGlmIChzdGF0dXMgPT09ICdTVUNDRUVERUQnKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCBzZW5kUmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgeyBTdGF0dXM6ICdTVUNDRUVERUQnIH0pO1xuICAgICAgfSBlbHNlIGlmIChbJ0ZBSUxFRCcsICdGQVVMVCcsICdUSU1FRF9PVVQnLCAnU1RPUFBFRCddLmluY2x1ZGVzKHN0YXR1cykpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBcXGBCdWlsZCBmYWlsZWQ6IFxcJHtzdGF0dXN9XFxgKTtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHBvbGxJbnRlcnZhbFNlY29uZHMgKiAxMDAwKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJldHVybiBhd2FpdCBzZW5kUmVzcG9uc2UoZXZlbnQsICdGQUlMRUQnLCB7fSwgZXJyb3IubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBcXGBCdWlsZCB0aW1lb3V0IGFmdGVyIFxcJHttYXhXYWl0TWludXRlc30gbWludXRlc1xcYCk7XG59O1xuXG5hc3luYyBmdW5jdGlvbiBzZW5kUmVzcG9uc2UoZXZlbnQsIHN0YXR1cywgZGF0YSwgcmVhc29uKSB7XG4gIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04uc3RyaW5naWZ5KHtcbiAgICBTdGF0dXM6IHN0YXR1cyxcbiAgICBSZWFzb246IHJlYXNvbiB8fCBcXGBTZWUgQ2xvdWRXYXRjaCBMb2cgU3RyZWFtOiBcXCR7ZXZlbnQuTG9nU3RyZWFtTmFtZX1cXGAsXG4gICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBldmVudC5QaHlzaWNhbFJlc291cmNlSWQgfHwgZXZlbnQuUmVxdWVzdElkLFxuICAgIFN0YWNrSWQ6IGV2ZW50LlN0YWNrSWQsXG4gICAgUmVxdWVzdElkOiBldmVudC5SZXF1ZXN0SWQsXG4gICAgTG9naWNhbFJlc291cmNlSWQ6IGV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkLFxuICAgIERhdGE6IGRhdGFcbiAgfSk7XG5cbiAgY29uc3QgaHR0cHMgPSByZXF1aXJlKCdodHRwcycpO1xuICBjb25zdCB1cmwgPSByZXF1aXJlKCd1cmwnKTtcbiAgY29uc3QgcGFyc2VkVXJsID0gdXJsLnBhcnNlKGV2ZW50LlJlc3BvbnNlVVJMKTtcblxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICBob3N0bmFtZTogcGFyc2VkVXJsLmhvc3RuYW1lLFxuICAgICAgcG9ydDogNDQzLFxuICAgICAgcGF0aDogcGFyc2VkVXJsLnBhdGgsXG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJycsICdDb250ZW50LUxlbmd0aCc6IHJlc3BvbnNlQm9keS5sZW5ndGggfVxuICAgIH07XG4gICAgY29uc3QgcmVxdWVzdCA9IGh0dHBzLnJlcXVlc3Qob3B0aW9ucywgKHJlc3BvbnNlKSA9PiB7IHJlc29sdmUoZGF0YSk7IH0pO1xuICAgIHJlcXVlc3Qub24oJ2Vycm9yJywgKGVycm9yKSA9PiB7IHJlamVjdChlcnJvcik7IH0pO1xuICAgIHJlcXVlc3Qud3JpdGUocmVzcG9uc2VCb2R5KTtcbiAgICByZXF1ZXN0LmVuZCgpO1xuICB9KTtcbn1cbiAgICAgIGApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgIH0pXG5cbiAgICBidWlsZFdhaXRlckZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpCYXRjaEdldEJ1aWxkcyddLFxuICAgICAgICByZXNvdXJjZXM6IFtidWlsZFByb2plY3QucHJvamVjdEFybl0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvbnN0IGJ1aWxkV2FpdGVyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnQ29kZUFnZW50QnVpbGRXYWl0ZXJSZXNvdXJjZScsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogYnVpbGRXYWl0ZXJGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIHByb3BlcnRpZXM6IHsgQnVpbGRJZDogYnVpbGRUcmlnZ2VyLmdldFJlc3BvbnNlRmllbGQoJ2J1aWxkLmlkJykgfSxcbiAgICB9KVxuXG4gICAgYnVpbGRXYWl0ZXIubm9kZS5hZGREZXBlbmRlbmN5KGJ1aWxkVHJpZ2dlcilcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgODogQ3JlYXRlIEFnZW50Q29yZSBSdW50aW1lIChBMkEgcHJvdG9jb2wpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3QgcnVudGltZU5hbWUgPSBwcm9qZWN0TmFtZS5yZXBsYWNlKC8tL2csICdfJykgKyAnX2NvZGVfYWdlbnRfcnVudGltZSdcbiAgICBjb25zdCBydW50aW1lID0gbmV3IGFnZW50Y29yZS5DZm5SdW50aW1lKHRoaXMsICdDb2RlQWdlbnRSdW50aW1lJywge1xuICAgICAgYWdlbnRSdW50aW1lTmFtZTogcnVudGltZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZGUgQWdlbnQgQTJBIFJ1bnRpbWUgLSBBdXRvbm9tb3VzIGNvZGluZyB3aXRoIENsYXVkZSBBZ2VudCBTREsnLFxuICAgICAgcm9sZUFybjogZXhlY3V0aW9uUm9sZS5yb2xlQXJuLFxuXG4gICAgICBhZ2VudFJ1bnRpbWVBcnRpZmFjdDoge1xuICAgICAgICBjb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgY29udGFpbmVyVXJpOiBgJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuXG4gICAgICBuZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBuZXR3b3JrTW9kZTogJ1BVQkxJQycsXG4gICAgICB9LFxuXG4gICAgICAvLyBBMkEgcHJvdG9jb2wgKHNhbWUgYXMgcmVzZWFyY2gtYWdlbnQpXG4gICAgICBwcm90b2NvbENvbmZpZ3VyYXRpb246ICdBMkEnLFxuXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICBMT0dfTEVWRUw6ICdJTkZPJyxcbiAgICAgICAgUFJPSkVDVF9OQU1FOiBwcm9qZWN0TmFtZSxcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgICBBV1NfREVGQVVMVF9SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICBBV1NfUkVHSU9OOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgLy8gQ2xhdWRlIEFnZW50IFNESyBCZWRyb2NrIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgIENMQVVERV9DT0RFX1VTRV9CRURST0NLOiAnMScsXG4gICAgICAgIEFOVEhST1BJQ19NT0RFTDogYW50aHJvcGljTW9kZWwsXG4gICAgICAgIE9URUxfUFlUSE9OX0RJU0FCTEVEX0lOU1RSVU1FTlRBVElPTlM6ICdib3RvLGJvdG9jb3JlJyxcbiAgICAgICAgLy8gUzMgYnVja2V0IGZvciBzeW5jaW5nIHdvcmtzcGFjZSBvdXRwdXQgYWZ0ZXIgZWFjaCB0YXNrXG4gICAgICAgIERPQ1VNRU5UX0JVQ0tFVDogZG9jdW1lbnRCdWNrZXROYW1lLFxuICAgICAgICAvLyBGb3JjZXMgQ2xvdWRGb3JtYXRpb24gdG8gZGV0ZWN0IGEgY2hhbmdlIG9uIGV2ZXJ5IGRlcGxveSxcbiAgICAgICAgLy8gc28gdGhlIFJ1bnRpbWUgcHVsbHMgdGhlIGxhdGVzdCBpbWFnZSBmcm9tIEVDUiBlYWNoIHRpbWUuXG4gICAgICAgIEJVSUxEX1RJTUVTVEFNUDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcblxuICAgICAgdGFnczoge1xuICAgICAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFwcGxpY2F0aW9uOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudGAsXG4gICAgICAgIFR5cGU6ICdBMkEtQWdlbnQnLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koZXhlY3V0aW9uUm9sZSlcbiAgICBydW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShidWlsZFdhaXRlcilcblxuICAgIHRoaXMucnVudGltZSA9IHJ1bnRpbWVcbiAgICB0aGlzLnJ1bnRpbWVBcm4gPSBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgOTogU3RvcmUgUnVudGltZSBBUk4gaW4gUGFyYW1ldGVyIFN0b3JlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0NvZGVBZ2VudFJ1bnRpbWVBcm5QYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L2EyYS9jb2RlLWFnZW50LXJ1bnRpbWUtYXJuYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZGUgQWdlbnQgQWdlbnRDb3JlIFJ1bnRpbWUgQVJOJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pXG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnQ29kZUFnZW50UnVudGltZUlkUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb2plY3ROYW1lfS8ke2Vudmlyb25tZW50fS9hMmEvY29kZS1hZ2VudC1ydW50aW1lLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBJRCcsXG4gICAgICB0aWVyOiBzc20uUGFyYW1ldGVyVGllci5TVEFOREFSRCxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNSIFJlcG9zaXRvcnkgVVJJIGZvciBDb2RlIEFnZW50IGNvbnRhaW5lcicsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudC1yZXBvLXVyaWAsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtcnVudGltZS1hcm5gLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUnVudGltZUlkJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2RlIEFnZW50IEFnZW50Q29yZSBSdW50aW1lIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50LXJ1bnRpbWUtaWRgLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==