"""
Nova Act MCP Server Fargate Stack
AWS CDK Stack for deploying Nova Act MCP Server on ECS Fargate
"""

from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    Fn,
    CfnOutput
)
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_ecs as ecs
from aws_cdk import aws_ecs_patterns as ecs_patterns
from aws_cdk import aws_ecr as ecr
from aws_cdk import aws_logs as logs
from aws_cdk import aws_iam as iam
from aws_cdk import aws_elasticloadbalancingv2 as elbv2
from aws_cdk import aws_ssm as ssm
from constructs import Construct
import os
from pathlib import Path


class NovaActFargateStack(Stack):
    """
    CDK Stack for Nova Act MCP Server on Fargate
    """

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Get stack name for resource naming
        stack_name = self.stack_name.lower()
        

        # Import shared VPC from Chatbot deployment
        vpc = ec2.Vpc.from_vpc_attributes(
            self, "SharedChatbotVpc",
            vpc_id=Fn.import_value(f"ChatbotStack-vpc-id"),
            availability_zones=["us-west-2a", "us-west-2b"],  # Must match Chatbot VPC AZs
            public_subnet_ids=[
                Fn.select(0, Fn.split(",", Fn.import_value(f"ChatbotStack-public-subnets"))),
                Fn.select(1, Fn.split(",", Fn.import_value(f"ChatbotStack-public-subnets")))
            ],
            private_subnet_ids=[
                Fn.select(0, Fn.split(",", Fn.import_value(f"ChatbotStack-private-subnets"))),
                Fn.select(1, Fn.split(",", Fn.import_value(f"ChatbotStack-private-subnets")))
            ]
        )

        # Create ECR repository for the Docker image
        ecr_repository = ecr.Repository(
            self, "NovaActMcpRepository",
            repository_name=f"{stack_name}-nova-act-mcp",
            removal_policy=RemovalPolicy.DESTROY,  # For demo purposes
            image_scan_on_push=True,
            lifecycle_rules=[
                ecr.LifecycleRule(
                    description="Keep only 10 most recent images",
                    max_image_count=10
                )
            ]
        )

        # Create ECS cluster
        cluster = ecs.Cluster(
            self, "NovaActMcpCluster",
            cluster_name=f"{stack_name}-cluster",
            vpc=vpc
            # container_insights=True  # Commented out to avoid deprecation warning
        )

        # Create CloudWatch log group
        log_group = logs.LogGroup(
            self, "NovaActMcpLogGroup",
            log_group_name=f"/ecs/{stack_name}-nova-act-mcp",
            retention=logs.RetentionDays.ONE_WEEK,
            removal_policy=RemovalPolicy.DESTROY
        )

        # Create task execution role
        execution_role = iam.Role(
            self, "NovaActMcpExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AmazonECSTaskExecutionRolePolicy")
            ]
        )

        # Grant ECR permissions to execution role
        ecr_repository.grant_pull(execution_role)

        # Create task role (for the container itself)
        task_role_statements = [
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                resources=[log_group.log_group_arn]
            )
        ]
        
        
        task_role = iam.Role(
            self, "NovaActMcpTaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            inline_policies={
                "NovaActMcpPolicy": iam.PolicyDocument(
                    statements=task_role_statements
                )
            }
        )

        # Create Fargate task definition
        task_definition = ecs.FargateTaskDefinition(
            self, "NovaActMcpTaskDefinition",
            family=f"{stack_name}-nova-act-mcp",
            cpu=1024,  # 1 vCPU
            memory_limit_mib=2048,  # 2 GB RAM
            execution_role=execution_role,
            task_role=task_role,
            runtime_platform=ecs.RuntimePlatform(
                cpu_architecture=ecs.CpuArchitecture.ARM64,
                operating_system_family=ecs.OperatingSystemFamily.LINUX
            )
        )

        # Load API key from .env.local file (or fallback to default)
        env_vars = self._load_env_files()
        default_api_key = env_vars.get('NOVA_ACT_API_KEY', 'your_nova_act_api_key_here')

        # Create parameter for Nova Act API Key (uses .env value as default)
        api_key_parameter = ssm.StringParameter(
            self, "NovaActApiKeyParameter", 
            parameter_name="/nova-act-mcp/api-key",
            string_value=default_api_key,  # From .env file
            description="Nova Act API Key for MCP server (override via AWS Console if needed)",
            tier=ssm.ParameterTier.STANDARD
        )

        # Add container to task definition
        container = task_definition.add_container(
            "NovaActMcpContainer",
            image=ecs.ContainerImage.from_asset(
                directory="../src",
                file="Dockerfile"
            ),
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="nova-act-mcp",
                log_group=log_group
            ),
            environment=self._build_environment_variables(),
            secrets={
                "NOVA_ACT_API_KEY": ecs.Secret.from_ssm_parameter(api_key_parameter)
            },
            port_mappings=[
                ecs.PortMapping(
                    container_port=8000,  # Updated to correct port
                    protocol=ecs.Protocol.TCP
                )
            ]
        )

        # Create security group for the service
        service_security_group = ec2.SecurityGroup(
            self, "NovaActMcpServiceSecurityGroup",
            vpc=vpc,
            description="Security group for Nova Act MCP Fargate service",
            allow_all_outbound=True
        )

        # Allow inbound traffic on port 8000 from ALB security group
        # Import VPC CIDR for security group rules
        vpc_cidr = Fn.import_value(f"ChatbotStack-vpc-cidr")
        service_security_group.add_ingress_rule(
            peer=ec2.Peer.ipv4(vpc_cidr),
            connection=ec2.Port.tcp(8000),
            description="Allow inbound traffic from ALB"
        )

        # Import shared ALB from the MCP Farm infrastructure
        shared_alb = elbv2.ApplicationLoadBalancer.from_application_load_balancer_attributes(
            self, "SharedMcpFarmAlb",
            load_balancer_arn=Fn.import_value(f"mcpfarmalbstack-mcp-farm-alb-arn"),
            load_balancer_dns_name=Fn.import_value(f"mcpfarmalbstack-mcp-farm-alb-dns"),
            vpc=vpc,
            security_group_id=Fn.import_value(f"mcpfarmalbstack-mcp-farm-alb-sg-id")
        )
        
        # Import shared listener using from_application_listener_attributes
        shared_listener = elbv2.ApplicationListener.from_application_listener_attributes(
            self, "SharedMcpFarmListener",
            listener_arn=Fn.import_value(f"mcpfarmalbstack-mcp-farm-listener-arn"),
            security_group=shared_alb.connections.security_groups[0]
        )

        # Create Fargate service without ALB (we'll add target group manually)
        fargate_service = ecs.FargateService(
            self, "NovaActMcpService",
            cluster=cluster,
            task_definition=task_definition,
            service_name=f"{stack_name}-nova-act-mcp-service",
            desired_count=1,
            platform_version=ecs.FargatePlatformVersion.LATEST,
            assign_public_ip=False,  # Running in private subnet
            security_groups=[service_security_group],
            vpc_subnets=ec2.SubnetSelection(
                subnets=vpc.private_subnets
            )
        )

        # Create target group for the Fargate service
        target_group = elbv2.ApplicationTargetGroup(
            self, "NovaActMcpTargetGroup",
            vpc=vpc,
            port=8000,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_type=elbv2.TargetType.IP,
            deregistration_delay=Duration.seconds(30),
            health_check=elbv2.HealthCheck(
                protocol=elbv2.Protocol.HTTP,
                path="/nova-act/mcp",  # Same as MCP endpoint
                port="8000",
                healthy_threshold_count=2,
                unhealthy_threshold_count=3,
                timeout=Duration.seconds(10),  # Increased timeout for Python execution
                interval=Duration.seconds(30),
                healthy_http_codes="200,400,406"  # Accept 400,406 as healthy since FastMCP server responds with 406 to GET
            )
        )


        # Add listener rule for /nova-act/mcp path  
        elbv2.ApplicationListenerRule(
            self, "NovaActMcpListenerRule",
            listener=shared_listener,
            priority=100,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/nova-act/mcp"])
            ],
            action=elbv2.ListenerAction.forward([target_group])
        )

        # Attach Fargate service to target group
        fargate_service.attach_to_application_target_group(target_group)

        # Configure deployment settings to speed up deployments
        cfn_service = fargate_service.node.default_child
        cfn_service.add_property_override("DeploymentConfiguration", {
            "MinimumHealthyPercent": 0,
            "MaximumPercent": 200,
            "DeploymentCircuitBreaker": {
                "Enable": False,
                "Rollback": False
            }
        })

        # Store ALB reference for other services to use
        self.shared_alb = shared_alb
        self.shared_listener = shared_listener

        # Configure auto scaling
        scalable_target = fargate_service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=5
        )

        # Scale based on CPU utilization
        scalable_target.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.minutes(5),
            scale_out_cooldown=Duration.minutes(2)
        )

        # Scale based on memory utilization
        scalable_target.scale_on_memory_utilization(
            "MemoryScaling",
            target_utilization_percent=80,
            scale_in_cooldown=Duration.minutes(5),
            scale_out_cooldown=Duration.minutes(2)
        )

        # Outputs
        CfnOutput(
            self, "LoadBalancerUrl",
            value=f"http://{shared_alb.load_balancer_dns_name}",
            description="MCP Farm Application Load Balancer URL"
        )

        CfnOutput(
            self, "McpEndpoint",
            value=f"http://{shared_alb.load_balancer_dns_name}/nova-act/mcp",
            description="Nova Act MCP Server Endpoint URL"
        )

        CfnOutput(
            self, "McpFarmAlbDnsName",
            value=shared_alb.load_balancer_dns_name,
            description="MCP Farm ALB DNS Name for adding additional MCP servers"
        )

        CfnOutput(
            self, "EcrRepositoryUri",
            value=ecr_repository.repository_uri,
            description="ECR Repository URI for Docker images"
        )

        CfnOutput(
            self, "ClusterName",
            value=cluster.cluster_name,
            description="ECS Cluster Name"
        )

        CfnOutput(
            self, "ServiceName",
            value=fargate_service.service_name,
            description="ECS Service Name"
        )

        # Parameter Store entry for MCP endpoint
        ssm.StringParameter(
            self, "McpEndpointParameter",
            parameter_name="/mcp/endpoints/stateful/nova-act-mcp",
            string_value=f"http://{shared_alb.load_balancer_dns_name}/nova-act/mcp",
            description="Nova Act MCP Server endpoint URL"
        )
        

        # Store important values as instance variables for potential use
        self.vpc = vpc
        self.cluster = cluster
        self.ecr_repository = ecr_repository
        self.fargate_service = fargate_service
        self.target_group = target_group
        self.log_group = log_group
    
    def _load_env_files(self) -> dict:
        """Load environment variables from .env and .env.local files"""
        src_dir = Path(__file__).parent.parent.parent / "src"
        env_vars = {}
        
        # Load public settings from .env first
        env_file = src_dir / ".env"
        if env_file.exists():
            with open(env_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
        
        # Load sensitive values from .env.local (overrides .env)
        env_local_file = src_dir / ".env.local"
        if env_local_file.exists():
            with open(env_local_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
        
        return env_vars
    
    def _build_environment_variables(self) -> dict:
        """Build environment variables for the container - loads from .env and .env.local files"""
        # Start with .env and .env.local file values
        env_vars = self._load_env_files()
        
        # Remove sensitive values that should only be in secrets (not environment variables)
        sensitive_keys = ['NOVA_ACT_API_KEY']
        for key in sensitive_keys:
            env_vars.pop(key, None)
        
        # Add container-specific settings (override .env if needed)
        container_specific = {
            "PYTHONUNBUFFERED": "1",
            "DISPLAY": ":99", 
            "DEPLOYMENT_MODE": "cloud",
            "AWS_DEFAULT_REGION": self.region
        }
        
        # Merge with .env values taking precedence for app settings
        env_vars.update(container_specific)
        
        return env_vars
