/**
 * Lambda Stack for AgentCore Gateway
 * Deploys Lambda functions for MCP tools using CodeBuild
 */
import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as cr from 'aws-cdk-lib/custom-resources'
import { Construct } from 'constructs'

export interface LambdaStackProps extends cdk.StackProps {
  projectName: string
  lambdaRole: iam.IRole
  gatewayArn: string
  tavilyApiKeySecret: secretsmanager.ISecret
  googleCredentialsSecret: secretsmanager.ISecret
}

export class LambdaStack extends cdk.Stack {
  public readonly functions: Map<string, lambda.Function>

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props)

    const { projectName, lambdaRole, gatewayArn, tavilyApiKeySecret, googleCredentialsSecret } =
      props

    this.functions = new Map()

    // ============================================================
    // Step 1: S3 Bucket for Lambda Source and Build Artifacts
    // ============================================================
    const lambdaBucket = new s3.Bucket(this, 'LambdaBucket', {
      bucketName: `${projectName}-gateway-lambdas-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
          id: 'DeleteOldBuilds',
        },
      ],
    })

    // ============================================================
    // Step 2: Upload Lambda Source to S3
    // ============================================================
    const lambdaSourcePath = '../lambda-functions'
    const lambdaSourceUpload = new s3deploy.BucketDeployment(this, 'LambdaSourceUpload', {
      sources: [
        s3deploy.Source.asset(lambdaSourcePath, {
          exclude: [
            'build/**',
            'build.zip',
            '__pycache__/**',
            '*.pyc',
            '.DS_Store',
            'venv/**',
            '.venv/**',
          ],
        }),
      ],
      destinationBucket: lambdaBucket,
      destinationKeyPrefix: 'source/',
      prune: false,
      retainOnDelete: false,
    })

    // ============================================================
    // Step 3: CodeBuild Project for Building Lambda Packages
    // ============================================================
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Build role for Gateway Lambda packages',
    })

    // CloudWatch Logs
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/${projectName}-lambda-*`,
        ],
      })
    )

    // S3 Access
    codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
        resources: [lambdaBucket.bucketArn, `${lambdaBucket.bucketArn}/*`],
      })
    )

    const buildProject = new codebuild.Project(this, 'LambdaBuildProject', {
      projectName: `${projectName}-lambda-builder`,
      description: 'Builds ARM64 Lambda deployment packages for Gateway tools',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false, // No Docker needed for pip install
      },
      source: codebuild.Source.s3({
        bucket: lambdaBucket,
        path: 'source/',
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              python: '3.13',
            },
          },
          build: {
            commands: [
              `
set -e
echo "Building Lambda packages for ARM64..."

# Function list
FUNCTIONS="tavily wikipedia arxiv google-search finance"

for FUNC in $FUNCTIONS; do
  echo "Building $FUNC..."
  FUNC_DIR="$FUNC"
  BUILD_DIR="build-$FUNC"

  # Create build directory
  mkdir -p "$BUILD_DIR"

  # Install dependencies if requirements.txt exists
  if [ -f "$FUNC_DIR/requirements.txt" ]; then
    echo "  Installing dependencies..."
    pip3 install -r "$FUNC_DIR/requirements.txt" -t "$BUILD_DIR" --upgrade --no-cache-dir || {
      echo "  ERROR: pip install failed for $FUNC"
      exit 1
    }
  fi

  # Copy source code
  echo "  Copying source code..."
  cp "$FUNC_DIR"/*.py "$BUILD_DIR/" 2>/dev/null || true

  # Create ZIP package
  echo "  Creating deployment package..."
  cd "$BUILD_DIR"
  zip -r "../\${FUNC}.zip" . -q
  cd ..

  # Upload to S3
  aws s3 cp "\${FUNC}.zip" "s3://${lambdaBucket.bucketName}/builds/\${FUNC}.zip"

  echo "  ✓ $FUNC built successfully"
done

echo "All Lambda packages built successfully!"
              `,
            ],
          },
        },
      }),
    })

    // ============================================================
    // Step 4: Trigger CodeBuild
    // ============================================================
    const buildTrigger = new cr.AwsCustomResource(this, 'TriggerLambdaBuild', {
      onCreate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`lambda-build-${Date.now()}`),
        outputPaths: ['build.id'], // Only extract build ID to avoid response size limit
      },
      onUpdate: {
        service: 'CodeBuild',
        action: 'startBuild',
        parameters: {
          projectName: buildProject.projectName,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`lambda-build-${Date.now()}`),
        outputPaths: ['build.id'], // Only extract build ID to avoid response size limit
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

    buildTrigger.node.addDependency(lambdaSourceUpload)

    // ============================================================
    // Step 5: Wait for Build to Complete (using Lambda polling)
    // ============================================================
    const buildWaiterFunction = new lambda.Function(this, 'BuildWaiterFunction', {
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

    const buildWaiter = new cdk.CustomResource(this, 'BuildWaiter', {
      serviceToken: buildWaiterFunction.functionArn,
      properties: {
        BuildId: buildTrigger.getResponseField('build.id'),
      },
    })

    buildWaiter.node.addDependency(buildTrigger)

    // ============================================================
    // Step 6: Lambda Function Configurations
    // ============================================================

    interface LambdaConfig {
      id: string
      functionName: string
      description: string
      s3Key: string
      timeout: number
      memorySize: number
      environment: { [key: string]: string }
    }

    const lambdaConfigs: LambdaConfig[] = [
      {
        id: 'tavily',
        functionName: 'mcp-tavily',
        description: 'Tavily AI-powered web search and content extraction',
        s3Key: 'builds/tavily.zip',
        timeout: 300,
        memorySize: 1024,
        environment: {
          TAVILY_API_KEY_SECRET_NAME: tavilyApiKeySecret.secretName,
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'wikipedia',
        functionName: 'mcp-wikipedia',
        description: 'Wikipedia article search and retrieval',
        s3Key: 'builds/wikipedia.zip',
        timeout: 60,
        memorySize: 512,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'arxiv',
        functionName: 'mcp-arxiv',
        description: 'ArXiv scientific paper search and retrieval',
        s3Key: 'builds/arxiv.zip',
        timeout: 120,
        memorySize: 512,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'google-search',
        functionName: 'mcp-google-search',
        description: 'Google Custom Search for web and images',
        s3Key: 'builds/google-search.zip',
        timeout: 60,
        memorySize: 512,
        environment: {
          GOOGLE_CREDENTIALS_SECRET_NAME: googleCredentialsSecret.secretName,
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'finance',
        functionName: 'mcp-finance',
        description: 'Yahoo Finance stock data and analysis',
        s3Key: 'builds/finance.zip',
        timeout: 120,
        memorySize: 1024,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
    ]

    // ============================================================
    // Step 7: Create Lambda Functions (using S3 artifacts)
    // ============================================================

    lambdaConfigs.forEach((config) => {
      // Create Lambda function using S3 code
      const fn = new lambda.Function(this, `${config.id}Function`, {
        functionName: config.functionName,
        description: config.description,
        runtime: lambda.Runtime.PYTHON_3_13,
        handler: 'lambda_function.lambda_handler',
        code: lambda.Code.fromBucket(lambdaBucket, config.s3Key),
        role: lambdaRole,
        architecture: lambda.Architecture.ARM_64,
        timeout: cdk.Duration.seconds(config.timeout),
        memorySize: config.memorySize,
        environment: config.environment,
      })

      // Ensure Lambda is created after build completes
      fn.node.addDependency(buildWaiter)

      // CloudWatch Log Group
      new logs.LogGroup(this, `${config.id}LogGroup`, {
        logGroupName: `/aws/lambda/${config.functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      })

      // Lambda Permission for Gateway to invoke
      fn.addPermission(`${config.id}GatewayPermission`, {
        principal: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: gatewayArn,
      })

      // Store function reference
      this.functions.set(config.id, fn)

      // Output
      new cdk.CfnOutput(this, `${config.id}FunctionArn`, {
        value: fn.functionArn,
        description: `Lambda ARN for ${config.id}`,
        exportName: `${projectName}-${config.id}-arn`,
      })
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'LambdaFunctionsSummary', {
      value: Array.from(this.functions.keys()).join(', '),
      description: 'Deployed Lambda functions',
    })

    new cdk.CfnOutput(this, 'TotalFunctions', {
      value: this.functions.size.toString(),
      description: 'Total number of Lambda functions',
    })

    new cdk.CfnOutput(this, 'BuildBucket', {
      value: lambdaBucket.bucketName,
      description: 'S3 bucket for Lambda builds',
    })

    new cdk.CfnOutput(this, 'CodeBuildProject', {
      value: buildProject.projectName,
      description: 'CodeBuild project for Lambda builds',
    })
  }
}
