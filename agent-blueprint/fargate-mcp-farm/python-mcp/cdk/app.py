#!/usr/bin/env python3
"""
Python MCP Server Fargate Deployment
CDK App Entry Point
"""

import os
from aws_cdk import App, Environment
from stacks.python_mcp_fargate_stack import PythonMcpFargateStack

app = App()

# Get configuration from context or environment
region = app.node.try_get_context("region") or "us-west-2"
stack_name = f"python-mcp-fargate"

# Create the Python MCP Fargate stack
PythonMcpFargateStack(
    app, 
    stack_name,
    env=Environment(
        account=os.environ.get('CDK_DEFAULT_ACCOUNT'),
        region=region
    ),
    description="Python MCP Server running on AWS Fargate with Application Load Balancer"
)

app.synth()