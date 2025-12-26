"""
Browser Use Agent A2A Server

Autonomous browser automation agent using browser-use library.
Receives browser tasks and executes them with adaptive AI-driven navigation.

For local testing:
    python -m uvicorn src.main:app --port 9000 --reload
"""

import logging
import os
import asyncio
from typing import Optional, Dict, Any
from pathlib import Path

import uvicorn
from fastapi import FastAPI
import boto3

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater, InMemoryTaskStore
from a2a.types import (
    AgentCard,
    AgentSkill,
    AgentCapabilities,
    Message,
    Part,
    TextPart,
    Role,
)

from browser_use import Agent as BrowserUseAgent, Browser, BrowserProfile
from browser_use.llm import ChatAWSBedrock
from browser_use.tools.service import Tools
from bedrock_agentcore.tools.browser_client import BrowserClient
from pydantic import BaseModel
from typing import Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ============================================================
# Custom Action: Save Screenshot
# ============================================================

class SaveScreenshotParams(BaseModel):
    """Parameters for save_screenshot action"""
    filename: str
    description: str

# Global reference to current browser session and updater (set during agent execution)
_current_browser_context = None
_current_updater = None
_current_screenshot_b64 = None  # Last screenshot taken by browser-use
_screenshot_queue = []  # Queue of screenshots to upload
_screenshot_counter = 0  # Counter for unique screenshot artifact names

def create_screenshot_tools():
    """Create Tools instance with custom screenshot action"""
    tools = Tools()

    @tools.action(
        'Save screenshot to workspace with descriptive filename. Use at important milestones (search results, completed forms, final state).',
        param_model=SaveScreenshotParams
    )
    def save_screenshot(params: SaveScreenshotParams):
        """
        Save current browser screenshot to main agent's workspace.

        Args:
            filename: Descriptive name ending with .png (e.g., "amazon-search-results.png")
            description: What the screenshot shows (e.g., "Product search results page")

        Returns:
            Confirmation message
        """
        global _current_screenshot_b64, _screenshot_queue

        if not _current_screenshot_b64:
            return "❌ Error: No screenshot available (browser may not have captured one yet)"

        # Validate filename
        if not params.filename.lower().endswith('.png'):
            params.filename = params.filename + '.png'

        # Queue screenshot for upload (will be processed in main async loop)
        # This avoids creating new event loops which can interfere with WebSocket
        _screenshot_queue.append({
            'filename': params.filename,
            'description': params.description,
            'screenshot_b64': _current_screenshot_b64  # Copy current screenshot
        })

        logger.info(f"📸 Queued screenshot for upload: {params.filename} - {params.description}")
        return f"✅ Screenshot queued: {params.filename}"

    return tools

# Configuration from environment
PORT = int(os.environ.get('PORT', 9000))
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')
DEFAULT_MODEL_ID = os.environ.get('MODEL_ID', 'us.anthropic.claude-haiku-4-5-20251001-v1:0')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')

logger.info(f"Configuration:")
logger.info(f"  Model ID: {DEFAULT_MODEL_ID}")
logger.info(f"  AWS Region: {AWS_REGION}")
logger.info(f"  Port: {PORT}")
logger.info(f"  Project: {PROJECT_NAME}")
logger.info(f"  Environment: {ENVIRONMENT}")

# ============================================================
# Patched ChatAWSBedrock with Fixed Tool Schema Conversion
# ============================================================

class PatchedChatAWSBedrock(ChatAWSBedrock):
    """
    ChatAWSBedrock with fixed _format_tools_for_request method.

    The original implementation loses nested schema information (array items,
    object properties, $ref definitions), causing validation errors.

    This patched version recursively resolves $ref references and preserves
    complete nested schema structure for proper tool calling.
    """

    def _format_tools_for_request(self, output_format: type[BaseModel]) -> list[dict[str, Any]]:
        """Format a Pydantic model as a tool for structured output."""
        logger.info(f"🔧 PatchedChatAWSBedrock._format_tools_for_request called for {output_format.__name__}")

        schema = output_format.model_json_schema()

        # Resolve $ref references inline by merging $defs
        def resolve_refs(obj: Any, defs: dict) -> Any:
            """Recursively resolve $ref references in schema."""
            if isinstance(obj, dict):
                if '$ref' in obj:
                    # Extract definition name from $ref (e.g., "#/$defs/ActionModel" -> "ActionModel")
                    ref_path = obj['$ref'].split('/')[-1]
                    if ref_path in defs:
                        # Recursively resolve the referenced definition
                        return resolve_refs(defs[ref_path], defs)
                    return obj
                else:
                    # Recursively resolve all nested objects
                    return {k: resolve_refs(v, defs) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [resolve_refs(item, defs) for item in obj]
            else:
                return obj

        # Get $defs if they exist
        defs = schema.get('$defs', {})

        # Resolve all $ref references in properties
        properties = resolve_refs(schema.get('properties', {}), defs)
        required = schema.get('required', [])

        # Build complete input schema with all nested structures preserved
        input_schema = {
            'type': 'object',
            'properties': properties,
            'required': required
        }

        logger.info(f"✅ PatchedChatAWSBedrock: Tool schema generated with {len(properties)} properties, {len(defs)} $defs resolved")

        return [
            {
                'toolSpec': {
                    'name': f'extract_{output_format.__name__.lower()}',
                    'description': f'Extract information in the format of {output_format.__name__}',
                    'inputSchema': {'json': input_schema},
                }
            }
        ]


# LLM cache for reusing clients with the same model_id
llm_cache: Dict[str, PatchedChatAWSBedrock] = {}

# Note: Browser sessions are NOT cached - each task gets a fresh browser session
# This prevents stale session errors and ensures clean browser state per task


def get_or_create_llm(model_id: str) -> PatchedChatAWSBedrock:
    """
    Get cached LLM client or create new one with specified model_id.

    Args:
        model_id: AWS Bedrock model ID (e.g., 'us.anthropic.claude-sonnet-4-20250514-v1:0')

    Returns:
        PatchedChatAWSBedrock instance with fixed tool schema conversion
    """
    if model_id not in llm_cache:
        logger.info(f"Creating new LLM client with model: {model_id}")
        # Create boto3 session to ensure IAM role credentials are used
        import boto3
        boto_session = boto3.Session(region_name=AWS_REGION)

        llm_instance = PatchedChatAWSBedrock(
            model=model_id,
            aws_region=AWS_REGION,
            temperature=0.3,  # Lower temperature for more consistent structured output
            max_tokens=8192,
            session=boto_session,  # Pass boto3 session explicitly
        )
        llm_cache[model_id] = llm_instance

        # Log class name to verify PatchedChatAWSBedrock is being used
        logger.info(f"✅ Created LLM instance: {llm_instance.__class__.__name__} (should be 'PatchedChatAWSBedrock')")
    else:
        logger.info(f"Reusing cached LLM client with model: {model_id}")

    return llm_cache[model_id]


def get_browser_id() -> Optional[str]:
    """
    Get Custom Browser ID from environment or Parameter Store.

    Returns:
        Browser ID or None if not found
    """
    # 1. Check environment variable
    browser_id = os.getenv('BROWSER_ID')
    if browser_id:
        logger.info(f"Found BROWSER_ID in environment: {browser_id}")
        return browser_id

    # 2. Try Parameter Store
    try:
        import boto3
        param_name = f"/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/browser-id"
        logger.info(f"Checking Parameter Store for Browser ID: {param_name}")
        ssm = boto3.client('ssm', region_name=AWS_REGION)
        response = ssm.get_parameter(Name=param_name)
        browser_id = response['Parameter']['Value']
        logger.info(f"Found BROWSER_ID in Parameter Store: {browser_id}")
        return browser_id
    except Exception as e:
        logger.warning(f"Custom Browser ID not found: {e}")
        return None


def get_or_create_browser_session(session_id: str) -> Optional[tuple[str, str, dict, str]]:
    """
    Create a NEW AgentCore Browser session for each browser task.

    Note: We do NOT cache browser sessions across tasks because:
    1. Each task may need a fresh browser state
    2. Browser sessions have timeout and may become invalid
    3. Caching can cause stale session errors

    Args:
        session_id: Session ID from main agent (for logging only)

    Returns:
        Tuple of (session_arn, ws_url, headers, browser_id) or None if browser not available
    """
    # DO NOT use cache - always create new browser session
    # This ensures fresh browser state for each task
    try:
        logger.info(f"Creating new AgentCore Browser session for {session_id}")
        client = BrowserClient(region=AWS_REGION)

        # Start session - Browser ID is optional, will auto-create if not provided
        custom_browser_id = get_browser_id()
        if custom_browser_id:
            logger.info(f"Using custom Browser ID: {custom_browser_id}")
            browser_session_arn = client.start(
                identifier=custom_browser_id,
                session_timeout_seconds=3600,
                viewport={'width': 1536, 'height': 1296}
            )
            # Use the custom browser_id we passed to start()
            browser_id = custom_browser_id
        else:
            logger.info("No custom Browser ID found - creating new browser session")
            browser_session_arn = client.start(
                session_timeout_seconds=3600,
                viewport={'width': 1536, 'height': 1296}
            )
            # For auto-created browsers, we don't have a stable browser_id
            browser_id = None

        # Get WebSocket URL and headers
        ws_url, headers = client.generate_ws_headers()

        logger.info(f"✅ Browser session created: {browser_session_arn}, browser_id: {browser_id}")

        # DO NOT cache - return fresh session
        return browser_session_arn, ws_url, headers, browser_id

    except Exception as e:
        logger.error(f"Failed to create browser session: {e}")
        return None


def _format_single_step(step, step_num: int) -> str:
    """
    Format a single step for real-time streaming (concise version).

    Args:
        step: AgentHistory object
        step_num: Step number (1-indexed)

    Returns:
        Markdown formatted step summary
    """
    lines = [f"### 📍 Step {step_num}\n\n"]

    # Memory/thinking
    if hasattr(step, 'model_output') and step.model_output:
        if hasattr(step.model_output, 'current_state') and step.model_output.current_state:
            if hasattr(step.model_output.current_state, 'memory'):
                memory = step.model_output.current_state.memory
                if memory:
                    truncated = memory[:150] + "..." if len(memory) > 150 else memory
                    lines.append(f"**🧠 Thinking**: {truncated}\n\n")

        if hasattr(step.model_output, 'next_goal') and step.model_output.next_goal:
            goal = step.model_output.next_goal
            truncated = goal[:150] + "..." if len(goal) > 150 else goal
            lines.append(f"**🎯 Goal**: {truncated}\n\n")

    # Action
    if hasattr(step, 'action') and step.action:
        action_dict = {}
        if hasattr(step.action, 'model_dump'):
            action_dict = step.action.model_dump()

        if action_dict:
            action_name = action_dict.get('name', 'Unknown')
            lines.append(f"**▶️ Action**: {action_name}\n\n")

    # Result
    if hasattr(step, 'result') and step.result:
        if hasattr(step.result, 'evaluation_previous_goal'):
            eval_text = step.result.evaluation_previous_goal
            if eval_text:
                truncated = eval_text[:100] + "..." if len(eval_text) > 100 else eval_text
                emoji = "✅" if "success" in eval_text.lower() else "⚠️"
                lines.append(f"{emoji} {truncated}\n\n")

    lines.append("---\n\n")

    return "".join(lines)


def _format_execution_history(history) -> str:
    """
    Format browser-use execution history with detailed step-by-step information.

    Args:
        history: AgentHistoryList from agent.run()

    Returns:
        Detailed markdown with all steps and final result
    """
    if not history:
        return "**Task Status**: No execution history available."

    # AgentHistoryList has .history attribute which is list[AgentHistory]
    history_list = history.history if hasattr(history, 'history') else []

    if not history_list:
        return "**Task Status**: No execution history available."

    # Build detailed step-by-step output
    output_lines = [
        "## Browser Automation Result\n\n",
        f"**Status**: ✅ Completed in {len(history_list)} step(s)\n\n",
    ]

    # Add each step's details
    for i, step in enumerate(history_list, 1):
        output_lines.append(f"### 📍 Step {i}\n\n")

        # Memory/thinking
        if hasattr(step, 'model_output') and step.model_output:
            model_output = step.model_output

            # Extract memory from current_state
            if hasattr(model_output, 'current_state') and model_output.current_state:
                if hasattr(model_output.current_state, 'memory'):
                    memory = model_output.current_state.memory
                    if memory:
                        output_lines.append(f"**🧠 Memory**: {memory}\n\n")

            # Extract next goal
            if hasattr(model_output, 'next_goal') and model_output.next_goal:
                output_lines.append(f"**🎯 Next Goal**: {model_output.next_goal}\n\n")

        # Action taken
        if hasattr(step, 'action') and step.action:
            action = step.action
            # Extract action details
            action_dict = {}
            if hasattr(action, 'model_dump'):
                action_dict = action.model_dump()
            elif hasattr(action, 'dict'):
                action_dict = action.dict()

            if action_dict:
                # Format action nicely
                action_lines = []
                for key, value in action_dict.items():
                    if value is not None and key != 'data':  # Skip None and data fields
                        if isinstance(value, str) and len(value) > 100:
                            value = value[:100] + "..."
                        action_lines.append(f"  - **{key}**: {value}")

                if action_lines:
                    output_lines.append(f"**▶️  Action**:\n")
                    output_lines.append("\n".join(action_lines))
                    output_lines.append("\n\n")

        # Evaluation (success/failure)
        if hasattr(step, 'result') and step.result:
            result_obj = step.result

            # Extract evaluation text
            if hasattr(result_obj, 'evaluation_previous_goal') and result_obj.evaluation_previous_goal:
                eval_text = result_obj.evaluation_previous_goal
                # Truncate if too long
                if len(eval_text) > 300:
                    eval_text = eval_text[:300] + "..."

                # Add emoji based on success
                emoji = "✅" if "success" in eval_text.lower() else "⚠️"
                output_lines.append(f"{emoji} **Evaluation**: {eval_text}\n\n")

        output_lines.append("---\n\n")

    # Add final summary at the end
    output_lines.append("### 📄 Final Result\n\n")

    final_result = None
    last_step = history_list[-1]

    # Extract result from last step (result is a list of ActionResult)
    if hasattr(last_step, 'result') and last_step.result and len(last_step.result) > 0:
        # Get the last action result (usually the done action)
        result_obj = last_step.result[-1]

        # Priority 1: Extract content from done action's text parameter
        if hasattr(result_obj, 'extracted_content') and result_obj.extracted_content:
            final_result = result_obj.extracted_content

        # Priority 2: Extract from long_term_memory
        elif hasattr(result_obj, 'long_term_memory') and result_obj.long_term_memory:
            final_result = result_obj.long_term_memory

        # Priority 3: Extract from judgement (if Judge was used)
        elif hasattr(result_obj, 'judgement') and result_obj.judgement:
            judgement = result_obj.judgement
            if hasattr(judgement, 'reasoning') and judgement.reasoning:
                final_result = judgement.reasoning

    # Fallback: check if task was marked as done
    if not final_result:
        if hasattr(last_step, 'result') and last_step.result and len(last_step.result) > 0:
            is_done = getattr(last_step.result[-1], 'is_done', False)
            if is_done:
                final_result = "Task marked as complete by agent."
            else:
                final_result = "Task execution finished."
        else:
            final_result = "Task execution finished."

    output_lines.append(final_result)
    output_lines.append("\n")

    return "".join(output_lines)


class BrowserUseAgentExecutor(AgentExecutor):
    """
    A2A AgentExecutor that directly executes browser-use agent.

    NO Strands Agent layer - LLM is only called by browser-use agent.
    """

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Cancel execution - not currently supported."""
        from a2a.types import UnsupportedOperationError
        from a2a.utils.errors import ServerError
        logger.warning("Cancellation requested but not supported")
        raise ServerError(error=UnsupportedOperationError())

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """
        Execute browser automation task.

        Args:
            context: A2A request context with messages and metadata
            event_queue: Event queue for streaming progress
        """
        # Reset screenshot counter for each new task
        global _screenshot_counter
        _screenshot_counter = 0

        # Create task if not exists and enqueue (same as StrandsA2AExecutor)
        from a2a.utils import new_task
        task = context.current_task
        if not task:
            task = new_task(context.message)  # type: ignore
            await event_queue.enqueue_event(task)

        # Create TaskUpdater from event_queue
        updater = TaskUpdater(event_queue, task.id, task.context_id)

        browser_session_arn = None
        try:
            # Extract task from message
            if not context.message:
                raise ValueError("No message in request context")

            if not context.message.parts:
                raise ValueError("No parts in message")

            # Get task text
            task_text = ""
            for part in context.message.parts:
                if hasattr(part, 'text'):
                    task_text += part.text
                elif hasattr(part, 'root') and hasattr(part.root, 'text'):
                    task_text += part.root.text

            if not task_text:
                raise ValueError("Empty task text")

            logger.info(f"Received browser task: {task_text[:100]}...")

            # Wrap task with screenshot instructions at the BEGINNING for high attention weight
            wrapped_task = f"""CRITICAL REQUIREMENTS - READ FIRST:
- You MUST take screenshots at key milestones using save_screenshot action
- Required screenshots: search results, completed forms, important pages, final state
- Call save_screenshot(filename="descriptive-name.png", description="what this shows")
- Screenshots are essential for task verification

TASK:
{task_text}"""

            logger.info(f"✅ Wrapped task with screenshot requirements (positioned at start)")

            # Extract metadata from RequestContext
            # Try both params.metadata (MessageSendParams) and message.metadata (Message)
            # Streaming client may put metadata in Message.metadata
            metadata = context.metadata  # MessageSendParams.metadata
            if not metadata and context.message and hasattr(context.message, 'metadata'):
                metadata = context.message.metadata or {}  # Message.metadata

            model_id = metadata.get('model_id', DEFAULT_MODEL_ID) if metadata else DEFAULT_MODEL_ID
            session_id = metadata.get('session_id', 'unknown') if metadata else 'unknown'
            user_id = metadata.get('user_id', 'unknown') if metadata else 'unknown'
            max_steps = metadata.get('max_steps', 30) if metadata else 30  # Default 30 steps for browser automation

            logger.info(f"Metadata - model_id: {model_id}, session_id: {session_id}, user_id: {user_id}, max_steps: {max_steps}")

            # Get LLM client (cached by model_id)
            llm = get_or_create_llm(model_id)

            # Get or create AgentCore Browser session (REQUIRED - no local browser fallback)
            browser_result = get_or_create_browser_session(session_id)
            if not browser_result:
                raise ValueError("AgentCore Browser is required but not available.")

            browser_session_arn, ws_url, headers, browser_id = browser_result
            logger.info(f"Using AgentCore Browser: {browser_session_arn}, browser_id: {browser_id}")

            # Add browser session ARN as artifact IMMEDIATELY (for live view)
            # This allows frontend to show "View Browser" button while agent is still working
            # Streaming will handle propagation to frontend and DynamoDB persistence
            if browser_session_arn:
                await updater.add_artifact(
                    parts=[Part(root=TextPart(text=browser_session_arn))],
                    name="browser_session_arn"
                )
                logger.info(f"✅ Sent browser_session_arn artifact immediately: {browser_session_arn}")

                # Also send browser_id (ALWAYS - required for frontend validation)
                if browser_id:
                    await updater.add_artifact(
                        parts=[Part(root=TextPart(text=browser_id))],
                        name="browser_id"
                    )
                    logger.info(f"✅ Sent browser_id artifact: {browser_id}")
                else:
                    logger.warning("⚠️ browser_id not available from BrowserClient - Live View may not work")

            # Configure browser-use to use AgentCore Browser with authentication headers
            logger.info(f"Connecting to AgentCore Browser via CDP: {ws_url}")

            # Create browser profile with headers for authentication
            browser_profile = BrowserProfile(
                headers=headers,
                timeout=1500000,  # 1500 seconds (25 minutes) timeout for long-running tasks
                cross_origin_iframes=False,  # Disable cross-origin iframes (blocks most ads)
                max_iframes=5,  # Aggressive limit: only process first 5 same-origin iframes
                max_iframe_depth=3,  # Reduce nested iframe depth (default: 5)
            )

            # Create browser session with CDP URL
            browser_session = Browser(
                cdp_url=ws_url,
                browser_profile=browser_profile,
            )

            # Initialize browser session
            logger.info("Initializing AgentCore Browser session...")
            await browser_session.start()

            # Create screenshot tools for custom actions
            screenshot_tools = create_screenshot_tools()

            # Create browser-use agent (SINGLE LLM LAYER!)
            logger.info(f"Starting browser-use agent with model {model_id}")
            agent = BrowserUseAgent(
                task=wrapped_task,  # Use wrapped task with screenshot requirements
                llm=llm,
                browser_session=browser_session,  # Use browser_session parameter
                tools=screenshot_tools,  # Add custom screenshot action
                max_actions_per_step=1,  # Observe after each action to prevent WebSocket timeout
                llm_screenshot_size=(1536, 1296),  # Match viewport to avoid scaling overhead
                use_vision='auto',  # Enable vision mode to allow screenshot action
                use_judge=False,  # Disable Judge - rely on agent's own completion signal
            )

            # Set global variables for custom action access
            global _current_browser_context, _current_updater
            _current_updater = updater
            # Get current page from browser session for screenshot access
            _current_browser_context = await browser_session.get_current_page()

            # Override agent's close() method to prevent browser session cleanup
            # This keeps the browser alive for Live View after task completion
            async def noop_close():
                logger.info("🔴 [Live View] Skipping agent close() to keep browser session alive for Live View")
                pass
            agent.close = noop_close

            # Hook into browser_session to intercept screenshots from browser-use
            # This captures the screenshot that browser-use already took, avoiding duplicate work
            original_get_browser_state = browser_session.get_browser_state_summary

            async def hooked_get_browser_state(**kwargs):
                """Intercept browser state to capture screenshot before it's discarded"""
                global _current_screenshot_b64
                result = await original_get_browser_state(**kwargs)
                # Capture screenshot if browser-use took one
                if result.screenshot:
                    _current_screenshot_b64 = result.screenshot
                    logger.debug(f"📸 Captured screenshot from browser-use (length: {len(result.screenshot)})")
                return result

            # Use object.__setattr__ to bypass Pydantic validation
            object.__setattr__(browser_session, 'get_browser_state_summary', hooked_get_browser_state)

            # Execute autonomously with REAL-TIME step streaming
            # Run agent in background while monitoring history
            async def run_agent():
                return await agent.run(max_steps=max_steps)

            agent_task = asyncio.create_task(run_agent())

            # Track sent steps to avoid duplicates
            sent_step_numbers = set()

            # Declare global variables for screenshot management
            global _screenshot_queue

            # Monitor history and stream steps in real-time
            while not agent_task.done():
                await asyncio.sleep(2)  # Check every 2 seconds

                # Screenshot is now captured by hook above - no need to take new screenshot

                # Process screenshot upload queue
                while _screenshot_queue:
                    item = _screenshot_queue.pop(0)
                    try:
                        _screenshot_counter += 1
                        await updater.add_artifact(
                            parts=[Part(root=TextPart(text=item['screenshot_b64']))],
                            name=f"screenshot_{_screenshot_counter}",
                            metadata={
                                "filename": item['filename'],
                                "content_type": "image/png",
                                "encoding": "base64",
                                "description": item['description'],
                                "user_id": user_id,
                                "session_id": session_id
                            }
                        )
                        logger.info(f"✅ Uploaded screenshot_{_screenshot_counter}: {item['filename']}")
                    except Exception as e:
                        logger.error(f"Failed to upload screenshot {item['filename']}: {e}")

                # Check if agent has history
                if hasattr(agent, 'history') and agent.history and hasattr(agent.history, 'history'):
                    current_steps = agent.history.history

                    # Send new steps
                    for i, step in enumerate(current_steps, 1):
                        if i not in sent_step_numbers:
                            step_text = _format_single_step(step, i)

                            # Send each step as separate artifact (streaming via A2A TaskArtifactUpdateEvent)
                            await updater.add_artifact(
                                parts=[Part(root=TextPart(text=step_text))],
                                name=f"browser_step_{i}"
                            )
                            sent_step_numbers.add(i)
                            logger.info(f"✅ Streamed browser_step_{i} to frontend")

            # Get final result
            history = await agent_task

            # Process any remaining screenshots in queue
            while _screenshot_queue:
                item = _screenshot_queue.pop(0)
                try:
                    _screenshot_counter += 1
                    await updater.add_artifact(
                        parts=[Part(root=TextPart(text=item['screenshot_b64']))],
                        name=f"screenshot_{_screenshot_counter}",
                        metadata={
                            "filename": item['filename'],
                            "content_type": "image/png",
                            "encoding": "base64",
                            "description": item['description'],
                            "user_id": user_id,
                            "session_id": session_id
                        }
                    )
                    logger.info(f"✅ Uploaded final screenshot_{_screenshot_counter}: {item['filename']}")
                except Exception as e:
                    logger.error(f"Failed to upload final screenshot {item['filename']}: {e}")

            # Send any remaining steps that were added after last loop iteration
            if hasattr(agent, 'history') and agent.history and hasattr(agent.history, 'history'):
                current_steps = agent.history.history
                for i, step in enumerate(current_steps, 1):
                    if i not in sent_step_numbers:
                        step_text = _format_single_step(step, i)
                        await updater.add_artifact(
                            parts=[Part(root=TextPart(text=step_text))],
                            name=f"browser_step_{i}"
                        )
                        sent_step_numbers.add(i)
                        logger.info(f"✅ Streamed final browser_step_{i} to frontend")

            # Browser session kept alive for Live View (will timeout after 25 minutes)
            logger.info("🔴 [Live View] Browser session kept alive for post-execution viewing")

            # Format result
            result_text = _format_execution_history(history)

            # Browser Agent always completes successfully
            # Declined/cancelled cases are handled by supervisor agent's interrupt mechanism
            logger.info(f"Task completed in {len(history.history) if hasattr(history, 'history') else len(history)} steps")

            # Add agent response summary
            summary = f"Browser automation completed in {len(history.history) if hasattr(history, 'history') else len(history)} steps."
            await updater.add_artifact(
                parts=[Part(root=TextPart(text=summary))],
                name="agent_response"
            )

            # Add main execution result (plain markdown, no XML tags)
            await updater.add_artifact(
                parts=[Part(root=TextPart(text=result_text))],
                name="browser_result"
            )
            logger.info(f"Added browser_result artifact ({len(result_text)} chars)")

            # Complete task
            await updater.complete()

        except Exception as e:
            logger.exception(f"Error executing browser task: {e}")

            # Classify error and provide specific error message
            error_message = str(e)
            error_type = type(e).__name__

            # Handle specific browser-use errors
            if "ModelProviderError" in error_type or "Expected structured output" in error_message:
                error_message = f"LLM Error: Model failed to generate valid tool use response. This may be due to model configuration or prompt issues."
            elif "429" in error_message or "Too Many Requests" in error_message:
                error_message = f"Rate Limit Error: Browser service rate limit exceeded. Please wait a moment and try again."
            elif "WebSocket" in error_message or "CDP" in error_message or "connection" in error_message.lower():
                error_message = f"Browser Connection Error: Failed to establish or maintain connection to browser session."
            elif "AssertionError" in error_type:
                error_message = f"Browser Initialization Error: CDP client failed to initialize properly."
            elif "TimeoutError" in error_type or "timeout" in error_message.lower():
                error_message = f"Timeout Error: Browser task exceeded time limit or connection timed out."
            else:
                error_message = f"Browser automation error: {error_message}"

            logger.error(f"Classified error as: {error_message}")

            # Send error via TaskUpdater (proper A2A protocol)
            try:
                # Add error as artifact
                await updater.add_artifact(
                    parts=[Part(root=TextPart(text=f"⚠️ Error: {error_message}"))],
                    name="agent_response"
                )
                await updater.failed()
            except Exception as fail_error:
                logger.error(f"Failed to send error via updater: {fail_error}")
                # Fallback: raise ServerError
                from a2a.types import InternalError
                from a2a.utils.errors import ServerError
                raise ServerError(error=InternalError()) from e

            # Return gracefully - error already sent to client
            return


def create_agent_card() -> AgentCard:
    """
    Create A2A Agent Card for Browser Use Agent.

    Returns:
        AgentCard with skills and capabilities
    """
    runtime_url = os.environ.get('AGENTCORE_RUNTIME_URL', f'http://127.0.0.1:{PORT}/')

    return AgentCard(
        name='Browser Use Agent',
        description='Autonomous browser automation agent powered by browser-use library. Executes complex multi-step browser tasks with AI-driven adaptive navigation.',
        url=runtime_url,
        version='1.0.0',
        default_input_modes=['text'],
        default_output_modes=['text'],
        capabilities=AgentCapabilities(
            streaming=True,
            supports_authenticated_extended_card=False
        ),
        skills=[
            AgentSkill(
                id='browser_automation',
                name='Browser Automation',
                description='Execute multi-step browser tasks: navigate websites, interact with elements, fill forms, extract information. Uses AI-driven decision making for adaptive navigation.',
                tags=['browser', 'automation', 'web', 'scraping', 'navigation'],
                examples=[
                    'Navigate to amazon.com and search for AWS Bedrock pricing',
                    'Go to github.com and find the most popular Python repository',
                    'Fill out the contact form on example.com with name and email',
                    'Extract the latest news headlines from news.ycombinator.com',
                    'Search Google for "browser automation tools" and summarize the top 3 results'
                ]
            )
        ]
    )


def create_app() -> FastAPI:
    """
    Create FastAPI application with A2A server.

    Returns:
        FastAPI application instance
    """
    # Create FastAPI app
    app = FastAPI(
        title="Browser Use Agent A2A Server",
        description=(
            "Autonomous browser automation agent powered by browser-use library. "
            "Executes complex multi-step browser tasks with AI-driven adaptive navigation. "
            "Uses AWS Bedrock models for LLM capabilities."
        ),
        version="1.0.0"
    )

    # Create Agent Card
    agent_card = create_agent_card()
    logger.info(f"Agent Card created: {agent_card.name}")

    # Create AgentExecutor
    executor = BrowserUseAgentExecutor()
    logger.info("BrowserUseAgentExecutor created")

    # Create Task Store
    task_store = InMemoryTaskStore()

    # Create Request Handler
    request_handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=task_store
    )
    logger.info("DefaultRequestHandler created")

    # Create A2A Server
    a2a_server = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler
    )
    logger.info("A2A Starlette Application created")

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        """Health check endpoint for AgentCore Runtime"""
        return {
            "status": "healthy",
            "agent_type": "browser-use",
            "llm_provider": "aws_bedrock",
            "default_model": DEFAULT_MODEL_ID,
            "cached_models": list(llm_cache.keys()),
        }

    @app.get("/ping")
    async def ping():
        """Simple ping endpoint for Docker healthcheck"""
        return {"status": "ok"}

    # Mount A2A server at root (handles /.well-known/agent-card.json, etc.)
    # This provides AgentCore Runtime API contract
    starlette_app = a2a_server.build()
    app.mount("/", starlette_app)

    logger.info("A2A server mounted at root")
    logger.info(f"Agent Card will be available at: {agent_card.url}.well-known/agent-card.json")

    return app


# Create app instance
app = create_app()


def main():
    """Run the A2A server"""
    logger.info(f"Starting Browser Use Agent A2A Server on port {PORT}")
    logger.info(f"Default model: {DEFAULT_MODEL_ID}")
    logger.info(f"AWS Region: {AWS_REGION}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )


if __name__ == "__main__":
    main()
