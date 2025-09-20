"""
MCP Farm Shared ALB Stack
AWS CDK Stack for creating a shared Application Load Balancer for all MCP servers
"""

from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    Fn,
    CfnOutput
)
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_elasticloadbalancingv2 as elbv2
from aws_cdk import aws_logs as logs
from constructs import Construct


class McpFarmAlbStack(Stack):
    """
    CDK Stack for MCP Farm Shared Application Load Balancer
    """

    def __init__(self, scope: Construct, construct_id: str, allowed_mcp_cidrs=None, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Default CIDR ranges if none provided
        if allowed_mcp_cidrs is None:
            allowed_mcp_cidrs = ["10.0.0.0/8"]  # VPC internal by default

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

        # Create security group for the ALB with CIDR restrictions
        alb_security_group = ec2.SecurityGroup(
            self, "McpFarmAlbSecurityGroup",
            vpc=vpc,
            description="Security group for MCP Farm ALB with CIDR restrictions",
            allow_all_outbound=True
        )

        # Auto-allow ECS private subnets for backend access to MCP servers
        # Add VPC CIDR for internal access (ECS backend)
        alb_security_group.add_ingress_rule(
            peer=ec2.Peer.ipv4(Fn.import_value(f"ChatbotStack-vpc-cidr")),
            connection=ec2.Port.tcp(80),
            description="ECS backend HTTP access from VPC"
        )

        alb_security_group.add_ingress_rule(
            peer=ec2.Peer.ipv4(Fn.import_value(f"ChatbotStack-vpc-cidr")),
            connection=ec2.Port.tcp(443),
            description="ECS backend HTTPS access from VPC"
        )

        # Allow inbound traffic from user-specified CIDR blocks for development access
        for i, cidr in enumerate(allowed_mcp_cidrs):
            # Skip VPC internal CIDRs as they're already added above
            if not cidr.startswith("10.0."):
                alb_security_group.add_ingress_rule(
                    peer=ec2.Peer.ipv4(cidr),
                    connection=ec2.Port.tcp(80),
                    description=f"Developer HTTP access {i+1}: {cidr}"
                )

                alb_security_group.add_ingress_rule(
                    peer=ec2.Peer.ipv4(cidr),
                    connection=ec2.Port.tcp(443),
                    description=f"Developer HTTPS access {i+1}: {cidr}"
                )

        # Create Application Load Balancer with CIDR restrictions (for MCP servers)
        alb = elbv2.ApplicationLoadBalancer(
            self, "McpFarmAlb",
            vpc=vpc,
            internet_facing=True,  # Internet-facing for development access
            load_balancer_name=f"{stack_name}-mcp-farm-alb",
            security_group=alb_security_group,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC  # Must use public subnets for internet-facing ALB
            ),
            idle_timeout=Duration.seconds(3600)
        )

        # Create default listener (HTTP)
        default_listener = alb.add_listener(
            "McpFarmDefaultListener",
            port=80,
            protocol=elbv2.ApplicationProtocol.HTTP,
            default_action=elbv2.ListenerAction.fixed_response(
                status_code=200,
                content_type="application/json",
                message_body='{"message": "MCP Farm ALB - Ready for MCP servers", "status": "healthy"}'
            )
        )


        # Create CloudWatch log group for ALB access logs
        alb_log_group = logs.LogGroup(
            self, "McpFarmAlbLogGroup",
            log_group_name=f"/aws/alb/{stack_name}-mcp-farm",
            retention=logs.RetentionDays.ONE_WEEK,
            removal_policy=RemovalPolicy.DESTROY
        )

        # Enable ALB access logging (optional, can be enabled later)
        # alb.log_access_logs(
        #     bucket=s3_bucket,  # Would need to create S3 bucket
        #     prefix="alb-access-logs"
        # )

        # Outputs
        CfnOutput(
            self, "McpFarmAlbArn",
            value=alb.load_balancer_arn,
            description="MCP Farm ALB ARN for cross-stack references",
            export_name=f"{stack_name}-mcp-farm-alb-arn"
        )

        CfnOutput(
            self, "McpFarmAlbDnsName",
            value=alb.load_balancer_dns_name,
            description="MCP Farm ALB DNS Name",
            export_name=f"{stack_name}-mcp-farm-alb-dns"
        )

        CfnOutput(
            self, "McpFarmAlbUrl",
            value=f"http://{alb.load_balancer_dns_name}",
            description="MCP Farm ALB Base URL"
        )

        CfnOutput(
            self, "McpFarmVpcId",
            value=vpc.vpc_id,
            description="MCP Farm VPC ID (using Chatbot VPC)",
            export_name=f"{stack_name}-mcp-farm-vpc-id"
        )

        CfnOutput(
            self, "McpFarmPrivateSubnetIds",
            value=Fn.import_value(f"ChatbotStack-private-subnets"),
            description="MCP Farm Private Subnet IDs (using Chatbot private subnets)",
            export_name=f"{stack_name}-mcp-farm-private-subnets"
        )

        CfnOutput(
            self, "McpFarmDefaultListenerArn",
            value=default_listener.listener_arn,
            description="MCP Farm ALB Default Listener ARN for adding rules",
            export_name=f"{stack_name}-mcp-farm-listener-arn"
        )

        CfnOutput(
            self, "McpFarmAlbSecurityGroupId",
            value=alb_security_group.security_group_id,
            description="MCP Farm ALB Security Group ID for cross-stack references",
            export_name=f"{stack_name}-mcp-farm-alb-sg-id"
        )

        # Store important values as instance variables for potential use
        self.vpc = vpc
        self.alb = alb
        self.default_listener = default_listener
        self.alb_security_group = alb_security_group
        self.alb_log_group = alb_log_group
