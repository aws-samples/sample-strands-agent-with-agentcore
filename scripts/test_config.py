#!/usr/bin/env python3
"""
Environment Variable and SSM Parameter Validation Script

Validates that all required environment variables and SSM parameters
are properly configured for the Strands Agent application.

Usage:
    python test_config.py          # Local mode (default)
    python test_config.py cloud    # Cloud mode (checks SSM)
"""

import os
import sys
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class Status(Enum):
    PASSED = "✓"
    FAILED = "✗"
    WARNING = "⚠"
    SKIPPED = "○"


class Level(Enum):
    REQUIRED = "REQUIRED"
    OPTIONAL = "OPTIONAL"
    CONDITIONAL = "CONDITIONAL"
    FEATURE = "FEATURE"


@dataclass
class EnvVar:
    name: str
    description: str
    level: Level
    default: Optional[str] = None
    condition: Optional[str] = None


@dataclass
class SSMParam:
    pattern: str
    description: str
    level: Level


# Environment Variables
ENV_VARS: List[EnvVar] = [
    EnvVar("AWS_REGION", "AWS region", Level.REQUIRED, "us-west-2"),
    EnvVar("PROJECT_NAME", "Project name", Level.OPTIONAL, "strands-agent-chatbot"),
    EnvVar("ENVIRONMENT", "Environment (dev/staging/prod)", Level.OPTIONAL, "dev"),
    EnvVar("NEXT_PUBLIC_AGENTCORE_LOCAL", "Local mode flag", Level.OPTIONAL, "false"),
    EnvVar("MEMORY_ID", "AgentCore Memory ID", Level.CONDITIONAL, condition="Cloud mode"),
    EnvVar("GATEWAY_MCP_ENABLED", "Gateway MCP enabled", Level.OPTIONAL, "true"),
    EnvVar("CODE_INTERPRETER_ID", "Bedrock Code Interpreter ID", Level.FEATURE),
    EnvVar("BROWSER_NAME", "Browser instance name", Level.FEATURE),
    EnvVar("BROWSER_ID", "Browser instance ID", Level.FEATURE),
    EnvVar("DOCUMENT_BUCKET", "S3 document bucket", Level.FEATURE),
    EnvVar("NOVA_ACT_API_KEY", "Nova ACT API key", Level.FEATURE),
    EnvVar("LOCAL_RESEARCH_AGENT_URL", "Local A2A research agent URL", Level.FEATURE),
]

# SSM Parameters
SSM_PARAMS: List[SSMParam] = [
    SSMParam("/{project}/{env}/code-interpreter/id", "Code Interpreter ID", Level.FEATURE),
    SSMParam("/{project}/{env}/browser/id", "Browser ID", Level.FEATURE),
    SSMParam("/{project}/{env}/s3/document-bucket", "Document bucket", Level.FEATURE),
    SSMParam("/{project}/{env}/gateway/url", "Gateway URL", Level.CONDITIONAL),
    SSMParam("/{project}/{env}/a2a/research-agent-runtime-arn", "Research Agent ARN", Level.FEATURE),
    SSMParam("/{project}/{env}/a2a/browser-use-agent-runtime-arn", "Browser Agent ARN", Level.FEATURE),
]

# Colors
GREEN, RED, YELLOW, GRAY, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"
COLORS = {Status.PASSED: GREEN, Status.FAILED: RED, Status.WARNING: YELLOW, Status.SKIPPED: GRAY}


def check_env_var(var: EnvVar) -> tuple[Status, str]:
    """Check a single environment variable."""
    value = os.environ.get(var.name)

    if value:
        return Status.PASSED, f"Set: {value[:40]}{'...' if len(value) > 40 else ''}"
    if var.default:
        return Status.WARNING, f"Using default: {var.default}"
    if var.level == Level.REQUIRED:
        return Status.FAILED, "REQUIRED but not set"
    if var.level == Level.CONDITIONAL:
        return Status.WARNING, f"Required when: {var.condition}"
    return Status.SKIPPED, "Not set (optional)"


def check_ssm_param(pattern: str, project: str, env: str, region: str) -> tuple[Status, str]:
    """Check a single SSM parameter."""
    param_name = pattern.format(project=project, env=env)

    try:
        import boto3
        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(Name=param_name)
        value = response['Parameter']['Value']
        return Status.PASSED, f"Found: {value[:30]}{'...' if len(value) > 30 else ''}"
    except ImportError:
        return Status.SKIPPED, "boto3 not installed"
    except Exception as e:
        if "ParameterNotFound" in str(e):
            return Status.SKIPPED, "Not found"
        return Status.WARNING, f"Error: {str(e)[:30]}"


def check_aws_credentials() -> tuple[Status, str]:
    """Check AWS credentials."""
    try:
        import boto3
        sts = boto3.client('sts')
        identity = sts.get_caller_identity()
        return Status.PASSED, f"Account: {identity['Account']}"
    except ImportError:
        return Status.SKIPPED, "boto3 not installed"
    except Exception as e:
        return Status.FAILED, f"Error: {str(e)[:30]}"


def check_service(service: str, region: str) -> tuple[Status, str]:
    """Check AWS service connectivity."""
    try:
        import boto3
        if service == "bedrock":
            client = boto3.client('bedrock', region_name=region)
            response = client.list_foundation_models(byOutputModality='TEXT')
            return Status.PASSED, f"{len(response.get('modelSummaries', []))} models"
        elif service == "s3":
            bucket = os.environ.get('DOCUMENT_BUCKET')
            if not bucket:
                return Status.SKIPPED, "DOCUMENT_BUCKET not set"
            client = boto3.client('s3', region_name=region)
            client.head_bucket(Bucket=bucket)
            return Status.PASSED, f"Bucket: {bucket}"
        elif service == "dynamodb":
            project = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
            env = os.environ.get('ENVIRONMENT', 'dev')
            table = f"{project}-{env}-stop-signals"
            client = boto3.client('dynamodb', region_name=region)
            response = client.describe_table(TableName=table)
            return Status.PASSED, f"Table: {response['Table']['TableStatus']}"
    except ImportError:
        return Status.SKIPPED, "boto3 not installed"
    except Exception as e:
        if "ResourceNotFoundException" in str(e) or "404" in str(e):
            return Status.SKIPPED, "Not found"
        return Status.WARNING, f"Error: {str(e)[:30]}"
    return Status.SKIPPED, "Unknown"


def print_result(name: str, status: Status, message: str):
    """Print a single result."""
    color = COLORS.get(status, "")
    print(f"  {color}{status.value} {name}{RESET}: {message}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "local"

    project = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
    env = os.environ.get('ENVIRONMENT', 'dev')
    region = os.environ.get('AWS_REGION', 'us-west-2')

    print(f"\n{'='*50}")
    print(f"  Config Validation (mode: {mode})")
    print(f"{'='*50}")
    print(f"  Project: {project}, Env: {env}, Region: {region}\n")

    results = []

    # AWS Credentials
    print("AWS Credentials:")
    status, msg = check_aws_credentials()
    print_result("Credentials", status, msg)
    results.append(status)

    # Environment Variables
    print("\nEnvironment Variables:")
    for var in ENV_VARS:
        status, msg = check_env_var(var)
        print_result(var.name, status, msg)
        results.append(status)

    # SSM Parameters (cloud mode only)
    if mode == "cloud":
        print("\nSSM Parameters:")
        for param in SSM_PARAMS:
            status, msg = check_ssm_param(param.pattern, project, env, region)
            print_result(param.pattern.format(project=project, env=env), status, msg)
            results.append(status)

    # Service Connectivity
    print("\nService Connectivity:")
    for svc in ["bedrock", "s3", "dynamodb"] if mode == "cloud" else ["bedrock"]:
        status, msg = check_service(svc, region)
        print_result(svc.capitalize(), status, msg)
        results.append(status)

    # Summary
    passed = sum(1 for r in results if r == Status.PASSED)
    failed = sum(1 for r in results if r == Status.FAILED)
    warnings = sum(1 for r in results if r == Status.WARNING)

    print(f"\n{'='*50}")
    print(f"  {GREEN}Passed: {passed}{RESET}  {RED}Failed: {failed}{RESET}  {YELLOW}Warnings: {warnings}{RESET}")
    print(f"{'='*50}\n")

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
