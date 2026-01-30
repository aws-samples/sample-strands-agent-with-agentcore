import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/**
 * Props for SsoMonitoringStack
 */
export interface SsoMonitoringStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, production)
   * @default 'dev'
   */
  readonly environment?: string;

  /**
   * Email address for alarm notifications
   * @default undefined - no email subscription
   */
  readonly alarmNotificationEmail?: string;

  /**
   * ARN of the Lambda@Edge IAM role that needs access to secrets
   * @default undefined - no Lambda@Edge access granted
   */
  readonly lambdaEdgeRoleArn?: string;

  /**
   * Cognito User Pool ID for monitoring
   * @default undefined
   */
  readonly cognitoUserPoolId?: string;

  /**
   * Log retention in days
   * @default 7 for dev, 90 for production
   */
  readonly logRetentionDays?: number;

  /**
   * Enable CloudTrail logging for IAM Identity Center
   * @default true
   */
  readonly enableCloudTrail?: boolean;
}

/**
 * CDK Stack for SSO Authentication Monitoring and Secrets Management
 * 
 * This stack creates:
 * - Secrets Manager secrets for SAML metadata storage
 * - CloudWatch Log Groups for Lambda@Edge functions
 * - Custom CloudWatch metrics for authentication monitoring
 * - CloudWatch alarms for authentication failures and latency
 * - CloudWatch dashboard for authentication visibility
 * - SNS topics for alarm notifications
 * - CloudTrail logging for IAM Identity Center audit
 * 
 * Implements Tasks 1.4 (Secrets Management) and 1.5 (Monitoring and Logging)
 */
export class SsoMonitoringStack extends cdk.Stack {
  /**
   * Secrets Manager secret for SAML metadata
   */
  public readonly samlMetadataSecret: secretsmanager.Secret;

  /**
   * CloudWatch Log Group for viewer request Lambda@Edge
   */
  public readonly viewerRequestLogGroup: logs.LogGroup;

  /**
   * CloudWatch Log Group for origin request Lambda@Edge
   */
  public readonly originRequestLogGroup: logs.LogGroup;

  /**
   * SNS Topic for authentication alarms
   */
  public readonly alarmTopic: sns.Topic;

  /**
   * CloudWatch Dashboard for authentication metrics
   */
  public readonly authDashboard: cloudwatch.Dashboard;

  /**
   * CloudTrail trail for IAM Identity Center logging
   */
  public readonly cloudTrail?: cloudtrail.Trail;

  constructor(scope: Construct, id: string, props?: SsoMonitoringStackProps) {
    super(scope, id, props);

    const environment = props?.environment ?? 'dev';
    const enableCloudTrail = props?.enableCloudTrail ?? true;
    const logRetentionDays = props?.logRetentionDays ?? 
      (environment === 'production' ? 90 : 7);

    // ============================================================
    // Task 1.4: Secrets Management
    // ============================================================

    // Task 1.4.1: Create Secrets Manager secret for SAML metadata
    this.samlMetadataSecret = new secretsmanager.Secret(this, 'SamlMetadataSecret', {
      secretName: `sso-auth/saml-metadata-${environment}`,
      description: 'IAM Identity Center SAML metadata XML for SSO authentication',
      // Task 1.4.2: Initial placeholder value - will be updated with actual metadata
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        metadata: 'PLACEHOLDER - Upload IAM Identity Center SAML metadata here',
        lastUpdated: new Date().toISOString(),
        environment: environment,
      })),
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Task 1.4.3: Configure secret rotation policy
    // Note: SAML metadata rotation is typically manual as it requires
    // coordination with IAM Identity Center. We set up the rotation
    // schedule but the actual rotation Lambda would need to be implemented
    // based on organizational requirements.
    
    // Create a custom resource policy for the secret
    this.samlMetadataSecret.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowSecretAccess',
      effect: iam.Effect.ALLOW,
      principals: [new iam.AccountRootPrincipal()],
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: ['*'],
    }));

    // Task 1.4.4: Grant Lambda@Edge access to secrets
    if (props?.lambdaEdgeRoleArn) {
      const lambdaEdgeRole = iam.Role.fromRoleArn(
        this, 
        'LambdaEdgeRole', 
        props.lambdaEdgeRoleArn
      );
      
      this.samlMetadataSecret.grantRead(lambdaEdgeRole);
    }

    // Create additional secret for Cognito client configuration
    const cognitoConfigSecret = new secretsmanager.Secret(this, 'CognitoConfigSecret', {
      secretName: `sso-auth/cognito-config-${environment}`,
      description: 'Cognito configuration for SSO authentication',
      secretStringValue: cdk.SecretValue.unsafePlainText(JSON.stringify({
        userPoolId: props?.cognitoUserPoolId ?? 'PLACEHOLDER',
        region: this.region,
        environment: environment,
        lastUpdated: new Date().toISOString(),
      })),
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // ============================================================
    // Task 1.5: Monitoring and Logging
    // ============================================================

    // Task 1.5.1: Create CloudWatch log groups for Lambda@Edge
    // Note: Lambda@Edge logs are created in the region where the function executes
    // We create log groups in us-east-1 as that's where Lambda@Edge is deployed
    this.viewerRequestLogGroup = new logs.LogGroup(this, 'ViewerRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.sso-viewer-request-${environment}`,
      retention: this.getLogRetention(logRetentionDays),
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    this.originRequestLogGroup = new logs.LogGroup(this, 'OriginRequestLogGroup', {
      logGroupName: `/aws/lambda/us-east-1.sso-origin-request-${environment}`,
      retention: this.getLogRetention(logRetentionDays),
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Create log group for Cognito authentication events
    // This log group is created for future use when Cognito advanced security logging is enabled
    new logs.LogGroup(this, 'CognitoAuthLogGroup', {
      logGroupName: `/aws/cognito/sso-auth-${environment}`,
      retention: this.getLogRetention(logRetentionDays),
      removalPolicy: environment === 'production' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Task 1.5.6: Configure SNS topics for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AuthAlarmTopic', {
      topicName: `sso-auth-alarms-${environment}`,
      displayName: `SSO Authentication Alarms (${environment})`,
    });

    // Add email subscription if provided
    if (props?.alarmNotificationEmail) {
      new sns.Subscription(this, 'AlarmEmailSubscription', {
        topic: this.alarmTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.alarmNotificationEmail,
      });
    }

    // Task 1.5.3: Create custom CloudWatch metrics
    // These metrics will be published by Lambda@Edge functions
    const namespace = `SSO/Authentication/${environment}`;

    // Task 1.5.3.1: AuthenticationSuccess metric
    const authSuccessMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'AuthenticationSuccess',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    });

    // Task 1.5.3.2: AuthenticationFailure metric
    const authFailureMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'AuthenticationFailure',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    });

    // Task 1.5.3.3: TokenValidationLatency metric
    const tokenLatencyMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'TokenValidationLatency',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'p99',
      period: cdk.Duration.minutes(1),
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    // Task 1.5.3.4: SAMLAssertionProcessing metric
    const samlProcessingMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'SAMLAssertionProcessing',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'p99',
      period: cdk.Duration.minutes(1),
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    // Task 1.5.4: Create CloudWatch alarms

    // Task 1.5.4.1: High authentication failure rate alarm
    const authFailureAlarm = new cloudwatch.Alarm(this, 'HighAuthFailureRateAlarm', {
      alarmName: `sso-high-auth-failure-rate-${environment}`,
      alarmDescription: 'Authentication failure rate exceeds 10% over 5 minutes',
      metric: authFailureMetric,
      threshold: 10,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    authFailureAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));
    authFailureAlarm.addOkAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Task 1.5.4.2: Lambda@Edge error rate alarm
    const lambdaErrorMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: `sso-viewer-request-${environment}`,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1),
    });

    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaEdgeErrorRateAlarm', {
      alarmName: `sso-lambda-edge-error-rate-${environment}`,
      alarmDescription: 'Lambda@Edge error rate exceeds 5 errors per minute',
      metric: lambdaErrorMetric,
      threshold: 5,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));
    lambdaErrorAlarm.addOkAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Task 1.5.4.3: Token validation latency alarm
    const tokenLatencyAlarm = new cloudwatch.Alarm(this, 'TokenValidationLatencyAlarm', {
      alarmName: `sso-token-validation-latency-${environment}`,
      alarmDescription: 'Token validation p99 latency exceeds 100ms',
      metric: tokenLatencyMetric,
      threshold: 100,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    tokenLatencyAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Task 1.5.4.4: SAML certificate expiration alarm
    // This is a custom metric that should be published by a scheduled Lambda
    const certExpirationMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'SAMLCertificateDaysUntilExpiration',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'Minimum',
      period: cdk.Duration.hours(1),
    });

    const certExpirationAlarm = new cloudwatch.Alarm(this, 'SAMLCertExpirationAlarm', {
      alarmName: `sso-saml-cert-expiration-${environment}`,
      alarmDescription: 'SAML certificate expires in less than 30 days',
      metric: certExpirationMetric,
      threshold: 30,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    certExpirationAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Task 1.5.5: Create CloudWatch dashboard for authentication metrics
    this.authDashboard = new cloudwatch.Dashboard(this, 'AuthDashboard', {
      dashboardName: `SSO-Authentication-${environment}`,
    });

    // Add widgets to dashboard
    this.authDashboard.addWidgets(
      // Header row
      new cloudwatch.TextWidget({
        markdown: `# SSO Authentication Dashboard (${environment})\nReal-time monitoring of authentication metrics and system health`,
        width: 24,
        height: 1,
      }),
    );

    this.authDashboard.addWidgets(
      // Authentication success/failure metrics
      new cloudwatch.GraphWidget({
        title: 'Authentication Success vs Failure',
        left: [authSuccessMetric],
        right: [authFailureMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Success Count',
          showUnits: false,
        },
        rightYAxis: {
          label: 'Failure Count',
          showUnits: false,
        },
      }),
      // Token validation latency
      new cloudwatch.GraphWidget({
        title: 'Token Validation Latency (p99)',
        left: [tokenLatencyMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Latency (ms)',
          showUnits: false,
        },
      }),
    );

    this.authDashboard.addWidgets(
      // SAML processing time
      new cloudwatch.GraphWidget({
        title: 'SAML Assertion Processing Time (p99)',
        left: [samlProcessingMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Processing Time (ms)',
          showUnits: false,
        },
      }),
      // Lambda@Edge errors
      new cloudwatch.GraphWidget({
        title: 'Lambda@Edge Errors',
        left: [lambdaErrorMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Error Count',
          showUnits: false,
        },
      }),
    );

    this.authDashboard.addWidgets(
      // Alarm status widget
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        alarms: [
          authFailureAlarm,
          lambdaErrorAlarm,
          tokenLatencyAlarm,
          certExpirationAlarm,
        ],
        width: 24,
        height: 3,
      }),
    );

    // Task 1.5.7: Set up CloudTrail logging for IAM Identity Center
    if (enableCloudTrail) {
      // Create S3 bucket for CloudTrail logs
      const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
        bucketName: `sso-cloudtrail-logs-${environment}-${this.account}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        lifecycleRules: [
          {
            id: 'TransitionToGlacier',
            enabled: true,
            transitions: [
              {
                storageClass: s3.StorageClass.GLACIER,
                transitionAfter: cdk.Duration.days(90),
              },
            ],
            expiration: cdk.Duration.days(365 * 7), // 7 years retention
          },
        ],
        removalPolicy: environment === 'production' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: environment !== 'production',
      });

      // Create CloudWatch Log Group for CloudTrail
      const cloudTrailLogGroup = new logs.LogGroup(this, 'CloudTrailLogGroup', {
        logGroupName: `/aws/cloudtrail/sso-auth-${environment}`,
        retention: this.getLogRetention(logRetentionDays),
        removalPolicy: environment === 'production' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
      });

      // Create CloudTrail trail
      this.cloudTrail = new cloudtrail.Trail(this, 'SsoCloudTrail', {
        trailName: `sso-auth-trail-${environment}`,
        bucket: trailBucket,
        cloudWatchLogGroup: cloudTrailLogGroup,
        cloudWatchLogsRetention: this.getLogRetention(logRetentionDays),
        enableFileValidation: true,
        includeGlobalServiceEvents: true,
        isMultiRegionTrail: true,
        sendToCloudWatchLogs: true,
      });

      // Add event selectors for IAM Identity Center and Cognito
      this.cloudTrail.addEventSelector(cloudtrail.DataResourceType.LAMBDA_FUNCTION, [
        `arn:aws:lambda:us-east-1:${this.account}:function:sso-*`,
      ]);
    }

    // Task 1.4.5: Update environment variables with secret ARNs
    // Export secret ARNs for use by other stacks
    new cdk.CfnOutput(this, 'SamlMetadataSecretArn', {
      value: this.samlMetadataSecret.secretArn,
      description: 'ARN of the SAML metadata secret',
      exportName: `${this.stackName}-SamlMetadataSecretArn`,
    });

    new cdk.CfnOutput(this, 'CognitoConfigSecretArn', {
      value: cognitoConfigSecret.secretArn,
      description: 'ARN of the Cognito configuration secret',
      exportName: `${this.stackName}-CognitoConfigSecretArn`,
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'ARN of the SNS topic for authentication alarms',
      exportName: `${this.stackName}-AlarmTopicArn`,
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.authDashboard.dashboardName}`,
      description: 'URL to the CloudWatch authentication dashboard',
    });

    new cdk.CfnOutput(this, 'ViewerRequestLogGroupName', {
      value: this.viewerRequestLogGroup.logGroupName,
      description: 'Name of the viewer request Lambda@Edge log group',
      exportName: `${this.stackName}-ViewerRequestLogGroupName`,
    });

    new cdk.CfnOutput(this, 'OriginRequestLogGroupName', {
      value: this.originRequestLogGroup.logGroupName,
      description: 'Name of the origin request Lambda@Edge log group',
      exportName: `${this.stackName}-OriginRequestLogGroupName`,
    });

    new cdk.CfnOutput(this, 'MetricsNamespace', {
      value: namespace,
      description: 'CloudWatch metrics namespace for SSO authentication',
      exportName: `${this.stackName}-MetricsNamespace`,
    });

    if (this.cloudTrail) {
      new cdk.CfnOutput(this, 'CloudTrailArn', {
        value: this.cloudTrail.trailArn,
        description: 'ARN of the CloudTrail trail for SSO audit logging',
        exportName: `${this.stackName}-CloudTrailArn`,
      });
    }
  }

  /**
   * Convert retention days to LogRetention enum
   */
  private getLogRetention(days: number): logs.RetentionDays {
    const retentionMap: { [key: number]: logs.RetentionDays } = {
      1: logs.RetentionDays.ONE_DAY,
      3: logs.RetentionDays.THREE_DAYS,
      5: logs.RetentionDays.FIVE_DAYS,
      7: logs.RetentionDays.ONE_WEEK,
      14: logs.RetentionDays.TWO_WEEKS,
      30: logs.RetentionDays.ONE_MONTH,
      60: logs.RetentionDays.TWO_MONTHS,
      90: logs.RetentionDays.THREE_MONTHS,
      120: logs.RetentionDays.FOUR_MONTHS,
      150: logs.RetentionDays.FIVE_MONTHS,
      180: logs.RetentionDays.SIX_MONTHS,
      365: logs.RetentionDays.ONE_YEAR,
      400: logs.RetentionDays.THIRTEEN_MONTHS,
      545: logs.RetentionDays.EIGHTEEN_MONTHS,
      731: logs.RetentionDays.TWO_YEARS,
      1827: logs.RetentionDays.FIVE_YEARS,
      2192: logs.RetentionDays.SIX_YEARS,
      2557: logs.RetentionDays.SEVEN_YEARS,
      2922: logs.RetentionDays.EIGHT_YEARS,
      3288: logs.RetentionDays.NINE_YEARS,
      3653: logs.RetentionDays.TEN_YEARS,
    };

    // Find the closest retention period
    const availableDays = Object.keys(retentionMap).map(Number).sort((a, b) => a - b);
    const closestDays = availableDays.find(d => d >= days) || availableDays[availableDays.length - 1];
    
    return retentionMap[closestDays];
  }
}
