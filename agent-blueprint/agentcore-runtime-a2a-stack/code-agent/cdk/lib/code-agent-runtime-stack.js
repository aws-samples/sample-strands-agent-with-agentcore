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
        // DynamoDB: Read and clear stop signal (phase 2 of two-phase stop protocol)
        executionRole.addToPolicy(new iam.PolicyStatement({
            sid: 'DynamoDBStopSignalAccess',
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${projectName}-users-v2`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29kZS1hZ2VudC1ydW50aW1lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7O0dBSUc7QUFDSCxtQ0FBa0M7QUFDbEMsOERBQTZEO0FBQzdELDJDQUEwQztBQUMxQywyQ0FBMEM7QUFDMUMsMkNBQTBDO0FBQzFDLHlDQUF3QztBQUN4QywwREFBeUQ7QUFDekQsdURBQXNEO0FBQ3RELG1EQUFrRDtBQUNsRCxpREFBZ0Q7QUFTaEQsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNsQyxPQUFPLENBQXNCO0lBQzdCLFVBQVUsQ0FBUTtJQUVsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWtDO1FBQzFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksdUJBQXVCLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxLQUFLLENBQUE7UUFDL0MsTUFBTSxjQUFjLEdBQUcsS0FBSyxFQUFFLGNBQWMsSUFBSSxnQ0FBZ0MsQ0FBQTtRQUVoRiwrREFBK0Q7UUFDL0QseUJBQXlCO1FBQ3pCLCtEQUErRDtRQUMvRCxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixLQUFLLE1BQU0sQ0FBQTtRQUM5RCxNQUFNLFVBQVUsR0FBRyxjQUFjO1lBQy9CLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUMvQixJQUFJLEVBQ0oscUJBQXFCLEVBQ3JCLEdBQUcsV0FBVyxhQUFhLENBQzVCO1lBQ0gsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7Z0JBQzlDLGNBQWMsRUFBRSxHQUFHLFdB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Q25DLEtBQUssRUFBRSxPQUFPLENBQUMsa0JBQWtCO1lBQ2pDLFdBQVcsRUFBRSxpQ0FBaUM7WUFDOUMsVUFBVSxFQUFFLEdBQUcsV0FBVyx3QkFBd0I7U0FDbkQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGO0FBcmRELHNEQXFkQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ29kZSBBZ2VudCBBMkEgUnVudGltZSBTdGFja1xuICogRGVwbG95cyBDb2RlIEFnZW50IChDbGF1ZGUgQWdlbnQgU0RLIHdyYXBwZXIpIGFzIEFnZW50Q29yZSBBMkEgUnVudGltZVxuICogQmFzZWQgb24gcmVzZWFyY2gtYWdlbnQgcGF0dGVybiAtIG5vIFMzIGNoYXJ0IGJ1Y2tldCBvciBDb2RlIEludGVycHJldGVyIG5lZWRlZFxuICovXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInXG5pbXBvcnQgKiBhcyBhZ2VudGNvcmUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWJlZHJvY2thZ2VudGNvcmUnXG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcidcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJ1xuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnXG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCdcbmltcG9ydCAqIGFzIGNvZGVidWlsZCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJ1xuaW1wb3J0ICogYXMgY3IgZnJvbSAnYXdzLWNkay1saWIvY3VzdG9tLXJlc291cmNlcydcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJ1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cydcblxuZXhwb3J0IGludGVyZmFjZSBDb2RlQWdlbnRSdW50aW1lU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgcHJvamVjdE5hbWU/OiBzdHJpbmdcbiAgZW52aXJvbm1lbnQ/OiBzdHJpbmdcbiAgYW50aHJvcGljTW9kZWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIENvZGVBZ2VudFJ1bnRpbWVTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBydW50aW1lOiBhZ2VudGNvcmUuQ2ZuUnVudGltZVxuICBwdWJsaWMgcmVhZG9ubHkgcnVudGltZUFybjogc3RyaW5nXG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBDb2RlQWdlbnRSdW50aW1lU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpXG5cbiAgICBjb25zdCBwcm9qZWN0TmFtZSA9IHByb3BzPy5wcm9qZWN0TmFtZSB8fCAnc3RyYW5kcy1hZ2VudC1jaGF0Ym90J1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gcHJvcHM/LmVudmlyb25tZW50IHx8ICdkZXYnXG4gICAgY29uc3QgYW50aHJvcGljTW9kZWwgPSBwcm9wcz8uYW50aHJvcGljTW9kZWwgfHwgJ3VzLmFudGhyb3BpYy5jbGF1ZGUtc29ubmV0LTQtNidcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgMTogRUNSIFJlcG9zaXRvcnlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCB1c2VFeGlzdGluZ0VjciA9IHByb2Nlc3MuZW52LlVTRV9FWElTVElOR19FQ1IgPT09ICd0cnVlJ1xuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSB1c2VFeGlzdGluZ0VjclxuICAgICAgPyBlY3IuUmVwb3NpdG9yeS5mcm9tUmVwb3NpdG9yeU5hbWUoXG4gICAgICAgICAgdGhpcyxcbiAgICAgICAgICAnQ29kZUFnZW50UmVwb3NpdG9yeScsXG4gICAgICAgICAgYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnRgXG4gICAgICAgIClcbiAgICAgIDogbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdDb2RlQWdlbnRSZXBvc2l0b3J5Jywge1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudGAsXG4gICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgICAgICBsaWZlY3ljbGVSdWxlczogW3sgZGVzY3JpcHRpb246ICdLZWVwIGxhc3QgMTAgaW1hZ2VzJywgbWF4SW1hZ2VDb3VudDogMTAgfV0sXG4gICAgICAgIH0pXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDI6IElBTSBFeGVjdXRpb24gUm9sZVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0NvZGVBZ2VudEV4ZWN1dGlvblJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdFeGVjdXRpb24gcm9sZSBmb3IgQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZScsXG4gICAgfSlcblxuICAgIC8vIEVDUiBBY2Nlc3NcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdFQ1JJbWFnZUFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydlY3I6QmF0Y2hHZXRJbWFnZScsICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJ10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmVjcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cmVwb3NpdG9yeS8qYCwgJyonXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gQ2xvdWRXYXRjaCBMb2dzXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ1N0cmVhbXMnLFxuICAgICAgICAgICdsb2dzOkRlc2NyaWJlTG9nR3JvdXBzJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvcnVudGltZXMvKmAsXG4gICAgICAgICAgYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOipgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBYLVJheSBhbmQgQ2xvdWRXYXRjaCBNZXRyaWNzXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsXG4gICAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICAgICAgJ2Nsb3Vkd2F0Y2g6UHV0TWV0cmljRGF0YScsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KVxuICAgIClcblxuICAgIC8vIEJlZHJvY2sgTW9kZWwgQWNjZXNzIChDbGF1ZGUgQWdlbnQgU0RLIGNhbGxzIEJlZHJvY2sgdmlhIElBTSByb2xlKVxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0JlZHJvY2tNb2RlbEludm9jYXRpb24nLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAgICdiZWRyb2NrOkNvbnZlcnNlJyxcbiAgICAgICAgICAnYmVkcm9jazpDb252ZXJzZVN0cmVhbScsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC8qYCxcbiAgICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToqYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gUGFyYW1ldGVyIFN0b3JlIChmb3IgY29uZmlndXJhdGlvbilcbiAgICBleGVjdXRpb25Sb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycyddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlci8ke3Byb2plY3ROYW1lfS8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gUzMgRG9jdW1lbnQgQnVja2V0IEFjY2VzcyAocmVhZCB1cGxvYWRlZCBmaWxlcyArIHdyaXRlIHdvcmtzcGFjZSBvdXRwdXQpXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnUzNEb2N1bWVudEJ1Y2tldEFjY2VzcycsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkxpc3RCdWNrZXQnLCAnczM6RGVsZXRlT2JqZWN0J10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOnMzOjo6JHtwcm9qZWN0TmFtZX0tKmAsXG4gICAgICAgICAgYGFybjphd3M6czM6Ojoke3Byb2plY3ROYW1lfS0qLypgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBEeW5hbW9EQjogUmVhZCBhbmQgY2xlYXIgc3RvcCBzaWduYWwgKHBoYXNlIDIgb2YgdHdvLXBoYXNlIHN0b3AgcHJvdG9jb2wpXG4gICAgZXhlY3V0aW9uUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnRHluYW1vREJTdG9wU2lnbmFsQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOkdldEl0ZW0nLCAnZHluYW1vZGI6RGVsZXRlSXRlbSddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtwcm9qZWN0TmFtZX0tdXNlcnMtdjJgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICAvLyBJbXBvcnQgZG9jdW1lbnQgYnVja2V0IG5hbWUgZnJvbSBtYWluIEFnZW50Q29yZSBSdW50aW1lIHN0YWNrIGV4cG9ydFxuICAgIGNvbnN0IGRvY3VtZW50QnVja2V0TmFtZSA9IGNkay5Gbi5pbXBvcnRWYWx1ZShgJHtwcm9qZWN0TmFtZX0tZG9jdW1lbnQtYnVja2V0YClcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgMzogUzMgQnVja2V0IGZvciBDb2RlQnVpbGQgU291cmNlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3Qgc291cmNlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQ29kZUFnZW50U291cmNlQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtc3JjLSR7dGhpcy5hY2NvdW50fS0ke3RoaXMucmVnaW9ufWAsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW3sgZXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksIGlkOiAnRGVsZXRlT2xkU291cmNlcycgfV0sXG4gICAgfSlcblxuICAgIGV4ZWN1dGlvblJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ1MzU291cmNlQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpMaXN0QnVja2V0J10sXG4gICAgICAgIHJlc291cmNlczogW3NvdXJjZUJ1Y2tldC5idWNrZXRBcm4sIGAke3NvdXJjZUJ1Y2tldC5idWNrZXRBcm59LypgXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA0OiBDb2RlQnVpbGQgUHJvamVjdFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGNvZGVCdWlsZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0NvZGVBZ2VudENvZGVCdWlsZFJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgcm9sZSBmb3IgQ29kZSBBZ2VudCBjb250YWluZXInLFxuICAgIH0pXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLFxuICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICAgJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJyxcbiAgICAgICAgICAnZWNyOlB1dEltYWdlJyxcbiAgICAgICAgICAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLFxuICAgICAgICAgICdlY3I6VXBsb2FkTGF5ZXJQYXJ0JyxcbiAgICAgICAgICAnZWNyOkNvbXBsZXRlTGF5ZXJVcGxvYWQnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAnKicsXG4gICAgICAgICAgYGFybjphd3M6ZWNyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpyZXBvc2l0b3J5LyR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZX1gLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb2RlQnVpbGRSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnbG9nczpDcmVhdGVMb2dHcm91cCcsICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9jb2RlYnVpbGQvJHtwcm9qZWN0TmFtZX0tKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgIClcblxuICAgIGNvZGVCdWlsZFJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkxpc3RCdWNrZXQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbc291cmNlQnVja2V0LmJ1Y2tldEFybiwgYCR7c291cmNlQnVja2V0LmJ1Y2tldEFybn0vKmBdLFxuICAgICAgfSlcbiAgICApXG5cbiAgICBjb25zdCBidWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ0NvZGVBZ2VudEJ1aWxkUHJvamVjdCcsIHtcbiAgICAgIHByb2plY3ROYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudC1idWlsZGVyYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGRzIEFSTTY0IGNvbnRhaW5lciBpbWFnZSBmb3IgQ29kZSBBZ2VudCBBMkEgUnVudGltZScsXG4gICAgICByb2xlOiBjb2RlQnVpbGRSb2xlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl9BUk1fMyxcbiAgICAgICAgY29tcHV0ZVR5cGU6IGNvZGVidWlsZC5Db21wdXRlVHlwZS5TTUFMTCxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHNvdXJjZUJ1Y2tldCxcbiAgICAgICAgcGF0aDogJ2NvZGUtYWdlbnQtc291cmNlLycsXG4gICAgICB9KSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gTG9nZ2luZyBpbiB0byBBbWF6b24gRUNSLi4uJyxcbiAgICAgICAgICAgICAgYGF3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICR7dGhpcy5yZWdpb259IHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJHt0aGlzLmFjY291bnR9LmRrci5lY3IuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkaW5nIENvZGUgQWdlbnQgRG9ja2VyIGltYWdlIGZvciBBUk02NC4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLS1wbGF0Zm9ybSBsaW51eC9hcm02NCAtdCBjb2RlLWFnZW50OmxhdGVzdCAuJyxcbiAgICAgICAgICAgICAgYGRvY2tlciB0YWcgY29kZS1hZ2VudDpsYXRlc3QgJHtyZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyBEb2NrZXIgaW1hZ2UgdG8gRUNSLi4uJyxcbiAgICAgICAgICAgICAgYGRvY2tlciBwdXNoICR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgLFxuICAgICAgICAgICAgICAnZWNobyBCdWlsZCBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5JyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIH0pXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDU6IFVwbG9hZCBTb3VyY2UgdG8gUzNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBhZ2VudFNvdXJjZVVwbG9hZCA9IG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdDb2RlQWdlbnRTb3VyY2VVcGxvYWQnLCB7XG4gICAgICBzb3VyY2VzOiBbXG4gICAgICAgIHMzZGVwbG95LlNvdXJjZS5hc3NldCgnLi4nLCB7XG4gICAgICAgICAgZXhjbHVkZTogW1xuICAgICAgICAgICAgJ3ZlbnYvKionLCAnLnZlbnYvKionLCAnX19weWNhY2hlX18vKionLCAnKi5weWMnLFxuICAgICAgICAgICAgJy5naXQvKionLCAnbm9kZV9tb2R1bGVzLyoqJywgJy5EU19TdG9yZScsICcqLmxvZycsXG4gICAgICAgICAgICAnY2RrLyoqJywgJ2Nkay5vdXQvKionLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBzb3VyY2VCdWNrZXQsXG4gICAgICBkZXN0aW5hdGlvbktleVByZWZpeDogJ2NvZGUtYWdlbnQtc291cmNlLycsXG4gICAgICBwcnVuZTogZmFsc2UsXG4gICAgICByZXRhaW5PbkRlbGV0ZTogZmFsc2UsXG4gICAgfSlcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgNjogVHJpZ2dlciBDb2RlQnVpbGRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFRyaWdnZXIgPSBuZXcgY3IuQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgJ1RyaWdnZXJDb2RlQWdlbnRDb2RlQnVpbGQnLCB7XG4gICAgICBvbkNyZWF0ZToge1xuICAgICAgICBzZXJ2aWNlOiAnQ29kZUJ1aWxkJyxcbiAgICAgICAgYWN0aW9uOiAnc3RhcnRCdWlsZCcsXG4gICAgICAgIHBhcmFtZXRlcnM6IHsgcHJvamVjdE5hbWU6IGJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZihgY29kZS1hZ2VudC1idWlsZC0ke0RhdGUubm93KCl9YCksXG4gICAgICB9LFxuICAgICAgb25VcGRhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0NvZGVCdWlsZCcsXG4gICAgICAgIGFjdGlvbjogJ3N0YXJ0QnVpbGQnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7IHByb2plY3ROYW1lOiBidWlsZFByb2plY3QucHJvamVjdE5hbWUgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoYGNvZGUtYWdlbnQtYnVpbGQtJHtEYXRlLm5vdygpfWApLFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogY3IuQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnLCAnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbYnVpbGRQcm9qZWN0LnByb2plY3RBcm5dLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSlcblxuICAgIGJ1aWxkVHJpZ2dlci5ub2RlLmFkZERlcGVuZGVuY3koYWdlbnRTb3VyY2VVcGxvYWQpXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBTdGVwIDc6IFdhaXQgZm9yIEJ1aWxkIENvbXBsZXRpb25cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBidWlsZFdhaXRlckZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ29kZUFnZW50QnVpbGRXYWl0ZXInLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuY29uc3QgeyBDb2RlQnVpbGRDbGllbnQsIEJhdGNoR2V0QnVpbGRzQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWNvZGVidWlsZCcpO1xuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgaWYgKGV2ZW50LlJlcXVlc3RUeXBlID09PSAnRGVsZXRlJykge1xuICAgIHJldHVybiBzZW5kUmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgeyBTdGF0dXM6ICdERUxFVEVEJyB9KTtcbiAgfVxuXG4gIGNvbnN0IGJ1aWxkSWQgPSBldmVudC5SZXNvdXJjZVByb3BlcnRpZXMuQnVpbGRJZDtcbiAgY29uc3QgbWF4V2FpdE1pbnV0ZXMgPSAxNDtcbiAgY29uc3QgcG9sbEludGVydmFsU2Vjb25kcyA9IDMwO1xuICBjb25zdCBjbGllbnQgPSBuZXcgQ29kZUJ1aWxkQ2xpZW50KHt9KTtcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgbWF4V2FpdE1zID0gbWF4V2FpdE1pbnV0ZXMgKiA2MCAqIDEwMDA7XG5cbiAgd2hpbGUgKERhdGUubm93KCkgLSBzdGFydFRpbWUgPCBtYXhXYWl0TXMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChuZXcgQmF0Y2hHZXRCdWlsZHNDb21tYW5kKHsgaWRzOiBbYnVpbGRJZF0gfSkpO1xuICAgICAgY29uc3QgYnVpbGQgPSByZXNwb25zZS5idWlsZHNbMF07XG4gICAgICBjb25zdCBzdGF0dXMgPSBidWlsZC5idWlsZFN0YXR1cztcblxuICAgICAgaWYgKHN0YXR1cyA9PT0gJ1NVQ0NFRURFRCcpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ1NVQ0NFU1MnLCB7IFN0YXR1czogJ1NVQ0NFRURFRCcgfSk7XG4gICAgICB9IGVsc2UgaWYgKFsnRkFJTEVEJywgJ0ZBVUxUJywgJ1RJTUVEX09VVCcsICdTVE9QUEVEJ10uaW5jbHVkZXMoc3RhdHVzKSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIGZhaWxlZDogXFwke3N0YXR1c31cXGApO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgcG9sbEludGVydmFsU2Vjb25kcyAqIDEwMDApKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmV0dXJuIGF3YWl0IHNlbmRSZXNwb25zZShldmVudCwgJ0ZBSUxFRCcsIHt9LCBlcnJvci5tZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYXdhaXQgc2VuZFJlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywge30sIFxcYEJ1aWxkIHRpbWVvdXQgYWZ0ZXIgXFwke21heFdhaXRNaW51dGVzfSBtaW51dGVzXFxgKTtcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRSZXNwb25zZShldmVudCwgc3RhdHVzLCBkYXRhLCByZWFzb24pIHtcbiAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIFN0YXR1czogc3RhdHVzLFxuICAgIFJlYXNvbjogcmVhc29uIHx8IFxcYFNlZSBDbG91ZFdhdGNoIExvZyBTdHJlYW06IFxcJHtldmVudC5Mb2dTdHJlYW1OYW1lfVxcYCxcbiAgICBQaHlzaWNhbFJlc291cmNlSWQ6IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCBldmVudC5SZXF1ZXN0SWQsXG4gICAgU3RhY2tJZDogZXZlbnQuU3RhY2tJZCxcbiAgICBSZXF1ZXN0SWQ6IGV2ZW50LlJlcXVlc3RJZCxcbiAgICBMb2dpY2FsUmVzb3VyY2VJZDogZXZlbnQuTG9naWNhbFJlc291cmNlSWQsXG4gICAgRGF0YTogZGF0YVxuICB9KTtcblxuICBjb25zdCBodHRwcyA9IHJlcXVpcmUoJ2h0dHBzJyk7XG4gIGNvbnN0IHVybCA9IHJlcXVpcmUoJ3VybCcpO1xuICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UoZXZlbnQuUmVzcG9uc2VVUkwpO1xuXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiBwYXJzZWRVcmwuaG9zdG5hbWUsXG4gICAgICBwb3J0OiA0NDMsXG4gICAgICBwYXRoOiBwYXJzZWRVcmwucGF0aCxcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnJywgJ0NvbnRlbnQtTGVuZ3RoJzogcmVzcG9uc2VCb2R5Lmxlbmd0aCB9XG4gICAgfTtcbiAgICBjb25zdCByZXF1ZXN0ID0gaHR0cHMucmVxdWVzdChvcHRpb25zLCAocmVzcG9uc2UpID0+IHsgcmVzb2x2ZShkYXRhKTsgfSk7XG4gICAgcmVxdWVzdC5vbignZXJyb3InLCAoZXJyb3IpID0+IHsgcmVqZWN0KGVycm9yKTsgfSk7XG4gICAgcmVxdWVzdC53cml0ZShyZXNwb25zZUJvZHkpO1xuICAgIHJlcXVlc3QuZW5kKCk7XG4gIH0pO1xufVxuICAgICAgYCksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgfSlcblxuICAgIGJ1aWxkV2FpdGVyRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOkJhdGNoR2V0QnVpbGRzJ10sXG4gICAgICAgIHJlc291cmNlczogW2J1aWxkUHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgY29uc3QgYnVpbGRXYWl0ZXIgPSBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHRoaXMsICdDb2RlQWdlbnRCdWlsZFdhaXRlclJlc291cmNlJywge1xuICAgICAgc2VydmljZVRva2VuOiBidWlsZFdhaXRlckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczogeyBCdWlsZElkOiBidWlsZFRyaWdnZXIuZ2V0UmVzcG9uc2VGaWVsZCgnYnVpbGQuaWQnKSB9LFxuICAgIH0pXG5cbiAgICBidWlsZFdhaXRlci5ub2RlLmFkZERlcGVuZGVuY3koYnVpbGRUcmlnZ2VyKVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU3RlcCA4OiBDcmVhdGUgQWdlbnRDb3JlIFJ1bnRpbWUgKEEyQSBwcm90b2NvbClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBydW50aW1lTmFtZSA9IHByb2plY3ROYW1lLnJlcGxhY2UoLy0vZywgJ18nKSArICdfY29kZV9hZ2VudF9ydW50aW1lJ1xuICAgIGNvbnN0IHJ1bnRpbWUgPSBuZXcgYWdlbnRjb3JlLkNmblJ1bnRpbWUodGhpcywgJ0NvZGVBZ2VudFJ1bnRpbWUnLCB7XG4gICAgICBhZ2VudFJ1bnRpbWVOYW1lOiBydW50aW1lTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBMkEgUnVudGltZSAtIEF1dG9ub21vdXMgY29kaW5nIHdpdGggQ2xhdWRlIEFnZW50IFNESycsXG4gICAgICByb2xlQXJuOiBleGVjdXRpb25Sb2xlLnJvbGVBcm4sXG5cbiAgICAgIGFnZW50UnVudGltZUFydGlmYWN0OiB7XG4gICAgICAgIGNvbnRhaW5lckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBjb250YWluZXJVcmk6IGAke3JlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06bGF0ZXN0YCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG5cbiAgICAgIG5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIG5ldHdvcmtNb2RlOiAnUFVCTElDJyxcbiAgICAgIH0sXG5cbiAgICAgIC8vIEEyQSBwcm90b2NvbCAoc2FtZSBhcyByZXNlYXJjaC1hZ2VudClcbiAgICAgIHByb3RvY29sQ29uZmlndXJhdGlvbjogJ0EyQScsXG5cbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgIExPR19MRVZFTDogJ0lORk8nLFxuICAgICAgICBQUk9KRUNUX05BTUU6IHByb2plY3ROYW1lLFxuICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFXU19ERUZBVUxUX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICAvLyBDbGF1ZGUgQWdlbnQgU0RLIEJlZHJvY2sgYXV0aGVudGljYXRpb25cbiAgICAgICAgQ0xBVURFX0NPREVfVVNFX0JFRFJPQ0s6ICcxJyxcbiAgICAgICAgQU5USFJPUElDX01PREVMOiBhbnRocm9waWNNb2RlbCxcbiAgICAgICAgT1RFTF9QWVRIT05fRElTQUJMRURfSU5TVFJVTUVOVEFUSU9OUzogJ2JvdG8sYm90b2NvcmUnLFxuICAgICAgICAvLyBTMyBidWNrZXQgZm9yIHN5bmNpbmcgd29ya3NwYWNlIG91dHB1dCBhZnRlciBlYWNoIHRhc2tcbiAgICAgICAgRE9DVU1FTlRfQlVDS0VUOiBkb2N1bWVudEJ1Y2tldE5hbWUsXG4gICAgICAgIC8vIER5bmFtb0RCIHRhYmxlIGZvciBvdXQtb2YtYmFuZCBzdG9wIHNpZ25hbCBwb2xsaW5nXG4gICAgICAgIERZTkFNT0RCX1VTRVJTX1RBQkxFOiBgJHtwcm9qZWN0TmFtZX0tdXNlcnMtdjJgLFxuICAgICAgICAvLyBGb3JjZXMgQ2xvdWRGb3JtYXRpb24gdG8gZGV0ZWN0IGEgY2hhbmdlIG9uIGV2ZXJ5IGRlcGxveSxcbiAgICAgICAgLy8gc28gdGhlIFJ1bnRpbWUgcHVsbHMgdGhlIGxhdGVzdCBpbWFnZSBmcm9tIEVDUiBlYWNoIHRpbWUuXG4gICAgICAgIEJVSUxEX1RJTUVTVEFNUDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSxcblxuICAgICAgdGFnczoge1xuICAgICAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gICAgICAgIEFwcGxpY2F0aW9uOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudGAsXG4gICAgICAgIFR5cGU6ICdBMkEtQWdlbnQnLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgcnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koZXhlY3V0aW9uUm9sZSlcbiAgICBydW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShidWlsZFdhaXRlcilcblxuICAgIHRoaXMucnVudGltZSA9IHJ1bnRpbWVcbiAgICB0aGlzLnJ1bnRpbWVBcm4gPSBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0ZXAgOTogU3RvcmUgUnVudGltZSBBUk4gaW4gUGFyYW1ldGVyIFN0b3JlXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ0NvZGVBZ2VudFJ1bnRpbWVBcm5QYXJhbWV0ZXInLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7cHJvamVjdE5hbWV9LyR7ZW52aXJvbm1lbnR9L2EyYS9jb2RlLWFnZW50LXJ1bnRpbWUtYXJuYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZGUgQWdlbnQgQWdlbnRDb3JlIFJ1bnRpbWUgQVJOJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pXG5cbiAgICBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnQ29kZUFnZW50UnVudGltZUlkUGFyYW1ldGVyJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYC8ke3Byb2plY3ROYW1lfS8ke2Vudmlyb25tZW50fS9hMmEvY29kZS1hZ2VudC1ydW50aW1lLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBydW50aW1lLmF0dHJBZ2VudFJ1bnRpbWVJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBJRCcsXG4gICAgICB0aWVyOiBzc20uUGFyYW1ldGVyVGllci5TVEFOREFSRCxcbiAgICB9KVxuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNSIFJlcG9zaXRvcnkgVVJJIGZvciBDb2RlIEFnZW50IGNvbnRhaW5lcicsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcm9qZWN0TmFtZX0tY29kZS1hZ2VudC1yZXBvLXVyaWAsXG4gICAgfSlcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29kZSBBZ2VudCBBZ2VudENvcmUgUnVudGltZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJvamVjdE5hbWV9LWNvZGUtYWdlbnQtcnVudGltZS1hcm5gLFxuICAgIH0pXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUnVudGltZUlkJywge1xuICAgICAgdmFsdWU6IHJ1bnRpbWUuYXR0ckFnZW50UnVudGltZUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2RlIEFnZW50IEFnZW50Q29yZSBSdW50aW1lIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Byb2plY3ROYW1lfS1jb2RlLWFnZW50LXJ1bnRpbWUtaWRgLFxuICAgIH0pXG4gIH1cbn1cbiJdfQ==