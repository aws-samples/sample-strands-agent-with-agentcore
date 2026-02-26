"""
A2A Agent Tools Module

Integrates AgentCore Runtime A2A agents as direct callable tools.
Uses A2A SDK to communicate with agents deployed on AgentCore Runtime.

Based on: amazon-bedrock-agentcore-samples orchestrator pattern
"""

import boto3
import logging
import os
import asyncio
from typing import Optional, Dict, Any, AsyncGenerator
from urllib.parse import quote
from uuid import uuid4
from strands.tools import tool
from strands.types.tools import ToolContext

import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, TextPart, AgentCard

# Import SigV4 auth for IAM authentication
from agent.gateway.sigv4_auth import get_sigv4_auth

logger = logging.getLogger(__name__)

# ============================================================
# A2A Agent Configuration Registry
# ============================================================

A2A_AGENTS_CONFIG = {
    "agentcore_research-agent": {
        "name": "Research Agent",
        "description": """Multi-source web research with structured markdown reports and chart generation.

Args:
    plan: Research plan with objectives, topics, and desired report structure.

Returns:
    Detailed markdown report with citations and charts (displayed directly to user).

Example plan:
    "Research Plan: AI Market 2026

    Objectives:
    - Market size and growth trends
    - Key players and market share

    Topics:
    1. Global AI market statistics
    2. Leading companies
    3. Investment trends

    Structure:
    - Executive Summary
    - Market Overview
    - Key Players"
""",
        "runtime_arn_ssm": "/strands-agent-chatbot/dev/a2a/research-agent-runtime-arn",
    },
    "agentcore_browser-use-agent": {
        "name": "Browser Use Agent",
        "description": """Autonomous browser automation that executes multi-step web tasks.

Args:
    task: Clear description of what to accomplish. Agent decides navigation steps automatically.

Returns:
    Text summary of completed actions and extracted information.

Examples:
    "Go to example.com and find the main product price"
    "Search GitHub for top Python repos and get the star count"
    "Navigate to AWS pricing page and extract compute costs"
""",
        "runtime_arn_ssm": "/strands-agent-chatbot/dev/a2a/browser-use-agent-runtime-arn",
    },
    "agentcore_code-agent": {
        "name": "Code Agent",
        "description": """Autonomous coding agent that implements features, fixes bugs, refactors code, and runs tests.

Args:
    task: Clear description of the coding task. Be specific about files, requirements, and expected outcome.

Returns:
    Summary of completed work including files changed and actions taken.

Examples:
    "Add input validation to src/auth.py and write unit tests for it"
    "Fix the failing tests in tests/test_api.py - error: AssertionError on line 42"
    "Refactor the database module to use async/await throughout"
    "Implement a REST endpoint for user profile updates in src/api/users.py"
""",
        "runtime_arn_ssm": "/strands-agent-chatbot/dev/a2a/code-agent-runtime-arn",
    },
}

# Global cache
_cache = {
    'agent_arns': {},
    'agent_cards': {},
    'http_client': None
}


def _list_session_s3_files(user_id: Optional[str], session_id: Optional[str]) -> list:
    """
    List files uploaded by the user in the current session from the S3 workspace bucket.

    Returns a list of {"s3_uri": "s3://bucket/key", "filename": "name"} dicts
    suitable for passing as metadata["s3_files"] to the code-agent.
    """
    if not user_id or not session_id:
        return []

    try:
        from workspace.config import get_workspace_bucket
        bucket = get_workspace_bucket()
        prefix = f"documents/{user_id}/{session_id}/"

        s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        paginator = s3.get_paginator('list_objects_v2')
        files = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                filename = key.split('/')[-1]
                if filename:
                    files.append({"s3_uri": f"s3://{bucket}/{key}", "filename": filename})

        if files:
            logger.info(f"[code-agent] Found {len(files)} S3 file(s) for session {session_id}")
        return files

    except Exception as e:
        logger.warning(f"[code-agent] Failed to list S3 files: {e}")
        return []

DEFAULT_TIMEOUT = 2400  # 40 minutes for complex coding tasks
AGENT_TIMEOUT = 2400    # 2400s (40 minutes) per agent call


# ============================================================
# Helper Functions
# ============================================================

def get_cached_agent_arn(agent_id: str, region: str = "us-west-2") -> Optional[str]:
    """Get and cache agent ARN from SSM"""
    if agent_id not in _cache['agent_arns']:
        if agent_id not in A2A_AGENTS_CONFIG:
            return None

        config = A2A_AGENTS_CONFIG[agent_id]
        ssm_param = config['runtime_arn_ssm']

        try:
            ssm = boto3.client('ssm', region_name=region)
            response = ssm.get_parameter(Name=ssm_param)
            _cache['agent_arns'][agent_id] = response['Parameter']['Value']
            logger.info(f"Cached ARN for {agent_id}: {_cache['agent_arns'][agent_id]}")
        except Exception as e:
            logger.error(f"Failed to get ARN for {agent_id}: {e}")
            return None

    return _cache['agent_arns'][agent_id]


def get_http_client(region: str = "us-west-2"):
    """Reuse HTTP client with SigV4 IAM authentication"""
    if not _cache['http_client']:
        # Create SigV4 auth handler for IAM authentication
        sigv4_auth = get_sigv4_auth(
            service="bedrock-agentcore",
            region=region
        )

        _cache['http_client'] = httpx.AsyncClient(
            timeout=httpx.Timeout(DEFAULT_TIMEOUT, connect=30.0),  # 40 min timeout, 30s connect
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
            auth=sigv4_auth  # Add SigV4 auth
        )
        logger.info(f"Created HTTP client with SigV4 IAM auth (timeout: {DEFAULT_TIMEOUT}s) for region {region}")
    return _cache['http_client']


async def send_a2a_message(
    agent_id: str,
    message: str,
    session_id: Optional[str] = None,
    region: str = "us-west-2",
    metadata: Optional[dict] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream messages from A2A agent on AgentCore Runtime (ASYNC GENERATOR)

    Args:
        agent_id: Agent identifier (e.g., "agentcore_research-agent")
        message: User message to send
        session_id: Session ID from BFF (optional, will generate if not provided)
        region: AWS region
        metadata: Additional payload to send (user_id, preferences, context, etc.)

    Yields:
        Events from A2A agent:
        - {"type": "browser_session_detected", "browserSessionId": "...", "message": "..."}  # Immediate
        - {"status": "success", "content": [...]}  # Final result

    Example metadata:
        {
            "user_id": "user123",
            "language": "ko",
            "max_sources": 5,
            "depth": "detailed",
            "format_preference": "markdown"
        }
    """
    try:
        # Check for local testing mode (per-agent env var)
        # e.g. LOCAL_RESEARCH_AGENT_URL, LOCAL_CODE_AGENT_URL, LOCAL_BROWSER_USE_AGENT_URL
        env_key = "LOCAL_" + agent_id.replace("agentcore_", "").replace("-", "_").upper() + "_URL"
        local_runtime_url = os.environ.get(env_key) or os.environ.get('LOCAL_RESEARCH_AGENT_URL')
        agent_arn = None

        if local_runtime_url:
            # Local testing: use localhost URL
            runtime_url = local_runtime_url
            logger.debug(f"Local test mode ({agent_id}): {runtime_url}")
        else:
            # Production: use AgentCore Runtime
            agent_arn = get_cached_agent_arn(agent_id, region)
            if not agent_arn:
                yield {
                    "status": "error",
                    "content": [{"text": f"Error: Could not find agent ARN for {agent_id}"}]
                }
                return

            escaped_arn = quote(agent_arn, safe='')
            runtime_url = f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{escaped_arn}/invocations/"

        logger.debug(f"Invoking A2A agent {agent_id}")

        # Get HTTP client with SigV4 IAM auth
        httpx_client = get_http_client(region)

        # Add session ID header (must be >= 33 characters)
        if not session_id:
            session_id = str(uuid4()) + "-" + str(uuid4())[:8]  # UUID (36) + dash + 8 chars = 45 chars

        # Ensure session ID meets minimum length requirement
        if len(session_id) < 33:
            session_id = session_id + "-" + str(uuid4())[:max(0, 33 - len(session_id) - 1)]

        headers = {
            'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': session_id
        }
        httpx_client.headers.update(headers)

        # Get or cache agent card (skip for local testing)
        if agent_arn and agent_arn not in _cache['agent_cards']:
            logger.debug(f"Fetching agent card for ARN: {agent_arn}")

            try:
                # Use boto3 SDK to get agent card directly
                bedrock_agentcore = boto3.client('bedrock-agentcore', region_name=region)
                response = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: bedrock_agentcore.get_agent_card(agentRuntimeArn=agent_arn)
                )

                agent_card_dict = response.get('agentCard', {})

                if not agent_card_dict:
                    raise ValueError(f"No agent card found in boto3 response")

                logger.debug(f"Retrieved agent card for {agent_id}")

                # Convert dict to AgentCard object
                agent_card = AgentCard(**agent_card_dict)

                # Cache the agent card object
                _cache['agent_cards'][agent_arn] = agent_card

            except Exception as e:
                logger.error(f"Error fetching agent card: {e}")
                raise

        # Get agent card from cache (or create dummy for local testing)
        if agent_arn:
            agent_card = _cache['agent_cards'][agent_arn]
        else:
            # Local testing mode: create minimal agent card
            agent_card = AgentCard(url=runtime_url, capabilities={})

        # Create A2A client with streaming enabled
        config = ClientConfig(httpx_client=httpx_client, streaming=True)
        factory = ClientFactory(config)
        client = factory.create(agent_card)

        # Create message with metadata in Message.metadata
        msg = Message(
            kind="message",
            role=Role.user,
            parts=[Part(TextPart(kind="text", text=message))],
            message_id=uuid4().hex,
            metadata=metadata
        )


        response_text = ""
        code_result_meta = None    # Structured result metadata from code agent
        browser_session_arn = None  # For browser-use agent live view
        browser_id_from_stream = None  # Browser ID from artifact
        browser_session_event_sent = False  # Track if we've sent the event
        sent_browser_steps = set()  # Track sent browser/research steps to avoid duplicates
        sent_screenshots = set()   # Track sent screenshots to avoid duplicates
        sent_code_steps = set()    # Track sent code_step_N artifacts
        sent_code_todos = set()    # Track sent code_todos_N artifacts
        async with asyncio.timeout(AGENT_TIMEOUT):
            async for event in client.send_message(msg):
                logger.debug(f"Received A2A event type: {type(event).__name__}")

                if isinstance(event, Message):
                    # Extract text from Message response
                    if event.parts and len(event.parts) > 0:
                        for part in event.parts:
                            if hasattr(part, 'text'):
                                response_text += part.text
                            elif hasattr(part, 'root') and hasattr(part.root, 'text'):
                                response_text += part.root.text

                    logger.debug(f"A2A Message received ({len(response_text)} chars)")
                    break

                elif isinstance(event, tuple) and len(event) == 2:
                    # (Task, UpdateEvent) tuple - streaming mode
                    task, update_event = event

                    # Extract task status
                    task_status = task.status if hasattr(task, 'status') else task
                    state = task_status.state if hasattr(task_status, 'state') else 'unknown'

                    # Accumulate text chunks from task_status.message
                    # Note: browser_step content is sent via artifacts, NOT task_status.message
                    if hasattr(task_status, 'message') and task_status.message:
                        message_obj = task_status.message
                        if hasattr(message_obj, 'parts') and message_obj.parts:
                            text_part = message_obj.parts[0]
                            if hasattr(text_part, 'root') and hasattr(text_part.root, 'text'):
                                response_text += text_part.root.text
                            elif hasattr(text_part, 'text'):
                                response_text += text_part.text

                    # Check for artifacts IMMEDIATELY (for Live View - browser_session_arn and browser_id)
                    # This allows frontend to show Live View button while agent is still working
                    if hasattr(task, 'artifacts') and task.artifacts:
                        # Always check artifacts for new browser_session_arn or browser_id
                        # (they may arrive in separate streaming events)
                        logger.debug(f"[A2A] Checking {len(task.artifacts)} artifacts")
                        for artifact in task.artifacts:
                            artifact_name = artifact.name if hasattr(artifact, 'name') else 'unnamed'
                            logger.debug(f"[A2A] Found artifact: {artifact_name}")

                            # Extract browser_session_arn (if not yet extracted)
                            if artifact_name == 'browser_session_arn' and not browser_session_arn:
                                if hasattr(artifact, 'parts') and artifact.parts:
                                    for part in artifact.parts:
                                        if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                            browser_session_arn = part.root.text
                                        elif hasattr(part, 'text'):
                                            browser_session_arn = part.text
                                        if browser_session_arn:
                                            logger.debug(f"Extracted browser_session_arn: {browser_session_arn[:50]}...")
                                            break

                            # Extract browser_id (required for validation) - if not yet extracted
                            elif artifact_name == 'browser_id' and not browser_id_from_stream:
                                if hasattr(artifact, 'parts') and artifact.parts:
                                    for part in artifact.parts:
                                        if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                            browser_id_from_stream = part.root.text
                                        elif hasattr(part, 'text'):
                                            browser_id_from_stream = part.text
                                        if browser_id_from_stream:
                                            logger.debug(f"Extracted browser_id: {browser_id_from_stream}")
                                            break

                        # If we have browser_session_arn AND browser_id, send event once
                        if browser_session_arn and browser_id_from_stream and not browser_session_event_sent:
                            event_data = {
                                "type": "browser_session_detected",
                                "browserSessionId": browser_session_arn,
                                "browserId": browser_id_from_stream,
                                "message": "Browser session started - Live View available"
                            }
                            logger.debug(f"Browser session detected: {browser_id_from_stream}")
                            yield event_data
                            browser_session_event_sent = True

                        # Handle screenshot artifacts (auto-save to workspace)
                        for artifact in task.artifacts:
                            artifact_name = artifact.name if hasattr(artifact, 'name') else 'unnamed'

                            # Check for screenshot_N pattern (screenshot_1, screenshot_2, ...)
                            if artifact_name.startswith('screenshot_'):
                                # Skip if already processed (avoid duplicates)
                                if artifact_name in sent_screenshots:
                                    continue

                                logger.debug(f"Found screenshot artifact: {artifact_name}")

                                # Extract metadata
                                artifact_metadata = artifact.metadata if hasattr(artifact, 'metadata') else {}
                                filename = artifact_metadata.get('filename', f'screenshot_{uuid4()}.png')
                                description = artifact_metadata.get('description', 'Browser screenshot')

                                # Extract screenshot data
                                if hasattr(artifact, 'parts') and artifact.parts:
                                    for part in artifact.parts:
                                        # Get base64 screenshot data
                                        screenshot_b64 = None
                                        if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                            screenshot_b64 = part.root.text
                                        elif hasattr(part, 'text'):
                                            screenshot_b64 = part.text

                                        if screenshot_b64:

                                            try:
                                                # Decode base64 to bytes
                                                import base64
                                                screenshot_bytes = base64.b64decode(screenshot_b64)

                                                # Save to workspace via ImageManager
                                                from workspace import ImageManager
                                                # Use session_id from function parameter (already available in send_a2a_message)
                                                screenshot_session_id = session_id or 'unknown'
                                                # Get user_id from artifact metadata (priority), then function metadata, then environment variable
                                                # Use 'or' to skip None values and try next fallback
                                                screenshot_user_id = (
                                                    (artifact_metadata.get('user_id') if artifact_metadata else None)
                                                    or (metadata.get('user_id') if metadata else None)
                                                    or os.environ.get('USER_ID', 'default_user')
                                                )
                                                image_manager = ImageManager(user_id=screenshot_user_id, session_id=screenshot_session_id)
                                                image_manager.save_to_s3(filename, screenshot_bytes)

                                                # Mark as sent to avoid duplicate processing (by artifact name)
                                                sent_screenshots.add(artifact_name)
                                                logger.debug(f"Saved screenshot: {filename}")

                                                # Add text notification to response_text for LLM context
                                                screenshot_notification = f"\n\n**Screenshot Saved**\n- **Filename**: {filename}\n- **Description**: {description}\n"
                                                response_text += screenshot_notification

                                            except Exception as e:
                                                logger.error(f"Failed to save screenshot {artifact_name}: {str(e)}")
                                                error_notification = f"\n\n**Screenshot Error**: Failed to save {filename}\n"
                                                response_text += error_notification

                                            break

                        # Check for real-time step/todo artifacts and stream them immediately.
                        # This runs EVERY iteration, not just when extracting browser_session_arn.
                        for artifact in task.artifacts:
                            artifact_name = artifact.name if hasattr(artifact, 'name') else 'unnamed'

                            # browser_step_N / research_step_N
                            if artifact_name.startswith('browser_step_') or artifact_name.startswith('research_step_'):
                                try:
                                    step_number = int(artifact_name.split('_')[-1])
                                    step_type = "browser_step" if artifact_name.startswith('browser_step_') else "research_step"

                                    if step_number not in sent_browser_steps:
                                        step_text = ""
                                        if hasattr(artifact, 'parts') and artifact.parts:
                                            for part in artifact.parts:
                                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                                    step_text = part.root.text
                                                elif hasattr(part, 'text'):
                                                    step_text = part.text
                                                if step_text:
                                                    break

                                        if step_text:
                                            yield {
                                                "type": step_type,
                                                "stepNumber": step_number,
                                                "content": step_text
                                            }
                                            sent_browser_steps.add(step_number)
                                            logger.debug(f"Yielded {artifact_name}")
                                except (ValueError, IndexError):
                                    pass

                            # code_step_N — tool-use progress from code agent
                            elif artifact_name.startswith('code_step_'):
                                try:
                                    step_number = int(artifact_name.split('_')[-1])
                                    if step_number not in sent_code_steps:
                                        step_text = ""
                                        if hasattr(artifact, 'parts') and artifact.parts:
                                            for part in artifact.parts:
                                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                                    step_text = part.root.text
                                                elif hasattr(part, 'text'):
                                                    step_text = part.text
                                                if step_text:
                                                    break
                                        if step_text:
                                            yield {
                                                "type": "code_step",
                                                "stepNumber": step_number,
                                                "content": step_text
                                            }
                                            sent_code_steps.add(step_number)
                                            logger.debug(f"Yielded {artifact_name}")
                                except (ValueError, IndexError):
                                    pass

                            # code_todos_N — TodoWrite state from code agent
                            elif artifact_name.startswith('code_todos_'):
                                try:
                                    todo_number = int(artifact_name.split('_')[-1])
                                    if todo_number not in sent_code_todos:
                                        todos_json = ""
                                        if hasattr(artifact, 'parts') and artifact.parts:
                                            for part in artifact.parts:
                                                if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                                    todos_json = part.root.text
                                                elif hasattr(part, 'text'):
                                                    todos_json = part.text
                                                if todos_json:
                                                    break
                                        if todos_json:
                                            try:
                                                import json as _json
                                                yield {
                                                    "type": "code_todo_update",
                                                    "todos": _json.loads(todos_json)
                                                }
                                                sent_code_todos.add(todo_number)
                                                logger.debug(f"Yielded {artifact_name}")
                                            except Exception:
                                                pass
                                except (ValueError, IndexError):
                                    pass

                    # Check if task failed
                    if str(state) == 'TaskState.failed' or state == 'failed':
                        logger.warning(f"Task failed")

                        # Extract error message from task status
                        error_message = "Agent task failed"
                        if hasattr(task_status, 'message') and task_status.message:
                            if hasattr(task_status.message, 'parts') and task_status.message.parts:
                                for part in task_status.message.parts:
                                    if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                        error_message = part.root.text
                                    elif hasattr(part, 'text'):
                                        error_message = part.text

                        # Extract any artifacts (e.g., browser_session_arn, partial results)
                        if hasattr(task, 'artifacts') and task.artifacts:
                            for artifact in task.artifacts:
                                artifact_name = artifact.name if hasattr(artifact, 'name') else 'unnamed'
                                if hasattr(artifact, 'parts') and artifact.parts:
                                    for part in artifact.parts:
                                        artifact_text = ""
                                        if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                            artifact_text = part.root.text
                                        elif hasattr(part, 'text'):
                                            artifact_text = part.text

                                        if artifact_text:
                                            if artifact_name == 'browser_session_arn':
                                                browser_session_arn = artifact_text
                                            elif artifact_name == 'research_markdown':
                                                response_text += artifact_text

                        logger.warning(f"Task failed: {error_message}")

                        # Yield error with any partial results
                        yield {
                            "status": "error",
                            "content": [{
                                "text": response_text or f"Error: {error_message}"
                            }]
                        }
                        return

                    # Check if task completed
                    if str(state) == 'TaskState.completed' or state == 'completed':
                        logger.debug(f"Task completed, extracting artifacts")

                        # Extract all artifacts from completed task
                        if hasattr(task, 'artifacts') and task.artifacts:
                            for artifact in task.artifacts:
                                artifact_name = artifact.name if hasattr(artifact, 'name') else 'unnamed'

                                if hasattr(artifact, 'parts') and artifact.parts:
                                    for part in artifact.parts:
                                        artifact_text = ""
                                        if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                            artifact_text = part.root.text
                                        elif hasattr(part, 'text'):
                                            artifact_text = part.text

                                        if artifact_text:
                                            # Special handling for browser_session_arn and browser_id
                                            if artifact_name == 'browser_session_arn':
                                                browser_session_arn = artifact_text
                                                logger.info(f"Extracted browser_session_arn: {browser_session_arn}")
                                            elif artifact_name == 'browser_id':
                                                # Skip browser_id (already handled in metadata)
                                                pass
                                            elif artifact_name.startswith('browser_step_'):
                                                logger.info(f"Skipping {artifact_name} (UI-only artifact)")
                                            elif artifact_name.startswith('research_step_'):
                                                logger.info(f"Skipping {artifact_name} (UI-only artifact)")
                                            elif artifact_name.startswith('code_step_'):
                                                logger.info(f"Skipping {artifact_name} (UI-only artifact)")
                                            elif artifact_name.startswith('code_todos_'):
                                                logger.info(f"Skipping {artifact_name} (UI-only artifact)")
                                            elif artifact_name == 'code_result':
                                                # Parse JSON payload: use summary for LLM, stash meta for frontend event
                                                try:
                                                    import json as _json
                                                    result_data = _json.loads(artifact_text)
                                                    summary = result_data.get("summary", "")
                                                    if summary:
                                                        response_text += summary
                                                    code_result_meta = {
                                                        "files_changed": result_data.get("files_changed", []),
                                                        "todos": result_data.get("todos", []),
                                                        "steps": result_data.get("steps", 0),
                                                        "status": result_data.get("status", "completed"),
                                                    }
                                                except Exception:
                                                    # Fallback: treat as plain text
                                                    response_text += artifact_text
                                            else:
                                                # Include other artifacts (agent_response, browser_result, etc.) in LLM context
                                                response_text += artifact_text

                        logger.debug(f"Total response: {len(response_text)} chars")
                        break

                    # Break on final event
                    if update_event and hasattr(update_event, 'final') and update_event.final:
                        break

        # Yield structured code-agent metadata before the final result (frontend use)
        if code_result_meta is not None:
            yield {
                "type": "code_result_meta",
                **code_result_meta,
            }

        # Yield final result
        logger.debug(f"Final A2A response: {len(response_text)} chars")
        yield {
            "status": "success",
            "content": [{
                "text": response_text or "Task completed successfully"
            }]
        }

    except asyncio.TimeoutError:
        logger.warning(f"Timeout calling {agent_id} agent")
        yield {
            "status": "error",
            "content": [{
                "text": f"Agent {agent_id} timed out after {AGENT_TIMEOUT}s"
            }]
        }
    except Exception as e:
        logger.error(f"Error calling {agent_id}: {e}")
        logger.exception(e)
        yield {
            "status": "error",
            "content": [{
                "text": f"Error: {str(e)}"
            }]
        }


# ============================================================
# Factory Function - Creates Direct A2A Agent Tool
# ============================================================

def create_a2a_tool(agent_id: str):
    """
    Create a direct callable tool for the A2A agent

    Args:
        agent_id: Tool ID (e.g., "agentcore_research-agent", "agentcore_browser-use-agent")

    Returns:
        Strands tool function, or None if not found
    """
    if agent_id not in A2A_AGENTS_CONFIG:
        logger.warning(f"Unknown A2A agent: {agent_id}")
        return None

    config = A2A_AGENTS_CONFIG[agent_id]
    agent_name = config['name']
    agent_description = config['description']

    logger.debug(f"Creating A2A tool: {agent_id}")

    # Preload ARN into cache
    region = os.environ.get('AWS_REGION', 'us-west-2')
    agent_arn = get_cached_agent_arn(agent_id, region)
    if not agent_arn:
        logger.error(f"Failed to get ARN for {agent_id}")
        return None

    # Helper function to extract context
    def extract_context(tool_context):
        session_id = None
        user_id = None
        model_id = None

        if tool_context:
            # Try to get from invocation_state first
            session_id = tool_context.invocation_state.get("session_id")
            user_id = tool_context.invocation_state.get("user_id")
            model_id = tool_context.invocation_state.get("model_id")

            # Fallback to agent's session_manager
            if not session_id and hasattr(tool_context.agent, '_session_manager'):
                session_id = tool_context.agent._session_manager.session_id

            # Get user_id from agent if not in invocation_state
            if not user_id and hasattr(tool_context.agent, 'user_id'):
                user_id = tool_context.agent.user_id

            # Get model_id from agent if not in invocation_state
            if not model_id:
                if hasattr(tool_context.agent, 'model_id'):
                    model_id = tool_context.agent.model_id
                elif hasattr(tool_context.agent, 'model') and hasattr(tool_context.agent.model, 'model_id'):
                    model_id = tool_context.agent.model.model_id

        # Fallback to environment variable
        if not session_id:
            session_id = os.environ.get('SESSION_ID')
        if not user_id:
            user_id = os.environ.get('USER_ID')

        return session_id, user_id, model_id

    # Generate correct tool name BEFORE creating function
    correct_name = agent_id.replace("agentcore_", "").replace("-", "_")

    # Create different tool implementations based on agent type
    if "code" in agent_id:
        # Code Agent - task parameter, streams code_step events
        async def tool_impl(task: str, reset_session: bool = False, compact_session: bool = False, tool_context: ToolContext = None) -> AsyncGenerator[Dict[str, Any], None]:
            """
            task: The coding task to delegate.
            reset_session: Set True to clear conversation history and start fresh
                           (equivalent to /clear in Claude Code). Workspace files
                           are preserved — only the conversation context is wiped.
            compact_session: Set True to summarise conversation history before
                             running the task (equivalent to /compact in Claude Code).
                             Useful when prior context is long but still relevant.
            """
            session_id, user_id, model_id = extract_context(tool_context)

            # Discover uploaded files from S3 workspace and forward to code-agent
            s3_files = _list_session_s3_files(user_id, session_id)

            metadata = {
                "session_id": session_id,
                "user_id": user_id,
                "source": "main_agent",
                "model_id": model_id,
                "s3_files": s3_files,
                "reset_session": reset_session,
                "compact_session": compact_session,
            }

            async for event in send_a2a_message(agent_id, task, session_id, region, metadata=metadata):
                yield event

        tool_impl.__name__ = correct_name
        tool_impl.__doc__ = agent_description
        agent_tool = tool(context=True)(tool_impl)
        agent_tool._skill_name = "code-agent"

    elif "browser" in agent_id:
        # Browser Use Agent - task parameter only
        # Uses async generator to stream browser_session_arn immediately for Live View
        async def tool_impl(task: str, tool_context: ToolContext = None) -> AsyncGenerator[Dict[str, Any], None]:
            session_id, user_id, model_id = extract_context(tool_context)

            # Prepare metadata (max_steps handled internally by agent)
            metadata = {
                "session_id": session_id,
                "user_id": user_id,
                "source": "main_agent",
                "model_id": model_id,
            }

            # Stream events from A2A agent
            async for event in send_a2a_message(agent_id, task, session_id, region, metadata=metadata):
                # Store browser_session_arn and browser_id in invocation_state for frontend access
                if isinstance(event, dict):
                    if event.get("type") == "browser_session_detected":
                        browser_session_id = event.get("browserSessionId")
                        browser_id = event.get("browserId")
                        if browser_session_id and tool_context:
                            tool_context.invocation_state['browser_session_arn'] = browser_session_id
                            tool_context.invocation_state['browser_id'] = browser_id

                yield event

        # Set correct function name and docstring BEFORE decorating
        tool_impl.__name__ = correct_name
        tool_impl.__doc__ = agent_description

        # Apply decorator with context support
        agent_tool = tool(context=True)(tool_impl)

    else:
        # Research Agent (default) - plan parameter
        # Uses async generator to stream research_step events for real-time status updates
        async def tool_impl(plan: str, tool_context: ToolContext = None) -> AsyncGenerator[Dict[str, Any], None]:
            session_id, user_id, model_id = extract_context(tool_context)

            # Prepare metadata
            metadata = {
                "session_id": session_id,
                "user_id": user_id,
                "source": "main_agent",
                "model_id": model_id,
                "language": "en",
            }


            # Track final result for artifact saving
            final_result_text = None

            # Stream events from A2A agent (including research_step events for real-time UI updates)
            async for event in send_a2a_message(agent_id, plan, session_id, region, metadata=metadata):
                # Yield event FIRST to maintain proper stream order
                yield event

                # After yielding, check if this was the final success event and save artifact
                # This happens after the event is sent to agent, so won't interfere with interrupt
                if isinstance(event, dict) and event.get("status") == "success":
                    content = event.get("content", [])
                    if content and len(content) > 0:
                        final_result_text = content[0].get("text", "")

                        # Save research result to agent.state (after yielding final event)
                        if final_result_text and tool_context and tool_context.agent:
                            try:
                                from datetime import datetime, timezone

                                # Extract title from research content (first H1 heading)
                                import re
                                title_match = re.search(r'^#\s+(.+)$', final_result_text, re.MULTILINE)
                                title = title_match.group(1).strip() if title_match else "Research Results"

                                # Generate artifact ID using toolUseId for frontend mapping
                                tool_use_id = tool_context.tool_use.get('toolUseId', '')
                                artifact_id = f"research-{tool_use_id}" if tool_use_id else f"research-{session_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

                                # Get current artifacts from agent.state
                                artifacts = tool_context.agent.state.get("artifacts") or {}

                                # Calculate word count
                                word_count = len(final_result_text.split())

                                # Add new artifact
                                artifacts[artifact_id] = {
                                    "id": artifact_id,
                                    "type": "research",
                                    "title": title,
                                    "content": final_result_text,
                                    "tool_name": "research_agent",
                                    "metadata": {
                                        "word_count": word_count,
                                        "description": f"Research report: {title}"
                                    },
                                    "created_at": datetime.now(timezone.utc).isoformat(),
                                    "updated_at": datetime.now(timezone.utc).isoformat()
                                }

                                # Save to agent.state
                                tool_context.agent.state.set("artifacts", artifacts)

                                # Sync agent state to file system / AgentCore Memory
                                # Try session_manager from invocation_state first (set by ChatAgent)
                                session_manager = tool_context.invocation_state.get("session_manager")

                                if not session_manager and hasattr(tool_context.agent, 'session_manager'):
                                    session_manager = tool_context.agent.session_manager

                                if session_manager:
                                    session_manager.sync_agent(tool_context.agent)
                                    logger.debug(f"Saved research artifact: {artifact_id}")
                                else:
                                    logger.warning(f"No session_manager found, artifact not persisted")

                            except Exception as e:
                                logger.error(f"Failed to save research artifact: {e}")

        # Set correct function name and docstring BEFORE decorating
        tool_impl.__name__ = correct_name
        tool_impl.__doc__ = agent_description

        # Now apply the decorator to get the tool
        agent_tool = tool(context=True)(tool_impl)

    logger.debug(f"A2A tool created: {agent_tool.__name__}")
    return agent_tool


# Cleanup on shutdown
async def cleanup():
    if _cache['http_client']:
        await _cache['http_client'].aclose()
