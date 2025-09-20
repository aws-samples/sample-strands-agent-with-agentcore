#!/usr/bin/env python3
"""
Nova Act MCP Server Fargate Deployment
CDK App Entry Point
"""

import os
from aws_cdk import App, Environment
from stacks.nova_act_fargate_stack import NovaActFargateStack

app = App()

# Get configuration from context or environment
region = app.node.try_get_context("region") or "us-west-2"
stack_name = f"nova-act-mcp-fargate"

# Create the Nova Act Fargate stack
NovaActFargateStack(
    app, 
    stack_name,
    env=Environment(
        account=os.environ.get('CDK_DEFAULT_ACCOUNT'),
        region=region
    ),
    description="Nova Act MCP Server running on AWS Fargate with Application Load Balancer"
)

app.synth()
