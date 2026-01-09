"""
Generate Chart Tool

Generate chart images using Bedrock Code Interpreter.
Charts are generated from markers in the draft and saved as PNG files.
"""

import json
import logging
import os
import threading
from typing import Optional
from strands import tool
from strands.types.tools import ToolContext

logger = logging.getLogger(__name__)

# Global lock to prevent parallel chart generation (avoids race conditions on research_report.md)
_chart_generation_lock = threading.Lock()


def _get_code_interpreter_id() -> Optional[str]:
    """Get Custom Code Interpreter ID from environment or Parameter Store."""
    # 1. Check environment variable
    code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
    if code_interpreter_id:
        logger.info(f"Found CODE_INTERPRETER_ID in environment: {code_interpreter_id}")
        return code_interpreter_id

    # 2. Try Parameter Store (for local development)
    try:
        import boto3
        project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
        environment = os.getenv('ENVIRONMENT', 'dev')
        region = os.getenv('AWS_REGION', 'us-west-2')
        param_name = f"/{project_name}/{environment}/agentcore/code-interpreter-id"

        logger.info(f"Checking Parameter Store: {param_name}")
        ssm = boto3.client('ssm', region_name=region)
        response = ssm.get_parameter(Name=param_name)
        code_interpreter_id = response['Parameter']['Value']
        logger.info(f"Found CODE_INTERPRETER_ID in Parameter Store: {code_interpreter_id}")
        return code_interpreter_id
    except Exception as e:
        logger.warning(f"Code Interpreter ID not found in Parameter Store: {e}")
        return None


@tool(context=True)
def generate_chart_tool(
    chart_id: str,
    python_code: str,
    insert_at_line: int,
    tool_context: ToolContext
) -> str:
    """
    Generate a chart to visualize quantitative data and enhance research comprehension.

    **When to use this tool:**
    Use when you encounter numerical/statistical data that would be clearer with visualization:
    - Market statistics (growth rates, market share, revenue trends, industry size)
    - Comparative data (company performance, regional differences, before/after comparisons)
    - Time series data (historical trends, year-over-year changes, projections)
    - Statistical distributions (age demographics, survey results, adoption rates)
    - Performance metrics (benchmarks, KPIs, efficiency scores)
    - Ranking data (top players, league tables, competitive positioning)

    **Do NOT use for:**
    - Qualitative information (use text descriptions instead)
    - Simple yes/no or binary data
    - Data that's already clear in text format

    Creates professional charts using Python/matplotlib via Bedrock Code Interpreter
    and uploads to S3 with user_id/session_id organization.

    Args:
        chart_id: Chart filename without extension (e.g., "ai_market_growth_2020_2024")
                 Use descriptive names. Will be saved as {chart_id}.png
        python_code: Complete Python code for chart generation.
                    Must include: plt.savefig('{chart_id}.png', dpi=300, bbox_inches='tight')

                    Available libraries: matplotlib, seaborn, pandas, numpy

                    Example:
                    ```python
                    import matplotlib.pyplot as plt

                    # Quantitative data from research
                    data = [150, 220, 180, 250]
                    labels = ['Q1', 'Q2', 'Q3', 'Q4']

                    plt.figure(figsize=(10, 6))
                    plt.bar(labels, data, color='steelblue')
                    plt.title('Quarterly Revenue Growth', fontsize=14, fontweight='bold')
                    plt.xlabel('Quarter')
                    plt.ylabel('Revenue ($M)')
                    plt.grid(axis='y', alpha=0.3)
                    plt.savefig('ai_market_growth_2020_2024.png', dpi=300, bbox_inches='tight')
                    ```
        insert_at_line: Line number where chart should be inserted (after this line)
                       Use read_markdown_file to see current content and choose location

    Returns:
        JSON string with operation result and S3 key

    Example:
        generate_chart_tool(
            chart_id="ai_market_growth_2020_2024",
            python_code="import matplotlib.pyplot as plt\\n...",
            insert_at_line=45
        )
    """
    # Acquire lock to prevent race conditions when modifying research_report.md
    with _chart_generation_lock:
        logger.info(f"[generate_chart] Acquired lock for {chart_id}")
        try:
            from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

            # Get session_id from invocation_state
            # Use event_loop_parent_cycle_id as the session identifier (consistent across all tools in the request)
            invocation_state = tool_context.invocation_state
            session_id = None
            user_id = "default_user"

            if invocation_state:
                # First try to get explicit session_id and user_id from request_state
                request_state = invocation_state.get("request_state", {})
                session_id = request_state.get("session_id")
                user_id = request_state.get("user_id", "default_user")

                # Fallback: use event_loop_parent_cycle_id (consistent across all tool calls in the same request)
                if not session_id:
                    parent_cycle_id = invocation_state.get("event_loop_parent_cycle_id")
                    if parent_cycle_id:
                        session_id = str(parent_cycle_id)
                        logger.info(f"[generate_chart] Using event_loop_parent_cycle_id as session_id: {session_id}")
                    else:
                        # Second fallback: use event_loop_cycle_id if parent not available (first tool call)
                        cycle_id = invocation_state.get("event_loop_cycle_id")
                        if cycle_id:
                            session_id = str(cycle_id)
                            logger.info(f"[generate_chart] Using event_loop_cycle_id as session_id: {session_id}")

            if not session_id:
                logger.error("[generate_chart] No session_id or event_loop_cycle_id found")
                return json.dumps({
                    "status": "error",
                    "message": "No session identifier found in context"
                })

            logger.info(f"[generate_chart] Session ID: {session_id}, User ID: {user_id}")

            # Get report manager
            from report_manager import get_report_manager
            manager = get_report_manager(session_id, user_id)

            # Validate chart_id
            if not chart_id or not chart_id.replace('_', '').isalnum():
                return json.dumps({
                    "status": "error",
                    "message": f"Invalid chart_id: {chart_id}. Use alphanumeric and underscores only."
                })

            filename = f"{chart_id}.png"

            # Get Code Interpreter ID
            code_interpreter_id = _get_code_interpreter_id()

            if not code_interpreter_id:
                return json.dumps({
                    "status": "error",
                    "message": "Code Interpreter ID not found. Deploy AgentCore Runtime Stack first."
                })

            # Initialize Code Interpreter
            region = os.getenv('AWS_REGION', 'us-west-2')
            code_interpreter = CodeInterpreter(region)

            logger.info(f"[generate_chart] Starting Code Interpreter for {chart_id}")
            code_interpreter.start(identifier=code_interpreter_id)

            try:
                # Execute Python code
                logger.info(f"[generate_chart] Executing code for {filename}")
                response = code_interpreter.invoke("executeCode", {
                    "code": python_code,
                    "language": "python",
                    "clearContext": False
                })

                # Check for errors
                execution_success = False
                for event in response.get("stream", []):
                    result = event.get("result", {})
                    if result.get("isError", False):
                        error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                        logger.error(f"Code execution failed: {error_msg[:200]}")
                        return json.dumps({
                            "status": "error",
                            "message": f"Python code execution failed: {error_msg[:500]}"
                        })
                    execution_success = True

                if not execution_success:
                    return json.dumps({
                        "status": "error",
                        "message": "No result from Code Interpreter"
                    })

                # Download generated file
                logger.info(f"[generate_chart] Downloading {filename}")
                file_content = None

                download_response = code_interpreter.invoke("readFiles", {"paths": [filename]})

                for event in download_response.get("stream", []):
                    result = event.get("result", {})
                    if "content" in result and len(result["content"]) > 0:
                        content_block = result["content"][0]
                        if "data" in content_block:
                            file_content = content_block["data"]
                        elif "resource" in content_block and "blob" in content_block["resource"]:
                            file_content = content_block["resource"]["blob"]

                        if file_content:
                            break

                if not file_content:
                    return json.dumps({
                        "status": "error",
                        "message": f"Chart file '{filename}' not found. Make sure your code saves to '{filename}'."
                    })

                # Save chart to workspace and S3
                save_result = manager.save_chart(chart_id, file_content)
                chart_path = save_result['local_path']
                s3_key = save_result['s3_key']

                # Insert chart at specified line
                draft_content = manager.read_draft()
                if not draft_content:
                    return json.dumps({
                        "status": "error",
                        "message": "Draft document not found"
                    })

                lines = draft_content.split('\n')
                total_lines = len(lines)

                # Validate line number
                if insert_at_line < 1 or insert_at_line > total_lines:
                    return json.dumps({
                        "status": "error",
                        "message": f"Invalid line number: {insert_at_line}. Document has {total_lines} lines."
                    })

                # Create chart markdown with S3 key (required)
                # Note: Include trailing blank line to ensure next section heading parses correctly
                chart_title = chart_id.replace('_', ' ').title()
                if not s3_key:
                    raise ValueError(f"S3 key is missing for chart {chart_id}. S3 upload is required.")

                chart_markdown = f"\n![{chart_title}]({s3_key})\n*Figure: {chart_title}*\n"
                logger.info(f"[generate_chart] Using S3 key for chart: {s3_key}")

                # Insert after specified line (convert to 0-indexed)
                lines.insert(insert_at_line, chart_markdown)
                updated_content = '\n'.join(lines)
                manager.save_draft(updated_content)

                file_size_kb = len(file_content) / 1024
                logger.info(f"[generate_chart] Chart saved and inserted at line {insert_at_line}: {chart_path} ({file_size_kb:.1f} KB)")

                return json.dumps({
                    "status": "success",
                    "message": f"Chart '{chart_id}' generated and inserted at line {insert_at_line} ({file_size_kb:.1f} KB)",
                    "chart_id": chart_id,
                    "local_path": chart_path,
                    "s3_key": s3_key,
                    "inserted_at_line": insert_at_line
                })

            finally:
                code_interpreter.stop()

        except ImportError:
            logger.error("bedrock_agentcore not installed")
            return json.dumps({
                "status": "error",
                "message": "bedrock_agentcore package not installed. Install with: pip install bedrock-agentcore"
            })

        except Exception as e:
            import traceback
            logger.error(f"Error generating chart: {e}")
            return json.dumps({
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()[:500]
            })
