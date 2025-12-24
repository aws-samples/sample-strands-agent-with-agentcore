/**
 * IAM Stack for AgentCore Gateway
 * Defines IAM roles for Lambda functions and Gateway
 */
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

export interface GatewayIamStackProps extends cdk.StackProps {
  projectName: string
}

export class GatewayIamStack extends cdk.Stack {
  public readonly lambdaRole: iam.Role
  public readonly gatewayRole: iam.Role
  public readonly tavilyApiKeySecret: secretsmanager.ISecret
  public readonly googleCredentialsSecret: secretsmanager.ISecret
  public readonly googleMapsCredentialsSecret: secretsmanager.ISecret

  constructor(scope: Construct, id: string, props: GatewayIamStackProps) {
    super(scope, id, props)

    const { projectName } = props

    // ============================================================
    // Secrets Manager - API Keys (Import existing secrets)
    // ============================================================

    // Tavily API Key Secret - Import existing secret
    this.tavilyApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TavilyApiKey',
      `${projectName}/mcp/tavily-api-key`
    )

    // Google Custom Search Credentials Secret - Import existing secret
    this.googleCredentialsSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GoogleCredentials',
      `${projectName}/mcp/google-credentials`
    )

    // Google Maps API Credentials Secret - Import existing secret
    this.googleMapsCredentialsSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GoogleMapsCredentials',
      `${projectName}/mcp/google-maps-credentials`
    )

    // ============================================================
    // Lambda Execution Role
    // ============================================================

    this.lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${projectName}-gateway-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for AgentCore Gateway Lambda functions',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    })

    // Secrets Manager read permissions
    // Note: Using wildcard (*) suffix because AWS Secrets Manager automatically
    // appends random 6-character suffix to secret ARNs (e.g., -aeb8Cc)
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerAccess',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `${this.tavilyApiKeySecret.secretArn}*`,
          `${this.googleCredentialsSecret.secretArn}*`,
          `${this.googleMapsCredentialsSecret.secretArn}*`
        ],
      })
    )

    // CloudWatch Logs
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogsAccess',
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/mcp-*`],
      })
    )

    // ============================================================
    // Gateway Execution Role
    // ============================================================

    this.gatewayRole = new iam.Role(this, 'GatewayExecutionRole', {
      roleName: `${projectName}-gateway-role`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Gateway',
    })

    // Lambda invocation permissions
    this.gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'LambdaInvokeAccess',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:${this.region}:${this.account}:function:mcp-*`],
      })
    )

    // CloudWatch Logs for Gateway
    this.gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'GatewayLogsAccess',
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/gateways/*`,
        ],
      })
    )

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'LambdaRoleArn', {
      value: this.lambdaRole.roleArn,
      description: 'Lambda Execution Role ARN',
      exportName: `${projectName}-lambda-role-arn`,
    })

    new cdk.CfnOutput(this, 'GatewayRoleArn', {
      value: this.gatewayRole.roleArn,
      description: 'Gateway Execution Role ARN',
      exportName: `${projectName}-gateway-role-arn`,
    })

    new cdk.CfnOutput(this, 'TavilySecretArn', {
      value: this.tavilyApiKeySecret.secretArn,
      description: 'Tavily API Key Secret ARN',
    })

    new cdk.CfnOutput(this, 'GoogleSecretArn', {
      value: this.googleCredentialsSecret.secretArn,
      description: 'Google Credentials Secret ARN',
    })

    new cdk.CfnOutput(this, 'GoogleMapsSecretArn', {
      value: this.googleMapsCredentialsSecret.secretArn,
      description: 'Google Maps Credentials Secret ARN',
    })

    new cdk.CfnOutput(this, 'SecretsSetupInstructions', {
      value: `
To set API keys, run:
aws secretsmanager put-secret-value --secret-id ${this.tavilyApiKeySecret.secretName} --secret-string "YOUR_TAVILY_API_KEY"
aws secretsmanager put-secret-value --secret-id ${this.googleCredentialsSecret.secretName} --secret-string '{"api_key":"YOUR_API_KEY","search_engine_id":"YOUR_ENGINE_ID"}'
aws secretsmanager put-secret-value --secret-id ${this.googleMapsCredentialsSecret.secretName} --secret-string '{"api_key":"YOUR_GOOGLE_MAPS_API_KEY"}'
      `.trim(),
      description: 'Instructions for setting API keys',
    })
  }
}
