import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ChatbotStackProps extends cdk.StackProps {
  userPoolId?: string;
  userPoolClientId?: string;
  userPoolDomain?: string;
  enableCognito?: boolean;
  projectName?: string;
  environment?: string;
}

// Region-specific configuration
const REGION_CONFIG: { [key: string]: { azs: string[] } } = {
  'us-west-2': { azs: ['us-west-2a', 'us-west-2b'] },
  'us-east-1': { azs: ['us-east-1a', 'us-east-1b'] },
  'ap-northeast-2': { azs: ['ap-northeast-2a', 'ap-northeast-2b'] },
  'eu-west-1': { azs: ['eu-west-1a', 'eu-west-1b'] }
};

export class ChatbotStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: ChatbotStackProps) {
    super(scope, id, props);

    const projectName = props?.projectName || 'strands-agent-chatbot';
    const environment = props?.environment || 'dev';

    // Create new VPC for chatbot and MCP farm
    const vpc = new ec2.Vpc(this, 'ChatbotMcpVpc', {
      maxAzs: 2,  // Use 2 AZs for high availability
      natGateways: 1,  // Cost optimization - use 1 NAT gateway
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ]
    });

    // ============================================================
    // DynamoDB Tables for User and Session Management
    // Import existing tables if they exist, otherwise create new ones
    // ============================================================

    // Users Table - User profiles and preferences
    // Check if USE_EXISTING_TABLES=true to import existing tables
    const useExistingTables = process.env.USE_EXISTING_TABLES === 'true'

    const usersTable = useExistingTables
      ? dynamodb.Table.fromTableName(
          this,
          'ChatbotUsersTable',
          `${projectName}-users-v2`
        )
      : new dynamodb.Table(this, 'ChatbotUsersTable', {
          tableName: `${projectName}-users-v2`,
          partitionKey: {
            name: 'userId',
            type: dynamodb.AttributeType.STRING
          },
          sortKey: {
            name: 'sk',
            type: dynamodb.AttributeType.STRING
          },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand pricing
          removalPolicy: cdk.RemovalPolicy.DESTROY, // Delete table on stack deletion
          pointInTimeRecoverySpecification: {
            pointInTimeRecoveryEnabled: true // Enable backup
          },
          encryption: dynamodb.TableEncryption.AWS_MANAGED,
          timeToLiveAttribute: 'ttl', // Optional TTL for temporary data
        });

    // Sessions Table - Conversation sessions metadata
    const sessionsTable = useExistingTables
      ? dynamodb.Table.fromTableName(
          this,
          'ChatbotSessionsTable',
          `${projectName}-sessions`
        )
      : new dynamodb.Table(this, 'ChatbotSessionsTable', {
          tableName: `${projectName}-sessions`,
          partitionKey: {
            name: 'sessionId',
            type: dynamodb.AttributeType.STRING
          },
          sortKey: {
            name: 'userId',
            type: dynamodb.AttributeType.STRING
          },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          removalPolicy: cdk.RemovalPolicy.DESTROY, // Delete table on stack deletion
          pointInTimeRecoverySpecification: {
            pointInTimeRecoveryEnabled: true
          },
          encryption: dynamodb.TableEncryption.AWS_MANAGED,
          timeToLiveAttribute: 'ttl', // Auto-delete old sessions
        });

    // GSI for querying sessions by userId (only for new tables)
    if (!useExistingTables && sessionsTable instanceof dynamodb.Table) {
      sessionsTable.addGlobalSecondaryIndex({
        indexName: 'UserSessionsIndex',
        partitionKey: {
          name: 'userId',
          type: dynamodb.AttributeType.STRING
        },
        sortKey: {
          name: 'lastMessageAt',
          type: dynamodb.AttributeType.STRING
        },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    // ============================================================
    // Step 1: ECR Repository for Frontend+BFF
    // ============================================================
    const useExistingEcr = process.env.USE_EXISTING_ECR === 'true';
    const frontendRepository = useExistingEcr
      ? ecr.Repository.fromRepositoryName(
          this,
          'ChatbotFrontendRepository',
          'chatbot-frontend'
        )
      : new ecr.Repository(this, 'ChatbotFrontendRepository', {
          repositoryName: 'chatbot-frontend',
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          imageScanOnPush: true,
          lifecycleRules: [
            {
              description: 'Keep last 10 images',
              maxImageCount: 10,
            },
          ],
        });

    // ============================================================
    // Step 2: S3 Bucket for CodeBuild Source
    // ============================================================
    const sourceBucket = new s3.Bucket(this, 'FrontendSourceBucket', {
      bucketName: `${projectName}-frontend-sources-${this.account}-${this.region}`,
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
    // Step 3: CodeBuild Project for Frontend+BFF
    // ============================================================
    const codeBuildRole = new iam.Role(this, 'FrontendCodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for Frontend+BFF container image pipeline',
    });

    // ECR Token Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      })
    );

    // ECR Image Operations
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: [
          `arn:aws:ecr:${this.region}:${this.account}:repository/${frontendRepository.repositoryName}`,
        ],
      })
    );

    // CloudWatch Logs
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-*`,
        ],
      })
    );

    // S3 Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            's3:ResourceAccount': this.account,
          },
        },
      })
    );

    // CloudFormation Read Access (to get Cognito and ALB config during build)
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/CognitoAuthStack/*`,
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/ChatbotStack/*`,
        ],
      })
    );

    // Secrets Manager Access for Google Maps API Key
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${projectName}/mcp/google-maps-credentials-*`,
        ],
      })
    );

    const buildProject = new codebuild.Project(this, 'FrontendBuildProject', {
      projectName: `${projectName}-frontend-builder`,
      description: 'Builds AMD64 container image for Frontend+BFF',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true, // Required for Docker builds
      },
      source: codebuild.Source.s3({
        bucket: sourceBucket,
        path: 'frontend-source/',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
              'echo Getting Cognito configuration...',
              `COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name CognitoAuthStack --query 'Stacks[0].Outputs[?OutputKey==\`UserPoolId\`].OutputValue' --output text --region ${this.region} || echo "")`,
              `COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CognitoAuthStack --query 'Stacks[0].Outputs[?OutputKey==\`UserPoolClientId\`].OutputValue' --output text --region ${this.region} || echo "")`,
              `ALB_DNS=$(aws cloudformation describe-stacks --stack-name ChatbotStack --query 'Stacks[0].Outputs[?OutputKey==\`StreamingAlbUrl\`].OutputValue' --output text --region ${this.region} || echo "")`,
              'echo "Cognito User Pool ID: $COGNITO_USER_POOL_ID"',
              'echo "Cognito Client ID: $COGNITO_CLIENT_ID"',
              'echo "ALB DNS: $ALB_DNS"',
              'echo Getting Google Maps API key from Secrets Manager...',
              `GOOGLE_MAPS_SECRET=$(aws secretsmanager get-secret-value --secret-id "${projectName}/mcp/google-maps-credentials" --region ${this.region} --query SecretString --output text || echo "{}")`,
              `GOOGLE_MAPS_API_KEY=$(echo $GOOGLE_MAPS_SECRET | jq -r '.api_key // empty')`,
              'echo "Google Maps API Key: ${GOOGLE_MAPS_API_KEY:0:10}..." # Show first 10 chars only for security',
            ],
          },
          build: {
            commands: [
              'echo Building Docker image for AMD64 with build args...',
              'docker build --platform linux/amd64 ' +
              `--build-arg NEXT_PUBLIC_AWS_REGION=${this.region} ` +
              '--build-arg NEXT_PUBLIC_COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID ' +
              '--build-arg NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$COGNITO_CLIENT_ID ' +
              '--build-arg NEXT_PUBLIC_STREAMING_API_URL=$ALB_DNS ' +
              '--build-arg NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY=$GOOGLE_MAPS_API_KEY ' +
              '-t frontend:latest .',
              `docker tag frontend:latest ${frontendRepository.repositoryUri}:latest`,
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image to ECR...',
              `docker push ${frontendRepository.repositoryUri}:latest`,
              'echo Build completed successfully',
            ],
          },
        },
      }),
    });

    // ============================================================
    // Step 4: Upload Frontend Source to S3
    // ============================================================
    const frontendSourcePath = '../../../chatbot-app/frontend';

    // Use CUSTOM hash type with deployment timestamp to force re-upload every time
    const deployTimestamp = Date.now().toString();

    const frontendSourceUpload = new s3deploy.BucketDeployment(this, 'FrontendSourceUpload', {
      sources: [
        s3deploy.Source.asset(frontendSourcePath, {
          exclude: [
            'node_modules',
            'node_modules/**',
            '**/node_modules',
            '**/node_modules/**',
            '.next',
            '.next/**',
            '.git',
            '.git/**',
            '.DS_Store',
            '*.log',
            'build',
            'build/**',
            'dist',
            'dist/**',
          ],
          followSymlinks: cdk.SymlinkFollowMode.NEVER,
          ignoreMode: cdk.IgnoreMode.DOCKER,  // Allow uncommitted changes
          assetHashType: cdk.AssetHashType.CUSTOM,  // Use custom hash
          assetHash: deployTimestamp,  // Force new hash on every deployment
        }),
      ],
      destinationBucket: sourceBucket,
      destinationKeyPrefix: 'frontend-source/',
      prune: true,  // Clean up old versions
      retainOnDelete: false,
    });

    // ============================================================
    // Step 5: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerFrontendCodeBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`frontend-build-${Date.now()}`),
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`frontend-build-${Date.now()}`),
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

    buildTrigger.node.addDependency(frontendSourceUpload);

    // ============================================================
    // Step 6: Wait for Build to Complete
    // ============================================================
    const buildWaiterFunction = new lambda.Function(this, 'FrontendBuildWaiterFunction', {
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

    buildWaiterFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:BatchGetBuilds'],
        resources: [buildProject.projectArn],
      })
    );

    const buildWaiter = new cdk.CustomResource(this, 'FrontendBuildWaiter', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    });

    buildWaiter.node.addDependency(buildTrigger);

    // ============================================================
    // Step 7: ECS Cluster (after build completes)
    // ============================================================
    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'ChatbotCluster', {
      vpc,
      clusterName: 'chatbot-cluster',
    });

    // Frontend + BFF Task Definition
    const frontendTaskDefinition = new ecs.FargateTaskDefinition(this, 'ChatbotFrontendTaskDef', {
      memoryLimitMiB: 4096,  // 4 GB for BFF + Live View functionality
      cpu: 2048,             // 2 vCPU for improved performance
    });

    // Add AgentCore Runtime invocation permissions
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeForUser'
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`
        ]
      })
    );

    // Add Parameter Store permissions to fetch AgentCore Runtime ARN and MCP Gateway URL
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters'
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/${environment}/agentcore/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/${environment}/mcp/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${projectName}/${environment}/a2a/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/mcp/endpoints/*`
        ]
      })
    );

    // Add DynamoDB permissions for user and session management
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem'
        ],
        resources: [
          usersTable.tableArn,
          sessionsTable.tableArn,
          `${sessionsTable.tableArn}/index/*` // GSI permissions
        ]
      })
    );

    // Add API Gateway invoke permissions for MCP servers (if BFF needs to call MCP directly)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'execute-api:Invoke'
        ],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/mcp`,
          `arn:aws:execute-api:${this.region}:${this.account}:mcp-*/*/*/*`
        ]
      })
    );

    // Add AgentCore Gateway Access (MCP Gateway integration)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'GatewayAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeGateway',
          'bedrock-agentcore:GetGateway',
          'bedrock-agentcore:ListGateways'
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`
        ]
      })
    );

    // Add AgentCore Memory Access (for conversation history)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreMemoryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetEvent'
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/*`
        ]
      })
    );

    // Add AgentCore Browser Access (for Live View)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreBrowserAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetBrowser',
          'bedrock-agentcore:ListBrowsers',
          'bedrock-agentcore:StartBrowserSession',
          'bedrock-agentcore:GetBrowserSession',
          'bedrock-agentcore:ListBrowserSessions',
          'bedrock-agentcore:StopBrowserSession',
          'bedrock-agentcore:UpdateBrowserStream',
          'bedrock-agentcore:ConnectBrowserAutomationStream',
          'bedrock-agentcore:ConnectBrowserLiveViewStream'
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser/*`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:browser-custom/*`
        ]
      })
    );

    // Add S3 permissions for Research Agent chart images (presigned URL generation)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'ResearchAgentChartAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:ListBucket'
        ],
        resources: [
          `arn:aws:s3:::${projectName}-research-charts-${this.account}-${this.region}`,
          `arn:aws:s3:::${projectName}-research-charts-${this.account}-${this.region}/*`
        ]
      })
    );

    // Add S3 permissions for Document Bucket (Word documents, Excel spreadsheets, etc.)
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        sid: 'DocumentBucketAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:ListBucket'
        ],
        resources: [
          `arn:aws:s3:::${projectName}-docs-${this.account}-${this.region}`,
          `arn:aws:s3:::${projectName}-docs-${this.account}-${this.region}/*`
        ]
      })
    );

    // Add CloudWatch permissions for logging
    frontendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'cloudwatch:PutMetricData'
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/chatbot-frontend`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/chatbot-frontend:*`
        ]
      })
    );

    // Frontend + BFF Container
    const frontendEnvironment: { [key: string]: string } = {
      NODE_ENV: 'production',
      FORCE_UPDATE: new Date().toISOString(),
      NEXT_PUBLIC_AWS_REGION: this.region,
      AWS_DEFAULT_REGION: this.region,
      AWS_REGION: this.region,
      // AgentCore Runtime configuration
      PROJECT_NAME: projectName,
      ENVIRONMENT: environment,
      // DynamoDB Tables
      DYNAMODB_USERS_TABLE: usersTable.tableName,
      DYNAMODB_SESSIONS_TABLE: sessionsTable.tableName,
    };

    // Add AgentCore Memory ID from SSM Parameter Store (for conversation history)
    try {
      const memoryIdParam = ssm.StringParameter.fromStringParameterName(
        this,
        'MemoryIdParameter',
        `/${projectName}/${environment}/agentcore/memory-id`
      );
      frontendEnvironment.MEMORY_ID = memoryIdParam.stringValue;
      console.log('[ChatbotStack] Memory ID will be fetched from Parameter Store');
    } catch (error) {
      console.log('[ChatbotStack] Memory ID not available (AgentCore Runtime not deployed yet)');
    }

    // Add AgentCore Browser ID from SSM Parameter Store (for Live View)
    try {
      const browserIdParam = ssm.StringParameter.fromStringParameterName(
        this,
        'BrowserIdParameter',
        `/${projectName}/${environment}/agentcore/browser-id`
      );
      frontendEnvironment.BROWSER_ID = browserIdParam.stringValue;
      console.log('[ChatbotStack] Browser ID will be fetched from Parameter Store');
    } catch (error) {
      console.log('[ChatbotStack] Browser ID not available (AgentCore Runtime not deployed yet)');
    }

    // Add CORS origins configuration for frontend CSP
    const frontendCorsOrigins = process.env.CORS_ORIGINS;
    if (frontendCorsOrigins !== undefined) {
      frontendEnvironment.CORS_ORIGINS = frontendCorsOrigins;
    }

    // Add Cognito environment variables if enabled
    if (props?.enableCognito && props?.userPoolId && props?.userPoolClientId) {
      frontendEnvironment.NEXT_PUBLIC_COGNITO_USER_POOL_ID = props.userPoolId;
      frontendEnvironment.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID = props.userPoolClientId;
    }

    const frontendContainer = frontendTaskDefinition.addContainer('ChatbotFrontendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(frontendRepository, 'latest'),
      environment: frontendEnvironment,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'chatbot-frontend',
        logGroup: new logs.LogGroup(this, 'FrontendLogGroup', {
          logGroupName: '/ecs/chatbot-frontend',
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY
        })
      }),
    });

    frontendContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // Frontend ECS Service
    const frontendService = new ecs.FargateService(this, 'ChatbotFrontendService', {
      cluster,
      taskDefinition: frontendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      minHealthyPercent: 0,  // Allow stopping all tasks during deployment
      maxHealthyPercent: 200,
    });

    // Ensure service creation waits for build completion
    frontendService.node.addDependency(buildWaiter);

    // Import Cognito resources if provided
    let userPool: cognito.IUserPool | undefined;
    let userPoolClient: cognito.IUserPoolClient | undefined;
    let userPoolDomain: cognito.IUserPoolDomain | undefined;

    if (props?.enableCognito && props?.userPoolId && props?.userPoolClientId && props?.userPoolDomain) {
      userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', props.userPoolId);
      userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(this, 'ImportedUserPoolClient', props.userPoolClientId);
      userPoolDomain = cognito.UserPoolDomain.fromDomainName(this, 'ImportedUserPoolDomain', props.userPoolDomain);
    }

    // Create security group for ALB (CloudFront access only)
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ChatbotAlbSecurityGroup', {
      vpc,
      description: 'Security group for Chatbot Application Load Balancer - CloudFront only',
      allowAllOutbound: true
    });

    // Allow inbound HTTP traffic from CloudFront IP ranges only
    // Lookup CloudFront managed prefix list dynamically
    const cloudfrontPrefixListLookup = new cr.AwsCustomResource(this, 'CloudFrontPrefixListLookup', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: {
          Filters: [
            {
              Name: 'prefix-list-name',
              Values: ['com.amazonaws.global.cloudfront.origin-facing']
            }
          ]
        },
        physicalResourceId: cr.PhysicalResourceId.of('cloudfront-prefix-list-lookup')
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    const cloudfrontPrefixListId = cloudfrontPrefixListLookup.getResponseField('PrefixLists.0.PrefixListId');

    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(cloudfrontPrefixListId),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from CloudFront'
    );

    // Allow direct access for streaming endpoints (bypasses CloudFront 60s timeout)
    // Parse MCP access IP ranges from environment variable
    const mcpAccessRanges = process.env.MCP_ACCESS_IP_RANGES || '';
    if (mcpAccessRanges) {
      mcpAccessRanges.split(',').forEach((cidr, index) => {
        const trimmedCidr = cidr.trim();
        if (trimmedCidr) {
          albSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(trimmedCidr),
            ec2.Port.tcp(80),
            `Allow streaming access from ${trimmedCidr}`
          );
        }
      });
      console.log(`Added streaming access rules for: ${mcpAccessRanges}`);
    }

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ChatbotALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      idleTimeout: cdk.Duration.seconds(3600),
    });

    // Frontend Target Group (handles both UI and API requests via Next.js)
    const frontendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FrontendTargetGroup', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [frontendService],
      healthCheck: {
        path: '/api/health',  // Health check via API route
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    frontendTargetGroup.setAttribute('load_balancing.cross_zone.enabled', 'true');

    // Create ALB listener - all traffic goes to Frontend (which includes BFF)
    // Authentication is handled by the frontend application using AWS Amplify
    const listener = alb.addListener('ChatbotListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.forward([frontendTargetGroup]),
    });

    // Create custom Origin Request Policy to forward session headers
    const customOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ChatbotOriginRequestPolicy', {
      originRequestPolicyName: `ChatbotCustomOriginPolicy-${this.account}-${this.region}`,
      comment: 'Forward all headers including X-Session-ID for session management',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    // CloudFront Distribution (for HTTPS and global CDN)
    const distribution = new cloudfront.Distribution(this, 'ChatbotCloudFront', {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
          readTimeout: cdk.Duration.seconds(60), // Maximum CloudFront origin timeout
          keepaliveTimeout: cdk.Duration.seconds(60), // Maximum CloudFront keepalive timeout
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // Disable caching for dynamic content
        originRequestPolicy: customOriginRequestPolicy, // Use custom policy to forward session headers
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
      comment: 'CloudFront distribution for Chatbot application with HTTPS support',
    });

    // Update Cognito User Pool Client with CloudFront callback URL (if Cognito is enabled)
    if (props?.enableCognito && props?.userPoolClientId) {
      const updateCognitoClient = new cr.AwsCustomResource(this, 'UpdateCognitoCallbackUrl', {
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'updateUserPoolClient',
          parameters: {
            UserPoolId: props.userPoolId,
            ClientId: props.userPoolClientId,
            CallbackURLs: [
              `https://${distribution.distributionDomainName}/oauth2/idpresponse`,
            ],
            LogoutURLs: [
              `https://${distribution.distributionDomainName}/`,
            ],
            AllowedOAuthFlows: ['code'],
            AllowedOAuthFlowsUserPoolClient: true,
            AllowedOAuthScopes: ['openid', 'email', 'profile'],
            GenerateSecret: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of('cognito-client-update'),
        },
        onUpdate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'updateUserPoolClient',
          parameters: {
            UserPoolId: props.userPoolId,
            ClientId: props.userPoolClientId,
            CallbackURLs: [
              `https://${distribution.distributionDomainName}/oauth2/idpresponse`,
            ],
            LogoutURLs: [
              `https://${distribution.distributionDomainName}/`,
            ],
            AllowedOAuthFlows: ['code'],
            AllowedOAuthFlowsUserPoolClient: true,
            AllowedOAuthScopes: ['openid', 'email', 'profile'],
            GenerateSecret: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of('cognito-client-update'),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      });

      // Ensure the custom resource runs after CloudFront is created
      updateCognitoClient.node.addDependency(distribution);
    }

    // Outputs
    new cdk.CfnOutput(this, 'ApplicationUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Application URL via CloudFront (HTTPS)',
    });

    new cdk.CfnOutput(this, 'BackendApiUrl', {
      value: `https://${distribution.distributionDomainName}/api`,
      description: 'Backend API URL via CloudFront (HTTPS) - Served by Next.js API routes',
    });

    new cdk.CfnOutput(this, 'StreamingAlbUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'ALB URL for streaming endpoints (bypasses CloudFront 60s timeout) - Use for /api/stream/* endpoints',
    });

    new cdk.CfnOutput(this, 'FrontendECRRepositoryUri', {
      value: frontendRepository.repositoryUri,
      description: 'Frontend ECR Repository URI (includes BFF)',
    });

    // Export VPC information for potential cross-stack reference
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID used by ChatbotStack (Frontend, BFF)',
      exportName: `${this.stackName}-vpc-id`
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Private Subnet IDs used by ChatbotStack',
      exportName: `${this.stackName}-private-subnets`
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Public Subnet IDs used by ChatbotStack',
      exportName: `${this.stackName}-public-subnets`
    });

    new cdk.CfnOutput(this, 'VpcCidrBlock', {
      value: vpc.vpcCidrBlock,
      description: 'VPC CIDR Block used by ChatbotStack',
      exportName: `${this.stackName}-vpc-cidr`
    });

    // AgentCore Runtime Integration Note
    new cdk.CfnOutput(this, 'AgentCoreIntegrationNote', {
      value: `BFF calls AgentCore Runtime via InvokeAgentRuntimeCommand. Runtime ARN fetched from SSM: /${projectName}/${environment}/agentcore/runtime-arn`,
      description: 'AgentCore Runtime Integration Information'
    });

    // DynamoDB Tables
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: usersTable.tableName,
      description: 'DynamoDB Users Table (stores user profiles and preferences)',
      exportName: `${this.stackName}-users-table`
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: sessionsTable.tableName,
      description: 'DynamoDB Sessions Table (stores session metadata and history)',
      exportName: `${this.stackName}-sessions-table`
    });

    // Security Information
    new cdk.CfnOutput(this, 'SecurityNote', {
      value: props?.enableCognito
        ? 'ALB is protected with CloudFront and Cognito authentication. All endpoints require user login.'
        : 'ALB is protected with CloudFront-only access. Direct ALB access is blocked.',
      description: 'Security Configuration Information'
    });

    if (props?.enableCognito && props?.userPoolDomain) {
      new cdk.CfnOutput(this, 'CognitoLoginUrl', {
        value: `https://${props.userPoolDomain}.auth.${this.region}.amazoncognito.com/login?client_id=${props.userPoolClientId}&response_type=code&scope=openid+email+profile&redirect_uri=https://${distribution.distributionDomainName}/oauth2/idpresponse`,
        description: 'Cognito Login URL (CloudFront HTTPS)'
      });
    }

  }

}
