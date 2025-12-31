"""
Compacting Session Manager for Long Context Optimization

This wrapper applies threshold-based context compaction when loading sessions:
- Stage 1: Truncate long tool inputs/results (reduces token usage)
- Stage 2: If still over threshold, load [LTM Summary] + [Recent N turns]

Architecture:
- Uses AgentCore Memory's SUMMARIZATION strategy for retrieving session summaries
- Keeps recent complete turns intact (preserves toolUse/toolResult pairs)
- Summary merged into first user message, not as separate message
- Original messages remain in AgentCore STM as Single Source of Truth

Configuration:
- compaction_threshold: Trigger compaction when events exceed this count (default: 50)
- recent_turns_count: Number of recent complete turns to keep (default: 5)
- min_recent_turns: Minimum turns required; if fewer exist, load all (default: 3)
"""

import logging
from typing import TYPE_CHECKING, Any, Optional, Dict, List
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
from strands.types.content import Message

if TYPE_CHECKING:
    from strands.agent.agent import Agent

logger = logging.getLogger(__name__)


class CompactingSessionManager(AgentCoreMemorySessionManager):
    """
    Session manager with threshold-based context compaction.

    When event count exceeds threshold:
    1. Stage 1: Truncate long tool inputs/results to reduce tokens
    2. Stage 2: If still needed, load [LTM Summary] + [Recent N turns]

    This optimizes token usage while maintaining conversation coherence.
    """

    def __init__(
        self,
        agentcore_memory_config: AgentCoreMemoryConfig,
        region_name: str = "us-west-2",
        compaction_threshold: int = 50,
        recent_turns_count: int = 5,
        min_recent_turns: int = 3,
        truncation_threshold: int = 20,
        max_tool_content_length: int = 1000,
        summarization_strategy_id: Optional[str] = None,
        **kwargs: Any,
    ):
        """
        Initialize CompactingSessionManager.

        Args:
            agentcore_memory_config: AgentCore Memory configuration
            region_name: AWS region
            compaction_threshold: Trigger full compaction (summary + recent turns) when events exceed this (default: 50)
            recent_turns_count: Optimal number of recent complete turns to keep (default: 5)
            min_recent_turns: Minimum turns required; if fewer exist, load all messages (default: 3)
            truncation_threshold: Trigger tool truncation when events exceed this (default: 20)
            max_tool_content_length: Max characters for tool input/result before truncation (default: 1000)
            summarization_strategy_id: Strategy ID for SUMMARIZATION (auto-detected if not provided)
            **kwargs: Additional arguments passed to parent
        """
        super().__init__(
            agentcore_memory_config=agentcore_memory_config,
            region_name=region_name,
            **kwargs
        )

        self.compaction_threshold = compaction_threshold
        self.recent_turns_count = recent_turns_count
        self.min_recent_turns = min_recent_turns
        self.truncation_threshold = truncation_threshold
        self.max_tool_content_length = max_tool_content_length
        self.summarization_strategy_id = summarization_strategy_id
        self._cached_summary: Optional[str] = None

        logger.info(
            f"✅ CompactingSessionManager initialized: "
            f"compaction_threshold={compaction_threshold}, truncation_threshold={truncation_threshold}, "
            f"recent_turns={recent_turns_count}, min_turns={min_recent_turns}, "
            f"max_tool_content={max_tool_content_length}"
        )

    def _get_summarization_strategy_id(self) -> Optional[str]:
        """
        Get the SUMMARIZATION strategy ID from AgentCore Memory configuration.

        Returns:
            Strategy ID for SUMMARIZATION, or None if not found
        """
        if self.summarization_strategy_id:
            return self.summarization_strategy_id

        try:
            # Try to get from Memory configuration via control plane
            response = self.memory_client.gmcp_client.get_memory(
                memoryId=self.config.memory_id
            )
            memory = response.get('memory', {})
            strategies = memory.get('strategies', memory.get('memoryStrategies', []))

            for strategy in strategies:
                strategy_type = strategy.get('type', strategy.get('memoryStrategyType', ''))
                if strategy_type == 'SUMMARIZATION':
                    strategy_id = strategy.get('strategyId', strategy.get('memoryStrategyId', ''))
                    logger.info(f"Found SUMMARIZATION strategy: {strategy_id}")
                    self.summarization_strategy_id = strategy_id
                    return strategy_id

            logger.warning("SUMMARIZATION strategy not found in Memory configuration")
            return None

        except Exception as e:
            logger.error(f"Failed to get SUMMARIZATION strategy ID: {e}")
            return None

    def _retrieve_session_summaries(self, query: str = "conversation summary") -> List[str]:
        """
        Retrieve session summaries from AgentCore LTM.

        Uses SUMMARIZATION strategy namespace:
        /strategies/{summarization_strategy_id}/actors/{actor_id}

        Args:
            query: Query string for semantic search (default: "conversation summary")

        Returns:
            List of summary texts
        """
        strategy_id = self._get_summarization_strategy_id()
        if not strategy_id:
            logger.warning("Cannot retrieve summaries: SUMMARIZATION strategy not configured")
            return []

        try:
            # Build namespace path for summaries
            # Pattern: /strategies/{strategyId}/actors/{actorId}
            namespace = f"/strategies/{strategy_id}/actors/{self.config.actor_id}"

            logger.info(f"Retrieving summaries from namespace: {namespace}")

            memories = self.memory_client.retrieve_memories(
                memory_id=self.config.memory_id,
                namespace=namespace,
                query=query,
                top_k=5  # Get top 5 most relevant summaries
            )

            summaries = []
            for memory in memories:
                if isinstance(memory, dict):
                    content = memory.get("content", {})
                    if isinstance(content, dict):
                        text = content.get("text", "").strip()
                        if text:
                            summaries.append(text)

            logger.info(f"Retrieved {len(summaries)} summaries from LTM")
            return summaries

        except Exception as e:
            logger.error(f"Failed to retrieve summaries: {e}")
            return []

    def _build_summary_prefix(self, summaries: List[str]) -> str:
        """
        Build a summary prefix text to prepend to the first user message.

        Args:
            summaries: List of summary texts

        Returns:
            Summary prefix string, or empty string if no summaries
        """
        if not summaries:
            return ""

        # Combine summaries into context
        combined_summary = "\n\n".join(summaries)

        return f"""<conversation_summary>
The following is a summary of our previous conversation:

{combined_summary}

Please continue the conversation with this context in mind.
</conversation_summary>

"""

    def _prepend_summary_to_first_message(self, messages: List[Dict], summary_prefix: str) -> List[Dict]:
        """
        Prepend summary to the first user message's text content.

        Args:
            messages: List of message dicts (first should be user role)
            summary_prefix: Summary text to prepend

        Returns:
            Modified messages list with summary prepended to first message
        """
        if not messages or not summary_prefix:
            return messages

        # Deep copy to avoid modifying original
        import copy
        modified_messages = copy.deepcopy(messages)

        first_msg = modified_messages[0]
        if first_msg.get('role') != 'user':
            logger.warning("First message is not user role, cannot prepend summary")
            return messages

        content = first_msg.get('content', [])
        if isinstance(content, list) and len(content) > 0:
            # Find first text block and prepend summary
            for block in content:
                if isinstance(block, dict) and 'text' in block:
                    block['text'] = summary_prefix + block['text']
                    logger.info("✅ Summary prepended to first user message")
                    return modified_messages

        # No text block found - add one at the beginning
        content.insert(0, {'text': summary_prefix.rstrip()})
        first_msg['content'] = content
        logger.info("✅ Summary added as new text block in first user message")

        return modified_messages

    def _truncate_text(self, text: str, max_length: int) -> str:
        """Truncate text to max_length with indicator."""
        if len(text) <= max_length:
            return text
        return text[:max_length] + f"\n... [truncated, {len(text) - max_length} chars removed]"

    def _truncate_tool_contents(self, messages: List[Dict]) -> List[Dict]:
        """
        Stage 1 Compaction: Truncate long tool inputs and results.

        Reduces token usage by truncating:
        - toolUse.input (large tool parameters)
        - toolResult.content (large tool outputs)

        Args:
            messages: List of message dicts

        Returns:
            Modified messages with truncated tool content
        """
        import copy
        import json

        modified_messages = copy.deepcopy(messages)
        truncation_count = 0
        total_chars_saved = 0

        for msg in modified_messages:
            content = msg.get('content', [])
            if not isinstance(content, list):
                continue

            for block in content:
                if not isinstance(block, dict):
                    continue

                # Truncate toolUse input
                if 'toolUse' in block:
                    tool_use = block['toolUse']
                    tool_input = tool_use.get('input', {})

                    if isinstance(tool_input, dict):
                        # Serialize to check length
                        input_str = json.dumps(tool_input, ensure_ascii=False)
                        if len(input_str) > self.max_tool_content_length:
                            original_len = len(input_str)
                            # Truncate string values in input
                            truncated_input = self._truncate_dict_values(tool_input, self.max_tool_content_length)
                            tool_use['input'] = truncated_input
                            new_len = len(json.dumps(truncated_input, ensure_ascii=False))
                            truncation_count += 1
                            total_chars_saved += original_len - new_len

                # Truncate toolResult content
                elif 'toolResult' in block:
                    tool_result = block['toolResult']
                    result_content = tool_result.get('content', [])

                    if isinstance(result_content, list):
                        for result_block in result_content:
                            if isinstance(result_block, dict) and 'text' in result_block:
                                text = result_block['text']
                                if len(text) > self.max_tool_content_length:
                                    original_len = len(text)
                                    result_block['text'] = self._truncate_text(text, self.max_tool_content_length)
                                    truncation_count += 1
                                    total_chars_saved += original_len - self.max_tool_content_length

                            elif isinstance(result_block, dict) and 'json' in result_block:
                                json_content = result_block['json']
                                json_str = json.dumps(json_content, ensure_ascii=False)
                                if len(json_str) > self.max_tool_content_length:
                                    original_len = len(json_str)
                                    truncated_json = self._truncate_dict_values(json_content, self.max_tool_content_length)
                                    result_block['json'] = truncated_json
                                    new_len = len(json.dumps(truncated_json, ensure_ascii=False))
                                    truncation_count += 1
                                    total_chars_saved += original_len - new_len

        if truncation_count > 0:
            logger.info(
                f"✂️ Stage 1 Truncation: {truncation_count} tool contents truncated, "
                f"~{total_chars_saved} chars saved"
            )

        return modified_messages

    def _truncate_dict_values(self, obj: Any, max_length: int) -> Any:
        """Recursively truncate string values in dict/list structures."""
        if isinstance(obj, str):
            return self._truncate_text(obj, max_length)
        elif isinstance(obj, dict):
            return {k: self._truncate_dict_values(v, max_length) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._truncate_dict_values(item, max_length) for item in obj]
        else:
            return obj

    def _count_session_events(self, agent_id: str) -> int:
        """
        Count total events in the session.

        Args:
            agent_id: Agent ID to count events for

        Returns:
            Total event count
        """
        try:
            # Use list_messages which internally uses list_events
            messages = self.session_repository.list_messages(
                session_id=self.session_id,
                agent_id=agent_id,
                limit=1000  # Reasonable upper bound
            )
            return len(messages)
        except Exception as e:
            logger.error(f"Failed to count events: {e}")
            return 0

    def _has_tool_use(self, message: Dict) -> bool:
        """Check if message contains toolUse block."""
        content = message.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and 'toolUse' in block:
                    return True
        return False

    def _has_tool_result(self, message: Dict) -> bool:
        """Check if message contains toolResult block."""
        content = message.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and 'toolResult' in block:
                    return True
        return False

    def _find_safe_cutoff_index(self, messages: List[Dict]) -> int:
        """
        Find safe cutoff index that preserves conversation integrity.

        Simple approach: Find user text messages (not toolResult) from the end.
        Cutting at a user text message automatically:
        1. Ensures first message is user role (API requirement)
        2. Never breaks toolUse/toolResult pairs
        3. Maintains complete turn structure

        Args:
            messages: List of message dicts

        Returns:
            Index from which to start loading messages (0 = load all)
        """
        # Find all valid cutoff points (user text messages, not toolResult)
        # These are the only safe places to cut
        valid_cutoff_indices = []
        for i, msg in enumerate(messages):
            if msg.get('role') == 'user' and not self._has_tool_result(msg):
                valid_cutoff_indices.append(i)

        # Count turns = number of valid cutoff points (each starts a turn)
        total_turns = len(valid_cutoff_indices)

        logger.debug(f"Found {total_turns} valid cutoff points: {valid_cutoff_indices}")

        # Edge case: No valid cutoff points found (all messages are tool chains)
        if total_turns == 0:
            logger.warning(
                f"⚠️ No valid cutoff points found (all user messages are toolResult), "
                f"loading all {len(messages)} messages"
            )
            return 0

        # Check minimum turns requirement
        if total_turns < self.min_recent_turns:
            logger.info(
                f"⚠️ Only {total_turns} turns available (minimum: {self.min_recent_turns}), "
                f"loading all {len(messages)} messages"
            )
            return 0

        # Determine how many turns to keep
        turns_to_keep = min(total_turns, self.recent_turns_count)

        if total_turns < self.recent_turns_count:
            logger.info(
                f"📊 Found {total_turns} turns (optimal: {self.recent_turns_count}, min: {self.min_recent_turns}), "
                f"keeping all available turns"
            )

        # Get cutoff index: keep last N turns
        # valid_cutoff_indices[-turns_to_keep] gives the start of the Nth turn from the end
        safe_index = valid_cutoff_indices[-turns_to_keep]

        logger.info(
            f"🔍 Safe cutoff: index={safe_index}, keeping {len(messages) - safe_index} messages "
            f"({turns_to_keep} turns)"
        )

        return safe_index

    def initialize(self, agent: "Agent", **kwargs: Any) -> None:
        """
        Initialize agent with threshold-based summarization.

        If event count exceeds threshold:
        1. Count total events
        2. If above threshold: retrieve summaries and load only recent complete turns
        3. If below threshold: load all messages normally

        Args:
            agent: Agent to initialize
            **kwargs: Additional arguments
        """
        from strands.agent.state import AgentState
        from strands.types.session import SessionAgent, SessionMessage

        if agent.agent_id in self._latest_agent_message:
            from strands.types.exceptions import SessionException
            raise SessionException("The `agent_id` of an agent must be unique in a session.")

        self._latest_agent_message[agent.agent_id] = None

        # Check if agent exists in session
        session_agent = self.session_repository.read_agent(self.session_id, agent.agent_id)

        if session_agent is None:
            # New agent - create normally
            logger.debug(f"agent_id=<{agent.agent_id}> | session_id=<{self.session_id}> | creating agent")

            session_agent = SessionAgent.from_agent(agent)
            self.session_repository.create_agent(self.session_id, session_agent)

            # Initialize messages with sequential indices
            session_message = None
            for i, message in enumerate(agent.messages):
                session_message = SessionMessage.from_message(message, i)
                self.session_repository.create_message(self.session_id, agent.agent_id, session_message)
            self._latest_agent_message[agent.agent_id] = session_message

        else:
            # Existing agent - restore with potential summarization
            logger.debug(f"agent_id=<{agent.agent_id}> | session_id=<{self.session_id}> | restoring agent")

            agent.state = AgentState(session_agent.state)
            session_agent.initialize_internal_state(agent)

            # Restore conversation manager state
            prepend_messages = agent.conversation_manager.restore_from_session(
                session_agent.conversation_manager_state
            )
            if prepend_messages is None:
                prepend_messages = []

            # Count total events to decide on summarization
            total_events = self._count_session_events(agent.agent_id)
            offset = agent.conversation_manager.removed_message_count
            effective_events = total_events - offset

            logger.info(
                f"📊 Session state: total_events={total_events}, offset={offset}, "
                f"effective={effective_events}, threshold={self.compaction_threshold}"
            )

            # Load session messages (common for all stages)
            session_messages = self.session_repository.list_messages(
                session_id=self.session_id,
                agent_id=agent.agent_id,
                offset=offset
            )

            # Update latest message tracking
            if len(session_messages) > 0:
                self._latest_agent_message[agent.agent_id] = session_messages[-1]

            # Convert to dict format
            all_messages = [sm.to_message() for sm in session_messages]

            if effective_events > self.compaction_threshold:
                # Stage 2: Full compaction - load summary + recent complete turns only
                logger.info(
                    f"🔄 Stage 2 Compaction: {effective_events} events exceed threshold "
                    f"({self.compaction_threshold}), loading summary + recent {self.recent_turns_count} turns"
                )

                # Retrieve summaries from LTM
                summaries = self._retrieve_session_summaries()
                summary_prefix = self._build_summary_prefix(summaries)

                # Find safe cutoff point (starts at user text message)
                cutoff_index = self._find_safe_cutoff_index(all_messages)

                # Get recent messages from cutoff point
                recent_messages = all_messages[cutoff_index:]

                # Apply Stage 1 truncation to recent messages as well
                recent_messages = self._truncate_tool_contents(recent_messages)

                # Prepend summary to first user message (instead of adding separate message)
                if summary_prefix and recent_messages:
                    recent_messages = self._prepend_summary_to_first_message(recent_messages, summary_prefix)
                    logger.info(f"✅ Summary ({len(summaries)} summaries) merged into first user message")

                agent.messages = prepend_messages + recent_messages

                logger.info(
                    f"✅ Stage 2 Compaction applied: loaded {len(recent_messages)} recent messages "
                    f"(reduced from {effective_events} events)"
                )

            elif effective_events > self.truncation_threshold:
                # Stage 1: Truncate long tool contents only (keep all messages)
                logger.info(
                    f"✂️ Stage 1 Truncation: {effective_events} events exceed truncation threshold "
                    f"({self.truncation_threshold}), truncating long tool contents"
                )

                truncated_messages = self._truncate_tool_contents(all_messages)
                agent.messages = prepend_messages + truncated_messages

                logger.info(
                    f"✅ Stage 1 Truncation applied: loaded {len(truncated_messages)} messages "
                    f"with tool content truncated"
                )

            else:
                # Below both thresholds - load all messages normally
                logger.info(
                    f"📝 Below thresholds ({effective_events} <= {self.truncation_threshold}), "
                    f"loading all messages without modification"
                )

                agent.messages = prepend_messages + all_messages

        # Mark that we have an existing agent
        self.has_existing_agent = True
