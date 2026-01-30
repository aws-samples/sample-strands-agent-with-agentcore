import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Properties for Lambda@Edge functions
 */
export interface LambdaEdgeProps {
  /**
   * Cognito User Pool ID for JWT validation
   */
  cognitoUserPoolId: string;

  /**
   * Cognito User Pool Client ID for audience validation
   */
  cognitoClientId: string;

  /**
   * AWS Region where Cognito is deployed
   */
  cognitoRegion: string;

  /**
   * Login URL for redirects when authentication fails
   */
  loginUrl: string;

  /**
   * Cookie name containing the JWT token
   * @default 'id_token'
   */
  tokenCookieName?: string;

  /**
   * Environment name (dev, staging, production)
   */
  environment: string;
}

/**
 * CDK Construct for Lambda@Edge functions used in SSO authentication
 * 
 * This construct creates:
 * - Viewer Request Lambda@Edge function for JWT validation
 * - Origin Request Lambda@Edge function for user identity header injection
 * - IAM roles and policies with minimal permissions
 * - CloudWatch Log Groups with appropriate retention
 * 
 * Note: Lambda@Edge functions must be deployed to us-east-1
 */
export class LambdaEdgeConstruct extends Construct {
  /**
   * Viewer Request Lambda@Edge function
   */
  public readonly viewerRequestFunction: lambda.Function;

  /**
   * Origin Request Lambda@Edge function
   */
  public readonly originRequestFunction: lambda.Function;

  /**
   * Viewer Request function version for CloudFront association
   */
  public readonly viewerRequestVersion: lambda.Version;

  /**
   * Origin Request function version for CloudFront association
   */
  public readonly originRequestVersion: lambda.Version;

  constructor(scope: Construct, id: string, props: LambdaEdgeProps) {
    super(scope, id);

    // Validate that we're deploying to us-east-1
    const stack = cdk.Stack.of(this);
    if (stack.region !== 'us-east-1' && !cdk.Token.isUnresolved(stack.region)) {
      console.warn('Lambda@Edge functions should be deployed to us-east-1 for optimal performance');
    }

    // Create IAM role for Lambda@Edge functions
    const lambdaEdgeRole = new iam.Role(this, 'LambdaEdgeRole', {
      roleName: `lambda-edge-auth-role-${props.environment}`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
      description: 'IAM role for Lambda@Edge authentication functions',
    });

    // Add basic Lambda execution permissions
    lambdaEdgeRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Add permission to write logs to CloudWatch in any region
    // Lambda@Edge functions can execute in any edge location
    lambdaEdgeRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudWatchLogsPermission',
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      resources: [
        `arn:aws:logs:*:${stack.account}:log-group:/aws/lambda/us-east-1.*`,
        `arn:aws:logs:*:${stack.account}:log-group:/aws/lambda/*`
      ]
    }));

    // Create CloudWatch Log Group for Viewer Request function
    const viewerRequestLogGroup = new logs.LogGroup(this, 'ViewerRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.viewer-request-auth-${props.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create CloudWatch Log Group for Origin Request function
    const originRequestLogGroup = new logs.LogGroup(this, 'OriginRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.origin-request-auth-${props.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda@Edge does NOT support environment variables
    // Configuration must be embedded in the code at build time
    // 
    // IMPORTANT: Before deploying, you must run the build script to inject configuration:
    //   cd lambda-edge
    //   node build-viewer-request.js <region> <userPoolId> <clientId> <loginUrl> [tokenCookieName]
    //
    // For now, we'll use the template code directly. In production, use the build script.
    
    // Create Viewer Request Lambda@Edge function
    // Using the built version with embedded configuration
    this.viewerRequestFunction = new lambda.Function(this, 'ViewerRequestFunction', {
      functionName: `viewer-request-auth-${props.environment}`,
      description: 'Lambda@Edge function for JWT validation at CloudFront viewer request',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda-edge/viewer-request-build'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      role: lambdaEdgeRole,
      // NO environment variables for Lambda@Edge - configuration is embedded in code
      logGroup: viewerRequestLogGroup,
      tracing: lambda.Tracing.DISABLED // Lambda@Edge doesn't support X-Ray tracing
    });

    // Create Origin Request Lambda@Edge function
    this.originRequestFunction = new lambda.Function(this, 'OriginRequestFunction', {
      functionName: `origin-request-auth-${props.environment}`,
      description: 'Lambda@Edge function for adding user identity headers at CloudFront origin request',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda-edge/origin-request'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      role: lambdaEdgeRole,
      // NO environment variables for Lambda@Edge
      logGroup: originRequestLogGroup,
      tracing: lambda.Tracing.DISABLED // Lambda@Edge doesn't support X-Ray tracing
    });

    // Create versions for CloudFront association
    // Lambda@Edge requires specific versions, not $LATEST
    this.viewerRequestVersion = new lambda.Version(this, 'ViewerRequestVersion', {
      lambda: this.viewerRequestFunction,
      description: 'Viewer request function version for CloudFront'
    });

    this.originRequestVersion = new lambda.Version(this, 'OriginRequestVersion', {
      lambda: this.originRequestFunction,
      description: 'Origin request function version for CloudFront'
    });

    // Output the function ARNs
    new cdk.CfnOutput(this, 'ViewerRequestFunctionArn', {
      value: this.viewerRequestFunction.functionArn,
      description: 'ARN of the Viewer Request Lambda@Edge function',
      exportName: `ViewerRequestFunctionArn-${props.environment}`
    });

    new cdk.CfnOutput(this, 'OriginRequestFunctionArn', {
      value: this.originRequestFunction.functionArn,
      description: 'ARN of the Origin Request Lambda@Edge function',
      exportName: `OriginRequestFunctionArn-${props.environment}`
    });

    new cdk.CfnOutput(this, 'ViewerRequestVersionArn', {
      value: this.viewerRequestVersion.functionArn,
      description: 'ARN of the Viewer Request Lambda@Edge function version',
      exportName: `ViewerRequestVersionArn-${props.environment}`
    });

    new cdk.CfnOutput(this, 'OriginRequestVersionArn', {
      value: this.originRequestVersion.functionArn,
      description: 'ARN of the Origin Request Lambda@Edge function version',
      exportName: `OriginRequestVersionArn-${props.environment}`
    });

    // Output the IAM role ARN
    new cdk.CfnOutput(this, 'LambdaEdgeRoleArn', {
      value: lambdaEdgeRole.roleArn,
      description: 'ARN of the Lambda@Edge IAM role',
      exportName: `LambdaEdgeRoleArn-${props.environment}`
    });
  }
}
