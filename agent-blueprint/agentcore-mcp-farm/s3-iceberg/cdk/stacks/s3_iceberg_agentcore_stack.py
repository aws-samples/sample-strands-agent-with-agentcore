"""
S3 Iceberg MCP Server on AWS Bedrock AgentCore Runtime
CDK Stack Definition
"""
from aws_cdk import (
    Stack,
    CfnOutput,
    RemovalPolicy,
    Fn,
    aws_ecr as ecr,
    aws_iam as iam,
    aws_ssm as ssm,
    aws_logs as logs,
    aws_ec2 as ec2,
    aws_s3tables as s3tables,
    aws_bedrockagentcore as bedrockagentcore,
)
from constructs import Construct


class S3IcebergAgentCoreStack(Stack):
    """
    CDK Stack for deploying S3 Iceberg MCP Server on Bedrock AgentCore Runtime

    This stack creates:
    - ECR repository for Docker images
    - S3 bucket for Iceberg tables
    - IAM roles with necessary permissions
    - Bedrock AgentCore Runtime with container configuration
    - SSM parameter for endpoint storage
    """

    def __init__(self, scope: Construct, construct_id: str, stage: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.stage = stage
        region = self.region

        # ==================== ECR Repository ====================
        # Import existing ECR repository (created by deploy.sh before CDK deployment)
        ecr_repository = ecr.Repository.from_repository_name(
            self,
            "S3IcebergMcpRepository",
            repository_name=f"{construct_id}-repository"
        )

        # ==================== S3 Tables Bucket ====================
        # Create S3 Tables bucket for Iceberg format
        table_bucket = s3tables.CfnTableBucket(
            self,
            "IcebergTablesBucket",
            table_bucket_name=f"s3-tables-bucket-{self.account}".lower()[:63],  # Must be lowercase, max 63 chars
        )

        # Create namespace for organizing tables
        table_namespace = s3tables.CfnNamespace(
            self,
            "IcebergNamespace",
            namespace="default",  # Default namespace
            table_bucket_arn=table_bucket.attr_table_bucket_arn
        )

        # TODO: Cannot use VPC mode due to ENI race condition bug. Uncomment to use VPC mode when bug is resolved.
        # # ==================== VPC Import ====================
        # # Import VPC from ChatbotStack exports
        # vpc_id = Fn.import_value("ChatbotStack-vpc-id")
        # vpc_cidr = Fn.import_value("ChatbotStack-vpc-cidr")

        # # Import private subnets - split comma-separated list at synthesis time
        # # Note: We'll use Fn.select to get individual subnets from the comma-separated export
        # private_subnets_export = Fn.import_value("ChatbotStack-private-subnets")

        # private_subnet_list = Fn.split(",", private_subnets_export)
        # private_subnet_1 = Fn.select(0, private_subnet_list)
        # private_subnet_2 = Fn.select(1, private_subnet_list)

        # private_subnet_ids = [private_subnet_1, private_subnet_2]

        # azs = Stack.of(self).availability_zones[:2]

        # vpc = ec2.Vpc.from_vpc_attributes(
        #     self,
        #     "ImportedVpc",
        #     vpc_id=vpc_id,
        #     availability_zones=azs,
        #     private_subnet_ids=private_subnet_ids,
        #     vpc_cidr_block=vpc_cidr
        # )

        # # ==================== Security Group ====================
        # security_group = ec2.SecurityGroup(
        #     self,
        #     "AgentCoreRuntimeSG",
        #     vpc=vpc,
        #     description="Security group for S3 Iceberg AgentCore Runtime",
        #     allow_all_outbound=True
        # )

        # # Allow HTTPS inbound for MCP communication from VPC
        # security_group.add_ingress_rule(
        #     peer=ec2.Peer.ipv4(vpc_cidr),
        #     connection=ec2.Port.tcp(443),
        #     description="Allow HTTPS for MCP communication"
        # )

        # # Allow HTTP inbound for container port from VPC
        # security_group.add_ingress_rule(
        #     peer=ec2.Peer.ipv4(vpc_cidr),
        #     connection=ec2.Port.tcp(8000),
        #     description="Allow HTTP for MCP server"
        # )

        # ==================== IAM Role for AgentCore Runtime ====================
        runtime_role = iam.Role(
            self,
            "AgentCoreRuntimeRole",
            assumed_by=iam.CompositePrincipal(
                iam.ServicePrincipal("bedrock-agentcore.amazonaws.com",
                    conditions={
                        "StringEquals": {
                            "aws:SourceAccount": self.account
                        },
                        "ArnLike": {
                            "aws:SourceArn": f"arn:aws:bedrock-agentcore:{region}:{self.account}:*"
                        }
                    }
                )
            ),
            description="IAM role for S3 Iceberg AgentCore Runtime"
        )

        # Add S3 Tables permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3tables:GetTableBucket",
                    "s3tables:ListTableBuckets"
                ],
                resources=[table_bucket.attr_table_bucket_arn]
            )
        )

        # Add namespace permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3tables:GetNamespace",
                    "s3tables:ListNamespaces"
                ],
                resources=[f"{table_bucket.attr_table_bucket_arn}/namespace/*"]
            )
        )

        # Add S3 Tables API permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3tables:GetTable",
                    "s3tables:ListTables",
                    "s3tables:GetTableBucket",
                    "s3tables:ListTableBuckets",
                    "s3tables:GetTableMetadataLocation",
                    "s3tables:GetTableData",
                    "s3tables:PutTableData",
                    "s3tables:CreateTable",
                    "s3tables:DeleteTable",
                    "s3tables:UpdateTable"
                ],
                resources=["*"]
            )
        )

        # Add S3 bucket permissions for underlying Iceberg data access
        # S3 Tables uses underlying S3 buckets with pattern: *--table-s3
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3:GetObject",           # Read Parquet/Avro data files
                    "s3:ListBucket",          # List objects in table directories
                    "s3:GetObjectVersion"     # Access specific file versions
                ],
                resources=[
                    "arn:aws:s3:::*--table-s3",       # S3 Tables bucket pattern
                    "arn:aws:s3:::*--table-s3/*"
                ]
            )
        )

        # Add ECR permissions for pulling images
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                sid="ECRImageAccess",
                effect=iam.Effect.ALLOW,
                actions=[
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchCheckLayerAvailability"
                ],
                resources=[f"arn:aws:ecr:{region}:{self.account}:repository/*"]
            )
        )

        runtime_role.add_to_policy(
            iam.PolicyStatement(
                sid="ECRTokenAccess",
                effect=iam.Effect.ALLOW,
                actions=["ecr:GetAuthorizationToken"],
                resources=["*"]
            )
        )

        # Add CloudWatch Logs permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "logs:DescribeLogStreams",
                    "logs:CreateLogGroup"
                ],
                resources=[f"arn:aws:logs:{region}:{self.account}:log-group:/aws/bedrock-agentcore/runtimes/*"]
            )
        )

        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=["logs:DescribeLogGroups"],
                resources=[f"arn:aws:logs:{region}:{self.account}:log-group:*"]
            )
        )

        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                resources=[f"arn:aws:logs:{region}:{self.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"]
            )
        )

        # Add X-Ray permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "xray:PutTraceSegments",
                    "xray:PutTelemetryRecords",
                    "xray:GetSamplingRules",
                    "xray:GetSamplingTargets"
                ],
                resources=["*"]
            )
        )

        # Add CloudWatch metrics permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=["cloudwatch:PutMetricData"],
                resources=["*"],
                conditions={
                    "StringEquals": {
                        "cloudwatch:namespace": "bedrock-agentcore"
                    }
                }
            )
        )

        # Add workload identity permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                sid="GetAgentAccessToken",
                effect=iam.Effect.ALLOW,
                actions=[
                    "bedrock-agentcore:GetWorkloadAccessToken",
                    "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                    "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
                ],
                resources=[
                    f"arn:aws:bedrock-agentcore:{region}:{self.account}:workload-identity-directory/default",
                    f"arn:aws:bedrock-agentcore:{region}:{self.account}:workload-identity-directory/default/workload-identity/agentName-*"
                ]
            )
        )

        # Add Bedrock model invocation permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                sid="BedrockModelInvocation",
                effect=iam.Effect.ALLOW,
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream"
                ],
                resources=[
                    "arn:aws:bedrock:*::foundation-model/*",
                    f"arn:aws:bedrock:{region}:{self.account}:*"
                ]
            )
        )

        # Add VPC permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "ec2:CreateNetworkInterface",
                    "ec2:DescribeNetworkInterfaces",
                    "ec2:DeleteNetworkInterface",
                    "ec2:AssignPrivateIpAddresses",
                    "ec2:UnassignPrivateIpAddresses"
                ],
                resources=["*"]
            )
        )

        # ==================== CloudWatch Log Group ====================
        log_group = logs.LogGroup(
            self,
            "AgentCoreRuntimeLogGroup",
            log_group_name=f"/aws/bedrockagentcore/{construct_id}",
            removal_policy=RemovalPolicy.DESTROY,
            retention=logs.RetentionDays.ONE_WEEK
        )

        # ==================== Import Cognito User Pool ====================
        # Import Cognito User Pool ID and Client ID from CognitoAuthStack
        cognito_user_pool_id = Fn.import_value("CognitoAuthStack-UserPoolId")
        cognito_client_id = Fn.import_value("CognitoAuthStack-UserPoolClientId")

        # Construct Cognito discovery URL
        cognito_discovery_url = f"https://cognito-idp.{region}.amazonaws.com/{cognito_user_pool_id}/.well-known/openid-configuration"

        # ==================== Bedrock AgentCore Runtime ====================
        runtime = bedrockagentcore.CfnRuntime(
            self,
            "S3IcebergRuntime",
            agent_runtime_artifact=bedrockagentcore.CfnRuntime.AgentRuntimeArtifactProperty(
                container_configuration=bedrockagentcore.CfnRuntime.ContainerConfigurationProperty(
                    container_uri=f"{ecr_repository.repository_uri}:latest"
                )
            ),
            agent_runtime_name=f"s3_iceberg_agentcore_runtime",
            network_configuration=bedrockagentcore.CfnRuntime.NetworkConfigurationProperty(
                network_mode="PUBLIC"
                # TODO: Cannot use VPC mode due to ENI race condition bug
                # network_mode="VPC",
                # network_mode_config=bedrockagentcore.CfnRuntime.VpcConfigProperty(
                #     security_groups=[security_group.security_group_id],
                #     subnets=private_subnet_ids
                # )
            ),
            role_arn=runtime_role.role_arn,
            description=f"S3 Iceberg MCP Server Runtime ({stage})",
            # Environment variables passed at CfnRuntime level
            environment_variables={
                "ICEBERG_WAREHOUSE_ARN": table_bucket.attr_table_bucket_arn,
                "ICEBERG_URI": f"https://s3tables.{region}.amazonaws.com",
                "AWS_REGION": region,
                "NAMESPACE": "default",
                "PORT": "8000",
                "LOG_LEVEL": "info",
                "PYTHONUNBUFFERED": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
                "TABLE_BUCKET_ARN": table_bucket.attr_table_bucket_arn
            },
            protocol_configuration="MCP",
        )

        # Add dependency to ensure ECR repository is created first
        runtime.node.add_dependency(ecr_repository)
        runtime.node.add_dependency(runtime_role)

        # ==================== Bedrock AgentCore Runtime Endpoint ====================
        # Endpoint name must match pattern ^[a-zA-Z][a-zA-Z0-9_]{0,47}$ (no hyphens allowed)
        endpoint_name = construct_id.replace("-", "_") + "_endpoint"

        runtime_endpoint = bedrockagentcore.CfnRuntimeEndpoint(
            self,
            "S3IcebergRuntimeEndpoint",
            agent_runtime_id=runtime.attr_agent_runtime_id,
            name=endpoint_name,
            description=f"S3 Iceberg MCP Server Endpoint ({stage})"
        )
        runtime_endpoint.node.add_dependency(runtime)

        # ==================== SSM Parameter for Endpoint ====================
        ssm_parameter = ssm.StringParameter(
            self,
            "RuntimeEndpointParameter",
            parameter_name=f"/mcp/endpoints/agentcore/s3-iceberg",
            string_value=runtime_endpoint.attr_agent_runtime_endpoint_arn,
            description=f"AgentCore Runtime endpoint for S3 Iceberg MCP ({stage})",
            tier=ssm.ParameterTier.STANDARD
        )

        # ==================== CloudFormation Outputs ====================
        CfnOutput(
            self,
            "EcrRepositoryUri",
            value=ecr_repository.repository_uri,
            description="ECR Repository URI for Docker images",
            export_name=f"{construct_id}-ecr-uri"
        )

        CfnOutput(
            self,
            "EcrRepositoryName",
            value=ecr_repository.repository_name,
            description="ECR Repository Name",
            export_name=f"{construct_id}-ecr-name"
        )

        CfnOutput(
            self,
            "TableBucketName",
            value=table_bucket.table_bucket_name,
            description="S3 Tables bucket name for Iceberg tables",
            export_name=f"{construct_id}-table-bucket-name"
        )

        CfnOutput(
            self,
            "TableBucketArn",
            value=table_bucket.attr_table_bucket_arn,
            description="S3 Tables bucket ARN",
            export_name=f"{construct_id}-table-bucket-arn"
        )

        CfnOutput(
            self,
            "NamespaceArn",
            value=table_namespace.ref,
            description="S3 Tables namespace ARN",
            export_name=f"{construct_id}-namespace-arn"
        )

        CfnOutput(
            self,
            "RuntimeEndpoint",
            value=runtime_endpoint.attr_agent_runtime_endpoint_arn,
            description="AgentCore Runtime Endpoint ARN",
            export_name=f"{construct_id}-runtime-endpoint"
        )

        CfnOutput(
            self,
            "RuntimeArn",
            value=runtime.attr_agent_runtime_arn,
            description="AgentCore Runtime ARN",
            export_name=f"{construct_id}-runtime-arn"
        )

        CfnOutput(
            self,
            "RuntimeRoleArn",
            value=runtime_role.role_arn,
            description="IAM Role ARN for AgentCore Runtime",
            export_name=f"{construct_id}-role-arn"
        )

        CfnOutput(
            self,
            "SsmParameterName",
            value=ssm_parameter.parameter_name,
            description="SSM Parameter storing the runtime endpoint",
            export_name=f"{construct_id}-ssm-param"
        )

        CfnOutput(
            self,
            "LogGroupName",
            value=log_group.log_group_name,
            description="CloudWatch Log Group name",
            export_name=f"{construct_id}-log-group"
        )

        # TODO: Uncomment to export security group ID when VPC mode is used
        # CfnOutput(
        #     self,
        #     "SecurityGroupId",
        #     value=security_group.security_group_id,
        #     description="Security Group ID",
        #     export_name=f"{construct_id}-sg-id"
        # )
