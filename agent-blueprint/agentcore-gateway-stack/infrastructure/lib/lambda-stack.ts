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
  googleMapsCredentialsSecret: secretsmanager.ISecret
}

export class LambdaStack extends cdk.Stack {
  public readonly functions: Map<string, lambda.Function>

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props)

    const { projectName, lambdaRole, gatewayArn, tavilyApiKeySecret, googleCredentialsSecret, googleMapsCredentialsSecret } =
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
    // Step 2: Upload Lambda Source to S3 (Individual Deployments)
    // ============================================================
    const lambdaFunctions = ['tavily', 'wikipedia', 'arxiv', 'google-search', 'google-maps', 'finance']
    const lambdaSourceUploads: s3deploy.BucketDeployment[] = []

    lambdaFunctions.forEach((funcName) => {
      const upload = new s3deploy.BucketDeployment(this, `${funcName}SourceUpload`, {
        sources: [
          s3deploy.Source.asset(`../lambda-functions/${funcName}`, {
            exclude: ['__pycache__/**', '*.pyc', '.DS_Store'],
          }),
        ],
        destinationBucket: lambdaBucket,
        destinationKeyPrefix: `source/${funcName}/`,
        prune: false,
        retainOnDelete: false,
      })
      lambdaSourceUploads.push(upload)
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

    // Generate unique deployment ID for this deployment
    const deploymentId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

    const buildProject = new codebuild.Project(this, 'LambdaBuildProject', {
      projectName: `${projectName}-lambda-builder`,
      description: 'Builds ARM64 Lambda deployment packages for Gateway tools',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_3,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false, // No Docker needed for pip install
        environmentVariables: {
          DEPLOYMENT_ID: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: deploymentId,
          },
        },
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
echo ""

# Function list
FUNCTIONS="tavily wikipedia arxiv google-search google-maps finance"

# Check for force rebuild flag (set via environment variable in CDK)
FORCE_REBUILD=\${FORCE_REBUILD:-false}
if [ "$FORCE_REBUILD" = "true" ]; then
  echo "🔄 FORCE_REBUILD enabled - all packages will be rebuilt"
  echo ""
fi

for FUNC in $FUNCTIONS; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 Processing: $FUNC"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Check if source exists in S3
  SOURCE_MODIFIED=$(aws s3 ls "s3://${lambdaBucket.bucketName}/source/$FUNC/" --recursive | sort | tail -n 1 | awk '{print $1" "$2}')
  BUILD_MODIFIED=$(aws s3 ls "s3://${lambdaBucket.bucketName}/builds/$FUNC.zip" 2>/dev/null | awk '{print $1" "$2}' || echo "")

  # Determine if rebuild is needed
  REBUILD=false
  if [ "$FORCE_REBUILD" = "true" ]; then
    echo "  ⚡ Force rebuild requested"
    REBUILD=true
  elif [ -z "$BUILD_MODIFIED" ]; then
    echo "  📝 No existing build found"
    REBUILD=true
  elif [ "$SOURCE_MODIFIED" \> "$BUILD_MODIFIED" ]; then
    echo "  📝 Source changed (source: $SOURCE_MODIFIED, build: $BUILD_MODIFIED)"
    REBUILD=true
  else
    echo "  ✅ Up to date, skipping build"
    echo ""
    continue
  fi

  echo "  🔨 Building package..."

  # Download source from S3
  echo "  📥 Downloading source from S3..."
  aws s3 sync "s3://${lambdaBucket.bucketName}/source/$FUNC/" "$FUNC/" --quiet

  BUILD_DIR="build-$FUNC"
  rm -rf "$BUILD_DIR"  # Clean previous build
  mkdir -p "$BUILD_DIR"

  # Install dependencies if requirements.txt exists
  if [ -f "$FUNC/requirements.txt" ]; then
    echo "  📚 Installing dependencies..."
    echo "     Requirements:"
    cat "$FUNC/requirements.txt" | sed 's/^/       /'

    # Install with detailed output for debugging
    # Note: Removed --only-binary=:all: and platform-specific flags to allow
    # pure Python packages (like sgmllib3k) to install from source
    pip3 install -r "$FUNC/requirements.txt" -t "$BUILD_DIR" \
      --upgrade \
      --no-cache-dir 2>&1 | tee "pip-$FUNC.log" || {

      echo ""
      echo "  ❌ ERROR: pip install failed for $FUNC"
      echo "  📄 Requirements file contents:"
      cat "$FUNC/requirements.txt" | sed 's/^/       /'
      echo ""
      echo "  📋 Last 30 lines of pip output:"
      tail -30 "pip-$FUNC.log" | sed 's/^/       /'
      exit 1
    }

    # Verify main package installation
    # Skip comments and empty lines to find first real package
    MAIN_PACKAGE=$(grep -v "^#" "$FUNC/requirements.txt" | grep -v "^$" | head -n 1 | cut -d'=' -f1 | cut -d'>' -f1 | cut -d'<' -f1 | tr -d ' ' || echo "")
    if [ -n "$MAIN_PACKAGE" ]; then
      echo "  🔍 Verifying package: $MAIN_PACKAGE"

      # Check if package directory or .dist-info exists
      if ls "$BUILD_DIR/$MAIN_PACKAGE"* 1> /dev/null 2>&1 || \
         ls "$BUILD_DIR"/*"$MAIN_PACKAGE"*.dist-info 1> /dev/null 2>&1 || \
         ls "$BUILD_DIR"/*"$(echo $MAIN_PACKAGE | tr '-' '_')"* 1> /dev/null 2>&1; then
        echo "  ✅ Package verified: $MAIN_PACKAGE"
      else
        echo "  ⚠️  WARNING: Main package '$MAIN_PACKAGE' not found in build directory"
        echo "  📂 Build directory contents:"
        ls -la "$BUILD_DIR" | head -20 | sed 's/^/       /'
        echo ""
        echo "  ❌ ERROR: Build verification failed - dependencies may be incomplete"
        exit 1
      fi
    else
      echo "  ℹ️  No package found to verify (empty requirements or comments only)"
    fi
  else
    echo "  ℹ️  No requirements.txt found, skipping dependency installation"
  fi

  # Copy source code
  echo "  📝 Copying source code..."
  cp "$FUNC"/*.py "$BUILD_DIR/" 2>/dev/null || {
    echo "  ⚠️  WARNING: No .py files found in $FUNC/"
  }

  # Create ZIP package
  echo "  📦 Creating deployment package..."
  cd "$BUILD_DIR"
  zip -r "../$FUNC.zip" . -q || {
    echo "  ❌ ERROR: Failed to create ZIP package"
    exit 1
  }
  cd ..

  # Verify ZIP file
  ZIP_SIZE=$(stat -c%s "$FUNC.zip" 2>/dev/null || stat -f%z "$FUNC.zip")
  # Convert to MB using Python (more reliable than awk/bc)
  ZIP_SIZE_MB=$(python3 -c "print(round($ZIP_SIZE/1024/1024, 2))")

  echo "  📊 Package size: $ZIP_SIZE_MB MB ($ZIP_SIZE bytes)"

  if [ "$ZIP_SIZE" -lt 1000 ]; then
    echo "  ❌ ERROR: ZIP file too small ($ZIP_SIZE bytes), build likely failed"
    exit 1
  fi

  # Upload to S3 with deployment ID in key to force Lambda update
  S3_KEY="builds/$FUNC-\${DEPLOYMENT_ID}.zip"

  echo "  📤 Uploading to S3..."
  aws s3 cp "$FUNC.zip" "s3://${lambdaBucket.bucketName}/$S3_KEY" --quiet || {
    echo "  ❌ ERROR: Failed to upload to S3"
    exit 1
  }

  echo "  ✅ $FUNC built successfully ($ZIP_SIZE_MB MB)"
  echo "  📝 S3 Key: $S3_KEY"
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build process completed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
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

    lambdaSourceUploads.forEach((upload) => {
      buildTrigger.node.addDependency(upload)
    })

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
        s3Key: `builds/tavily-${deploymentId}.zip`,
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
        s3Key: `builds/wikipedia-${deploymentId}.zip`,
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
        s3Key: `builds/arxiv-${deploymentId}.zip`,
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
        s3Key: `builds/google-search-${deploymentId}.zip`,
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
        s3Key: `builds/finance-${deploymentId}.zip`,
        timeout: 120,
        memorySize: 1024,
        environment: {
          LOG_LEVEL: 'INFO',
        },
      },
      {
        id: 'google-maps',
        functionName: 'mcp-google-maps',
        description: 'Google Maps Platform (Places, Directions, Geocoding APIs)',
        s3Key: `builds/google-maps-${deploymentId}.zip`,
        timeout: 60,
        memorySize: 1024,
        environment: {
          GOOGLE_MAPS_CREDENTIALS_SECRET_NAME: googleMapsCredentialsSecret.secretName,
          LOG_LEVEL: 'INFO',
        },
      },
    ]

    // ============================================================
    // Step 7: Create Lambda Functions (using S3 artifacts)
    // ============================================================

    lambdaConfigs.forEach((config) => {
      // Create Lambda function using S3 code
      // S3 key includes deploymentId, so Lambda will update when code changes
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
