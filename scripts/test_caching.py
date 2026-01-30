#!/usr/bin/env python3 -u
"""
Agent Loop Caching Test Script

Tests prompt caching with ConversationCachingHook.
Measures per-call metrics: tokens, TTFT, latency, cache hit rate.

Usage:
    python test_caching.py                              # Quick validation test
    python test_caching.py --mode deep-research         # Deep research (10+ tool calls)
    python test_caching.py --mode latency               # Context size latency test (10K-100K)
    python test_caching.py --mode latency --compare     # Compare cache ON vs OFF
    python test_caching.py --mode latency --repeat 5    # Repeat 5 times for statistics
"""

import argparse
import sys
import os

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

import time
import asyncio
import logging
import warnings
from typing import List, Dict, Any

warnings.filterwarnings("ignore", message=".*cannot join thread.*")

logging.basicConfig(level=logging.WARNING, format='%(asctime)s - %(levelname)s - %(message)s')
logging.getLogger('strands').setLevel(logging.WARNING)
logging.getLogger('botocore').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

# Add local_tools path for real web search and url fetcher
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src', 'local_tools'))

# Add research agent path for tools
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'agent-blueprint', 'agentcore-runtime-a2a-stack', 'research-agent', 'src'))

# Import production caching hook
from agent.agent import ConversationCachingHook

# Import research agent tools (chart excluded per user request)
from tools import (
    ddg_web_search as research_ddg_web_search,
    fetch_url_content as research_fetch_url_content,
    wikipedia_search,
    wikipedia_get_article,
    write_markdown_section,
    read_markdown_file
)

# Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
CYAN = "\033[96m"
RESET = "\033[0m"
BOLD = "\033[1m"


class NoCacheHook:
    """Removes all cache points - for baseline comparison"""
    def __init__(self):
        self.enabled = True

    def register_hooks(self, registry, **kwargs):
        from strands.hooks import BeforeModelCallEvent
        registry.add_callback(BeforeModelCallEvent, self.remove_cache_points)

    def remove_cache_points(self, event):
        if not event.agent.messages:
            return
        for msg in event.agent.messages:
            content = msg.get("content", [])
            if isinstance(content, list):
                msg["content"] = [
                    block for block in content
                    if not (isinstance(block, dict) and "cachePoint" in block)
                ]


class CallMetrics:
    """Metrics collected for a single LLM call."""
    def __init__(self, call_num: int, turn: int = 1):
        self.call = call_num
        self.turn = turn
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read = 0
        self.cache_write = 0
        self.total_context = 0
        self.hit_rate = 0.0
        self.ttft_ms = 0.0
        self.latency_ms = 0.0
        self.tool_name = None

    def to_dict(self):
        return {
            'call': self.call,
            'turn': self.turn,
            'input_tokens': self.input_tokens,
            'output_tokens': self.output_tokens,
            'cache_read': self.cache_read,
            'cache_write': self.cache_write,
            'total_context': self.total_context,
            'hit_rate': self.hit_rate,
            'ttft_ms': self.ttft_ms,
            'latency_ms': self.latency_ms,
            'tool_name': self.tool_name
        }


def print_metrics_table(metrics: List[Dict], title: str):
    """Print metrics in a nice table format"""
    print(f"\n{CYAN}{'='*120}{RESET}")
    print(f"{BOLD}{title}{RESET}")
    print(f"{CYAN}{'='*120}{RESET}")

    # Header
    print(f"{'Call':<6} {'Turn':<6} {'Input':<10} {'Output':<10} {'CacheRead':<12} {'CacheWrite':<12} {'Context':<12} {'HitRate':<10} {'TTFT':<10} {'Latency':<10}")
    print("-" * 118)

    for m in metrics:
        hit_rate_str = f"{m.get('hit_rate', 0):.1f}%"
        ttft_str = f"{m.get('ttft_ms', 0):.0f}ms" if m.get('ttft_ms', 0) > 0 else "-"
        latency_str = f"{m.get('latency_ms', 0):.0f}ms"
        print(f"{m['call']:<6} {m.get('turn', 1):<6} {m['input_tokens']:>8,}  {m['output_tokens']:>8,}  {m['cache_read']:>10,}  {m['cache_write']:>10,}  {m['total_context']:>10,}  {hit_rate_str:>8}  {ttft_str:>8}  {latency_str:>8}")

    print("-" * 118)

    # Summary row
    total_input = sum(m['input_tokens'] for m in metrics)
    total_output = sum(m['output_tokens'] for m in metrics)
    total_cache_read = sum(m['cache_read'] for m in metrics)
    total_cache_write = sum(m['cache_write'] for m in metrics)
    total_context = total_input + total_cache_read + total_cache_write
    avg_hit_rate = (total_cache_read / total_context * 100) if total_context > 0 else 0
    avg_ttft = sum(m.get('ttft_ms', 0) for m in metrics) / len(metrics) if metrics else 0
    total_latency = sum(m.get('latency_ms', 0) for m in metrics)

    print(f"{'TOTAL':<6} {'':<6} {total_input:>8,}  {total_output:>8,}  {total_cache_read:>10,}  {total_cache_write:>10,}  {total_context:>10,}  {avg_hit_rate:>7.1f}%  {avg_ttft:>7.0f}ms  {total_latency:>7.0f}ms")
    print()


def generate_context_content(target_tokens: int) -> str:
    """Generate filler content to reach target token count.

    Rough estimate: 1 token ≈ 4 characters for English text.
    """
    base_paragraph = """Cloud computing represents a fundamental shift in how organizations deploy and manage IT infrastructure.
This comprehensive overview covers key concepts including Infrastructure as a Service (IaaS), Platform as a Service (PaaS),
and Software as a Service (SaaS). Modern cloud architectures leverage virtual machines, container orchestration with Kubernetes,
serverless computing, and managed databases. Security best practices include identity management, data encryption,
network security, and compliance governance. DevOps practices enable continuous integration and deployment through
automated pipelines, infrastructure as code, and comprehensive observability with metrics, logging, and tracing.
Cost optimization strategies include right-sizing resources, reserved capacity, spot instances, and storage tiering.
Microservices architecture patterns emphasize single responsibility, API-first development, and resilience through
circuit breakers, retry mechanisms, and health checks. Multi-cloud strategies help avoid vendor lock-in while
edge computing extends capabilities closer to end users for IoT and real-time applications.

"""

    target_chars = target_tokens * 4
    content = ""
    section_num = 0

    while len(content) < target_chars:
        section_num += 1
        content += f"[Section {section_num}] " + base_paragraph

    return content[:target_chars]


# =============================================================================
# MODE 1: Quick Validation Test
# =============================================================================

async def run_quick_test(cache_enabled: bool = True) -> Dict:
    """
    Quick validation test for ConversationCachingHook.
    2 turns with web search to verify cache hit on second turn.
    """
    from strands import Agent
    from strands.models import BedrockModel
    from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent
    from web_search import ddg_web_search

    strategy_name = f"Quick Test (Cache {'ON' if cache_enabled else 'OFF'})"

    print(f"\n{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{strategy_name}{RESET}")
    print(f"2 turns with web search - verifying cache behavior")
    print(f"{CYAN}{'='*60}{RESET}")

    # Track call timing
    call_state = {
        "call_start": None,
        "first_token_time": None,
        "call_ttft_captured": False,
    }

    class TimingHookProvider(HookProvider):
        def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
            registry.add_callback(BeforeModelCallEvent, self.on_before_model)

        def on_before_model(self, event: BeforeModelCallEvent) -> None:
            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

    system_prompt = """You are a helpful research assistant. Use ddg_web_search to find information.
Provide concise answers based on search results.

This system prompt needs sufficient length for cache testing. Additional padding text here.
Research methodology: Search first, then summarize key findings in 2-3 sentences."""

    model = BedrockModel(
        model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        temperature=0.0,
        max_tokens=1024
    )

    # Use production ConversationCachingHook or NoCacheHook
    if cache_enabled:
        hooks = [ConversationCachingHook(enabled=True), TimingHookProvider()]
    else:
        hooks = [NoCacheHook(), TimingHookProvider()]

    agent = Agent(
        model=model,
        system_prompt=system_prompt,
        tools=[ddg_web_search],
        hooks=hooks
    )

    prompts = [
        "Search for Python programming language and summarize.",
        "Now search for JavaScript and compare with Python."
    ]

    all_metrics = []
    total_calls = 0
    seen_tool_ids = set()

    for turn_idx, prompt in enumerate(prompts):
        print(f"\n{YELLOW}--- Turn {turn_idx + 1} ---{RESET}")
        print(f"Prompt: {prompt[:50]}...")

        call_num = 0
        call_state["call_start"] = time.time()
        seen_tool_ids.clear()

        async for event in agent.stream_async(prompt):
            if not call_state["call_ttft_captured"]:
                if isinstance(event, dict):
                    if "event" in event and isinstance(event["event"], dict):
                        raw = event["event"]
                        if "contentBlockDelta" in raw or "contentBlockStart" in raw:
                            call_state["first_token_time"] = time.time()
                            call_state["call_ttft_captured"] = True

            if isinstance(event, dict):
                if "event" in event and isinstance(event["event"], dict):
                    raw = event["event"]
                    if "metadata" in raw:
                        usage = raw["metadata"].get("usage", {})
                        if usage.get("inputTokens", 0) > 0:
                            call_num += 1
                            total_calls += 1
                            call_end = time.time()

                            call_start = call_state["call_start"]
                            first_token = call_state["first_token_time"]
                            ttft = (first_token - call_start) * 1000 if first_token else 0
                            latency = (call_end - call_start) * 1000 if call_start else 0

                            input_tokens = usage.get('inputTokens', 0)
                            output_tokens = usage.get('outputTokens', 0)
                            cache_read = usage.get('cacheReadInputTokens', 0)
                            cache_write = usage.get('cacheWriteInputTokens', 0)
                            total_context = input_tokens + cache_read + cache_write
                            hit_rate = (cache_read / total_context * 100) if total_context > 0 else 0

                            m = CallMetrics(total_calls, turn=turn_idx + 1)
                            m.input_tokens = input_tokens
                            m.output_tokens = output_tokens
                            m.cache_read = cache_read
                            m.cache_write = cache_write
                            m.total_context = total_context
                            m.hit_rate = hit_rate
                            m.ttft_ms = ttft
                            m.latency_ms = latency
                            all_metrics.append(m.to_dict())

                            status = f"{GREEN}HIT{RESET}" if cache_read > 0 else f"{RED}MISS{RESET}"
                            print(f"  Call {call_num}: in={input_tokens:,}, read={cache_read:,}, write={cache_write:,}, hit={hit_rate:.1f}% [{status}]")

                            call_state["call_start"] = time.time()
                            call_state["call_ttft_captured"] = False

                if "current_tool_use" in event:
                    tool_info = event["current_tool_use"]
                    tool_name = tool_info.get("name")
                    tool_id = tool_info.get("toolUseId")
                    if tool_name and tool_id and tool_id not in seen_tool_ids:
                        seen_tool_ids.add(tool_id)
                        print(f"    -> Tool: {tool_name}")

    # Summary
    total_input = sum(m['input_tokens'] for m in all_metrics)
    total_cache_read = sum(m['cache_read'] for m in all_metrics)
    total_cache_write = sum(m['cache_write'] for m in all_metrics)
    total_context = total_input + total_cache_read + total_cache_write
    hit_rate = (total_cache_read / total_context * 100) if total_context > 0 else 0

    print(f"\n{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}Summary: {strategy_name}{RESET}")
    print(f"  Total Calls:     {total_calls}")
    print(f"  Total Input:     {total_input:,}")
    print(f"  Cache Read:      {total_cache_read:,}")
    print(f"  Cache Write:     {total_cache_write:,}")
    print(f"  Hit Rate:        {hit_rate:.1f}%")

    if cache_enabled and hit_rate > 0:
        print(f"  {GREEN}Cache is working!{RESET}")
    elif cache_enabled:
        print(f"  {YELLOW}No cache hits - check if context is large enough{RESET}")

    return {
        'strategy': strategy_name,
        'cache_enabled': cache_enabled,
        'total_calls': total_calls,
        'total_input': total_input,
        'cache_read': total_cache_read,
        'cache_write': total_cache_write,
        'hit_rate': hit_rate,
        'per_call_metrics': all_metrics
    }


# =============================================================================
# MODE 2: Deep Research Agent Test
# =============================================================================

async def run_deep_research_test(cache_enabled: bool = True) -> Dict:
    """
    Deep Research Agent test (Single Turn, Multi Loop).
    Uses the same tools and system prompt as A2A research agent (chart excluded).
    Single user question triggers 10+ LLM calls.
    Measures TTFT, tokens, cache metrics per call.
    """
    from strands import Agent
    from strands.models import BedrockModel
    from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent
    from datetime import datetime

    strategy_name = "Deep Research (Cache ON)" if cache_enabled else "Deep Research (Cache OFF)"

    print(f"\n{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}Scenario: {strategy_name}{RESET}")
    print(f"  Using Research Agent tools and system prompt (A2A compatible)")
    print(f"  Single turn with 10+ tool calls")
    print(f"{CYAN}{'='*60}{RESET}")

    call_state = {
        "call_start": None,
        "first_token_time": None,
        "call_ttft_captured": False,
    }

    class TimingHookProvider(HookProvider):
        def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
            registry.add_callback(BeforeModelCallEvent, self.on_before_model)

        def on_before_model(self, event: BeforeModelCallEvent) -> None:
            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

    if cache_enabled:
        hooks = [ConversationCachingHook(enabled=True), TimingHookProvider()]
    else:
        hooks = [NoCacheHook(), TimingHookProvider()]

    # Research Agent System Prompt (same as A2A research agent, chart section removed)
    system_prompt = """You are a Research Agent - conduct comprehensive web research and create structured research reports.

**Your Task:**
When given a research plan, execute it by gathering information and generating a structured report.

1. **Research Phase**: Gather information from multiple sources
   - Use ddg_web_search() to find relevant web articles and information
   - Use wikipedia_search() and wikipedia_get_article() for encyclopedic knowledge
   - Use fetch_url_content() to read full articles when needed
   - Collect at least 3-5 diverse sources for comprehensive coverage

2. **Document Creation Phase**: Write sections directly to markdown file
   - Use write_markdown_section(heading, content, citations) to write each section
   - Sections are automatically appended to the markdown file

**Available Tools:**
- ddg_web_search(query, max_results=5): Search the web with DuckDuckGo
- wikipedia_search(query): Find Wikipedia articles
- wikipedia_get_article(title, summary_only=False): Get full Wikipedia article content
- fetch_url_content(url): Extract full text content from any URL
- write_markdown_section(heading, content, citations=[]): Write a section to research_report.md
- read_markdown_file(): Read current markdown content

**Rules:**
- Conduct thorough research with multiple sources before writing
- Always cite sources inline using ([Source Name](url)) format
- Execute research and writing automatically without asking permission
- Keep your final response concise and professional"""

    current_date = datetime.now().strftime("%Y-%m-%d")
    system_prompt_with_date = f"{system_prompt}\n\nCurrent date: {current_date}"

    model = BedrockModel(
        model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        temperature=0.0,
        max_tokens=8192
    )

    tools = [
        research_ddg_web_search,
        research_fetch_url_content,
        wikipedia_search,
        wikipedia_get_article,
        write_markdown_section,
        read_markdown_file
    ]

    agent = Agent(
        name="Research Agent",
        model=model,
        system_prompt=system_prompt_with_date,
        tools=tools,
        hooks=hooks
    )

    research_prompt = """Conduct comprehensive research on "The Impact of Generative AI on Software Development in 2024-2025".

You MUST follow this research plan step by step:

## Phase 1: Market Overview (3 searches + 2 URL reads)
1. Search for "generative AI software development market 2024"
2. Search for "GitHub Copilot adoption statistics 2024"
3. Search for "AI coding assistants market share comparison"
4. Read 2 promising URLs from these searches

## Phase 2: Developer Productivity Studies (3 searches + 2 URL reads)
5. Search for "AI coding assistant productivity research study"
6. Search for "developer experience with GitHub Copilot survey"
7. Search for "AI pair programming effectiveness metrics"
8. Read 2 URLs with detailed study findings

## Phase 3: Enterprise Adoption (2 searches + 2 URL reads)
9. Search for "enterprise generative AI adoption challenges 2024"
10. Search for "Fortune 500 AI coding tools implementation"
11. Read 2 URLs about enterprise case studies

## Phase 4: Future Trends (2 searches + 1 URL read)
12. Search for "AI software development predictions 2025"
13. Search for "autonomous AI coding agents future"
14. Read 1 URL about future predictions

After completing ALL searches and reads, write a comprehensive markdown report using write_markdown_section().

IMPORTANT: Execute EVERY search and URL read listed above. Do not skip any steps."""

    all_metrics = []
    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_write = 0
    call_num = [0]
    current_tool = [None]
    seen_tool_ids = set()

    start_time = time.time()
    call_state["call_start"] = time.time()

    async for event in agent.stream_async(research_prompt):
        if not call_state["call_ttft_captured"]:
            if isinstance(event, dict):
                if "event" in event and isinstance(event["event"], dict):
                    raw = event["event"]
                    if "contentBlockDelta" in raw or "contentBlockStart" in raw:
                        call_state["first_token_time"] = time.time()
                        call_state["call_ttft_captured"] = True

        if isinstance(event, dict):
            if "event" in event and isinstance(event["event"], dict):
                raw = event["event"]
                if "metadata" in raw:
                    usage = raw["metadata"].get("usage", {})
                    if usage.get("inputTokens", 0) > 0:
                        call_num[0] += 1
                        call_end = time.time()
                        call_latency = (call_end - call_state["call_start"]) * 1000 if call_state["call_start"] else 0
                        ttft = (call_state["first_token_time"] - call_state["call_start"]) * 1000 if call_state["first_token_time"] else 0

                        input_tokens = usage.get('inputTokens', 0)
                        output_tokens = usage.get('outputTokens', 0)
                        cache_read = usage.get('cacheReadInputTokens', 0)
                        cache_write = usage.get('cacheWriteInputTokens', 0)
                        total_context = input_tokens + cache_read + cache_write
                        hit_rate = (cache_read / total_context * 100) if total_context > 0 else 0

                        m = CallMetrics(call_num[0], turn=1)
                        m.input_tokens = input_tokens
                        m.output_tokens = output_tokens
                        m.cache_read = cache_read
                        m.cache_write = cache_write
                        m.total_context = total_context
                        m.hit_rate = hit_rate
                        m.ttft_ms = ttft
                        m.latency_ms = call_latency
                        m.tool_name = current_tool[0]

                        all_metrics.append(m.to_dict())

                        status = f"{GREEN}HIT{RESET}" if cache_read > 0 else f"{RED}MISS{RESET}"
                        print(f"  {BLUE}Call {call_num[0]:2d}:{RESET} in={input_tokens:,}, out={output_tokens:,}, read={cache_read:,}, write={cache_write:,}, hit={hit_rate:.1f}% [{status}], ttft={ttft:.0f}ms")

                        total_input += input_tokens
                        total_output += output_tokens
                        total_cache_read += cache_read
                        total_cache_write += cache_write

                        call_state["call_start"] = time.time()
                        call_state["call_ttft_captured"] = False
                        current_tool[0] = None

            if "current_tool_use" in event:
                tool_info = event["current_tool_use"]
                tool_name = tool_info.get("name")
                tool_id = tool_info.get("toolUseId")
                if tool_name and tool_id and tool_id not in seen_tool_ids:
                    seen_tool_ids.add(tool_id)
                    current_tool[0] = tool_name
                    print(f"    -> Tool: {tool_name}")

    total_time = time.time() - start_time
    overall_total = total_input + total_cache_read + total_cache_write
    hit_rate = (total_cache_read / overall_total * 100) if overall_total > 0 else 0

    # Cost calculation (Claude Haiku 4.5 pricing, as of January 2025)
    INPUT_PRICE = 1.00 / 1_000_000
    OUTPUT_PRICE = 5.00 / 1_000_000
    CACHE_WRITE_PRICE = 1.25 / 1_000_000
    CACHE_READ_PRICE = 0.10 / 1_000_000

    cost = total_input * INPUT_PRICE + total_output * OUTPUT_PRICE + total_cache_write * CACHE_WRITE_PRICE + total_cache_read * CACHE_READ_PRICE
    no_cache_cost = overall_total * INPUT_PRICE + total_output * OUTPUT_PRICE
    savings = no_cache_cost - cost
    savings_pct = (savings / no_cache_cost * 100) if no_cache_cost > 0 else 0

    print_metrics_table(all_metrics, f"Per-Call Metrics: {strategy_name}")

    print(f"\n{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}Summary: {strategy_name}{RESET}")
    print(f"  Total LLM Calls: {call_num[0]}")
    print(f"  Total Time:      {total_time:.2f}s")
    print(f"  Total Input:     {total_input:,}")
    print(f"  Total Output:    {total_output:,}")
    print(f"  Cache Read:      {total_cache_read:,}")
    print(f"  Cache Write:     {total_cache_write:,}")
    print(f"  Hit Rate:        {hit_rate:.1f}%")
    print(f"  Cost:            ${cost:.4f}")
    print(f"  Without Cache:   ${no_cache_cost:.4f}")
    print(f"  Savings:         ${savings:.4f} ({savings_pct:.1f}%)")

    return {
        'strategy': strategy_name,
        'cache_enabled': cache_enabled,
        'total_calls': call_num[0],
        'total_time': total_time,
        'total_input': total_input,
        'total_output': total_output,
        'cache_read': total_cache_read,
        'cache_write': total_cache_write,
        'total_context': overall_total,
        'hit_rate': hit_rate,
        'cost': cost,
        'no_cache_cost': no_cache_cost,
        'savings_pct': savings_pct,
        'per_call_metrics': all_metrics
    }


# =============================================================================
# MODE 3: Context Size Latency Test (Fixture-based, No Tools)
# =============================================================================

async def run_latency_test(cache_enabled: bool = True, context_sizes: List[int] = None) -> Dict:
    """
    Context Size Latency Test.

    For each context size (10K, 20K, ... 100K):
    - If cache_enabled: warm-up call (cache write) -> cached call (cache read) using SAME agent
    - If not cache_enabled: single call without cache

    Measures TTFT and total latency for each.
    """
    from strands import Agent
    from strands.models import BedrockModel
    from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent

    if context_sizes is None:
        context_sizes = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80]

    strategy_name = f"Latency Test (Cache {'ON' if cache_enabled else 'OFF'})"

    print(f"\n{CYAN}{'='*70}{RESET}")
    print(f"{BOLD}{strategy_name}{RESET}")
    print(f"Testing context sizes: {', '.join(f'{s}K' for s in context_sizes)}")
    print(f"{CYAN}{'='*70}{RESET}")

    # Shared call state for timing
    call_state = {
        "call_start": None,
        "first_token_time": None,
        "call_ttft_captured": False,
    }

    class TimingHookProvider(HookProvider):
        def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
            registry.add_callback(BeforeModelCallEvent, self.on_before_model)

        def on_before_model(self, event: BeforeModelCallEvent) -> None:
            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

    all_results = []

    for size_k in context_sizes:
        print(f"\n{YELLOW}--- Context Size: {size_k}K tokens ---{RESET}")

        # Generate context content for this size
        target_tokens = size_k * 1000
        context_content = generate_context_content(target_tokens)

        # System prompt with embedded context
        system_prompt = f"""You are a helpful assistant. You have been given the following reference document to use when answering questions.

<reference_document>
{context_content}
</reference_document>

When asked a question, respond with EXACTLY this format:
"The answer is: [your brief answer]"

Keep your response under 50 words."""

        model = BedrockModel(
            model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
            temperature=0.0,
            max_tokens=100
        )

        # Set up hooks based on cache mode
        if cache_enabled:
            hooks = [ConversationCachingHook(enabled=True), TimingHookProvider()]
        else:
            hooks = [NoCacheHook(), TimingHookProvider()]

        # Create agent ONCE per context size
        agent = Agent(
            model=model,
            system_prompt=system_prompt,
            tools=[],
            hooks=hooks
        )

        # Deterministic prompts - need 3 calls for cache to work:
        # Call 1: No assistant msg yet → no cache point → write=0
        # Call 2: Has assistant msg from call 1 → cache point added → write>0
        # Call 3: Cache point exists → read from cache → read>0
        prompt1 = "Based on the reference document, what is the main topic discussed? Answer briefly."
        prompt2 = "Based on the reference document, list the key service models mentioned."
        prompt3 = "Based on the reference document, summarize the security practices in one sentence."

        async def measure_call(prompt: str) -> Dict:
            """Run a single call and measure metrics."""
            result = {
                'input_tokens': 0,
                'output_tokens': 0,
                'cache_read': 0,
                'cache_write': 0,
                'total_context': 0,
                'hit_rate': 0.0,
                'ttft_ms': 0.0,
                'latency_ms': 0.0,
            }

            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

            async for event in agent.stream_async(prompt):
                if not call_state["call_ttft_captured"]:
                    if isinstance(event, dict):
                        if "event" in event and isinstance(event["event"], dict):
                            raw = event["event"]
                            if "contentBlockDelta" in raw or "contentBlockStart" in raw:
                                call_state["first_token_time"] = time.time()
                                call_state["call_ttft_captured"] = True

                if isinstance(event, dict):
                    if "event" in event and isinstance(event["event"], dict):
                        raw = event["event"]
                        if "metadata" in raw:
                            usage = raw["metadata"].get("usage", {})
                            if usage.get("inputTokens", 0) > 0:
                                call_end = time.time()

                                result['input_tokens'] = usage.get('inputTokens', 0)
                                result['output_tokens'] = usage.get('outputTokens', 0)
                                result['cache_read'] = usage.get('cacheReadInputTokens', 0)
                                result['cache_write'] = usage.get('cacheWriteInputTokens', 0)
                                result['total_context'] = result['input_tokens'] + result['cache_read'] + result['cache_write']
                                result['hit_rate'] = (result['cache_read'] / result['total_context'] * 100) if result['total_context'] > 0 else 0
                                result['ttft_ms'] = (call_state["first_token_time"] - call_state["call_start"]) * 1000 if call_state["first_token_time"] else 0
                                result['latency_ms'] = (call_end - call_state["call_start"]) * 1000

            return result

        if cache_enabled:
            # Call 1: Initial (no assistant msg yet, so no cache point)
            print(f"  [1/3] Initial (no cache yet)...", end=" ", flush=True)
            init_result = await measure_call(prompt1)
            print(f"TTFT={init_result['ttft_ms']:.0f}ms, Lat={init_result['latency_ms']:.0f}ms")

            await asyncio.sleep(0.3)

            # Call 2: Warm-up (now has assistant msg, cache point added → write)
            print(f"  [2/3] Warm-up (cache write)...", end=" ", flush=True)
            warmup_result = await measure_call(prompt2)
            print(f"TTFT={warmup_result['ttft_ms']:.0f}ms, Lat={warmup_result['latency_ms']:.0f}ms, Write={warmup_result['cache_write']:,}")

            await asyncio.sleep(0.3)

            # Call 3: Cached (should read from cache)
            print(f"  [3/3] Cached (cache read)...", end=" ", flush=True)
            cached_result = await measure_call(prompt3)
            hit_status = f"{GREEN}HIT{RESET}" if cached_result['cache_read'] > 0 else f"{RED}MISS{RESET}"
            print(f"TTFT={cached_result['ttft_ms']:.0f}ms, Lat={cached_result['latency_ms']:.0f}ms, Read={cached_result['cache_read']:,} [{hit_status}]")

            all_results.append({
                'context_size_k': size_k,
                'init_ttft_ms': init_result['ttft_ms'],
                'init_latency_ms': init_result['latency_ms'],
                'warmup_ttft_ms': warmup_result['ttft_ms'],
                'warmup_latency_ms': warmup_result['latency_ms'],
                'warmup_cache_write': warmup_result['cache_write'],
                'cached_ttft_ms': cached_result['ttft_ms'],
                'cached_latency_ms': cached_result['latency_ms'],
                'cached_cache_read': cached_result['cache_read'],
                'cached_hit_rate': cached_result['hit_rate'],
            })
        else:
            # No cache - single call
            print(f"  [1/1] No cache...", end=" ", flush=True)
            nocache_result = await measure_call(prompt1)
            print(f"TTFT={nocache_result['ttft_ms']:.0f}ms, Lat={nocache_result['latency_ms']:.0f}ms")

            all_results.append({
                'context_size_k': size_k,
                'nocache_ttft_ms': nocache_result['ttft_ms'],
                'nocache_latency_ms': nocache_result['latency_ms'],
            })

    # Print summary table
    print(f"\n{CYAN}{'='*90}{RESET}")
    print(f"{BOLD}Summary: {strategy_name}{RESET}")
    print(f"{CYAN}{'='*90}{RESET}")

    if cache_enabled:
        print(f"{'Context':<10} {'Warmup TTFT':<14} {'Warmup Lat':<14} {'Cached TTFT':<14} {'Cached Lat':<14} {'Hit Rate':<10}")
        print("-" * 86)
        for r in all_results:
            print(f"{r['context_size_k']}K{'':<7} {r['warmup_ttft_ms']:.0f}ms{'':<8} {r['warmup_latency_ms']:.0f}ms{'':<8} {r['cached_ttft_ms']:.0f}ms{'':<8} {r['cached_latency_ms']:.0f}ms{'':<8} {r['cached_hit_rate']:.1f}%")
    else:
        print(f"{'Context':<10} {'TTFT':<14} {'Latency':<14}")
        print("-" * 38)
        for r in all_results:
            print(f"{r['context_size_k']}K{'':<7} {r['nocache_ttft_ms']:.0f}ms{'':<8} {r['nocache_latency_ms']:.0f}ms")

    return {
        'strategy': strategy_name,
        'cache_enabled': cache_enabled,
        'context_sizes': context_sizes,
        'results': all_results
    }


# =============================================================================
# MODE 4: Cache Write Overhead Test
# =============================================================================

async def run_write_overhead_test(context_sizes: List[int] = None) -> Dict:
    """
    Cache Write Overhead Test.

    For each context size, compare:
    - Cache OFF (2nd call): baseline without cache point
    - Cache ON (2nd call): with cache write happening

    This isolates the pure write overhead.
    """
    from strands import Agent
    from strands.models import BedrockModel
    from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent

    if context_sizes is None:
        context_sizes = [10, 20, 30, 40, 50, 60, 70, 80]

    print(f"\n{CYAN}{'='*70}{RESET}")
    print(f"{BOLD}Cache Write Overhead Test{RESET}")
    print(f"Comparing 2nd call: Cache OFF (baseline) vs Cache ON (write)")
    print(f"Context sizes: {', '.join(f'{s}K' for s in context_sizes)}")
    print(f"{CYAN}{'='*70}{RESET}")

    call_state = {
        "call_start": None,
        "first_token_time": None,
        "call_ttft_captured": False,
    }

    class TimingHookProvider(HookProvider):
        def register_hooks(self, registry: HookRegistry, **kwargs) -> None:
            registry.add_callback(BeforeModelCallEvent, self.on_before_model)

        def on_before_model(self, event: BeforeModelCallEvent) -> None:
            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

    all_results = []

    for size_k in context_sizes:
        print(f"\n{YELLOW}--- Context Size: {size_k}K tokens ---{RESET}")

        target_tokens = size_k * 1000
        context_content = generate_context_content(target_tokens)

        system_prompt = f"""You are a helpful assistant. You have been given the following reference document.

<reference_document>
{context_content}
</reference_document>

When asked a question, respond with EXACTLY: "The answer is: [brief answer]"
Keep response under 50 words."""

        prompt1 = "What is the main topic of the reference document?"
        prompt2 = "List the key service models mentioned."

        async def run_two_calls(cache_enabled: bool) -> Dict:
            """Run 2 calls and return 2nd call metrics."""
            model = BedrockModel(
                model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
                temperature=0.0,
                max_tokens=100
            )

            if cache_enabled:
                hooks = [ConversationCachingHook(enabled=True), TimingHookProvider()]
            else:
                hooks = [NoCacheHook(), TimingHookProvider()]

            agent = Agent(
                model=model,
                system_prompt=system_prompt,
                tools=[],
                hooks=hooks
            )

            # Call 1: Setup (creates assistant message)
            call_state["call_start"] = time.time()
            async for event in agent.stream_async(prompt1):
                pass

            await asyncio.sleep(0.2)

            # Call 2: Measure this one (write happens here for cache ON)
            result = {
                'ttft_ms': 0, 'latency_ms': 0,
                'cache_write': 0, 'cache_read': 0, 'input_tokens': 0
            }

            call_state["call_start"] = time.time()
            call_state["first_token_time"] = None
            call_state["call_ttft_captured"] = False

            async for event in agent.stream_async(prompt2):
                if not call_state["call_ttft_captured"]:
                    if isinstance(event, dict) and "event" in event:
                        raw = event.get("event", {})
                        if "contentBlockDelta" in raw or "contentBlockStart" in raw:
                            call_state["first_token_time"] = time.time()
                            call_state["call_ttft_captured"] = True

                if isinstance(event, dict) and "event" in event:
                    raw = event.get("event", {})
                    if "metadata" in raw:
                        usage = raw["metadata"].get("usage", {})
                        if usage.get("inputTokens", 0) > 0:
                            call_end = time.time()
                            result['input_tokens'] = usage.get('inputTokens', 0)
                            result['cache_write'] = usage.get('cacheWriteInputTokens', 0)
                            result['cache_read'] = usage.get('cacheReadInputTokens', 0)
                            result['ttft_ms'] = (call_state["first_token_time"] - call_state["call_start"]) * 1000 if call_state["first_token_time"] else 0
                            result['latency_ms'] = (call_end - call_state["call_start"]) * 1000

            return result

        # Run Cache OFF (baseline)
        print(f"  Cache OFF (baseline)...", end=" ", flush=True)
        off_result = await run_two_calls(cache_enabled=False)
        print(f"TTFT={off_result['ttft_ms']:.0f}ms, Lat={off_result['latency_ms']:.0f}ms")

        await asyncio.sleep(0.5)

        # Run Cache ON (write)
        print(f"  Cache ON  (write)...", end=" ", flush=True)
        on_result = await run_two_calls(cache_enabled=True)
        print(f"TTFT={on_result['ttft_ms']:.0f}ms, Lat={on_result['latency_ms']:.0f}ms, Write={on_result['cache_write']:,}")

        # Calculate overhead
        ttft_overhead = on_result['ttft_ms'] - off_result['ttft_ms']
        lat_overhead = on_result['latency_ms'] - off_result['latency_ms']

        color = RED if ttft_overhead > 0 else GREEN
        print(f"  {color}Write Overhead: TTFT={ttft_overhead:+.0f}ms, Lat={lat_overhead:+.0f}ms{RESET}")

        all_results.append({
            'context_size_k': size_k,
            'off_ttft_ms': off_result['ttft_ms'],
            'off_latency_ms': off_result['latency_ms'],
            'on_ttft_ms': on_result['ttft_ms'],
            'on_latency_ms': on_result['latency_ms'],
            'cache_write': on_result['cache_write'],
            'ttft_overhead_ms': ttft_overhead,
            'latency_overhead_ms': lat_overhead,
        })

    # Summary table
    print(f"\n{CYAN}{'='*90}{RESET}")
    print(f"{BOLD}Write Overhead Summary{RESET}")
    print(f"{CYAN}{'='*90}{RESET}")
    print(f"{'Context':<10} {'OFF TTFT':<12} {'ON TTFT':<12} {'TTFT Ovhd':<14} {'OFF Lat':<12} {'ON Lat':<12} {'Lat Ovhd':<14}")
    print("-" * 90)

    for r in all_results:
        ttft_color = RED if r['ttft_overhead_ms'] > 0 else GREEN
        lat_color = RED if r['latency_overhead_ms'] > 0 else GREEN
        print(f"{r['context_size_k']}K{'':<7} {r['off_ttft_ms']:.0f}ms{'':<6} {r['on_ttft_ms']:.0f}ms{'':<6} "
              f"{ttft_color}{r['ttft_overhead_ms']:+.0f}ms{RESET:<8} "
              f"{r['off_latency_ms']:.0f}ms{'':<6} {r['on_latency_ms']:.0f}ms{'':<6} "
              f"{lat_color}{r['latency_overhead_ms']:+.0f}ms{RESET}")

    # Average overhead
    avg_ttft_overhead = sum(r['ttft_overhead_ms'] for r in all_results) / len(all_results)
    avg_lat_overhead = sum(r['latency_overhead_ms'] for r in all_results) / len(all_results)

    print("-" * 90)
    print(f"{'AVERAGE':<10} {'':<12} {'':<12} {avg_ttft_overhead:+.0f}ms{'':<8} {'':<12} {'':<12} {avg_lat_overhead:+.0f}ms")

    return {
        'strategy': 'Write Overhead Test',
        'context_sizes': context_sizes,
        'results': all_results,
        'avg_ttft_overhead_ms': avg_ttft_overhead,
        'avg_latency_overhead_ms': avg_lat_overhead,
    }


def print_latency_comparison(r_on: Dict, r_off: Dict):
    """Print side-by-side comparison of cache ON vs OFF latency results."""
    print(f"\n{CYAN}{'='*100}{RESET}")
    print(f"{BOLD}COMPARISON: Cache ON (Cached) vs Cache OFF{RESET}")
    print(f"{CYAN}{'='*100}{RESET}")

    print(f"\n{'Context':<10} {'Cached TTFT':<14} {'NoCache TTFT':<14} {'TTFT Diff':<16} {'Cached Lat':<14} {'NoCache Lat':<14} {'Lat Diff':<16}")
    print("-" * 110)

    for on_r, off_r in zip(r_on['results'], r_off['results']):
        size_k = on_r['context_size_k']

        cached_ttft = on_r['cached_ttft_ms']
        nocache_ttft = off_r['nocache_ttft_ms']
        ttft_diff = cached_ttft - nocache_ttft
        ttft_pct = (ttft_diff / nocache_ttft * 100) if nocache_ttft > 0 else 0

        cached_lat = on_r['cached_latency_ms']
        nocache_lat = off_r['nocache_latency_ms']
        lat_diff = cached_lat - nocache_lat
        lat_pct = (lat_diff / nocache_lat * 100) if nocache_lat > 0 else 0

        ttft_color = GREEN if ttft_diff < 0 else RED
        lat_color = GREEN if lat_diff < 0 else RED

        print(f"{size_k}K{'':<7} {cached_ttft:.0f}ms{'':<8} {nocache_ttft:.0f}ms{'':<8} {ttft_color}{ttft_diff:+.0f}ms ({ttft_pct:+.1f}%){RESET:<6} {cached_lat:.0f}ms{'':<8} {nocache_lat:.0f}ms{'':<8} {lat_color}{lat_diff:+.0f}ms ({lat_pct:+.1f}%){RESET}")


def print_scenario_comparison(results: List[Dict], title: str):
    """Print detailed comparison for cache ON vs OFF scenarios"""
    print(f"\n{CYAN}{'='*80}{RESET}")
    print(f"{BOLD}{title}{RESET}")
    print(f"{CYAN}{'='*80}{RESET}")

    print(f"\n{'Metric':<25}", end="")
    for r in results:
        strategy_short = r['strategy'].split('(')[1].rstrip(')') if '(' in r['strategy'] else r['strategy'][:20]
        print(f"{strategy_short:>20}", end="")
    print()
    print("-" * (25 + 20 * len(results)))

    metrics = [
        ('Total LLM Calls', 'total_calls', '{}'),
        ('Total Time (s)', 'total_time', '{:.2f}'),
        ('Input Tokens', 'total_input', '{:,}'),
        ('Cache Read', 'cache_read', '{:,}'),
        ('Cache Write', 'cache_write', '{:,}'),
        ('Cache Hit Rate', 'hit_rate', '{:.1f}%'),
        ('Cost', 'cost', '${:.4f}'),
        ('Savings', 'savings_pct', '{:.1f}%'),
    ]

    for label, key, fmt in metrics:
        print(f"{label:<25}", end="")
        for r in results:
            val = r.get(key, 0)
            print(f"{fmt.format(val):>20}", end="")
        print()

    print(f"\n{CYAN}{'='*80}{RESET}")
    if len(results) == 2:
        cache_on = results[0] if results[0].get('cache_enabled', True) else results[1]
        cache_off = results[1] if results[0].get('cache_enabled', True) else results[0]

        cost_reduction = ((cache_off['cost'] - cache_on['cost']) / cache_off['cost'] * 100) if cache_off['cost'] > 0 else 0
        print(f"{GREEN}{BOLD}Cache Benefit:{RESET}")
        print(f"  Cost with caching:    ${cache_on['cost']:.4f}")
        print(f"  Cost without caching: ${cache_off['cost']:.4f}")
        print(f"  {GREEN}Cost reduction: {cost_reduction:.1f}%{RESET}")


def save_test_results(results: List[Dict], scenario_name: str):
    """Save test results to JSON and CSV files."""
    import json
    import csv
    from datetime import datetime

    results_dir = os.path.join(os.path.dirname(__file__), 'test_results')
    os.makedirs(results_dir, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_name = f"{scenario_name}_{timestamp}"

    json_path = os.path.join(results_dir, f"{base_name}.json")
    with open(json_path, 'w') as f:
        json.dump({
            'timestamp': timestamp,
            'scenario': scenario_name,
            'results': results
        }, f, indent=2, default=str)
    print(f"\n{GREEN}JSON saved: {json_path}{RESET}")


def print_aggregate_summary(all_runs: List[tuple], mode: str):
    """Print aggregate summary across all runs."""
    import statistics

    print(f"\n{CYAN}{'='*80}{RESET}")
    print(f"{BOLD}AGGREGATE SUMMARY ({len(all_runs)} runs){RESET}")
    print(f"{CYAN}{'='*80}{RESET}")

    if mode == 'latency':
        # Aggregate latency results by context size
        context_sizes = all_runs[0][0]['context_sizes']

        print(f"\n{BOLD}Average TTFT Improvement (Cached vs NoCache):{RESET}")
        print(f"{'Context':<10} {'Avg Cached':<14} {'Avg NoCache':<14} {'Avg Diff':<16} {'StdDev':<10}")
        print("-" * 70)

        for idx, size_k in enumerate(context_sizes):
            cached_ttfts = [run[0]['results'][idx]['cached_ttft_ms'] for run in all_runs]
            nocache_ttfts = [run[1]['results'][idx]['nocache_ttft_ms'] for run in all_runs]
            diffs = [c - n for c, n in zip(cached_ttfts, nocache_ttfts)]

            avg_cached = statistics.mean(cached_ttfts)
            avg_nocache = statistics.mean(nocache_ttfts)
            avg_diff = statistics.mean(diffs)
            std_diff = statistics.stdev(diffs) if len(diffs) > 1 else 0

            color = GREEN if avg_diff < 0 else RED
            print(f"{size_k}K{'':<7} {avg_cached:.0f}ms{'':<8} {avg_nocache:.0f}ms{'':<8} {color}{avg_diff:+.0f}ms{RESET:<10} ±{std_diff:.0f}ms")
    else:
        # Original aggregate for deep-research
        on_costs = [r[0].get('cost', 0) for r in all_runs]
        off_costs = [r[1].get('cost', 0) for r in all_runs]
        on_hit_rates = [r[0].get('hit_rate', 0) for r in all_runs]

        print(f"\n{BOLD}Cost Analysis:{RESET}")
        print(f"  Cache ON  avg: ${statistics.mean(on_costs):.6f}" + (f" (±${statistics.stdev(on_costs):.6f})" if len(on_costs) > 1 else ""))
        print(f"  Cache OFF avg: ${statistics.mean(off_costs):.6f}" + (f" (±${statistics.stdev(off_costs):.6f})" if len(off_costs) > 1 else ""))

        print(f"\n{BOLD}Cache Hit Rate:{RESET}")
        print(f"  Cache ON  avg: {statistics.mean(on_hit_rates):.1f}%" + (f" (±{statistics.stdev(on_hit_rates):.1f}%)" if len(on_hit_rates) > 1 else ""))


async def main():
    parser = argparse.ArgumentParser(description='Test agent loop caching')
    parser.add_argument('--mode', choices=['quick', 'deep-research', 'latency', 'write-overhead'],
                        default='quick', help='Test mode')
    parser.add_argument('--repeat', type=int, default=1, help='Number of times to repeat the test')
    parser.add_argument('--compare', action='store_true', help='Compare cache ON vs OFF')
    parser.add_argument('--save', action='store_true', help='Save results to JSON files')
    parser.add_argument('--sizes', type=str, default='8,16,24,32,40,48,56,64,72,80',
                        help='Context sizes in K for latency mode (comma-separated)')
    args = parser.parse_args()

    print(f"\n{BOLD}Agent Loop Caching Test{RESET}")
    print(f"Mode: {args.mode}")
    if args.repeat > 1:
        print(f"Repeat: {args.repeat} times")
    print(f"Using: ConversationCachingHook (production)")

    all_results = []
    all_runs = []

    if args.mode == 'quick':
        print(f"\n{BOLD}{'='*60}{RESET}")
        print(f"{BOLD}Quick Validation Test{RESET}")
        print(f"Verifying ConversationCachingHook works correctly")
        print(f"{BOLD}{'='*60}{RESET}")

        r_on = await run_quick_test(cache_enabled=True)
        all_results.append(r_on)

        if args.compare:
            print(f"\n{YELLOW}Waiting 10 seconds...{RESET}")
            await asyncio.sleep(10)
            r_off = await run_quick_test(cache_enabled=False)
            all_results.append(r_off)
            print_scenario_comparison([r_on, r_off], "Quick Test: Cache ON vs OFF")

        if args.save:
            save_test_results(all_results, "quick_test")

    elif args.mode == 'deep-research':
        for run_num in range(1, args.repeat + 1):
            if args.repeat > 1:
                print(f"\n{CYAN}{'='*70}{RESET}")
                print(f"{BOLD}RUN {run_num}/{args.repeat}{RESET}")
                print(f"{CYAN}{'='*70}{RESET}")

            print(f"\n{BOLD}{'='*60}{RESET}")
            print(f"{BOLD}Deep Research Agent Test{RESET}")
            print(f"Single turn with 10+ tool calls")
            print(f"{BOLD}{'='*60}{RESET}")

            print(f"\n{YELLOW}Running with caching enabled...{RESET}")
            r_on = await run_deep_research_test(cache_enabled=True)
            all_results.append(r_on)

            if args.compare:
                print(f"\n{YELLOW}Waiting 15 seconds for cache expiration...{RESET}")
                await asyncio.sleep(15)

                print(f"\n{YELLOW}Running without caching...{RESET}")
                r_off = await run_deep_research_test(cache_enabled=False)
                all_results.append(r_off)

                print_scenario_comparison([r_on, r_off], "Deep Research: Cache ON vs OFF")
                all_runs.append((r_on, r_off))

            if run_num < args.repeat:
                print(f"\n{YELLOW}Waiting 15 seconds before next run...{RESET}")
                await asyncio.sleep(15)

        if args.repeat > 1 and args.compare and all_runs:
            print_aggregate_summary(all_runs, args.mode)

        if args.save:
            save_test_results(all_results, "deep_research")

    elif args.mode == 'latency':
        # Parse context sizes
        context_sizes = [int(s.strip()) for s in args.sizes.split(',')]

        for run_num in range(1, args.repeat + 1):
            if args.repeat > 1:
                print(f"\n{CYAN}{'='*70}{RESET}")
                print(f"{BOLD}RUN {run_num}/{args.repeat}{RESET}")
                print(f"{CYAN}{'='*70}{RESET}")

            print(f"\n{YELLOW}Running with caching enabled (warmup + cached)...{RESET}")
            r_on = await run_latency_test(cache_enabled=True, context_sizes=context_sizes)
            all_results.append(r_on)

            if args.compare:
                print(f"\n{YELLOW}Waiting 10 seconds...{RESET}")
                await asyncio.sleep(10)

                print(f"\n{YELLOW}Running without caching...{RESET}")
                r_off = await run_latency_test(cache_enabled=False, context_sizes=context_sizes)
                all_results.append(r_off)

                print_latency_comparison(r_on, r_off)
                all_runs.append((r_on, r_off))

            if run_num < args.repeat:
                print(f"\n{YELLOW}Waiting 10 seconds before next run...{RESET}")
                await asyncio.sleep(10)

        if args.repeat > 1 and args.compare and all_runs:
            print_aggregate_summary(all_runs, args.mode)

        if args.save:
            save_test_results(all_results, "latency_test")

    elif args.mode == 'write-overhead':
        context_sizes = [int(s.strip()) for s in args.sizes.split(',')]

        print(f"\n{BOLD}{'='*60}{RESET}")
        print(f"{BOLD}Cache Write Overhead Test{RESET}")
        print(f"Measuring pure write overhead by comparing 2nd call")
        print(f"{BOLD}{'='*60}{RESET}")

        result = await run_write_overhead_test(context_sizes=context_sizes)
        all_results.append(result)

        if args.save:
            save_test_results(all_results, "write_overhead")


if __name__ == "__main__":
    asyncio.run(main())
