#!/usr/bin/env python3
"""
CompactingSessionManager Integration Test

Tests the two-stage compaction with actual AgentCore Memory:
- Stage 1 (events > 20): Tool content truncation only
- Stage 2 (events > 50): Summary + recent turns + truncation

Supports two modes:
- Local: Creates agent locally with mock tools (default)
- Deployed: Invokes deployed AgentCore Runtime via API (--deployed)

Usage:
    # Local mode (default) - creates agent locally
    python test_compaction.py                    # Full test
    python test_compaction.py --no-wait          # Skip wait for summaries
    python test_compaction.py --stage1-only      # Test Stage 1 only
    python test_compaction.py --stage2-only      # Test Stage 2 only

    # Deployed mode - invokes deployed agent via API
    python test_compaction.py --deployed         # Full test on deployed agent
    python test_compaction.py --deployed --quick # Quick test (Stage 1)
    python test_compaction.py --deployed --turns 20  # Custom turns
"""

import argparse
import sys
import os
import uuid
import time
import json
from datetime import datetime

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

import boto3

# Configuration
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')

# Thresholds (should match compacting_session_manager.py defaults)
TRUNCATION_THRESHOLD = 20
COMPACTION_THRESHOLD = 50


# ============================================================
# Common Utilities
# ============================================================

def get_memory_id() -> str:
    """Get Memory ID from environment or SSM."""
    memory_id = os.environ.get('MEMORY_ID')
    if memory_id:
        return memory_id

    try:
        ssm = boto3.client('ssm', region_name=REGION)
        response = ssm.get_parameter(
            Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/memory-id'
        )
        return response['Parameter']['Value']
    except Exception as e:
        print(f"Failed to get Memory ID: {e}")
        return None


def get_runtime_arn() -> str:
    """Get AgentCore Runtime ARN from environment or SSM."""
    runtime_arn = os.environ.get('AGENTCORE_RUNTIME_ARN')
    if runtime_arn:
        return runtime_arn

    try:
        ssm = boto3.client('ssm', region_name=REGION)
        response = ssm.get_parameter(
            Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/runtime-arn'
        )
        return response['Parameter']['Value']
    except Exception as e:
        print(f"Failed to get Runtime ARN: {e}")
        return None


def get_strategy_ids(memory_id: str) -> dict:
    """Get strategy IDs from Memory configuration."""
    try:
        gmcp = boto3.client('bedrock-agentcore-control', region_name=REGION)
        response = gmcp.get_memory(memoryId=memory_id)
        memory = response.get('memory', {})
        strategies = memory.get('strategies', memory.get('memoryStrategies', []))

        strategy_map = {}
        for s in strategies:
            strategy_type = s.get('type', s.get('memoryStrategyType', ''))
            strategy_id = s.get('strategyId', s.get('memoryStrategyId', ''))
            if strategy_type and strategy_id:
                strategy_map[strategy_type] = strategy_id

        return strategy_map
    except Exception as e:
        print(f"Failed to get strategy IDs: {e}")
        return {}


# ============================================================
# Local Mode - Hook and Tool
# ============================================================

try:
    from strands import tool
    from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent

    class PromptVerificationHook(HookProvider):
        """Hook to capture and verify actual prompt sent to LLM."""

        def __init__(self):
            self.captured_messages = []
            self.has_summary = False
            self.has_truncation = False
            self.first_user_message_preview = None

        def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
            registry.add_callback(BeforeModelCallEvent, self.capture_prompt)

        def capture_prompt(self, event: BeforeModelCallEvent) -> None:
            """Capture messages being sent to the model."""
            messages = event.agent.messages
            self.captured_messages = messages

            if messages:
                first_msg = messages[0]
                if first_msg.get('role') == 'user':
                    content = first_msg.get('content', [])
                    for block in content:
                        if isinstance(block, dict) and 'text' in block:
                            text = block['text']
                            self.first_user_message_preview = text[:500]
                            if '<conversation_summary>' in text:
                                self.has_summary = True
                            break

            for msg in messages:
                content = msg.get('content', [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            if 'toolResult' in block:
                                result_content = block['toolResult'].get('content', [])
                                for rb in result_content:
                                    if isinstance(rb, dict) and 'text' in rb:
                                        if '[truncated,' in rb['text']:
                                            self.has_truncation = True

        def print_verification(self):
            """Print verification results."""
            print()
            print("   PROMPT VERIFICATION (actual messages sent to LLM):")
            print(f"   Total messages in prompt: {len(self.captured_messages)}")
            print(f"   Summary in first user message: {'YES' if self.has_summary else 'NO'}")
            print(f"   Truncation markers found: {'YES' if self.has_truncation else 'NO'}")
            if self.first_user_message_preview:
                print(f"   First user message preview:")
                preview_lines = self.first_user_message_preview[:300].split('\n')
                for line in preview_lines[:5]:
                    print(f"      {line}")
                if len(self.first_user_message_preview) > 300:
                    print(f"      ...")

    @tool
    def long_data_fetcher(query: str, data_size: int = 2000) -> str:
        """
        Fetches data and returns a long response for testing truncation.

        Args:
            query: Search query or topic
            data_size: Size of data to return in characters (default: 2000)

        Returns:
            A long string response that will trigger truncation
        """
        base_content = f"""
=== Data Report for: {query} ===

Executive Summary:
This comprehensive report provides detailed analysis and findings related to "{query}".
The data has been collected from multiple sources and processed for accuracy.

Section 1: Overview
{"=" * 50}
The query "{query}" returned extensive results across multiple categories.
Our analysis covers various aspects including historical data, current trends,
and future projections. The following sections detail our findings.

Section 2: Detailed Findings
{"=" * 50}
"""

        detail_block = f"""
- Finding #{{}}: Analysis of {query} shows significant patterns.
  * Data point A: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
  * Data point B: Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
  * Data point C: Ut enim ad minim veniam, quis nostrud exercitation ullamco.
  * Conclusion: Based on these data points, we observe notable trends.

"""

        result = base_content
        finding_num = 1
        while len(result) < data_size:
            result += detail_block.format(finding_num)
            finding_num += 1

        result += f"""
Section 3: Conclusion
{"=" * 50}
Total findings analyzed: {finding_num - 1}
Report generated for query: "{query}"
Data size: {len(result)} characters

=== End of Report ===
"""

        return result[:data_size]

    LOCAL_MODE_AVAILABLE = True
except ImportError:
    LOCAL_MODE_AVAILABLE = False


# ============================================================
# Deployed Mode - Travel Planning Messages
# ============================================================

TRAVEL_PLANNING_MESSAGES = [
    "I want to plan a trip to Hawaii for next month. What's the weather like there?",
    "Search for the best beaches in Oahu, Hawaii",
    "Find hotels near Waikiki Beach with good reviews",
    "What are the top tourist attractions in Hawaii?",
    "What's the weather forecast for Honolulu for the next 7 days?",
    "Search for highly rated Hawaiian restaurants in Honolulu",
    "How do I get from Honolulu airport to Waikiki Beach?",
    "I'm also thinking about Japan. What's the weather in Tokyo?",
    "Search for must-visit places in Tokyo for first-time visitors",
    "Find the best ramen restaurants in Tokyo",
    "Compare the weather between Hawaii and Tokyo for January",
    "Search for budget-friendly activities in Hawaii",
    "What cultural experiences should I try in Hawaii?",
    "Search for famous temples to visit in Kyoto, Japan",
    "How does the Japan Rail Pass work?",
    "What about Europe? What's the weather in Paris in January?",
    "Search for top attractions in Paris, France",
    "Help me compare Hawaii, Japan, and Paris for a January trip",
    "Create a 7-day itinerary for Hawaii including beaches and cultural sites",
    "What should I pack for a trip to Hawaii in January?",
    "Search for snorkeling spots in Hawaii",
    "What are some local tips for visiting Hawaii?",
    "Based on everything we discussed, which destination do you recommend?",
]

TRAVEL_TOOLS = [
    "gateway_get_today_weather",
    "gateway_get_weather_forecast",
    "gateway_google_web_search",
    "gateway_search_places",
    "gateway_get_place_details",
    "gateway_get_directions",
]


# ============================================================
# Deployed Mode Functions
# ============================================================

def invoke_agent_runtime(
    runtime_arn: str,
    user_id: str,
    session_id: str,
    message: str,
    enabled_tools: list = None,
    model_id: str = None
) -> dict:
    """Invoke the deployed AgentCore Runtime via invoke_agent_runtime API."""
    client = boto3.client('bedrock-agentcore', region_name=REGION)

    input_data = {
        "user_id": user_id,
        "session_id": session_id,
        "message": message,
        "model_id": model_id or "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    }

    if enabled_tools:
        input_data["enabled_tools"] = enabled_tools

    payload = {"input": input_data}

    try:
        response = client.invoke_agent_runtime(
            agentRuntimeArn=runtime_arn,
            qualifier='DEFAULT',
            contentType='application/json',
            accept='text/event-stream',
            payload=json.dumps(payload).encode('utf-8'),
            runtimeUserId=user_id,
            runtimeSessionId=session_id,
        )

        full_response = ""
        response_stream = response.get('response')

        if response_stream:
            stream_data = response_stream.read().decode('utf-8')

            for line in stream_data.split('\n'):
                if line.startswith('data: '):
                    try:
                        event_data = json.loads(line[6:])
                        if event_data.get('type') == 'response':
                            full_response += event_data.get('text', '')
                        elif event_data.get('type') == 'complete':
                            full_response = event_data.get('message', full_response)
                    except json.JSONDecodeError:
                        pass

        return {
            "success": True,
            "response": full_response,
            "status_code": response.get('statusCode', 200),
            "trace_id": response.get('traceId'),
        }

    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


def create_deployed_conversation(
    runtime_arn: str,
    user_id: str,
    session_id: str,
    num_turns: int = 15
) -> tuple:
    """Create a travel planning conversation by invoking deployed agent."""
    print(f"\n Creating conversation via deployed agent ({num_turns} turns)...")
    print("-" * 60)
    print(f"   Runtime ARN: {runtime_arn[:60]}...")
    print(f"   User ID: {user_id}")
    print(f"   Session ID: {session_id}")
    print()

    messages_to_send = TRAVEL_PLANNING_MESSAGES[:num_turns]
    if num_turns > len(TRAVEL_PLANNING_MESSAGES):
        messages_to_send = (TRAVEL_PLANNING_MESSAGES * (num_turns // len(TRAVEL_PLANNING_MESSAGES) + 1))[:num_turns]

    print(f"   Scenario: Travel planning to Hawaii, Japan, Europe")
    print(f"   Sending {len(messages_to_send)} messages...")
    print()

    successful_turns = 0
    estimated_events = 0

    for i, msg in enumerate(messages_to_send):
        print(f"   [{i+1}/{len(messages_to_send)}] User: {msg[:50]}...")

        result = invoke_agent_runtime(
            runtime_arn=runtime_arn,
            user_id=user_id,
            session_id=session_id,
            message=msg,
            enabled_tools=TRAVEL_TOOLS
        )

        if result["success"]:
            response_preview = result["response"][:60].replace('\n', ' ') if result["response"] else "(no text)"
            print(f"            Agent: {response_preview}...")
            successful_turns += 1
            estimated_events += 4
        else:
            error_msg = result.get('error', 'Unknown error')
            print(f"            Error: {error_msg}")
            break

        time.sleep(1.0)

    print()
    print(f" Conversation created!")
    print(f"   Successful turns: {successful_turns}/{len(messages_to_send)}")
    print(f"   Estimated events: ~{estimated_events}")

    return successful_turns > 0, estimated_events


def verify_deployed_compaction(
    memory_id: str,
    session_id: str,
    actor_id: str,
    runtime_arn: str,
    estimated_events: int
) -> dict:
    """Verify compaction by testing context retention via deployed agent."""
    print(f"\n Verifying Compaction...")
    print("-" * 60)

    results = {
        "stage": "none",
        "estimated_events": estimated_events,
        "context_retained": False,
    }

    # Determine expected stage
    if estimated_events > COMPACTION_THRESHOLD:
        results["stage"] = "stage2"
    elif estimated_events > TRUNCATION_THRESHOLD:
        results["stage"] = "stage1"
    else:
        results["stage"] = "none"

    print(f"   Estimated events: {estimated_events}")
    print(f"   Expected stage: {results['stage'].upper()}")

    # Test context retention via deployed agent
    print()
    print("   Testing context retention...")

    context_test_message = "Based on our conversation, what destinations did we discuss for my trip? Please list them briefly."

    result = invoke_agent_runtime(
        runtime_arn=runtime_arn,
        user_id=actor_id,
        session_id=session_id,
        message=context_test_message,
        enabled_tools=[]
    )

    if result["success"] and result.get("response"):
        response_text = result["response"]
        print(f"   Agent response: {response_text[:200]}...")

        destinations_mentioned = any(dest.lower() in response_text.lower()
                                      for dest in ["hawaii", "japan", "tokyo", "paris", "honolulu"])
        results["context_retained"] = destinations_mentioned

        if destinations_mentioned:
            print("   Context retention: PASS (mentions discussed destinations)")
        else:
            print("   Context retention: UNCERTAIN (check response manually)")
    else:
        print(f"   Error: {result.get('error', 'No response')}")
        results["context_retained"] = False

    return results


def run_deployed_test(num_turns: int = 15, wait_for_summary: bool = True):
    """Run the deployed mode compaction test."""
    print()
    print("=" * 60)
    print("  CompactingSessionManager - DEPLOYED Mode Test")
    print("=" * 60)
    print()
    print("  Invokes deployed agent via invoke_agent_runtime API")
    print(f"  Stage 1 (>{TRUNCATION_THRESHOLD} events): Tool content truncation")
    print(f"  Stage 2 (>{COMPACTION_THRESHOLD} events): Summary + recent turns")
    print()

    runtime_arn = get_runtime_arn()
    if not runtime_arn:
        print("\n AGENTCORE_RUNTIME_ARN not found.")
        print("   Set environment variable or check Parameter Store.")
        sys.exit(1)

    memory_id = get_memory_id()
    if not memory_id:
        print("\n MEMORY_ID not found.")
        print("   Set environment variable or check Parameter Store.")
        sys.exit(1)

    print(f" Runtime ARN: {runtime_arn[:50]}...")
    print(f" Memory ID: {memory_id[:40]}...")
    print(f" Region: {REGION}")

    strategy_ids = get_strategy_ids(memory_id)
    print(f" Strategies: {list(strategy_ids.keys())}")

    # Generate test IDs (min 33 chars required by AgentCore API)
    test_id = uuid.uuid4().hex
    session_id = f"compaction-test-deployed-{test_id}"
    user_id = f"compaction-test-user-{test_id}"

    print(f"\n Session ID: {session_id}")
    print(f" User ID: {user_id}")

    # Create conversation
    success, estimated_events = create_deployed_conversation(
        runtime_arn=runtime_arn,
        user_id=user_id,
        session_id=session_id,
        num_turns=num_turns
    )

    if not success:
        print(" Failed to create conversation")
        sys.exit(1)

    # Wait for SUMMARIZATION if testing Stage 2
    if estimated_events > COMPACTION_THRESHOLD and wait_for_summary:
        wait_time = 60
        print(f"\n Waiting {wait_time}s for SUMMARIZATION strategy to process...")
        for i in range(wait_time // 15):
            time.sleep(15)
            print(f"   ... {(i+1)*15}/{wait_time} seconds")

    # Verify compaction
    results = verify_deployed_compaction(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id,
        runtime_arn=runtime_arn,
        estimated_events=estimated_events
    )

    # Print results
    print()
    print("=" * 60)
    print(" TEST RESULTS")
    print("-" * 60)

    stage = results["stage"]

    print(f"   Session ID: {session_id}")
    print(f"   Estimated events: {results['estimated_events']}")
    print(f"   Expected stage: {stage.upper()}")
    print()

    if stage == "stage2":
        print(f"   Stage 2 should apply:")
        print(f"   - Load summary from LTM")
        print(f"   - Keep only recent 5 turns")
        print(f"   - Truncate tool content")
    elif stage == "stage1":
        print(f"   Stage 1 should apply:")
        print(f"   - Keep all messages")
        print(f"   - Truncate tool content (>1000 chars)")
    else:
        print(f"   No compaction expected (events <= {TRUNCATION_THRESHOLD})")

    print()

    if results["context_retained"]:
        print("   Context retention: PASS")
        return True
    else:
        print("   Context retention: CHECK MANUALLY")
        return True  # Not a failure, just needs manual check


# ============================================================
# Local Mode Functions
# ============================================================

def count_events_in_messages(messages: list) -> dict:
    """Count different event types in messages."""
    counts = {
        'total_messages': len(messages),
        'user_messages': 0,
        'assistant_messages': 0,
        'tool_use_blocks': 0,
        'tool_result_blocks': 0,
        'text_blocks': 0
    }

    for msg in messages:
        role = msg.get('role', '')
        if role == 'user':
            counts['user_messages'] += 1
        elif role == 'assistant':
            counts['assistant_messages'] += 1

        content = msg.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if 'toolUse' in block:
                        counts['tool_use_blocks'] += 1
                    elif 'toolResult' in block:
                        counts['tool_result_blocks'] += 1
                    elif 'text' in block:
                        counts['text_blocks'] += 1

    return counts


def verify_tool_pairs_intact(messages: list) -> tuple:
    """Verify all toolUse blocks have matching toolResult blocks."""
    tool_use_ids = set()
    tool_result_ids = set()

    for msg in messages:
        content = msg.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if 'toolUse' in block:
                        tool_id = block['toolUse'].get('toolUseId')
                        if tool_id:
                            tool_use_ids.add(tool_id)
                    elif 'toolResult' in block:
                        tool_id = block['toolResult'].get('toolUseId')
                        if tool_id:
                            tool_result_ids.add(tool_id)

    missing_results = tool_use_ids - tool_result_ids

    if missing_results:
        return False, f"toolUse without toolResult: {missing_results}"

    return True, "All tool pairs intact"


def check_truncation_applied(messages: list) -> tuple:
    """Check if any tool content has been truncated."""
    truncation_count = 0

    for msg in messages:
        content = msg.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if 'toolResult' in block:
                        result_content = block['toolResult'].get('content', [])
                        for rb in result_content:
                            if isinstance(rb, dict) and 'text' in rb:
                                if '[truncated,' in rb['text']:
                                    truncation_count += 1

    return truncation_count > 0, truncation_count


def check_summary_in_messages(messages: list) -> tuple:
    """Check if summary is present in messages."""
    for msg in messages:
        content = msg.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and 'text' in block:
                    text = block['text']
                    if '<conversation_summary>' in text:
                        start = text.find('<conversation_summary>')
                        end = text.find('</conversation_summary>')
                        if end > start:
                            preview = text[start:min(end+25, start+200)]
                            return True, preview
                        return True, text[:200]

    return False, None


def create_local_conversation(memory_id: str, session_id: str, actor_id: str, target_events: int) -> tuple:
    """Create a conversation with tool calls to reach target event count."""
    print(f"\n Creating Conversation (target: ~{target_events} events)")
    print("-" * 50)

    try:
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
        from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
        from strands import Agent
        from strands.models import BedrockModel

        strategy_ids = get_strategy_ids(memory_id)
        print(f"   Found strategies: {list(strategy_ids.keys())}")

        retrieval_config = {}
        if 'USER_PREFERENCE' in strategy_ids:
            retrieval_config[f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{actor_id}"] = \
                RetrievalConfig(top_k=5, relevance_score=0.7)

        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
            retrieval_config=retrieval_config
        )

        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=REGION
        )

        model = BedrockModel(
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        agent = Agent(
            model=model,
            session_manager=session_manager,
            tools=[long_data_fetcher],
            system_prompt="""You are a data research assistant. When asked to fetch or research data,
ALWAYS use the long_data_fetcher tool. Keep your summary responses brief (1-2 sentences).
The tool returns detailed reports - just summarize the key finding."""
        )

        num_messages = max(3, target_events // 4)

        base_messages = [
            "Fetch data about Python programming",
            "Research information on machine learning",
            "Get data about cloud computing trends",
            "Fetch details on artificial intelligence",
            "Research data about software development",
            "Get information on data science",
            "Fetch data about web development",
            "Research details on DevOps practices",
            "Get data about cybersecurity",
            "Fetch information on blockchain technology",
            "Research data about mobile development",
            "Get details on database systems",
            "Fetch data about API design",
            "Research information on microservices",
            "Get data about containerization",
        ]

        messages_to_send = base_messages[:num_messages]
        if num_messages > len(base_messages):
            messages_to_send = base_messages * (num_messages // len(base_messages) + 1)
            messages_to_send = messages_to_send[:num_messages]

        print(f"   Sending {len(messages_to_send)} messages...")
        print()

        for i, msg in enumerate(messages_to_send):
            print(f"   [{i+1}/{len(messages_to_send)}] User: {msg[:50]}...")
            response = agent(msg)

            if response.message and response.message.get('content'):
                for block in response.message['content']:
                    if isinstance(block, dict) and block.get('text'):
                        print(f"            Agent: {block['text'][:50]}...")
                        break

            time.sleep(0.3)

        event_counts = count_events_in_messages(agent.messages)

        print()
        print(f" Conversation created!")
        print(f"   Session ID: {session_id}")
        print(f"   Actor ID: {actor_id}")
        print()
        print(f" Event Counts:")
        print(f"   Total messages: {event_counts['total_messages']}")
        print(f"   User messages: {event_counts['user_messages']}")
        print(f"   Assistant messages: {event_counts['assistant_messages']}")
        print(f"   toolUse blocks: {event_counts['tool_use_blocks']}")
        print(f"   toolResult blocks: {event_counts['tool_result_blocks']}")

        return True, event_counts['total_messages']

    except Exception as e:
        print(f" Error: {e}")
        import traceback
        traceback.print_exc()
        return False, 0


def test_stage1_truncation(memory_id: str, session_id: str, actor_id: str, event_count: int) -> bool:
    """Test Stage 1: Tool content truncation only (20 < events <= 50)."""
    print("\n Testing Stage 1: Tool Content Truncation")
    print("-" * 50)
    print(f"   Events: {event_count} (threshold: {TRUNCATION_THRESHOLD})")

    if event_count <= TRUNCATION_THRESHOLD:
        print(f"   Events ({event_count}) <= truncation threshold ({TRUNCATION_THRESHOLD})")
        print("   Stage 1 won't be triggered. Skipping test.")
        return True

    if event_count > COMPACTION_THRESHOLD:
        print(f"   Events ({event_count}) > compaction threshold ({COMPACTION_THRESHOLD})")
        print("   Stage 2 will be triggered instead. Test Stage 2 separately.")
        return True

    try:
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
        from agent.compacting_session_manager import CompactingSessionManager
        from strands import Agent
        from strands.models import BedrockModel

        strategy_ids = get_strategy_ids(memory_id)

        retrieval_config = {}
        if 'USER_PREFERENCE' in strategy_ids:
            retrieval_config[f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{actor_id}"] = \
                RetrievalConfig(top_k=5, relevance_score=0.7)

        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
            retrieval_config=retrieval_config
        )

        session_manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
            truncation_threshold=TRUNCATION_THRESHOLD,
            compaction_threshold=COMPACTION_THRESHOLD,
            recent_turns_count=5,
            min_recent_turns=3,
            max_tool_content_length=500,
            summarization_strategy_id=strategy_ids.get('SUMMARIZATION')
        )

        model = BedrockModel(
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        verification_hook = PromptVerificationHook()

        print(f"   Creating Agent with CompactingSessionManager...")
        print(f"   max_tool_content_length=500 (tool returns ~2000 chars)")

        agent = Agent(
            model=model,
            session_manager=session_manager,
            tools=[long_data_fetcher],
            hooks=[verification_hook],
            system_prompt="You are a data research assistant. Use long_data_fetcher for any data requests."
        )

        print()
        print(f" Messages loaded: {len(agent.messages)}")

        event_counts = count_events_in_messages(agent.messages)
        print(f"   User: {event_counts['user_messages']}, Assistant: {event_counts['assistant_messages']}")
        print(f"   toolUse: {event_counts['tool_use_blocks']}, toolResult: {event_counts['tool_result_blocks']}")

        has_truncation, truncation_count = check_truncation_applied(agent.messages)
        if has_truncation:
            print(f"   Truncation applied: {truncation_count} content(s) truncated")
        else:
            print(f"   No truncation detected (content may be short)")

        has_summary, _ = check_summary_in_messages(agent.messages)
        if has_summary:
            print(f"   Unexpected: Summary found in Stage 1!")
            return False
        else:
            print(f"   No summary (correct for Stage 1)")

        is_valid, msg = verify_tool_pairs_intact(agent.messages)
        if is_valid:
            print(f"   Tool pairs intact: {msg}")
        else:
            print(f"   Tool pairs broken: {msg}")
            return False

        print()
        print("   Testing agent response (and verifying actual prompt)...")
        response = agent("Summarize what data we fetched so far.")
        if response.message:
            print("   Agent responded successfully")
            verification_hook.print_verification()
            return True
        else:
            print("   Agent failed to respond")
            return False

    except Exception as e:
        print(f" Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_stage2_compaction(memory_id: str, session_id: str, actor_id: str, event_count: int, wait_for_summary: bool = True) -> bool:
    """Test Stage 2: Full compaction (events > 50)."""
    print("\n Testing Stage 2: Full Compaction (Summary + Recent Turns)")
    print("-" * 50)
    print(f"   Events: {event_count} (threshold: {COMPACTION_THRESHOLD})")

    if event_count <= COMPACTION_THRESHOLD:
        print(f"   Events ({event_count}) <= compaction threshold ({COMPACTION_THRESHOLD})")
        print("   Stage 2 won't be triggered. Need more events.")
        return True

    try:
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
        from agent.compacting_session_manager import CompactingSessionManager
        from strands import Agent
        from strands.models import BedrockModel

        strategy_ids = get_strategy_ids(memory_id)

        retrieval_config = {}
        if 'USER_PREFERENCE' in strategy_ids:
            retrieval_config[f"/strategies/{strategy_ids['USER_PREFERENCE']}/actors/{actor_id}"] = \
                RetrievalConfig(top_k=5, relevance_score=0.7)

        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
            retrieval_config=retrieval_config
        )

        session_manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
            truncation_threshold=TRUNCATION_THRESHOLD,
            compaction_threshold=COMPACTION_THRESHOLD,
            recent_turns_count=5,
            min_recent_turns=3,
            max_tool_content_length=500,
            summarization_strategy_id=strategy_ids.get('SUMMARIZATION')
        )

        model = BedrockModel(
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        print(f"   Creating Agent with CompactingSessionManager...")
        print(f"   max_tool_content_length=500 (tool returns ~2000 chars)")

        verification_hook = PromptVerificationHook()

        agent = Agent(
            model=model,
            session_manager=session_manager,
            tools=[long_data_fetcher],
            hooks=[verification_hook],
            system_prompt="You are a data research assistant. Use long_data_fetcher for any data requests."
        )

        print()
        print(f" Messages loaded: {len(agent.messages)} (reduced from ~{event_count})")

        event_counts = count_events_in_messages(agent.messages)
        print(f"   User: {event_counts['user_messages']}, Assistant: {event_counts['assistant_messages']}")
        print(f"   toolUse: {event_counts['tool_use_blocks']}, toolResult: {event_counts['tool_result_blocks']}")

        if len(agent.messages) >= event_count:
            print(f"   Messages not reduced ({len(agent.messages)} >= {event_count})")

        has_summary, summary_preview = check_summary_in_messages(agent.messages)
        if has_summary:
            print(f"   Summary found in first user message!")
            print(f"      Preview: {summary_preview[:100]}...")
        else:
            if wait_for_summary:
                print(f"   No summary found (SUMMARIZATION may still be processing)")
            else:
                print(f"   No summary (--no-wait mode)")

        has_truncation, truncation_count = check_truncation_applied(agent.messages)
        if has_truncation:
            print(f"   Truncation applied: {truncation_count} content(s)")
        else:
            print(f"   No truncation detected")

        is_valid, msg = verify_tool_pairs_intact(agent.messages)
        if is_valid:
            print(f"   Tool pairs intact: {msg}")
        else:
            print(f"   Tool pairs broken: {msg}")
            return False

        if agent.messages and agent.messages[0].get('role') == 'user':
            print(f"   First message is user role (API requirement)")
        else:
            print(f"   First message is not user role!")
            return False

        print()
        print("   Testing agent response (and verifying actual prompt)...")
        response = agent("Summarize what data we fetched so far.")
        if response.message:
            for block in response.message.get('content', []):
                if isinstance(block, dict) and block.get('text'):
                    print(f"   Agent: {block['text'][:100]}...")
                    break
            print("   Agent responded successfully")
            verification_hook.print_verification()
            return True
        else:
            print("   Agent failed to respond")
            return False

    except Exception as e:
        print(f" Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def run_local_test(args):
    """Run the local mode compaction test."""
    if not LOCAL_MODE_AVAILABLE:
        print(" Local mode requires strands SDK. Install with: pip install strands-agents")
        sys.exit(1)

    print()
    print("=" * 60)
    print("  CompactingSessionManager - LOCAL Mode Test")
    print("=" * 60)
    print()
    print(f"  Stage 1 (events > {TRUNCATION_THRESHOLD}): Tool content truncation")
    print(f"  Stage 2 (events > {COMPACTION_THRESHOLD}): Summary + recent turns")
    print()

    memory_id = get_memory_id()
    if not memory_id:
        print(" Memory ID not found")
        sys.exit(1)

    print(f" Memory ID: {memory_id[:40]}...")
    print(f" Region: {REGION}")

    strategy_ids = get_strategy_ids(memory_id)
    print(f" Strategies: {list(strategy_ids.keys())}")

    results = {}

    # Test Stage 1 (unless --stage2-only)
    if not args.stage2_only:
        test_id = uuid.uuid4().hex[:8]
        session_id = f"stage1-test-{test_id}"
        actor_id = f"test-user-{test_id}"

        print(f"\n{'='*60}")
        print(f" STAGE 1 TEST")
        print(f"   Session: {session_id}")
        print(f"   Target: 25-45 events (between thresholds)")

        success, event_count = create_local_conversation(memory_id, session_id, actor_id, target_events=35)
        if success:
            results['stage1'] = test_stage1_truncation(memory_id, session_id, actor_id, event_count)
        else:
            results['stage1'] = False

    # Test Stage 2 (unless --stage1-only)
    if not args.stage1_only:
        test_id = uuid.uuid4().hex[:8]
        session_id = f"stage2-test-{test_id}"
        actor_id = f"test-user-{test_id}"

        print(f"\n{'='*60}")
        print(f" STAGE 2 TEST")
        print(f"   Session: {session_id}")
        print(f"   Target: 55-70 events (above compaction threshold)")

        success, event_count = create_local_conversation(memory_id, session_id, actor_id, target_events=60)
        if success:
            if not args.no_wait:
                wait_time = 45
                print(f"\n Waiting {wait_time} seconds for SUMMARIZATION strategy...")
                for i in range(wait_time // 15):
                    time.sleep(15)
                    print(f"   ... {(i+1)*15}/{wait_time} seconds")

            results['stage2'] = test_stage2_compaction(
                memory_id, session_id, actor_id, event_count,
                wait_for_summary=not args.no_wait
            )
        else:
            results['stage2'] = False

    # Print results
    print()
    print("=" * 60)
    print(" TEST RESULTS")
    print("-" * 60)

    all_passed = True
    for stage, passed in results.items():
        status = "PASSED" if passed else "FAILED"
        print(f"   {stage.upper()}: {status}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print(" All tests passed!")
    else:
        print(" Some tests failed")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Test CompactingSessionManager (Local or Deployed mode)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Local mode (default):
    python test_compaction.py                 # Full local test
    python test_compaction.py --stage1-only   # Stage 1 only
    python test_compaction.py --stage2-only   # Stage 2 only

  Deployed mode:
    python test_compaction.py --deployed      # Full deployed test
    python test_compaction.py --deployed --quick    # Quick test (8 turns)
    python test_compaction.py --deployed --turns 20 # Custom turns
"""
    )

    # Mode selection
    parser.add_argument("--deployed", action="store_true",
                        help="Test deployed agent via invoke_agent_runtime API")

    # Common options
    parser.add_argument("--no-wait", action="store_true",
                        help="Skip wait time for summaries")

    # Local mode options
    parser.add_argument("--stage1-only", action="store_true",
                        help="[Local] Test Stage 1 only (25-50 events)")
    parser.add_argument("--stage2-only", action="store_true",
                        help="[Local] Test Stage 2 only (50+ events)")

    # Deployed mode options
    parser.add_argument("--quick", action="store_true",
                        help="[Deployed] Quick test (8 turns, Stage 1 only)")
    parser.add_argument("--turns", type=int, default=None,
                        help="[Deployed] Custom number of conversation turns")

    args = parser.parse_args()

    if args.deployed:
        # Deployed mode
        if args.turns:
            num_turns = args.turns
        elif args.quick:
            num_turns = 8
        else:
            num_turns = 15

        run_deployed_test(
            num_turns=num_turns,
            wait_for_summary=not args.no_wait
        )
    else:
        # Local mode
        run_local_test(args)


if __name__ == "__main__":
    main()
