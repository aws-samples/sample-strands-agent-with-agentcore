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
import { Construct } from 'constructs';

export interface ChatbotStackProps extends cdk.StackProps {
  userPoolId?: string;
  userPoolClientId?: string;
  userPoolDomain?: string;
  enableCognito?: boolean;
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

    // ALB is now CloudFront-only access, no CIDR configuration needed

    // ECR Repositories - Import existing repositories
    const backendRepository = ecr.Repository.fromRepositoryName(this, 'ChatbotBackendRepository', 'chatbot-backend');
    const frontendRepository = ecr.Repository.fromRepositoryName(this, 'ChatbotFrontendRepository', 'chatbot-frontend');


    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'ChatbotCluster', {
      vpc,
      clusterName: 'chatbot-cluster',
    });

    // Backend Task Definition
    const backendTaskDefinition = new ecs.FargateTaskDefinition(this, 'ChatbotBackendTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Add Bedrock permissions to backend task role
    backendTaskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
    );
    backendTaskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('BedrockAgentCoreFullAccess')
    );

    // Add API Gateway invoke permissions for MCP servers
    backendTaskDefinition.addToTaskRolePolicy(
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

    // Add Parameter Store permissions for dynamic MCP endpoint configuration
    backendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath'
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/mcp/endpoints/*`
        ]
      })
    );

    // Add CloudWatch permissions for AgentCore Observability
    backendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'cloudwatch:PutMetricData'
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:agents/strands-agent-logs`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:agents/strands-agent-logs:*`
        ]
      })
    );

    // Add X-Ray permissions for trace export
    backendTaskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords'
        ],
        resources: ['*']
      })
    );

    // Handle AgentCore Observability Log Group (create only if it doesn't exist)
    const logGroupName = 'agents/strands-agent-logs';
    let agentObservabilityLogGroup: logs.ILogGroup;

    // Check if we should import existing log group (set by deployment script if log group exists)
    const importExistingLogGroup = process.env.IMPORT_EXISTING_LOG_GROUP === 'true';

    if (importExistingLogGroup) {
      // Import existing log group
      agentObservabilityLogGroup = logs.LogGroup.fromLogGroupName(this, 'AgentObservabilityLogGroup', logGroupName);
    } else {
      // Create new log group with error handling
      agentObservabilityLogGroup = new logs.LogGroup(this, 'AgentObservabilityLogGroup', {
        logGroupName: logGroupName,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.RETAIN
      });
    }

    // Generate unique log stream name
    const logStreamName = `otel-auto-${Math.random().toString(36).substring(2, 11)}`;
    
    // Create OTEL log stream
    new logs.LogStream(this, 'OtelLogStream', {
      logGroup: agentObservabilityLogGroup,
      logStreamName: logStreamName,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });



    // Backend Container
    const backendEnvironment: { [key: string]: string } = {
      DEPLOYMENT_ENV: 'production',
      STORAGE_TYPE: 'local',
      HOST: '0.0.0.0',
      PORT: '8000',
      CORS_ORIGINS: '*',
      FORCE_UPDATE: new Date().toISOString(),
      AWS_DEFAULT_REGION: this.region,
      // AgentCore Observability - OTEL Configuration
      OTEL_PYTHON_DISTRO: 'aws_distro',
      OTEL_PYTHON_CONFIGURATOR: 'aws_configurator',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/protobuf',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: `x-aws-log-group=agents/strands-agent-logs,x-aws-log-stream=${logStreamName},x-aws-metric-namespace=agentsd`,
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=strands-chatbot',
      AGENT_OBSERVABILITY_ENABLED: 'true',
      AWS_REGION: this.region,
      OTEL_LOG_LEVEL: 'DEBUG',
      // OTEL batch processing settings for real-time traces
      OTEL_BSP_SCHEDULE_DELAY: '100',
      OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1',
      OTEL_BSP_EXPORT_TIMEOUT: '5000',
    };

    // Add CORS origins configuration (used for both API CORS and embed domain validation)
    const corsOrigins = process.env.CORS_ORIGINS;
    if (corsOrigins !== undefined) {
      backendEnvironment.CORS_ORIGINS = corsOrigins;
    }

    const backendContainer = backendTaskDefinition.addContainer('ChatbotBackendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(backendRepository, 'latest'),
      environment: backendEnvironment,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'chatbot-backend',
      }),
    });

    backendContainer.addPortMappings({
      containerPort: 8000,
      protocol: ecs.Protocol.TCP,
    });

    // Backend ECS Service
    const backendService = new ecs.FargateService(this, 'ChatbotBackendService', {
      cluster,
      taskDefinition: backendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      minHealthyPercent: 0,  // Allow stopping all tasks during deployment
      maxHealthyPercent: 200,
    });


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

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ChatbotALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      idleTimeout: cdk.Duration.seconds(3600),
    });

    // Will create listener after target groups are defined

    // Frontend Task Definition (before ALB targets)
    const frontendTaskDefinition = new ecs.FargateTaskDefinition(this, 'ChatbotFrontendTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });


    // Frontend Container
    const frontendEnvironment: { [key: string]: string } = {
      NODE_ENV: 'production',
      FORCE_UPDATE: new Date().toISOString(),
      BACKEND_URL: `http://${alb.loadBalancerDnsName}`,
      // NEXT_PUBLIC_API_URL removed - using auto-detection based on hostname
      NEXT_PUBLIC_AWS_REGION: this.region,
      AWS_DEFAULT_REGION: this.region,
    };

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

    // Import Cognito resources if provided
    let userPool: cognito.IUserPool | undefined;
    let userPoolClient: cognito.IUserPoolClient | undefined;
    let userPoolDomain: cognito.IUserPoolDomain | undefined;

    if (props?.enableCognito && props?.userPoolId && props?.userPoolClientId && props?.userPoolDomain) {
      userPool = cognito.UserPool.fromUserPoolId(this, 'ImportedUserPool', props.userPoolId);
      userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(this, 'ImportedUserPoolClient', props.userPoolClientId);
      userPoolDomain = cognito.UserPoolDomain.fromDomainName(this, 'ImportedUserPoolDomain', props.userPoolDomain);
    }

    // Frontend Target Group
    const frontendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FrontendTargetGroup', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [frontendService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Set default action to forward to frontend (will be updated after target groups are created)

    frontendTargetGroup.setAttribute('load_balancing.cross_zone.enabled', 'true');

    // Backend Target Group - Unified routing for all API requests
    const backendTargetGroup = new elbv2.ApplicationTargetGroup(this, 'BackendTargetGroup', {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [backendService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(60),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
      },
      stickinessCookieDuration: cdk.Duration.hours(1),
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    backendTargetGroup.setAttribute('load_balancing.cross_zone.enabled', 'true');

    // Create ALB listener with proper default action
    const listener = alb.addListener('ChatbotListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.forward([frontendTargetGroup]),
    });

    // Health check endpoint without authentication (for ALB health checks)
    listener.addAction('HealthCheckAction', {
      priority: 50,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/health']),
      ],
      action: elbv2.ListenerAction.forward([backendTargetGroup]),
    });

    // API endpoints routing (authentication handled by CloudFront)
    listener.addAction('BackendApiAction', {
      priority: 100,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          '/api/*',           // All API requests
          '/docs*',           // Swagger documentation
          '/uploads/*',       // Direct uploads endpoints
          '/output/*',        // Direct output endpoints
        ]),
      ],
      action: elbv2.ListenerAction.forward([backendTargetGroup]),
    });

    // Create custom Origin Request Policy to forward session headers
    const customOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ChatbotOriginRequestPolicy', {
      originRequestPolicyName: 'ChatbotCustomOriginPolicy',
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
      description: 'Backend API URL via CloudFront (HTTPS)',
    });

    new cdk.CfnOutput(this, 'SwaggerDocsUrl', {
      value: `https://${distribution.distributionDomainName}/docs`,
      description: 'API Documentation (Swagger)',
    });


    new cdk.CfnOutput(this, 'BackendECRRepositoryUri', {
      value: backendRepository.repositoryUri,
      description: 'Backend ECR Repository URI',
    });

    new cdk.CfnOutput(this, 'FrontendECRRepositoryUri', {
      value: frontendRepository.repositoryUri,
      description: 'Frontend ECR Repository URI',
    });

    // Export VPC information for MCP farm to reuse
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID for MCP farm reuse',
      exportName: `${this.stackName}-vpc-id`
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Private Subnet IDs for MCP farm reuse',
      exportName: `${this.stackName}-private-subnets`
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Public Subnet IDs for MCP farm reuse',
      exportName: `${this.stackName}-public-subnets`
    });

    new cdk.CfnOutput(this, 'VpcCidrBlock', {
      value: vpc.vpcCidrBlock,
      description: 'VPC CIDR Block for MCP farm reuse',
      exportName: `${this.stackName}-vpc-cidr`
    });

    // AgentCore Observability Outputs
    new cdk.CfnOutput(this, 'ObservabilityLogGroupName', {
      value: 'agents/strands-agent-logs',
      description: 'CloudWatch Log Group for AgentCore Observability'
    });

    new cdk.CfnOutput(this, 'ObservabilitySetupNote', {
      value: 'Remember to enable CloudWatch Transaction Search for full observability',
      description: 'AgentCore Observability Setup Reminder'
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
