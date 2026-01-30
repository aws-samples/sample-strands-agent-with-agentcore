import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Properties for Lambda@Edge Stack
 */
export interface LambdaEdgeUsEast1StackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, production)
   */
  environment: string;
  
  /**
   * Project name for resource naming
   */
  projectName: string;
}

/**
 * CDK Stack for Lambda@Edge functions - MUST be deployed to us-east-1
 * 
 * Lambda@Edge functions can only be created in us-east-1 and are then
 * replicated globally by CloudFront.
 * 
 * This stack creates:
 * - Viewer Request Lambda@Edge function for JWT validation
 * - Origin Request Lambda@Edge function for user identity header injection
 * - IAM roles and policies with minimal permissions
 * - SSM Parameters to store function ARNs for cross-region reference
 */
export class LambdaEdgeUsEast1Stack extends cdk.Stack {
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

  constructor(scope: Construct, id: string, props: LambdaEdgeUsEast1StackProps) {
    super(scope, id, {
      ...props,
      env: {
        ...props.env,
        region: 'us-east-1', // Force us-east-1 for Lambda@Edge
      },
      crossRegionReferences: true, // Enable cross-region references
    });

    const { environment, projectName } = props;

    // Create IAM role for Lambda@Edge functions
    const lambdaEdgeRole = new iam.Role(this, 'LambdaEdgeRole', {
      roleName: `lambda-edge-auth-role-${environment}`,
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
        `arn:aws:logs:*:${this.account}:log-group:/aws/lambda/us-east-1.*`,
        `arn:aws:logs:*:${this.account}:log-group:/aws/lambda/*`
      ]
    }));

    // Create CloudWatch Log Group for Viewer Request function
    new logs.LogGroup(this, 'ViewerRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.viewer-request-auth-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create CloudWatch Log Group for Origin Request function
    new logs.LogGroup(this, 'OriginRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.origin-request-auth-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create Viewer Request Lambda@Edge function
    // Using the built version with embedded configuration
    this.viewerRequestFunction = new lambda.Function(this, 'ViewerRequestFunction', {
      functionName: `viewer-request-auth-${environment}`,
      description: 'Lambda@Edge function for JWT validation at CloudFront viewer request',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda-edge/viewer-request-build'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      role: lambdaEdgeRole,
      // NO environment variables for Lambda@Edge - configuration is embedded in code
    });

    // Create Origin Request Lambda@Edge function
    this.originRequestFunction = new lambda.Function(this, 'OriginRequestFunction', {
      functionName: `origin-request-auth-${environment}`,
      description: 'Lambda@Edge function for adding user identity headers at CloudFront origin request',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda-edge/origin-request'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      role: lambdaEdgeRole,
      // NO environment variables for Lambda@Edge
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

    // Store function version ARNs in SSM Parameter Store for cross-region reference
    new ssm.StringParameter(this, 'ViewerRequestVersionArnParam', {
      parameterName: `/${projectName}/${environment}/lambda-edge/viewer-request-version-arn`,
      stringValue: this.viewerRequestVersion.functionArn,
      description: 'ARN of the Viewer Request Lambda@Edge function version',
    });

    new ssm.StringParameter(this, 'OriginRequestVersionArnParam', {
      parameterName: `/${projectName}/${environment}/lambda-edge/origin-request-version-arn`,
      stringValue: this.originRequestVersion.functionArn,
      description: 'ARN of the Origin Request Lambda@Edge function version',
    });

    // Output the function ARNs
    new cdk.CfnOutput(this, 'ViewerRequestFunctionArn', {
      value: this.viewerRequestFunction.functionArn,
      description: 'ARN of the Viewer Request Lambda@Edge function',
      exportName: `ViewerRequestFunctionArn-${environment}`
    });

    new cdk.CfnOutput(this, 'OriginRequestFunctionArn', {
      value: this.originRequestFunction.functionArn,
      description: 'ARN of the Origin Request Lambda@Edge function',
      exportName: `OriginRequestFunctionArn-${environment}`
    });

    new cdk.CfnOutput(this, 'ViewerRequestVersionArn', {
      value: this.viewerRequestVersion.functionArn,
      description: 'ARN of the Viewer Request Lambda@Edge function version (use this for CloudFront)',
      exportName: `ViewerRequestVersionArn-${environment}`
    });

    new cdk.CfnOutput(this, 'OriginRequestVersionArn', {
      value: this.originRequestVersion.functionArn,
      description: 'ARN of the Origin Request Lambda@Edge function version (use this for CloudFront)',
      exportName: `OriginRequestVersionArn-${environment}`
    });

    // Output the IAM role ARN
    new cdk.CfnOutput(this, 'LambdaEdgeRoleArn', {
      value: lambdaEdgeRole.roleArn,
      description: 'ARN of the Lambda@Edge IAM role',
      exportName: `LambdaEdgeRoleArn-${environment}`
    });
  }
}
