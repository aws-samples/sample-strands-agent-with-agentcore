#!/usr/bin/env python3
"""CDK App for Document Writer MCP Server on Bedrock AgentCore Runtime"""

import os
import aws_cdk as cdk
from stacks.document_writer_agentcore_stack import DocumentWriterAgentCoreStack

app = cdk.App()

# Get environment variables with defaults
region = os.environ.get("AWS_REGION", "us-west-2")
account = os.environ.get("CDK_DEFAULT_ACCOUNT")

# Create the stack
DocumentWriterAgentCoreStack(
    app,
    "DocumentWriterAgentCoreStack",
    env=cdk.Environment(account=account, region=region),
    description="Document Writer MCP Server on AWS Bedrock AgentCore Runtime"
)

app.synth()
