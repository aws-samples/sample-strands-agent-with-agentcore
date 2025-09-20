#!/usr/bin/env python3
"""
MCP Farm Shared Infrastructure CDK App
"""

import aws_cdk as cdk
import os
from aws_cdk import App
from stacks.mcp_farm_alb_stack import McpFarmAlbStack

app = App()

# Parse MCP CIDR ranges from environment variable
allowed_mcp_cidrs_env = os.environ.get('ALLOWED_MCP_CIDRS', '')
allowed_mcp_cidrs = []

if allowed_mcp_cidrs_env:
    allowed_mcp_cidrs = [cidr.strip() for cidr in allowed_mcp_cidrs_env.split(',') if cidr.strip()]

print(f"🔒 MCP Access CIDR ranges: {', '.join(allowed_mcp_cidrs) if allowed_mcp_cidrs else 'VPC internal only'}")

# Create MCP Farm Shared ALB Stack
McpFarmAlbStack(
    app, "McpFarmAlbStack",
    allowed_mcp_cidrs=allowed_mcp_cidrs,
    description="MCP Farm Shared Application Load Balancer with CIDR restrictions",
    env=cdk.Environment(
        account=app.node.try_get_context("account"),
        region=app.node.try_get_context("region") or "us-west-2"
    )
)

app.synth()
