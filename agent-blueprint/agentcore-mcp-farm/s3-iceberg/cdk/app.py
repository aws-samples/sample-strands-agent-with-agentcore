#!/usr/bin/env python3
"""
S3 Iceberg MCP Server on Bedrock AgentCore Runtime
CDK Application Entry Point
"""
import os
import aws_cdk as cdk
from stacks.s3_iceberg_agentcore_stack import S3IcebergAgentCoreStack

# Get configuration from environment or use defaults
region = os.environ.get('AWS_REGION', 'us-west-2')
stage = os.environ.get('STAGE', 'prod')
account = os.environ.get('CDK_DEFAULT_ACCOUNT', os.environ.get('AWS_ACCOUNT_ID', ''))

# Stack name
stack_name = f"s3-iceberg-agentcore-{stage}"

# Initialize CDK app
app = cdk.App()

# Create the S3 Iceberg AgentCore stack
S3IcebergAgentCoreStack(
    app,
    stack_name,
    env=cdk.Environment(
        account=account or None,
        region=region
    ),
    description=f"S3 Iceberg MCP Server on AWS Bedrock AgentCore Runtime ({stage})",
    stack_name=stack_name,
    stage=stage
)

# Synthesize CloudFormation template
app.synth()
