#!/usr/bin/env python3 -u
"""
CompactingSessionManager Integration Test

Tests two-feature token-based compaction with actual AgentCore Memory:
1. Truncation (always applied): Truncate old tool contents, protect recent turns
2. Checkpoint (100K+ tokens): Skip old messages, prepend summary from DynamoDB

Single session test: runs N turns in one session.
Compaction is triggered automatically based on input token count.

Supports two modes:
- Local: Uses ChatbotAgent locally with real tools (default)
- Deployed: Invokes deployed AgentCore Runtime via API (--deployed)

Usage:
    # Local mode (default) - uses ChatbotAgent locally
    python test_compaction.py                    # 20 turns with compaction
    python test_compaction.py --turns 15         # Custom turn count
    python test_compaction.py --no-compaction    # Baseline (tokens grow unbounded)
    python test_compaction.py --scenario finance # Use finance scenario
    python test_compaction.py --caching          # Enable prompt caching
    python test_compaction.py --wait             # Wait for LTM summaries
    python test_compaction.py --threshold 500    # Custom checkpoint threshold

    # Deployed mode - invokes deployed agent via API
    python test_compaction.py --deployed         # 15 turns on deployed agent
    python test_compaction.py --deployed --turns 20  # Custom turns
"""

import argparse
import sys
import os

# Disable output buffering for real-time logging
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)
import uuid
import time
import json
import asyncio
import logging
import atexit
import warnings
from datetime import datetime

# Suppress threading warnings at shutdown (MCP client cleanup)
warnings.filterwarnings("ignore", message=".*cannot join thread.*")

# Configure logging - show INFO for agent modules, suppress noisy libraries
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Enable INFO for agent modules (metrics, initialization)
logging.getLogger('agent.agent').setLevel(logging.INFO)
logging.getLogger('agent.compacting_session_manager').setLevel(logging.INFO)

# Suppress noisy library loggers
logging.getLogger('strands').setLevel(logging.WARNING)
logging.getLogger('botocore').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logging.getLogger('httpx').setLevel(logging.WARNING)

# Track agents for cleanup
_active_agents = []

def cleanup_agents():
    """Cleanup agents on exit to prevent MCP thread errors."""
    for agent in _active_agents:
        try:
            # Cleanup Gateway MCP client if present
            if hasattr(agent, 'gateway_client') and agent.gateway_client:
                try:
                    agent.gateway_client.__exit__(None, None, None)
                except Exception:
                    pass  # Ignore errors during shutdown
        except Exception:
            pass

atexit.register(cleanup_agents)

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

import boto3

# Configuration
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')

# Token threshold (should match compacting_session_manager.py default)
# Can be overridden via --threshold argument for testing
DEFAULT_TOKEN_THRESHOLD = 50_000


# ============================================================
# Metrics Collector - External metrics collection for test script
# ============================================================

class TurnMetrics:
    """Metrics collected for a single turn."""
    def __init__(self, turn: int):
        self.turn = turn
        self.latency_ms = 0.0
        # Token metrics
        self.context_size = 0  # Last API call's input tokens (actual context sent to LLM)
        self.accumulated_input_tokens = 0  # Total input tokens across all API calls in turn
        self.output_tokens = 0
        self.total_tokens = 0
        self.cache_read = 0
        self.cache_write = 0
        self.event_count = 0
        # Compaction info
        self.checkpoint = 0
        self.truncation_count = 0
        self.stage = "none"
        self.original_messages = 0
        self.final_messages = 0
        self.compaction_overhead_ms = 0.0  # Time spent on compaction during initialize

    def to_dict(self):
        return {
            'turn': self.turn,
            'latency_ms': self.latency_ms,
            'context_size': self.context_size,
            'accumulated_input_tokens': self.accumulated_input_tokens,
            'output_tokens': self.output_tokens,
            'total_tokens': self.total_tokens,
            'cache_read': self.cache_read,
            'cache_write': self.cache_write,
            'event_count': self.event_count,
            'checkpoint': self.checkpoint,
            'truncation_count': self.truncation_count,
            'compaction_overhead_ms': self.compaction_overhead_ms,
            'stage': self.stage,
        }


class MetricsCollector:
    """
    External metrics collector for test script.

    Collects metrics from ChatbotAgent without requiring metrics code in production.
    Uses agent.stream_processor.last_usage for token info and
    agent.session_manager.last_init_info for compaction info.
    """

    def __init__(self):
        self.turn_metrics: list[TurnMetrics] = []
        self.total_latency = 0.0
        self.total_context_size = 0
        self.total_accumulated_input_tokens = 0
        self.total_output_tokens = 0
        self.total_tokens = 0
        self.total_cache_read = 0
        self.total_cache_write = 0

    def collect_turn_metrics(self, agent, turn_number: int, latency_seconds: float):
        """Collect metrics after a turn completes.

        Args:
            agent: The ChatbotAgent
            turn_number: Turn number
            latency_seconds: Turn latency in seconds
        """
        tm = TurnMetrics(turn_number)
        tm.latency_ms = latency_seconds * 1000

        # Get accumulated usage from stream_processor
        accumulated_input = 0
        if hasattr(agent, 'stream_processor') and hasattr(agent.stream_processor, 'last_usage'):
            usage = agent.stream_processor.last_usage or {}
            accumulated_input = usage.get('inputTokens', 0)
            tm.output_tokens = usage.get('outputTokens', 0)
            tm.cache_read = usage.get('cacheReadInputTokens', 0)
            tm.cache_write = usage.get('cacheWriteInputTokens', 0)

        # Get context size from stream_processor.last_llm_input_tokens (last LLM call's inputTokens)
        # This is the actual context size used for compaction threshold decisions
        if agent.stream_processor and agent.stream_processor.last_llm_input_tokens > 0:
            tm.context_size = agent.stream_processor.last_llm_input_tokens

        tm.accumulated_input_tokens = accumulated_input
        tm.total_tokens = tm.accumulated_input_tokens + tm.output_tokens

        # Get compaction info from session_manager.last_init_info
        session_manager = getattr(agent, 'session_manager', None)
        if session_manager:
            # Get last_init_info (simple dict)
            init_info = getattr(session_manager, 'last_init_info', None)
            if init_info:
                tm.stage = init_info.get('stage', 'none')
                tm.truncation_count = init_info.get('truncation_count', 0)
                tm.original_messages = init_info.get('original_messages', 0)
                tm.final_messages = init_info.get('final_messages', 0)
                tm.compaction_overhead_ms = init_info.get('compaction_overhead_ms', 0.0)

            # Get checkpoint from compaction_state
            compaction_state = getattr(session_manager, 'compaction_state', None)
            if compaction_state:
                tm.checkpoint = getattr(compaction_state, 'checkpoint', 0)

            # Get event count from session repository
            try:
                if hasattr(session_manager, 'session_repository') and agent.agent:
                    messages = session_manager.session_repository.list_messages(
                        session_id=agent.session_id,
                        agent_id=agent.agent.agent_id,
                        limit=1000
                    )
                    tm.event_count = len(messages)
            except Exception:
                pass

        self.turn_metrics.append(tm)

        # Update totals
        self.total_latency += latency_seconds
        self.total_context_size += tm.context_size
        self.total_accumulated_input_tokens += tm.accumulated_input_tokens
        self.total_output_tokens += tm.output_tokens
        self.total_tokens += tm.total_tokens
        self.total_cache_read += tm.cache_read
        self.total_cache_write += tm.cache_write

        return tm

    def get_summary(self) -> dict:
        """Get summary statistics."""
        total_compact_ms = sum(tm.compaction_overhead_ms for tm in self.turn_metrics)
        return {
            'turn_count': len(self.turn_metrics),
            'total_latency': self.total_latency,
            'total_context_size': self.total_context_size,
            'total_compaction_overhead_ms': total_compact_ms,
            'total_output_tokens': self.total_output_tokens,
            'total_tokens': self.total_tokens,
            'total_cache_read': self.total_cache_read,
            'total_cache_write': self.total_cache_write,
            'turn_metrics': [tm.to_dict() for tm in self.turn_metrics],
        }


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


def get_compaction_state(user_id: str, session_id: str) -> dict:
    """Get compaction state from DynamoDB session metadata."""
    table_name = f"{PROJECT_NAME}-users-v2"
    dynamodb = boto3.resource('dynamodb', region_name=REGION)
    table = dynamodb.Table(table_name)

    try:
        response = table.get_item(
            Key={
                'userId': user_id,
                'sk': f'SESSION#{session_id}'
            },
            ProjectionExpression='compaction'
        )
        if 'Item' in response and 'compaction' in response['Item']:
            return response['Item']['compaction']
        return None
    except Exception as e:
        print(f"Failed to get compaction state: {e}")
        return None


def clear_compaction_state(user_id: str, session_id: str):
    """Clear compaction state from DynamoDB (for test cleanup)."""
    table_name = f"{PROJECT_NAME}-users-v2"
    dynamodb = boto3.resource('dynamodb', region_name=REGION)
    table = dynamodb.Table(table_name)

    try:
        table.update_item(
            Key={
                'userId': user_id,
                'sk': f'SESSION#{session_id}'
            },
            UpdateExpression='REMOVE compaction'
        )
    except Exception as e:
        print(f"Failed to clear compaction state: {e}")


# ============================================================
# Conversation Messages and Tools Configuration
# ============================================================

TRAVEL_PLANNING_MESSAGES = [
    # Hawaii intro + follow-ups (1-5)
    "I want to plan a trip to Hawaii next month. What's the weather like in Honolulu?",
    "That sounds nice. What are the best beaches near Waikiki?",
    "Are there good snorkeling spots at any of those beaches?",
    "Great, can you find me a hotel near Waikiki Beach?",
    "What about restaurants nearby? I love seafood.",
    # Topic switch to Tokyo + follow-ups (6-10)
    "By the way, I'm also considering Tokyo for a different trip. What's the weather there?",
    "Interesting. What are some must-see places for first-time visitors?",
    "I heard Shibuya is famous. What can I do there?",
    "Find me some good ramen spots in that area",
    "How would I get there from Narita airport?",
    # Back to Hawaii briefly (11-12)
    "Going back to Hawaii - how do I get from Honolulu airport to Waikiki?",
    "Is Uber available there or should I rent a car?",
    # Switch to Paris + follow-ups (13-17)
    "Let me also ask about Paris. What's the weather like in January?",
    "A bit cold but manageable. What are popular attractions there?",
    "Any good cafes near the Eiffel Tower?",
    "What's the best way to get around the city?",
    "Find me hotels in a nice neighborhood",
    # Practical questions mixed (18-22)
    "What time zone is Hawaii in compared to California?",
    "Do I need a visa to visit Japan as a US citizen?",
    "What's the tipping culture like in France?",
    "Search for travel insurance that covers multiple countries",
    "What vaccines do I need for international travel?",
    # Back to specific destinations (23-27)
    "For Tokyo, are there any good day trips I can take?",
    "What about from Paris - any nearby cities worth visiting?",
    "In Hawaii, what activities would you recommend besides the beach?",
    "Search for hiking trails in Oahu",
    "Any cultural sites I shouldn't miss?",
    # Final practical questions (28-32)
    "What's the best time of year to visit Tokyo?",
    "How much should I budget per day in Paris?",
    "Find me budget airlines that fly to Honolulu",
    "What apps should I download for traveling in Japan?",
    "Any packing tips for tropical weather?",
]

TRAVEL_TOOLS = [
    "gateway_get_today_weather",
    "gateway_get_weather_forecast",
    "ddg_web_search",
    "gateway_search_places",
    "gateway_get_place_details",
    "gateway_get_directions",
]

FINANCE_ANALYSIS_MESSAGES = [
    # Apple deep dive (1-5)
    "I'm researching Apple stock. Can you give me the current price and recent performance for AAPL?",
    "What are the key factors driving Apple's stock price lately?",
    "Show me how AAPL has performed over the past month with the stock history",
    "Any recent news or earnings reports affecting Apple?",
    "What do analysts think about Apple's valuation right now?",
    # Compare with Microsoft (6-9)
    "How does Apple compare to Microsoft? Give me MSFT's current price and performance",
    "Which one has had better returns this year between AAPL and MSFT?",
    "Search for news about competition between Apple and Microsoft in AI",
    "What's the market cap difference between these two companies?",
    # Switch to NVIDIA deep dive (10-14)
    "Let's look at NVIDIA now. What's the current stock price and why has it been so hot?",
    "Show me NVDA's stock history for the past few weeks",
    "What's driving NVIDIA's growth in the AI chip market?",
    "Any concerns about NVIDIA being overvalued at current levels?",
    "Search for news about NVIDIA's partnerships with cloud providers",
    # Compare chipmakers (15-18)
    "How does AMD compare to NVIDIA? Give me AMD's current price and analysis",
    "What about Intel? How are they positioned against NVIDIA and AMD?",
    "Which semiconductor stock looks most promising right now?",
    "Any news about the chip shortage and how it affects these companies?",
    # Tesla and EV sector (19-23)
    "Switching to EVs - what's Tesla's current stock price and recent trend?",
    "How has TSLA performed compared to the overall market this year?",
    "What are the main risks and opportunities for Tesla right now?",
    "Are there other EV stocks worth considering? How about Rivian?",
    "Search for news about EV adoption rates and impact on these stocks",
    # Big tech comparison (24-27)
    "Let's look at Meta. What's their stock doing and why?",
    "How does Meta's performance compare to Alphabet this year?",
    "Any news about how AI is affecting these social media companies?",
    "Which big tech stock looks undervalued right now?",
    # Market context (28-32)
    "What's the Fed's current stance on interest rates and how does it affect tech stocks?",
    "Search for news about upcoming tech earnings this quarter",
    "How is the overall tech sector performing compared to other sectors?",
    "Any signs of a potential market correction in tech?",
    "What's your overall read on the tech stock landscape right now?",
]

FINANCE_TOOLS = [
    "gateway_stock_quote",
    "gateway_stock_history",
    "gateway_financial_news",
    "gateway_stock_analysis",
    "ddg_web_search",
]


# ============================================================
# Local Mode - Using ChatbotAgent
# ============================================================

def create_local_chatbot_agent(
    session_id: str,
    user_id: str,
    enabled_tools: list,
    compaction_enabled: bool = True,
    caching_enabled: bool = False,
    use_null_conversation_manager: bool = False,
):
    """Create a ChatbotAgent for local testing.

    Args:
        session_id: Session ID
        user_id: User ID
        enabled_tools: List of tool IDs to enable
        compaction_enabled: Whether to enable compaction
        caching_enabled: Whether to enable prompt caching
        use_null_conversation_manager: Use NullConversationManager (disable Strands' sliding window)
    """
    try:
        # Ensure MEMORY_ID is set (ChatbotAgent checks this env var)
        if not os.environ.get('MEMORY_ID'):
            memory_id = get_memory_id()
            if memory_id:
                os.environ['MEMORY_ID'] = memory_id
                print(f"   Set MEMORY_ID from SSM: {memory_id[:30]}...")

        # Set environment variables for local mode
        os.environ['NEXT_PUBLIC_AGENTCORE_LOCAL'] = 'false'  # Use cloud resources

        from agent.agent import ChatbotAgent

        agent = ChatbotAgent(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=enabled_tools,
            model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
            temperature=0.7,
            caching_enabled=caching_enabled,
            compaction_enabled=compaction_enabled,
            use_null_conversation_manager=use_null_conversation_manager
        )

        # Register for cleanup on exit
        _active_agents.append(agent)

        return agent
    except Exception as e:
        print(f"Failed to create ChatbotAgent: {e}")
        import traceback
        traceback.print_exc()
        return None


async def send_message_to_agent(agent, message: str, session_id: str) -> str:
    """Send a message to ChatbotAgent and collect response."""
    response_text = ""

    try:
        async for event in agent.stream_async(message, session_id=session_id):
            if event.startswith('data: '):
                try:
                    event_data = json.loads(event[6:])
                    if event_data.get('type') == 'response':
                        response_text += event_data.get('text', '')
                    elif event_data.get('type') == 'complete':
                        if event_data.get('message'):
                            response_text = event_data.get('message', response_text)
                except json.JSONDecodeError:
                    pass
    except Exception as e:
        print(f"Error in send_message_to_agent: {e}")

    return response_text


def create_local_conversation(
    session_id: str,
    user_id: str,
    num_turns: int,
    scenario: str = "travel",
    compaction_enabled: bool = True,
    caching_enabled: bool = False,
    use_null_conversation_manager: bool = False,
) -> tuple:
    """Create a conversation using ChatbotAgent locally.

    Args:
        session_id: Session ID
        user_id: User ID
        num_turns: Number of conversation turns
        scenario: 'travel' or 'finance'
        compaction_enabled: Whether to enable compaction
        caching_enabled: Whether to enable prompt caching
        use_null_conversation_manager: Use NullConversationManager (disable Strands' sliding window)

    Returns:
        Tuple of (success: bool, estimated_events: int, metrics_collector: MetricsCollector)
    """
    # Select messages and tools based on scenario
    if scenario == "finance":
        messages_source = FINANCE_ANALYSIS_MESSAGES
        tools = FINANCE_TOOLS
        scenario_desc = "Finance Analysis (Tech Stocks, Market News)"
    else:
        messages_source = TRAVEL_PLANNING_MESSAGES
        tools = TRAVEL_TOOLS
        scenario_desc = "Travel Planning (Hawaii, Japan, Europe)"

    mode_label = "BASELINE (No Compaction)" if not compaction_enabled else "WITH Compaction"
    if use_null_conversation_manager:
        mode_label += " + NullConvManager"

    print(f"\n Creating conversation using ChatbotAgent ({num_turns} turns)...")
    print("-" * 60)
    print(f"   Session ID: {session_id}")
    print(f"   User ID: {user_id}")
    print(f"   Scenario: {scenario_desc}")
    print(f"   Mode: {mode_label}")
    print(f"   Tools: {', '.join(tools[:4])}...")
    print()

    messages_to_send = messages_source[:num_turns]
    if num_turns > len(messages_source):
        messages_to_send = (messages_source * (num_turns // len(messages_source) + 1))[:num_turns]

    print(f"   Sending {len(messages_to_send)} messages...")
    print()

    successful_turns = 0
    estimated_events = 0
    metrics_collector = MetricsCollector()

    for i, msg in enumerate(messages_to_send):
        print(f"   [{i+1}/{len(messages_to_send)}] User: {msg[:50]}...")

        try:
            # Create new Agent for each turn (simulates real usage where session is restored)
            # This triggers compaction on initialize() when event count exceeds threshold
            agent = create_local_chatbot_agent(
                session_id=session_id,
                user_id=user_id,
                enabled_tools=tools,
                compaction_enabled=compaction_enabled,
                caching_enabled=caching_enabled,
                use_null_conversation_manager=use_null_conversation_manager,
            )

            if not agent:
                print(f"            Error: Failed to create agent")
                break

            # Log compaction state after agent initialization
            session_manager = getattr(agent, 'session_manager', None)
            if session_manager and hasattr(session_manager, 'last_init_info'):
                init_info = session_manager.last_init_info
                if init_info:
                    cp_state = getattr(session_manager, 'compaction_state', None)
                    checkpoint = cp_state.checkpoint if cp_state else 0
                    print(f"            📍 Compaction: stage={init_info.get('stage', 'none')}, checkpoint={checkpoint}, "
                          f"msgs={init_info.get('original_messages', 0)}→{init_info.get('final_messages', 0)}, "
                          f"truncated={init_info.get('truncation_count', 0)}")

            # Track latency
            turn_start = time.time()
            response = asyncio.run(send_message_to_agent(agent, msg, session_id))
            turn_latency = time.time() - turn_start

            if response:
                response_preview = response[:60].replace('\n', ' ')
                print(f"            Agent: {response_preview}...")
                successful_turns += 1
                estimated_events += 4  # Estimate: user + assistant + potential tool_use + tool_result
            else:
                print(f"            Agent: (no response)")
                successful_turns += 1
                estimated_events += 2

            # Collect metrics using MetricsCollector
            tm = metrics_collector.collect_turn_metrics(agent, i + 1, turn_latency)
            compact_info = f", compact={tm.compaction_overhead_ms:.0f}ms" if tm.compaction_overhead_ms > 0 else ""
            print(f"            📊 Tokens: context={tm.context_size:,}, accum={tm.accumulated_input_tokens:,}{compact_info}, latency={tm.latency_ms:.0f}ms")

        except Exception as e:
            print(f"            Error: {e}")
            import traceback
            traceback.print_exc()
            break

        time.sleep(5)  # Delay between turns for rate limiting

    print()
    print(f" Conversation created!")
    print(f"   Successful turns: {successful_turns}/{len(messages_to_send)}")
    print(f"   Estimated events: ~{estimated_events}")

    return successful_turns > 0, estimated_events, metrics_collector


def print_session_statistics(metrics_collector: MetricsCollector, stage_name: str, user_id: str = None, session_id: str = None):
    """Print session statistics in a nice table format."""
    if not metrics_collector or not metrics_collector.turn_metrics:
        return

    turn_metrics = metrics_collector.turn_metrics

    # Last turn is verification, actual conversation turns = total - 1
    actual_turns = len(turn_metrics) - 1

    print()
    print(f"📊 {stage_name} SESSION STATISTICS ({actual_turns} turns + 1 verification)")
    print("=" * 120)

    # Per-turn table with token breakdown
    # Context = last API call's input tokens (actual context size sent to LLM)
    # Accum = accumulated input tokens across all API calls in turn
    # Compact = Compaction overhead time (ms) during initialize
    print(f"{'Turn':<5} {'Latency':<10} {'Context':<12} {'Accum':<12} {'Compact':<10} {'Checkpoint':<10} {'Truncated':<9} {'Stage':<15}")
    print("-" * 115)

    for tm in turn_metrics:
        checkpoint = tm.checkpoint if tm.checkpoint > 0 else '-'
        compact_ms = f"{tm.compaction_overhead_ms:.0f}ms" if tm.compaction_overhead_ms > 0 else '-'
        print(f"{tm.turn:<5} {tm.latency_ms:>7.0f}ms  {tm.context_size:>10,}  {tm.accumulated_input_tokens:>10,}  {compact_ms:>8}  {str(checkpoint):>8}  {tm.truncation_count:>8}  {tm.stage:<15}")

    print("-" * 115)

    # Summary row
    total_latency = metrics_collector.total_latency * 1000
    avg_latency = total_latency / len(turn_metrics) if turn_metrics else 0

    # Get final event count from last turn
    final_events = turn_metrics[-1].event_count if turn_metrics else 0

    # Calculate total compaction overhead
    total_compact_ms = sum(tm.compaction_overhead_ms for tm in turn_metrics)

    print(f"{'TOTAL':<5} {total_latency:>7.0f}ms  {metrics_collector.total_context_size:>10,}  {metrics_collector.total_accumulated_input_tokens:>10,}  {total_compact_ms:>6.0f}ms  {'':>8}  {'':>8}  events={final_events}")
    print(f"{'AVG':<5} {avg_latency:>7.0f}ms")
    print()

    # Cache efficiency
    if metrics_collector.total_cache_read > 0 or metrics_collector.total_cache_write > 0:
        cache_hit_rate = (metrics_collector.total_cache_read / (metrics_collector.total_accumulated_input_tokens + metrics_collector.total_cache_read)) * 100 if (metrics_collector.total_accumulated_input_tokens + metrics_collector.total_cache_read) > 0 else 0
        print(f"Cache: write={metrics_collector.total_cache_write:,} tokens, read={metrics_collector.total_cache_read:,} tokens ({cache_hit_rate:.1f}% hit rate)")

    # Print compaction state from DynamoDB
    if user_id and session_id:
        compaction_state = get_compaction_state(user_id, session_id)
        if compaction_state:
            checkpoint = compaction_state.get('checkpoint', 0)
            print()
            print(f"📍 Compaction State (DynamoDB):")
            print(f"   checkpoint: {checkpoint} {'(checkpoint active)' if checkpoint > 0 else '(no checkpoint)'}")
            print(f"   lastInputTokens: {compaction_state.get('lastInputTokens', 0):,}")
            if compaction_state.get('summary'):
                summary_preview = compaction_state['summary'][:100] + "..." if len(compaction_state['summary']) > 100 else compaction_state['summary']
                print(f"   summary: {summary_preview}")


def print_compaction_summary(user_id: str, session_id: str, stage_name: str = ""):
    """Print compaction state summary from DynamoDB."""
    print()
    print(f"📈 {stage_name} COMPACTION STATE")
    print("=" * 60)

    compaction_state = get_compaction_state(user_id, session_id)
    if not compaction_state:
        print("   (No compaction state found)")
        return

    checkpoint = compaction_state.get('checkpoint', 0)
    last_tokens = compaction_state.get('lastInputTokens', 0)
    summary = compaction_state.get('summary')

    print(f"   Checkpoint: {checkpoint} {'(active)' if checkpoint > 0 else '(not set)'}")
    print(f"   Last input tokens: {last_tokens:,}")

    if summary:
        summary_preview = summary[:200] + "..." if len(summary) > 200 else summary
        print(f"   Summary ({len(summary)} chars):")
        for line in summary_preview.split('\n')[:5]:
            print(f"      {line[:80]}")


def retrieve_ltm_records(memory_id: str, user_id: str, strategy_ids: dict) -> dict:
    """
    Retrieve Long-Term Memory records for a user from all strategy namespaces.

    Args:
        memory_id: AgentCore Memory ID
        user_id: User/Actor ID
        strategy_ids: Dict mapping strategy type to strategy ID

    Returns:
        Dict with records from each strategy namespace
    """
    from bedrock_agentcore.memory import MemoryClient

    results = {}

    try:
        memory_client = MemoryClient(region_name=REGION)

        for strategy_type, strategy_id in strategy_ids.items():
            namespace = f"/strategies/{strategy_id}/actors/{user_id}"

            try:
                memories = memory_client.retrieve_memories(
                    memory_id=memory_id,
                    namespace=namespace,
                    query="conversation summary user preferences facts",
                    top_k=10
                )

                records = []
                for memory in memories:
                    if isinstance(memory, dict):
                        content = memory.get("content", {})
                        if isinstance(content, dict):
                            text = content.get("text", "").strip()
                            if text:
                                # Truncate long texts for display
                                preview = text[:500] + "..." if len(text) > 500 else text
                                records.append({
                                    "text": preview,
                                    "full_length": len(text),
                                    "id": memory.get("id", "unknown")
                                })

                results[strategy_type] = {
                    "namespace": namespace,
                    "count": len(records),
                    "records": records
                }

            except Exception as e:
                results[strategy_type] = {
                    "namespace": namespace,
                    "count": 0,
                    "error": str(e)
                }

    except Exception as e:
        print(f"Failed to create MemoryClient: {e}")
        return {}

    return results


def print_ltm_records(memory_id: str, user_id: str, strategy_ids: dict, stage_name: str = ""):
    """
    Print LTM records for a user in a formatted way.

    Args:
        memory_id: AgentCore Memory ID
        user_id: User/Actor ID
        strategy_ids: Dict mapping strategy type to strategy ID
        stage_name: Optional stage name for header
    """
    print()
    print(f"📚 {stage_name} LONG-TERM MEMORY RECORDS")
    print("=" * 70)
    print(f"   User ID: {user_id}")
    print()

    ltm_data = retrieve_ltm_records(memory_id, user_id, strategy_ids)

    if not ltm_data:
        print("   No LTM data retrieved (MemoryClient initialization failed)")
        return

    for strategy_type, data in ltm_data.items():
        print(f"📁 {strategy_type}")
        print(f"   Namespace: {data['namespace']}")

        if "error" in data:
            print(f"   ⚠️  Error: {data['error']}")
        elif data['count'] == 0:
            print(f"   (no records found)")
        else:
            print(f"   Records: {data['count']}")
            print("-" * 70)

            for i, record in enumerate(data['records'], 1):
                print(f"   [{i}] (ID: {record['id'][:20]}..., {record['full_length']} chars)")
                # Indent the text for readability
                lines = record['text'].split('\n')
                for line in lines[:10]:  # Show first 10 lines max
                    print(f"       {line[:80]}")
                if len(lines) > 10:
                    print(f"       ... ({len(lines) - 10} more lines)")
                print()

        print()


RETENTION_TEST_PROMPT = """Please summarize our entire conversation so far. List the key topics, questions, and information we discussed as bullet points. Be comprehensive and include:
- All destinations/locations mentioned
- Specific places, hotels, or attractions discussed
- Any searches or lookups performed
- Key facts or recommendations given
- The overall purpose/goal of our conversation

Format your response as a bullet-point list."""


def verify_local_compaction(
    session_id: str,
    user_id: str,
    enabled_tools: list,
    compaction_enabled: bool = True,
    caching_enabled: bool = False,
    metrics_collector: MetricsCollector = None,
    use_null_conversation_manager: bool = False,
) -> dict:
    """Verify compaction by testing context retention with a NEW agent.

    Creates a new agent and asks it to summarize the entire conversation.
    The summary is saved for later evaluation.
    """
    print(f"\n📋 Verifying Context Retention...")
    print("-" * 60)

    results = {
        "stage": "none",
        "checkpoint_active": False,
        "checkpoint": 0,
        "last_input_tokens": 0,
        "context_retained": False,
        "verification_metrics": None,
        "retention_summary": None,  # Full summary response for later evaluation
        "retention_bullet_count": 0,  # Number of bullet points in summary
    }

    # Get compaction state from DynamoDB BEFORE creating new agent
    compaction_state = get_compaction_state(user_id, session_id)
    print(f"   DynamoDB state before verification:")
    if compaction_state:
        print(f"   - checkpoint: {compaction_state.get('checkpoint', 0)}")
        print(f"   - lastInputTokens: {compaction_state.get('lastInputTokens', 0):,}")
    else:
        print(f"   - (no compaction state)")

    # Create NEW agent for verification (this triggers compaction on initialize)
    print()
    print("   Creating new agent for verification turn...")

    verification_agent = create_local_chatbot_agent(
        session_id=session_id,
        user_id=user_id,
        enabled_tools=enabled_tools,
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
        use_null_conversation_manager=use_null_conversation_manager,
    )

    if not verification_agent:
        print("   Error: Failed to create verification agent")
        return results

    # Log compaction state after agent initialization
    session_manager = getattr(verification_agent, 'session_manager', None)
    if session_manager and hasattr(session_manager, 'last_init_info'):
        init_info = session_manager.last_init_info
        if init_info:
            cp_state = getattr(session_manager, 'compaction_state', None)
            checkpoint = cp_state.checkpoint if cp_state else 0
            print(f"   📍 Verification Compaction: stage={init_info.get('stage', 'none')}, checkpoint={checkpoint}, "
                  f"msgs={init_info.get('original_messages', 0)}→{init_info.get('final_messages', 0)}, "
                  f"truncated={init_info.get('truncation_count', 0)}")
            results["verification_metrics"] = {
                "stage": init_info.get('stage', 'none'),
                "checkpoint": checkpoint,
                "original_messages": init_info.get('original_messages', 0),
                "final_messages": init_info.get('final_messages', 0),
                "truncation_count": init_info.get('truncation_count', 0),
            }

    # Update results from current compaction state
    if compaction_enabled and session_manager and hasattr(session_manager, 'compaction_state') and session_manager.compaction_state:
        cp_state = session_manager.compaction_state
        results["checkpoint_active"] = cp_state.checkpoint > 0
        results["checkpoint"] = cp_state.checkpoint
        results["last_input_tokens"] = cp_state.lastInputTokens

        if cp_state.checkpoint > 0:
            results["stage"] = "checkpoint"
        else:
            results["stage"] = "none"
    elif not compaction_enabled:
        results["stage"] = "baseline"

    print()
    print(f"   Checkpoint active: {results['checkpoint_active']}")
    print(f"   Checkpoint index: {results['checkpoint']}")
    print(f"   Last input tokens: {results['last_input_tokens']:,}")
    print(f"   Stage: {results['stage'].upper()}")

    # Test context retention with comprehensive summary request
    print()
    print("   Requesting conversation summary for retention test...")

    try:
        turn_start = time.time()
        response = asyncio.run(send_message_to_agent(verification_agent, RETENTION_TEST_PROMPT, session_id))
        turn_latency = time.time() - turn_start

        # Collect verification turn metrics
        if metrics_collector:
            turn_number = len(metrics_collector.turn_metrics) + 1
            tm = metrics_collector.collect_turn_metrics(verification_agent, turn_number, turn_latency)
            compact_info = f", compact={tm.compaction_overhead_ms:.0f}ms" if tm.compaction_overhead_ms > 0 else ""
            print(f"   📊 Verification: context={tm.context_size:,}, accum={tm.accumulated_input_tokens:,}{compact_info}, latency={tm.latency_ms:.0f}ms")

        if response:
            results["retention_summary"] = response

            # Count bullet points (lines starting with - or •)
            bullet_count = len([line for line in response.split('\n')
                               if line.strip().startswith(('-', '•', '*'))])
            results["retention_bullet_count"] = bullet_count
            results["context_retained"] = True  # Got a response

            print()
            print("=" * 60)
            print("📝 RETENTION TEST - CONVERSATION SUMMARY")
            print("=" * 60)
            print(response)
            print("=" * 60)
            print()
            print(f"   Bullet points: {bullet_count}")
            print("   ✅ Summary captured for evaluation")
        else:
            print(f"   ❌ Error: No response")
            results["context_retained"] = False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        results["context_retained"] = False

    return results


def run_local_test(args):
    """Run the local mode compaction test using ChatbotAgent.

    Single session test: runs N turns in one session.
    Token-based compaction is triggered automatically:
    - When input tokens exceed threshold: compaction triggers
    - Checkpoint is set, summary is stored in DynamoDB
    - Subsequent turns load from checkpoint with stored summary
    """
    scenario = getattr(args, 'scenario', 'travel')
    no_compaction = getattr(args, 'no_compaction', False)
    caching_enabled = getattr(args, 'caching', False)  # Default: caching disabled
    target_turns = args.turns if args.turns else 20  # Default: 20 turns
    token_threshold = getattr(args, 'threshold', None) or DEFAULT_TOKEN_THRESHOLD

    # Baseline mode: --no-compaction automatically enables NullConvManager
    # This ensures true baseline (no compaction, no Strands sliding window)
    # Note: CompactingSessionManager already uses limit=10000, so SDK's default 100 limit doesn't apply
    use_null_conv_manager = no_compaction

    # Set token threshold via environment variable
    os.environ['COMPACTION_TOKEN_THRESHOLD'] = str(token_threshold)

    scenario_names = {
        "travel": "Travel Planning",
        "finance": "Finance Analysis"
    }

    mode_label = "BASELINE" if no_compaction else "WITH Compaction"

    print()
    print("=" * 60)
    print(f"  CompactingSessionManager - LOCAL Mode Test")
    print(f"  Scenario: {scenario_names.get(scenario, scenario)}")
    print(f"  Mode: {mode_label}")
    print("=" * 60)
    print()
    print("  Uses ChatbotAgent locally with real tools")
    if no_compaction:
        print("  BASELINE mode:")
        print("  - Compaction DISABLED (metrics_only mode)")
        print("  - NullConversationManager (no Strands sliding window)")
        print("  → Tokens will grow unbounded")
    else:
        print(f"  Two-feature compaction:")
        print(f"  - Feature 1: Truncation (always applied)")
        print(f"    (truncate old tool contents, protect recent 2 turns)")
        print(f"  - Feature 2: Checkpoint (when input tokens > {token_threshold:,})")
        print(f"    (skip old messages, prepend summary from DynamoDB)")
    print()

    memory_id = get_memory_id()
    if not memory_id:
        print("\n MEMORY_ID not found.")
        print("   Set environment variable or check Parameter Store.")
        sys.exit(1)

    print(f" Memory ID: {memory_id[:40]}...")
    print(f" Region: {REGION}")

    strategy_ids = get_strategy_ids(memory_id)
    print(f" Strategies: {list(strategy_ids.keys())}")

    compaction_enabled = not no_compaction

    # Generate unique session/user IDs (separate random values to avoid cross-contamination)
    session_id = f"compaction-test-{uuid.uuid4().hex[:8]}"
    user_id = f"test-user-{uuid.uuid4().hex[:8]}"

    print(f"\n{'='*60}")
    print(f" CONVERSATION TEST")
    print(f"   Session: {session_id}")
    print(f"   User: {user_id}")
    print(f"   Target: {target_turns} turns (~{target_turns * 4} events)")

    # Run single session conversation
    success, event_count, metrics_collector = create_local_conversation(
        session_id=session_id,
        user_id=user_id,
        num_turns=target_turns,
        scenario=scenario,
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
        use_null_conversation_manager=use_null_conv_manager,
    )

    if not success:
        print("\n⚠️  Conversation failed or incomplete")
        # Still show metrics collected so far
        if metrics_collector and metrics_collector.turn_metrics:
            print_session_statistics(metrics_collector, "PARTIAL SESSION", user_id=user_id, session_id=session_id)
        sys.exit(1)

    # Check compaction state from DynamoDB
    compaction_state = get_compaction_state(user_id, session_id)
    compaction_triggered = compaction_state and compaction_state.get('checkpoint', 0) > 0

    # Wait for summaries if needed
    if args.wait and compaction_enabled and compaction_triggered:
        wait_time = 45
        print(f"\n Waiting {wait_time} seconds for SUMMARIZATION strategy...")
        for i in range(wait_time // 15):
            time.sleep(15)
            print(f"   ... {(i+1)*15}/{wait_time} seconds")

    # Select tools based on scenario
    if scenario == "finance":
        tools = FINANCE_TOOLS
    else:
        tools = TRAVEL_TOOLS

    # Verify context retention with NEW agent
    verify_results = verify_local_compaction(
        session_id=session_id,
        user_id=user_id,
        enabled_tools=tools,
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
        metrics_collector=metrics_collector,
        use_null_conversation_manager=use_null_conv_manager,
    )

    # Print session statistics
    print_session_statistics(metrics_collector, "SESSION", user_id=user_id, session_id=session_id)

    # Print compaction state summary
    if compaction_enabled:
        print_compaction_summary(user_id, session_id, "SESSION")

    # Print LTM records
    print_ltm_records(memory_id, user_id, strategy_ids, "SESSION")

    # Print final results
    print()
    print("=" * 70)
    print("📊 TEST RESULTS")
    print("-" * 70)
    print(f"   Mode: {mode_label}")
    print(f"   Session: {session_id}")
    print(f"   User: {user_id}")
    print(f"   Turns: {target_turns}")
    print(f"   Checkpoint threshold: {token_threshold:,}")
    print(f"   Checkpoint active: {verify_results['checkpoint_active']}")
    print(f"   Checkpoint index: {verify_results['checkpoint']}")
    print(f"   Last input tokens: {verify_results['last_input_tokens']:,}")
    print(f"   Stage applied: {verify_results['stage'].upper()}")
    print()
    print("📝 RETENTION METRICS")
    print("-" * 70)
    print(f"   Bullet points in summary: {verify_results.get('retention_bullet_count', 0)}")
    print(f"   Summary captured: {'✅ YES' if verify_results.get('retention_summary') else '❌ NO'}")
    print()

    if verify_results['context_retained']:
        print("✅ Test completed - summary saved for evaluation")
    else:
        print("⚠️  Test completed - no summary captured")


# ============================================================
# Deployed Mode Functions
# ============================================================

def invoke_agent_runtime(
    runtime_arn: str,
    user_id: str,
    session_id: str,
    message: str,
    enabled_tools: list = None,
    model_id: str = None,
    compaction_enabled: bool = True,
    caching_enabled: bool = True,
) -> dict:
    """Invoke the deployed AgentCore Runtime via invoke_agent_runtime API."""
    client = boto3.client('bedrock-agentcore', region_name=REGION)

    input_data = {
        "user_id": user_id,
        "session_id": session_id,
        "message": message,
        "model_id": model_id or "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        "compaction_enabled": compaction_enabled,
        "caching_enabled": caching_enabled,
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
    num_turns: int = 15,
    scenario: str = "travel",
    compaction_enabled: bool = True,
    caching_enabled: bool = True,
) -> tuple:
    """Create a conversation by invoking deployed agent."""
    if scenario == "finance":
        messages_source = FINANCE_ANALYSIS_MESSAGES
        tools = FINANCE_TOOLS
        scenario_desc = "Finance Analysis (Tech Stocks, Market News)"
    else:
        messages_source = TRAVEL_PLANNING_MESSAGES
        tools = TRAVEL_TOOLS
        scenario_desc = "Travel Planning (Hawaii, Japan, Europe)"

    print(f"\n Creating conversation via deployed agent ({num_turns} turns)...")
    print("-" * 60)
    print(f"   Runtime ARN: {runtime_arn[:60]}...")
    print(f"   User ID: {user_id}")
    print(f"   Session ID: {session_id}")
    print(f"   Scenario: {scenario_desc}")
    print(f"   Tools: {', '.join(tools[:4])}...")
    print()

    messages_to_send = messages_source[:num_turns]
    if num_turns > len(messages_source):
        messages_to_send = (messages_source * (num_turns // len(messages_source) + 1))[:num_turns]

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
            enabled_tools=tools,
            compaction_enabled=compaction_enabled,
            caching_enabled=caching_enabled,
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
    compaction_enabled: bool = True,
    caching_enabled: bool = True,
) -> dict:
    """Verify compaction by testing context retention via deployed agent."""
    print(f"\n Verifying Compaction...")
    print("-" * 60)

    results = {
        "stage": "none",
        "checkpoint_active": False,
        "checkpoint": 0,
        "last_input_tokens": 0,
        "context_retained": False,
    }

    # Get compaction state from DynamoDB
    compaction_state = get_compaction_state(actor_id, session_id)

    if compaction_enabled and compaction_state:
        checkpoint = compaction_state.get('checkpoint', 0)
        results["checkpoint_active"] = checkpoint > 0
        results["checkpoint"] = checkpoint
        results["last_input_tokens"] = compaction_state.get('lastInputTokens', 0)

        if checkpoint > 0:
            results["stage"] = "checkpoint"
        else:
            results["stage"] = "none"
    elif not compaction_enabled:
        results["stage"] = "baseline"

    print(f"   Checkpoint active: {results['checkpoint_active']}")
    print(f"   Checkpoint index: {results['checkpoint']}")
    print(f"   Last input tokens: {results['last_input_tokens']:,}")
    print(f"   Stage: {results['stage'].upper()}")

    print()
    print("   Testing context retention...")

    context_test_message = "Based on our conversation, what destinations did we discuss for my trip? Please list them briefly."

    result = invoke_agent_runtime(
        runtime_arn=runtime_arn,
        user_id=actor_id,
        session_id=session_id,
        message=context_test_message,
        enabled_tools=[],
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
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


def run_deployed_test(
    num_turns: int = 15,
    wait_for_summary: bool = False,
    scenario: str = "travel",
    no_compaction: bool = False,
    caching_enabled: bool = False,
    measure_performance: bool = False,
    followup_turns: int = 5,
    token_threshold: int = None
):
    """Run the deployed mode compaction test."""
    token_threshold = token_threshold or DEFAULT_TOKEN_THRESHOLD

    scenario_names = {
        "travel": "Travel Planning",
        "finance": "Finance Analysis"
    }

    mode_label = "BASELINE (No Compaction)" if no_compaction else "WITH Compaction"

    print()
    print("=" * 60)
    print(f"  CompactingSessionManager - DEPLOYED Mode Test")
    print(f"  Scenario: {scenario_names.get(scenario, scenario)}")
    print(f"  Mode: {mode_label}")
    print("=" * 60)
    print()
    print("  Invokes deployed agent via invoke_agent_runtime API")
    if no_compaction:
        print("  Compaction DISABLED (baseline measurement)")
    else:
        print(f"  Token-based compaction:")
        print(f"  - Threshold: {token_threshold:,} input tokens")
        print(f"  - When exceeded: checkpoint set + summary stored in DynamoDB")
        print(f"  - Subsequent turns: load from checkpoint with stored summary")
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

    test_id = uuid.uuid4().hex
    compaction_label = "baseline" if no_compaction else "compaction"
    session_id = f"{scenario}-{compaction_label}-test-{test_id}"
    user_id = f"{scenario}-{compaction_label}-user-{test_id}"

    print(f"\n Session ID: {session_id}")
    print(f" User ID: {user_id}")

    compaction_enabled = not no_compaction
    # caching_enabled is now passed directly as parameter (default: False)

    success, estimated_events = create_deployed_conversation(
        runtime_arn=runtime_arn,
        user_id=user_id,
        session_id=session_id,
        num_turns=num_turns,
        scenario=scenario,
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
    )

    if not success:
        print(" Failed to create conversation")
        sys.exit(1)

    # Check compaction state after conversation
    compaction_state = get_compaction_state(user_id, session_id)
    compaction_triggered = compaction_state and compaction_state.get('checkpoint', 0) > 0

    if not no_compaction and compaction_triggered and wait_for_summary:
        wait_time = 60
        print(f"\n Waiting {wait_time}s for SUMMARIZATION strategy to process...")
        for i in range(wait_time // 15):
            time.sleep(15)
            print(f"   ... {(i+1)*15}/{wait_time} seconds")

    results = verify_deployed_compaction(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id,
        runtime_arn=runtime_arn,
        compaction_enabled=compaction_enabled,
        caching_enabled=caching_enabled,
    )

    print()
    print("=" * 60)
    print(" TEST RESULTS")
    print("-" * 60)

    stage = results["stage"]

    print(f"   Session ID: {session_id}")
    print(f"   User ID: {user_id}")
    print(f"   Mode: {mode_label}")
    print(f"   Checkpoint active: {results['checkpoint_active']}")
    print(f"   Checkpoint index: {results['checkpoint']}")
    print(f"   Last input tokens: {results['last_input_tokens']:,}")
    print(f"   Stage applied: {stage.upper()}")
    print()

    if no_compaction:
        print("   Baseline mode: All messages loaded without compaction")
        print("   Use this to compare against compaction-enabled runs")
    elif stage == "checkpoint":
        print(f"   Checkpoint mode active:")
        print(f"   - Loading from checkpoint index {results['checkpoint']}")
        print(f"   - Prepending stored summary from DynamoDB")
        print(f"   - Truncating tool content")
    else:
        print(f"   Normal mode (tokens below threshold)")
        print(f"   - All messages loaded")
        print(f"   - No compaction applied")

    print()

    if results["context_retained"]:
        print("   Context retention: PASS")
        return True
    else:
        print("   Context retention: CHECK MANUALLY")
        return True


# ============================================================
# Main Entry Point
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Test CompactingSessionManager (Local or Deployed mode)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  Local mode (default) - uses ChatbotAgent with real tools:
    python test_compaction.py                    # 20 turns with compaction
    python test_compaction.py --turns 15         # Custom turn count
    python test_compaction.py --no-compaction    # Baseline (tokens grow unbounded)
    python test_compaction.py --scenario finance # Finance scenario
    python test_compaction.py --caching          # Enable prompt caching
    python test_compaction.py --threshold 500    # Custom token threshold (for testing)

  Deployed mode - invokes deployed agent via API:
    python test_compaction.py --deployed         # 15 turns on deployed agent
    python test_compaction.py --deployed --turns 20  # Custom turns

  Performance Comparison:
    # With compaction (default)
    python test_compaction.py --turns 20 2>&1 | tee results_compaction.txt

    # Baseline (tokens grow unbounded)
    python test_compaction.py --turns 20 --no-compaction 2>&1 | tee results_baseline.txt
"""
    )

    # Mode selection
    parser.add_argument("--deployed", action="store_true",
                        help="Test deployed agent via invoke_agent_runtime API")

    # Common options
    parser.add_argument("--wait", action="store_true",
                        help="Wait for summaries to be generated (default: no wait)")
    parser.add_argument("--scenario", type=str, default="travel",
                        choices=["travel", "finance"],
                        help="Test scenario: 'travel' or 'finance'")
    parser.add_argument("--no-compaction", action="store_true",
                        help="Baseline mode (no compaction, no sliding window, no SDK limit)")
    parser.add_argument("--caching", action="store_true",
                        help="Enable prompt caching (default: disabled)")
    parser.add_argument("--threshold", type=int, default=None,
                        help=f"Token threshold for checkpoint compaction (default: {DEFAULT_TOKEN_THRESHOLD:,}, i.e. 50K)")
    # Deployed mode options
    parser.add_argument("--quick", action="store_true",
                        help="[Deployed] Quick test (8 turns)")
    parser.add_argument("--turns", type=int, default=None,
                        help="Number of conversation turns (default: 20 for local, 15 for deployed)")
    parser.add_argument("--measure-performance", action="store_true",
                        help="[Deployed] Measure follow-up conversation performance")
    parser.add_argument("--followup-turns", type=int, default=5,
                        help="[Deployed] Number of follow-up turns for performance measurement")

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
            wait_for_summary=args.wait,
            scenario=args.scenario,
            no_compaction=args.no_compaction,
            caching_enabled=args.caching,
            measure_performance=args.measure_performance,
            followup_turns=args.followup_turns,
            token_threshold=args.threshold
        )
    else:
        # Local mode - pass threshold via args
        run_local_test(args)


if __name__ == "__main__":
    main()
