/**
 * Gateway Stack for AgentCore Gateway
 * Creates the AgentCore Gateway with MCP protocol and AWS_IAM authorization
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

export interface GatewayStackProps extends cdk.StackProps {
  projectName: string
  environment: string
  gatewayRole: iam.IRole
}

export class GatewayStack extends cdk.Stack {
  public readonly gateway: agentcore.CfnGateway
  public readonly gatewayArn: string
  public readonly gatewayUrl: string
  public readonly gatewayId: string

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props)

    const { projectName, environment, gatewayRole } = props

    // ============================================================
    // AgentCore Gateway
    // ============================================================

    this.gateway = new agentcore.CfnGateway(this, 'MCPGateway', {
      name: `${projectName}-mcp-gateway`,
      description: 'MCP Gateway for research and analysis tools (Tavily, Wikipedia, ArXiv, Google Search, Finance, Google Maps)',
      roleArn: gatewayRole.roleArn,

      // Authentication: AWS_IAM (SigV4)
      authorizerType: 'AWS_IAM',

      // Protocol: MCP
      protocolType: 'MCP',

      // Exception level: DEBUG for development, ERROR for production
      exceptionLevel: environment === 'prod' ? 'ERROR' : 'DEBUG',

      // MCP Protocol Configuration
      protocolConfiguration: {
        mcp: {
          supportedVersions: ['2025-03-26', '2025-06-18'], // MCP protocol versions
        },
      },

      tags: {
        Environment: environment,
        Application: projectName,
        ManagedBy: 'CDK',
      },
    })

    this.gatewayArn = this.gateway.attrGatewayArn
    this.gatewayUrl = this.gateway.attrGatewayUrl
    this.gatewayId = this.gateway.attrGatewayIdentifier

    // ============================================================
    // Parameter Store - Gateway Configuration
    // ============================================================

    new ssm.StringParameter(this, 'GatewayArnParameter', {
      parameterName: `/${projectName}/${environment}/mcp/gateway-arn`,
      stringValue: this.gatewayArn,
      description: 'AgentCore Gateway ARN for MCP tools',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'GatewayUrlParameter', {
      parameterName: `/${projectName}/${environment}/mcp/gateway-url`,
      stringValue: this.gatewayUrl,
      description: 'AgentCore Gateway URL for remote invocation (SigV4 authenticated)',
      tier: ssm.ParameterTier.STANDARD,
    })

    new ssm.StringParameter(this, 'GatewayIdParameter', {
      parameterName: `/${projectName}/${environment}/mcp/gateway-id`,
      stringValue: this.gatewayId,
      description: 'AgentCore Gateway Identifier',
      tier: ssm.ParameterTier.STANDARD,
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'GatewayArn', {
      value: this.gatewayArn,
      description: 'AgentCore Gateway ARN',
      exportName: `${projectName}-gateway-arn`,
    })

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: this.gatewayUrl,
      description: 'AgentCore Gateway URL (requires SigV4 authentication)',
      exportName: `${projectName}-gateway-url`,
    })

    new cdk.CfnOutput(this, 'GatewayId', {
      value: this.gatewayId,
      description: 'AgentCore Gateway Identifier',
      exportName: `${projectName}-gateway-id`,
    })

    new cdk.CfnOutput(this, 'GatewayStatus', {
      value: this.gateway.attrStatus,
      description: 'Gateway Status',
    })

    new cdk.CfnOutput(this, 'UsageInstructions', {
      value: `
Gateway URL: ${this.gatewayUrl}
Authentication: AWS_IAM (SigV4)

To invoke from AgentCore Runtime, add to environment:
  GATEWAY_URL: ${this.gatewayUrl}

To test with AWS CLI:
  aws bedrock-agentcore invoke-gateway \\
    --gateway-identifier ${this.gatewayId} \\
    --region ${this.region}
      `.trim(),
      description: 'Usage instructions for Gateway',
    })
  }
}
