"""
Document Writer MCP Server on AWS Bedrock AgentCore Runtime
CDK Stack Definition
"""
from aws_cdk import (
    Stack,
    CfnOutput,
    RemovalPolicy,
    aws_ecr as ecr,
    aws_iam as iam,
    aws_ssm as ssm,
    aws_logs as logs,
    aws_s3 as s3,
    aws_bedrockagentcore as bedrockagentcore,
)
from constructs import Construct


class DocumentWriterAgentCoreStack(Stack):
    """
    CDK Stack for deploying Document Writer MCP Server on Bedrock AgentCore Runtime

    This stack creates:
    - ECR repository for Docker images
    - S3 bucket for final document storage
    - IAM roles with necessary permissions
    - Bedrock AgentCore Runtime with container configuration
    - SSM parameter for endpoint storage
    """

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        region = self.region

        # ==================== ECR Repository ====================
        # Import existing ECR repository (created by deploy.sh before CDK deployment)
        ecr_repository = ecr.Repository.from_repository_name(
            self,
            "DocumentWriterMcpRepository",
            repository_name=f"document-writer-mcp-repository"
        )

        # ==================== S3 Bucket for Document Storage ====================
        # Create standard S3 bucket for final documents
        document_bucket = s3.Bucket(
            self,
            "DocumentStorageBucket",
            bucket_name=f"document-writer-bucket-{self.account}".lower()[:63],
            removal_policy=RemovalPolicy.DESTROY,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        # ==================== Bedrock AgentCore Code Interpreter  ===============
        code_interpreter = bedrockagentcore.CfnCodeInterpreterCustom(
            self, 
            "CodeInterpreter",
            name=f"code_interpreter_{self.account}",
            network_configuration=bedrockagentcore.CfnCodeInterpreterCustom.CodeInterpreterNetworkConfigurationProperty(
                network_mode="SANDBOX"
            )
        )

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
            description="IAM role for Document Writer AgentCore Runtime"
        )

        # Add S3 bucket permissions for document storage
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:DeleteObject",
                    "s3:ListBucket"
                ],
                resources=[
                    document_bucket.bucket_arn,
                    f"{document_bucket.bucket_arn}/*"
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

        # Add AgentCore Code Interpreter permissions
        runtime_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "bedrock-agentcore:CreateCodeInterpreter",
                    "bedrock-agentcore:StartCodeInterpreterSession",
                    "bedrock-agentcore:InvokeCodeInterpreter",
                    "bedrock-agentcore:StopCodeInterpreterSession",
                    "bedrock-agentcore:DeleteCodeInterpreter",
                    "bedrock-agentcore:ListCodeInterpreters",
                    "bedrock-agentcore:GetCodeInterpreter",
                    "bedrock-agentcore:GetCodeInterpreterSession",
                    "bedrock-agentcore:ListCodeInterpreterSessions"
                ],
                # ARN below looks incorrect but is correct for AWS Code Interpreter. It may be updated in the future.
                resources=[f"arn:aws:bedrock-agentcore:{region}:{self.account}:aws:code-interpreter/aws.codeinterpreter.v1"]
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

        # ==================== Bedrock AgentCore Runtime ====================
        runtime = bedrockagentcore.CfnRuntime(
            self,
            "DocumentWriterRuntime",
            agent_runtime_artifact=bedrockagentcore.CfnRuntime.AgentRuntimeArtifactProperty(
                container_configuration=bedrockagentcore.CfnRuntime.ContainerConfigurationProperty(
                    container_uri=f"{ecr_repository.repository_uri}:latest"
                )
            ),
            agent_runtime_name=f"document_writer_agentcore_runtime",
            network_configuration=bedrockagentcore.CfnRuntime.NetworkConfigurationProperty(
                network_mode="PUBLIC"
            ),
            role_arn=runtime_role.role_arn,
            description="Document Writer MCP Server Runtime",
            # Environment variables passed at CfnRuntime level
            environment_variables={
                "DOCUMENT_BUCKET_NAME": document_bucket.bucket_name,
                "AWS_REGION": region,
                "PORT": "8000",
                "LOG_LEVEL": "info",
                "PYTHONUNBUFFERED": "1",
                "PYTHONDONTWRITEBYTECODE": "1"
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
            "DocumentWriterRuntimeEndpoint",
            agent_runtime_id=runtime.attr_agent_runtime_id,
            name=endpoint_name,
            description="Document Writer MCP Server Endpoint"
        )
        runtime_endpoint.node.add_dependency(runtime)

        # ==================== SSM Parameter for Endpoint ====================
        ssm_parameter = ssm.StringParameter(
            self,
            "RuntimeEndpointParameter",
            parameter_name=f"/mcp/endpoints/agentcore/document-writer",
            string_value=runtime_endpoint.attr_agent_runtime_endpoint_arn,
            description="AgentCore Runtime endpoint for Document Writer MCP",
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
            "DocumentBucketName",
            value=document_bucket.bucket_name,
            description="S3 bucket name for document storage",
            export_name=f"{construct_id}-document-bucket-name"
        )

        CfnOutput(
            self,
            "DocumentBucketArn",
            value=document_bucket.bucket_arn,
            description="S3 bucket ARN",
            export_name=f"{construct_id}-document-bucket-arn"
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
