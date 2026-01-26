"""
Gateway Authentication for AgentCore Gateway MCP Tools
Provides AWS SigV4 authentication for Streamable HTTP MCP client
"""

import boto3
import httpx
from typing import Generator, Optional
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials


class SigV4HTTPXAuth(httpx.Auth):
    """
    HTTPX Auth class that signs requests with AWS SigV4.
    Used for authenticating with AgentCore Gateway MCP protocol.
    """

    def __init__(
        self,
        credentials: Optional[Credentials] = None,
        service: str = "bedrock-agentcore",
        region: Optional[str] = None,
    ):
        """
        Initialize SigV4 authentication.

        Args:
            credentials: AWS credentials. If None, uses boto3 session credentials.
            service: AWS service name (default: 'bedrock-agentcore')
            region: AWS region. If None, uses default region from boto3 session.
        """
        # Get credentials from boto3 session if not provided
        if credentials is None:
            session = boto3.Session()
            credentials = session.get_credentials()
            if credentials is None:
                raise ValueError("No AWS credentials found. Configure AWS credentials.")

        # Get region from boto3 session if not provided
        if region is None:
            session = boto3.Session()
            region = session.region_name
            if region is None:
                raise ValueError("No AWS region found. Set AWS_REGION or configure AWS region.")

        self.credentials = credentials
        self.service = service
        self.region = region
        self.signer = SigV4Auth(credentials, service, region)

    def auth_flow(
        self, request: httpx.Request
    ) -> Generator[httpx.Request, httpx.Response, None]:
        """
        Signs the request with SigV4 and adds the signature to the request headers.
        This method is called by httpx for each request.
        """
        # Create an AWS request
        headers = dict(request.headers)

        # Remove 'connection' header - it's not used in calculating the request
        # signature on the server-side, and results in a signature mismatch if included
        headers.pop("connection", None)

        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers=headers,
        )

        # Sign the request with SigV4
        self.signer.add_auth(aws_request)

        # Add the signature header to the original request
        request.headers.update(dict(aws_request.headers))

        yield request


def get_sigv4_auth(
    service: str = "bedrock-agentcore",
    region: Optional[str] = None,
    credentials: Optional[Credentials] = None,
) -> SigV4HTTPXAuth:
    """
    Get a SigV4 auth handler for httpx requests.

    Args:
        service: AWS service name (default: 'bedrock-agentcore')
        region: AWS region. If None, uses default region from boto3 session.
        credentials: AWS credentials. If None, uses boto3 session credentials.

    Returns:
        SigV4HTTPXAuth instance for use with httpx clients and MCP streamablehttp_client
    """
    return SigV4HTTPXAuth(
        credentials=credentials,
        service=service,
        region=region,
    )


def get_gateway_region_from_url(gateway_url: str) -> str:
    """
    Extract AWS region from Gateway URL.

    Gateway URLs follow pattern:
    https://gateway-xxx.bedrock-agentcore.{region}.amazonaws.com/...

    Args:
        gateway_url: AgentCore Gateway URL

    Returns:
        AWS region (e.g., 'us-west-2')
    """
    import re

    # Pattern for extracting region from Gateway URL
    pattern = r'bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com'
    match = re.search(pattern, gateway_url)

    if match:
        return match.group(1)

    # If we can't extract region, use default from boto3
    session = boto3.Session()
    region = session.region_name

    if region is None:
        raise ValueError(
            f"Cannot extract region from URL: {gateway_url}\n"
            "Please set AWS_REGION environment variable or configure AWS region."
        )

    return region
