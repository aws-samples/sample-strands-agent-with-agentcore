"""
Workspace Configuration - Centralized bucket and storage settings

This module provides configuration for workspace storage backends.
Currently supports S3 with plans for additional storage options.
"""

import os
import logging
import boto3

logger = logging.getLogger(__name__)


def get_workspace_bucket() -> str:
    """Get main workspace bucket name for document storage

    This bucket stores all document types: Word, Excel, PowerPoint, and Images.
    Each user/session gets an isolated workspace within this bucket.

    Returns:
        S3 bucket name for workspace storage

    Raises:
        ValueError: If bucket name not found in environment or Parameter Store
    """
    # 1. Check environment variable (set by AgentCore Runtime)
    bucket_name = os.getenv('DOCUMENT_BUCKET')
    if bucket_name:
        logger.info(f"Found DOCUMENT_BUCKET in environment: {bucket_name}")
        return bucket_name

    # 2. Try Parameter Store (for local development)
    try:
        project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
        environment = os.getenv('ENVIRONMENT', 'dev')
        region = os.getenv('AWS_REGION', 'us-west-2')
        param_name = f"/{project_name}/{environment}/agentcore/document-bucket"

        logger.info(f"Checking Parameter Store for Document Bucket: {param_name}")
        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(Name=param_name)
        bucket_name = response['Parameter']['Value']
        logger.info(f"Found DOCUMENT_BUCKET in Parameter Store: {bucket_name}")
        return bucket_name
    except Exception as e:
        logger.error(f"Document Bucket not found in Parameter Store: {e}")
        raise ValueError(
            "DOCUMENT_BUCKET not configured. "
            "Set environment variable or create Parameter Store entry: "
            f"/{project_name}/{environment}/agentcore/document-bucket"
        )


class WorkspaceConfig:
    """Centralized workspace configuration"""

    @staticmethod
    def get_document_bucket() -> str:
        """Get main workspace bucket for documents and images"""
        return get_workspace_bucket()

    @staticmethod
    def get_s3_region() -> str:
        """Get AWS region for S3 operations"""
        return os.getenv('AWS_REGION', 'us-west-2')

    @staticmethod
    def get_base_prefix() -> str:
        """Get base S3 prefix for all workspace data"""
        return "documents"
