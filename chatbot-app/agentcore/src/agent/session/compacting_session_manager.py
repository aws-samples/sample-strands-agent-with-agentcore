"""
Compacting Session Manager for Long Context Optimization

Simplified two-feature compaction with DynamoDB checkpoint persistence.
"""

import copy
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional, Dict, List

from strands.hooks import MessageAddedEvent
from strands.hooks.events import AfterInvocationEvent, AgentInitializedEvent
from strands.hooks.registry import HookRegistry
from strands.types.session import Session, SessionAgent, SessionMessage
from typing_extensions import override

from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.bedrock_converter import AgentCoreMemoryConverter

if TYPE_CHECKING:
    from strands.agent.agent import Agent

logger = logging.getLogger(__name__)

# Payload type markers for unified storage
PAYLOAD_TYPE_MESSAGE = "message"
PAYLOAD_TYPE_AGENT_STATE = "agent_state"
PAYLOAD_TYPE_SESSION = "session"


@dataclass
class CompactionState:
    """
    Compaction state stored in DynamoDB session metadata.

    Simplified state tracking:
    - checkpoint: Message index to load from (0 = load all)
    - summary: Summary of messages before checkpoint
    - lastInputTokens: For tracking token growth
    """
    checkpoint: int = 0                      # Message index to load from (0 = load all)
    summary: Optional[str] = None            # Compressed history summary
    lastInputTokens: int = 0                 # Last turn's actual input tokens
    updatedAt: Optional[str] = None          # Last update timestamp

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for DynamoDB storage."""
        return {
            "checkpoint": self.checkpoint,
            "summary": self.summary,
            "lastInputTokens": self.lastInputTokens,
            "updatedAt": self.updatedAt
        }

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "CompactionState":
        """Create from DynamoDB data."""
        if not data:
            return cls()
        # DynamoDB returns numbers as Decimal, so convert to int
        return cls(
            checkpoint=int(data.get("checkpoint", 0)),
            summary=data.get("summary"),
            lastInputTokens=int(data.get("lastInputTokens", 0)),
            updatedAt=data.get("updatedAt")
        )


class CompactingSessionManager(AgentCoreMemorySessionManager):
    """
    Session manager with token-based context compaction.

    Compaction state is persisted in DynamoDB session metadata, enabling:
    - Stateless operation across server restarts
    - Accurate token-based threshold triggering
    - Efficient checkpoint-based message loading

    Flow:
    1. initialize(): Load compaction state, apply if enabled
    2. After turn: Update lastInputTokens, trigger compaction if threshold exceeded
    """

    # DynamoDB table for compaction state (lazy initialized, shared across instances)
    _dynamodb_table = None
    _dynamodb_table_name: Optional[str] = None

    def __init__(
        self,
        agentcore_memory_config: AgentCoreMemoryConfig,
        region_name: str = "us-west-2",
        token_threshold: int = 100_000,
        protected_turns: int = 2,
        max_tool_content_length: int = 500,
        user_id: Optional[str] = None,
        summarization_strategy_id: Optional[str] = None,
        metrics_only: bool = False,
        enable_api_optimization: bool = True,
        **kwargs: Any,
    ):
        """
        Initialize CompactingSessionManager.

        Args:
            agentcore_memory_config: AgentCore Memory configuration
            region_name: AWS region
            token_threshold: Trigger checkpoint when input tokens exceed this (default: 100,000)
            protected_turns: Number of recent turns to protect from truncation and keep after checkpoint (default: 2)
            max_tool_content_length: Max chars for tool content before truncation (default: 500)
            user_id: User ID for DynamoDB operations
            summarization_strategy_id: Strategy ID for LTM summarization (optional)
            metrics_only: If True, only track metrics without applying compaction (for baseline testing)
            enable_api_optimization: If True (default), use unified actorId + batch storage for reduced API calls.
                                     If False, use original separate callbacks (for A/B testing).
            **kwargs: Additional arguments passed to parent
        """
        super().__init__(
            agentcore_memory_config=agentcore_memory_config,
            region_name=region_name,
            **kwargs
        )

        self.token_threshold = token_threshold
        self.protected_turns = protected_turns
        self.max_tool_content_length = max_tool_content_length
        self.user_id = user_id
        self.region_name = region_name
        self.summarization_strategy_id = summarization_strategy_id
        self.metrics_only = metrics_only
        self.enable_api_optimization = enable_api_optimization

        # Current compaction state (loaded from DynamoDB in initialize)
        self.compaction_state: Optional[CompactionState] = None

        # Last initialization info (for external metrics collection)
        self.last_init_info: Optional[Dict[str, Any]] = None

        # Cached valid cutoff points from initialize() for checkpoint calculation
        # List of message_ids where checkpoint can be set (user text messages, not toolResult)
        self._valid_cutoff_message_ids: List[int] = []
        # Total message count from Session Memory at initialize time
        self._total_message_count_at_init: int = 0
        # All messages loaded at initialize (for summary generation)
        self._all_messages_for_summary: List[Dict] = []

        # Track last synced state to avoid redundant API calls (API optimization)
        self._last_synced_state: Dict[str, dict] = {}

        # API call metrics for performance measurement
        self._api_call_count = 0
        self._api_call_total_ms = 0.0

        mode_str = "metrics_only" if metrics_only else "full_compaction"
        api_mode = "optimized" if enable_api_optimization else "legacy"
        logger.debug(f"CompactingSessionManager: mode={mode_str}, api={api_mode}")

    def reset_api_metrics(self):
        """Reset API call metrics."""
        self._api_call_count = 0
        self._api_call_total_ms = 0.0

    def get_api_metrics(self) -> Dict[str, Any]:
        """Get API call metrics."""
        return {
            "api_call_count": self._api_call_count,
            "api_call_total_ms": self._api_call_total_ms,
        }

    def _track_api_call(self, func, *args, **kwargs):
        """Execute function and track API call metrics."""
        import time
        start = time.time()
        result = func(*args, **kwargs)
        elapsed_ms = (time.time() - start) * 1000
        self._api_call_count += 1
        self._api_call_total_ms += elapsed_ms
        return result

    @override
    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        """Register hooks for session management.

        Behavior depends on `enable_api_optimization`:
        - True (default): Unified actorId + batch storage (2 API calls per turn instead of 7+)
        - False (legacy): Separate callbacks matching parent implementation (for A/B testing)
        """
        if self.enable_api_optimization:
            self._register_optimized_hooks(registry, **kwargs)
        else:
            self._register_legacy_hooks(registry, **kwargs)

    def _register_optimized_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        """Register optimized hooks - single callback saves message+state in one API call."""

        registry.add_callback(AgentInitializedEvent, lambda event: self.initialize(event.agent))
        registry.add_callback(MessageAddedEvent, lambda event: self.save_message_with_state(event.message, event.agent))
        registry.add_callback(MessageAddedEvent, lambda event: self.retrieve_customer_context(event))
        registry.add_callback(AfterInvocationEvent, lambda event: self._sync_if_conversation_manager_changed(event.agent))

    def _register_legacy_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        """Register legacy hooks - separate callbacks for A/B testing comparison."""
        registry.add_callback(AgentInitializedEvent, lambda event: self.initialize(event.agent))
        registry.add_callback(MessageAddedEvent, lambda event: self._append_message_tracked(event.message, event.agent))
        registry.add_callback(MessageAddedEvent, lambda event: self._sync_agent_tracked(event.agent))
        registry.add_callback(MessageAddedEvent, lambda event: self.retrieve_customer_context(event))
        registry.add_callback(AfterInvocationEvent, lambda event: self._sync_agent_tracked(event.agent))

    def _append_message_tracked(self, message: Dict, agent: "Agent") -> None:
        """Append message with API call tracking."""
        start = time.time()
        super().append_message(message, agent)
        elapsed_ms = (time.time() - start) * 1000
        self._api_call_count += 1
        self._api_call_total_ms += elapsed_ms

    def _sync_agent_tracked(self, agent: "Agent") -> None:
        """Sync agent with API call tracking."""
        start = time.time()
        super().sync_agent(agent)
        elapsed_ms = (time.time() - start) * 1000
        self._api_call_count += 1
        self._api_call_total_ms += elapsed_ms

    def save_message_with_state(self, message: Dict, agent: "Agent") -> None:
        """Save message and agent state in a single API call using unified actorId."""
        session_message = SessionMessage.from_message(message, 0)
        message_payloads = AgentCoreMemoryConverter.message_to_payload(session_message)

        if not message_payloads:
            return

        session_agent = SessionAgent.from_agent(agent)
        agent_data = session_agent.to_dict()
        agent_data["_payload_type"] = PAYLOAD_TYPE_AGENT_STATE
        agent_data["_agent_id"] = agent.agent_id

        payloads = []
        message_tuple = message_payloads[0]
        message_data = json.loads(message_tuple[0])
        message_data["_payload_type"] = PAYLOAD_TYPE_MESSAGE

        if not AgentCoreMemoryConverter.exceeds_conversational_limit(message_tuple):
            payloads.append({
                "conversational": {
                    "content": {"text": json.dumps(message_data)},
                    "role": message_tuple[1].upper(),
                }
            })
        else:
            payloads.append({"blob": json.dumps(message_data)})

        payloads.append({"blob": json.dumps(agent_data)})

        event = self._track_api_call(
            self.memory_client.gmdp_client.create_event,
            memoryId=self.config.memory_id,
            actorId=self.config.actor_id,
            sessionId=self.session_id,
            payload=payloads,
            eventTimestamp=self._get_monotonic_timestamp(),
        )

        event_id = event.get("event", {}).get("eventId")
        session_message = SessionMessage.from_message(message, event_id)
        self._latest_agent_message[agent.agent_id] = session_message
        self._last_synced_state[agent.agent_id] = agent_data

    def _sync_if_conversation_manager_changed(self, agent: "Agent") -> None:
        """Sync agent state only if conversation_manager state changed."""
        current_state = SessionAgent.from_agent(agent).to_dict()
        last_state = self._last_synced_state.get(agent.agent_id)

        if last_state is None:
            return

        current_cm_state = current_state.get("conversation_manager_state", {})
        last_cm_state = last_state.get("conversation_manager_state", {})

        if current_cm_state != last_cm_state:
            self._save_agent_state_only(agent)

    def _save_agent_state_only(self, agent: "Agent") -> None:
        """Save only agent state (for AfterInvocationEvent when CM state changed)."""
        session_agent = SessionAgent.from_agent(agent)
        agent_data = session_agent.to_dict()
        agent_data["_payload_type"] = PAYLOAD_TYPE_AGENT_STATE
        agent_data["_agent_id"] = agent.agent_id

        self.memory_client.gmdp_client.create_event(
            memoryId=self.config.memory_id,
            actorId=self.config.actor_id,
            sessionId=self.session_id,
            payload=[{"blob": json.dumps(agent_data)}],
            eventTimestamp=self._get_monotonic_timestamp(),
        )
        self._last_synced_state[agent.agent_id] = agent_data

    @override
    def list_messages(
        self,
        session_id: str,
        agent_id: str,
        limit: Optional[int] = None,
        offset: int = 0,
        **kwargs: Any,
    ) -> List[SessionMessage]:
        """List messages - tries unified format first, falls back to legacy."""
        messages = self._list_messages_unified(session_id, limit, offset)
        if messages:
            return messages
        return super().list_messages(session_id, agent_id, limit, offset, **kwargs)

    def _list_messages_unified(
        self,
        session_id: str,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[SessionMessage]:
        """List messages from unified storage format."""
        max_results = (limit + offset) if limit else 10000

        events = self.memory_client.list_events(
            memory_id=self.config.memory_id,
            actor_id=self.config.actor_id,
            session_id=session_id,
            max_results=max_results,
        )

        messages = []
        for event in events:
            for payload_item in event.get("payload", []):
                msg = self._parse_message_from_payload(payload_item)
                if msg:
                    messages.append(msg)

        # Reverse to chronological order (list_events returns newest first)
        messages = list(reversed(messages))

        # Apply offset and limit
        if limit is not None:
            return messages[offset : offset + limit]
        return messages[offset:]

    @staticmethod
    def _filter_empty_text(message: dict) -> dict:
        """Filter out empty text blocks from message content."""
        if "content" not in message:
            return message
        content = message.get("content", [])
        if not isinstance(content, list):
            return message
        filtered = [block for block in content if not (isinstance(block, dict) and block.get("text") == "")]
        return {**message, "content": filtered}

    def _parse_message_from_payload(self, payload_item: dict) -> Optional[SessionMessage]:
        """Parse a message from a payload item."""
        try:
            if "conversational" in payload_item:
                conv = payload_item["conversational"]
                data = json.loads(conv["content"]["text"])

                if data.get("_payload_type") == PAYLOAD_TYPE_MESSAGE or "message" in data:
                    data.pop("_payload_type", None)
                    session_msg = SessionMessage.from_dict(data)
                    session_msg.message = self._filter_empty_text(session_msg.message)
                    if session_msg.message.get("content"):
                        return session_msg

            elif "blob" in payload_item:
                blob_data = json.loads(payload_item["blob"])

                if isinstance(blob_data, dict):
                    if blob_data.get("_payload_type") == PAYLOAD_TYPE_AGENT_STATE:
                        return None
                    if blob_data.get("_payload_type") == PAYLOAD_TYPE_MESSAGE:
                        blob_data.pop("_payload_type", None)
                        session_msg = SessionMessage.from_dict(blob_data)
                        session_msg.message = self._filter_empty_text(session_msg.message)
                        if session_msg.message.get("content"):
                            return session_msg

                # Legacy blob format (tuple)
                if isinstance(blob_data, (tuple, list)) and len(blob_data) == 2:
                    session_msg = SessionMessage.from_dict(json.loads(blob_data[0]))
                    session_msg.message = self._filter_empty_text(session_msg.message)
                    if session_msg.message.get("content"):
                        return session_msg

        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.debug(f"Failed to parse message from payload: {e}")

        return None

    @override
    def read_agent(self, session_id: str, agent_id: str, **kwargs: Any) -> Optional[SessionAgent]:
        """Read agent with dual-read support.

        Tries unified format first, falls back to legacy format.
        """
        # Try unified format first
        agent = self._read_agent_unified(session_id, agent_id)

        if agent:
            return agent

        # Fallback to legacy format
        logger.debug("No unified agent found, falling back to legacy format")
        return super().read_agent(session_id, agent_id, **kwargs)

    def _read_agent_unified(self, session_id: str, agent_id: str) -> Optional[SessionAgent]:
        """Read agent state from unified storage format."""
        events = self.memory_client.list_events(
            memory_id=self.config.memory_id,
            actor_id=self.config.actor_id,
            session_id=session_id,
            max_results=100,
        )

        # Find latest agent state for this agent_id
        for event in events:
            for payload_item in event.get("payload", []):
                if "blob" in payload_item:
                    try:
                        blob_data = json.loads(payload_item["blob"])
                        if (
                            isinstance(blob_data, dict)
                            and blob_data.get("_payload_type") == PAYLOAD_TYPE_AGENT_STATE
                            and blob_data.get("_agent_id") == agent_id
                        ):
                            blob_data.pop("_payload_type", None)
                            blob_data.pop("_agent_id", None)
                            return SessionAgent.from_dict(blob_data)
                    except (json.JSONDecodeError, ValueError):
                        continue

        return None

    @override
    def create_session(self, session: Session, **kwargs: Any) -> Session:
        """Create session in unified format (under config.actor_id)."""
        session_data = session.to_dict()
        session_data["_payload_type"] = PAYLOAD_TYPE_SESSION

        self.memory_client.gmdp_client.create_event(
            memoryId=self.config.memory_id,
            actorId=self.config.actor_id,  # Unified actorId
            sessionId=self.session_id,
            payload=[{"blob": json.dumps(session_data)}],
            eventTimestamp=self._get_monotonic_timestamp(),
        )

        logger.info(f"Created session (unified): {session.session_id}")
        return session

    @override
    def create_agent(self, session_id: str, session_agent: SessionAgent, **kwargs: Any) -> None:
        """Create agent in unified format (under config.actor_id)."""
        agent_data = session_agent.to_dict()
        agent_data["_payload_type"] = PAYLOAD_TYPE_AGENT_STATE
        agent_data["_agent_id"] = session_agent.agent_id

        self.memory_client.gmdp_client.create_event(
            memoryId=self.config.memory_id,
            actorId=self.config.actor_id,  # Unified actorId
            sessionId=self.session_id,
            payload=[{"blob": json.dumps(agent_data)}],
            eventTimestamp=self._get_monotonic_timestamp(),
        )

        self._last_synced_state[session_agent.agent_id] = agent_data
        logger.info(f"Created agent (unified): {session_agent.agent_id}")

    @override
    def read_session(self, session_id: str, **kwargs: Any) -> Optional[Session]:
        """Read session with dual-read support."""
        # Try unified format first
        session = self._read_session_unified(session_id)

        if session:
            return session

        # Fallback to legacy format
        return super().read_session(session_id, **kwargs)

    def _read_session_unified(self, session_id: str) -> Optional[Session]:
        """Read session from unified storage format."""
        events = self.memory_client.list_events(
            memory_id=self.config.memory_id,
            actor_id=self.config.actor_id,
            session_id=session_id,
            max_results=50,
        )

        for event in events:
            for payload_item in event.get("payload", []):
                if "blob" in payload_item:
                    try:
                        blob_data = json.loads(payload_item["blob"])
                        if (
                            isinstance(blob_data, dict)
                            and blob_data.get("_payload_type") == PAYLOAD_TYPE_SESSION
                        ):
                            blob_data.pop("_payload_type", None)
                            return Session.from_dict(blob_data)
                    except (json.JSONDecodeError, ValueError):
                        continue

        return None

    def _get_dynamodb_table(self):
        """Lazy initialization of DynamoDB table."""
        if CompactingSessionManager._dynamodb_table is None:
            import boto3
            project_name = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
            CompactingSessionManager._dynamodb_table_name = f"{project_name}-users-v2"
            dynamodb = boto3.resource('dynamodb', region_name=self.region_name)
            CompactingSessionManager._dynamodb_table = dynamodb.Table(
                CompactingSessionManager._dynamodb_table_name
            )
            logger.debug(f"DynamoDB table initialized: {CompactingSessionManager._dynamodb_table_name}")
        return CompactingSessionManager._dynamodb_table

    def _get_session_key(self) -> dict:
        """Get DynamoDB key for session operations."""
        return {
            'userId': self.user_id,
            'sk': f'SESSION#{self.session_id}'
        }

    def load_compaction_state(self) -> CompactionState:
        """
        Load compaction state from DynamoDB session metadata.

        Returns:
            CompactionState object (default state if not found or error)
        """
        if not self.user_id:
            logger.debug("No user_id set, returning default compaction state")
            return CompactionState()

        try:
            table = self._get_dynamodb_table()
            response = table.get_item(
                Key=self._get_session_key(),
                ProjectionExpression='compaction'
            )

            if 'Item' in response and 'compaction' in response['Item']:
                state = CompactionState.from_dict(response['Item']['compaction'])
                if state.checkpoint > 0:
                    logger.debug(
                        f" Compaction state loaded: "
                        f"checkpoint={state.checkpoint}, lastTokens={state.lastInputTokens:,}"
                    )
                return state

            return CompactionState()

        except Exception as e:
            logger.warning(f"Error loading compaction state: {e}")
            return CompactionState()

    def save_compaction_state(self, state: CompactionState) -> None:
        """
        Save compaction state to DynamoDB session metadata.

        Args:
            state: CompactionState to save
        """
        if not self.user_id:
            logger.debug("No user_id set, skipping compaction state save")
            return

        try:
            state.updatedAt = datetime.now(timezone.utc).isoformat()
            table = self._get_dynamodb_table()
            table.update_item(
                Key=self._get_session_key(),
                UpdateExpression='SET compaction = :state',
                ExpressionAttributeValues={
                    ':state': state.to_dict()
                }
            )
            logger.debug(
                f" Compaction state saved: "
                f"checkpoint={state.checkpoint}, lastTokens={state.lastInputTokens:,}"
            )

        except Exception as e:
            logger.error(f"Error setting checkpoint: {e}")

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
                strategy_payload_type = strategy.get('type', strategy.get('memoryStrategyType', ''))
                if strategy_payload_type == 'SUMMARIZATION':
                    strategy_id = strategy.get('strategyId', strategy.get('memoryStrategyId', ''))
                    logger.debug(f"Found SUMMARIZATION strategy: {strategy_id}")
                    self.summarization_strategy_id = strategy_id
                    return strategy_id

            logger.warning("SUMMARIZATION strategy not found in Memory configuration")
            return None

        except Exception as e:
            logger.error(f"Failed to get SUMMARIZATION strategy ID: {e}")
            return None

    def _retrieve_session_summaries(self) -> List[str]:
        """
        Retrieve session summaries from AgentCore LTM using list_memory_records.

        Uses SUMMARIZATION strategy namespace (session-level):
        /strategies/{summarization_strategy_id}/actors/{actor_id}/sessions/{session_id}

        Returns:
            List of summary texts for this session
        """
        strategy_id = self._get_summarization_strategy_id()
        if not strategy_id:
            logger.warning("Cannot retrieve summaries: SUMMARIZATION strategy not configured")
            return []

        try:
            import boto3

            # Build namespace path for session-level summaries
            # Pattern: /strategies/{strategyId}/actors/{actorId}/sessions/{sessionId}
            namespace = f"/strategies/{strategy_id}/actors/{self.config.actor_id}/sessions/{self.session_id}"

            logger.debug(f"Listing summaries from namespace: {namespace}")

            # Use boto3 directly for list_memory_records (not available in MemoryClient)
            gmdp = boto3.client('bedrock-agentcore', region_name=self.region_name)
            response = gmdp.list_memory_records(
                memoryId=self.config.memory_id,
                namespace=namespace,
                maxResults=100  # Get all summary chunks for this session
            )

            records = response.get('memoryRecordSummaries', [])
            logger.debug(f"Found {len(records)} summary records in session namespace")

            # Extract texts
            summaries = []
            for record in records:
                content = record.get("content", {})
                if isinstance(content, dict):
                    text = content.get("text", "").strip()
                    if text:
                        summaries.append(text)

            logger.debug(f"Retrieved {len(summaries)} summaries from LTM")
            return summaries

        except Exception as e:
            logger.error(f"Failed to retrieve summaries: {e}")
            return []

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
                    logger.debug(" Summary prepended to first user message")
                    return modified_messages

        # No text block found - add one at the beginning
        content.insert(0, {'text': summary_prefix.rstrip()})
        first_msg['content'] = content
        logger.debug(" Summary added as new text block in first user message")

        return modified_messages

    def _truncate_text(self, text: str, max_length: int) -> str:
        """Truncate text to max_length with indicator."""
        if len(text) <= max_length:
            return text
        return text[:max_length] + f"\n... [truncated, {len(text) - max_length} chars removed]"

    def _find_protected_message_indices(self, messages: List[Dict], protected_turns: int) -> set:
        """
        Find message indices that should be protected from truncation.

        Protected messages are the most recent N complete turns (user text + assistant response).

        Args:
            messages: List of message dicts
            protected_turns: Number of recent turns to protect

        Returns:
            Set of message indices that should NOT be truncated
        """
        if protected_turns <= 0:
            return set()

        # Find all user text message indices (turn boundaries)
        turn_start_indices = []
        for i, msg in enumerate(messages):
            if msg.get('role') == 'user' and not self._has_tool_result(msg):
                turn_start_indices.append(i)

        if not turn_start_indices:
            return set()

        # Get the start index of the Nth turn from the end
        turns_to_protect = min(protected_turns, len(turn_start_indices))
        protected_start_idx = turn_start_indices[-turns_to_protect]

        # All messages from protected_start_idx onwards are protected
        protected_indices = set(range(protected_start_idx, len(messages)))

        logger.debug(
            f"Protected messages: indices {protected_start_idx}~{len(messages)-1} "
            f"({len(protected_indices)} messages, {turns_to_protect} turns)"
        )

        return protected_indices

    def _truncate_tool_contents(self, messages: List[Dict], protected_indices: Optional[set] = None) -> tuple:
        """
        Stage 1 Compaction: Truncate long tool inputs/results and replace images with placeholders.

        Reduces token usage by:
        - Truncating toolUse.input (large tool parameters)
        - Truncating toolResult.content (large tool outputs)
        - Replacing image blocks with text placeholders

        Protected messages (recent turns) are NOT truncated to preserve latest context.

        Args:
            messages: List of message dicts
            protected_indices: Set of message indices to skip truncation (optional)

        Returns:
            Tuple of (modified_messages, truncation_count, chars_saved)
        """
        modified_messages = copy.deepcopy(messages)
        truncation_count = 0
        total_chars_saved = 0

        if protected_indices is None:
            protected_indices = set()

        for msg_idx, msg in enumerate(modified_messages):
            # Skip protected messages (recent turns)
            if msg_idx in protected_indices:
                continue
            content = msg.get('content', [])
            if not isinstance(content, list):
                continue

            # Process content blocks - need index for replacement
            for block_idx, block in enumerate(content):
                if not isinstance(block, dict):
                    continue

                # Replace image blocks with placeholder
                if 'image' in block:
                    image_data = block['image']
                    image_format = image_data.get('format', 'unknown')
                    # Estimate original size from base64 bytes
                    source = image_data.get('source', {})
                    original_bytes = source.get('bytes', b'')
                    if isinstance(original_bytes, bytes):
                        original_size = len(original_bytes)
                    else:
                        original_size = 0

                    # Replace with text placeholder
                    content[block_idx] = {
                        'text': f'[Image placeholder: format={image_format}, original_size={original_size} bytes]'
                    }
                    truncation_count += 1
                    # Estimate token savings (base64 images are ~1.33x original, then tokenized)
                    total_chars_saved += original_size

                # Truncate toolUse input
                elif 'toolUse' in block:
                    tool_use = block['toolUse']
                    tool_input = tool_use.get('input', {})

                    if isinstance(tool_input, dict):
                        # Serialize to check length
                        input_str = json.dumps(tool_input, ensure_ascii=False)
                        if len(input_str) > self.max_tool_content_length:
                            original_len = len(input_str)
                            # Replace with truncated string representation
                            tool_use['input'] = {"_truncated": self._truncate_text(input_str, self.max_tool_content_length)}
                            truncation_count += 1
                            total_chars_saved += original_len - self.max_tool_content_length

                # Truncate toolResult content
                elif 'toolResult' in block:
                    tool_result = block['toolResult']
                    result_content = tool_result.get('content', [])

                    if isinstance(result_content, list):
                        for result_idx, result_block in enumerate(result_content):
                            if not isinstance(result_block, dict):
                                continue

                            # Replace image in toolResult with placeholder
                            if 'image' in result_block:
                                image_data = result_block['image']
                                image_format = image_data.get('format', 'unknown')
                                source = image_data.get('source', {})
                                original_bytes = source.get('bytes', b'')
                                if isinstance(original_bytes, bytes):
                                    original_size = len(original_bytes)
                                else:
                                    original_size = 0

                                result_content[result_idx] = {
                                    'text': f'[Image placeholder: format={image_format}, original_size={original_size} bytes]'
                                }
                                truncation_count += 1
                                total_chars_saved += original_size

                            elif 'text' in result_block:
                                text = result_block['text']
                                if len(text) > self.max_tool_content_length:
                                    original_len = len(text)
                                    result_block['text'] = self._truncate_text(text, self.max_tool_content_length)
                                    truncation_count += 1
                                    total_chars_saved += original_len - self.max_tool_content_length

                            elif 'json' in result_block:
                                json_content = result_block['json']
                                json_str = json.dumps(json_content, ensure_ascii=False)
                                if len(json_str) > self.max_tool_content_length:
                                    original_len = len(json_str)
                                    # Simply convert to truncated text instead of recursive dict processing
                                    result_block.pop('json')
                                    result_block['text'] = self._truncate_text(json_str, self.max_tool_content_length)
                                    truncation_count += 1
                                    total_chars_saved += original_len - self.max_tool_content_length

        if truncation_count > 0:
            logger.debug(
                f" Stage 1 Truncation: {truncation_count} items truncated (text/json/images), "
                f"~{total_chars_saved} chars/bytes saved"
            )

        return modified_messages, truncation_count, total_chars_saved

    def _has_tool_result(self, message: Dict) -> bool:
        """Check if message contains toolResult block."""
        content = message.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and 'toolResult' in block:
                    return True
        return False

    def initialize(self, agent: "Agent", **kwargs: Any) -> None:
        """
        Initialize agent with simplified two-feature compaction.

        Flow:
        1. Load compaction state from DynamoDB
        2. Feature 1 - Message Loading:
           - If checkpoint > 0: Load messages[checkpoint:] + prepend summary
           - Else: Load all messages
        3. Feature 2 - Truncation (always applied):
           - Truncate old tool contents (protect recent 2 turns)

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

            # No compaction for new agent
            self.compaction_state = CompactionState()
            self.last_init_info = {
                "stage": "none",
                "original_messages": 0,
                "final_messages": 0,
                "truncation_count": 0,
                "compaction_overhead_ms": 0,
            }

            # Initialize cached cutoff points for new agent
            self._valid_cutoff_message_ids = []
            self._total_message_count_at_init = 0
            self._all_messages_for_summary = []

        else:
            # Existing agent - restore with compaction (or metrics_only mode)
            mode_label = "metrics_only" if self.metrics_only else "with compaction"
            logger.debug(f"agent_id=<{agent.agent_id}> | session_id=<{self.session_id}> | restoring agent ({mode_label})")

            # Start timing compaction overhead
            compaction_start_time = time.time()

            agent.state = AgentState(session_agent.state)
            session_agent.initialize_internal_state(agent)

            # Restore conversation manager state
            prepend_messages = agent.conversation_manager.restore_from_session(
                session_agent.conversation_manager_state
            )
            if prepend_messages is None:
                prepend_messages = []

            # Load ALL messages from Session Memory (limit=None fetches all)
            all_session_messages = self.session_repository.list_messages(
                session_id=self.session_id,
                agent_id=agent.agent_id,
            )

            # Update latest message tracking
            if len(all_session_messages) > 0:
                self._latest_agent_message[agent.agent_id] = all_session_messages[-1]

            # Cache total message count
            self._total_message_count_at_init = len(all_session_messages)

            if self.metrics_only:
                # Metrics-only mode: Load all messages without compaction
                self.compaction_state = CompactionState()
                self._valid_cutoff_message_ids = []
                self._all_messages_for_summary = []
                messages_to_process = [sm.to_message() for sm in all_session_messages]
                original_message_count = len(messages_to_process)
                agent.messages = prepend_messages + messages_to_process

                compaction_overhead_ms = (time.time() - compaction_start_time) * 1000
                self.last_init_info = {
                    "stage": "metrics_only",
                    "original_messages": original_message_count,
                    "final_messages": len(agent.messages),
                    "truncation_count": 0,
                    "compaction_overhead_ms": compaction_overhead_ms,
                }
            else:
                # Full compaction mode
                self.compaction_state = self.load_compaction_state()
                conv_manager_offset = agent.conversation_manager.removed_message_count
                checkpoint = self.compaction_state.checkpoint
                effective_offset = max(conv_manager_offset, checkpoint)

                stage = "none"
                self._valid_cutoff_message_ids = []
                self._all_messages_for_summary = [sm.to_message() for sm in all_session_messages]

                for idx, sm in enumerate(all_session_messages):
                    msg = sm.to_message()
                    if msg.get('role') == 'user' and not self._has_tool_result(msg):
                        self._valid_cutoff_message_ids.append(idx)

                session_messages = all_session_messages[effective_offset:] if effective_offset > 0 else all_session_messages
                messages_to_process = [sm.to_message() for sm in session_messages]
                original_message_count = len(messages_to_process)

                if checkpoint > 0 and effective_offset >= checkpoint:
                    if self.compaction_state.summary and messages_to_process:
                        summary_prefix = f"""<conversation_summary>
The following is a summary of our previous conversation:

{self.compaction_state.summary}

Please continue the conversation with this context in mind.
</conversation_summary>

"""
                        messages_to_process = self._prepend_summary_to_first_message(messages_to_process, summary_prefix)
                    stage = "checkpoint"

                # Apply truncation
                protected_indices = self._find_protected_message_indices(messages_to_process, self.protected_turns)
                truncated_messages, truncation_count, chars_saved = self._truncate_tool_contents(
                    messages_to_process, protected_indices=protected_indices
                )

                if truncation_count > 0:
                    stage = "checkpoint+truncation" if stage == "checkpoint" else "truncation"

                agent.messages = prepend_messages + truncated_messages
                compaction_overhead_ms = (time.time() - compaction_start_time) * 1000

                self.last_init_info = {
                    "stage": stage,
                    "original_messages": original_message_count,
                    "final_messages": len(agent.messages),
                    "truncation_count": truncation_count,
                    "compaction_overhead_ms": compaction_overhead_ms,
                }

        # Mark that we have an existing agent
        self.has_existing_agent = True

    def update_after_turn(self, input_tokens: int, agent_id: str) -> None:
        """
        Update compaction state after turn completion.

        Called after agent response with actual input token count.
        Uses cached valid cutoff points from initialize() - no additional Session Memory query.

        Flow:
        - Always update lastInputTokens
        - If input_tokens > token_threshold:
          - Use cached valid cutoff points to find checkpoint
          - Generate summary from cached messages
          - Update checkpoint + save to DynamoDB

        In metrics_only mode, only tracks tokens without triggering compaction or saving state.

        Args:
            input_tokens: Actual input tokens from this turn
            agent_id: Agent ID (for logging)
        """
        if self.compaction_state is None:
            self.compaction_state = CompactionState()

        # Update lastInputTokens (for metrics tracking)
        self.compaction_state.lastInputTokens = input_tokens

        # In metrics_only mode, skip compaction logic and DynamoDB save
        if self.metrics_only:
            logger.debug(f" Metrics-only: context_tokens={input_tokens:,} (no compaction)")
            return

        # Check if checkpoint should be set or updated
        if input_tokens > self.token_threshold:
            logger.info(f" Threshold exceeded: {input_tokens:,} > {self.token_threshold:,}")
            logger.info(f" Cached cutoff points: {len(self._valid_cutoff_message_ids)}, protected_turns: {self.protected_turns}")

            # Use cached valid cutoff points from initialize()
            if not self._valid_cutoff_message_ids:
                logger.info(" No valid cutoff points cached, skipping checkpoint update")
                self.save_compaction_state(self.compaction_state)
                return

            total_turns = len(self._valid_cutoff_message_ids)

            # Need at least protected_turns + 1 turns to make a cutoff
            if total_turns <= self.protected_turns:
                logger.debug(
                    f" Only {total_turns} turns available (need > {self.protected_turns}), "
                    f"keeping all messages"
                )
                self.save_compaction_state(self.compaction_state)
                return

            # Keep last N turns, checkpoint at the start of (N+1)th turn from end
            new_checkpoint = self._valid_cutoff_message_ids[-(self.protected_turns)]
            current_checkpoint = self.compaction_state.checkpoint

            logger.info(f" Cutoff IDs: {self._valid_cutoff_message_ids}, new_checkpoint={new_checkpoint}, current={current_checkpoint}")

            # Only update if new checkpoint is further ahead
            if new_checkpoint > current_checkpoint:
                logger.info(
                    f" Checkpoint update: {input_tokens:,} tokens > {self.token_threshold:,} threshold, "
                    f"checkpoint {current_checkpoint} → {new_checkpoint}"
                )

                # Generate summary for messages before checkpoint
                # New summary REPLACES existing summary (no accumulation)
                messages_to_summarize = self._all_messages_for_summary[:new_checkpoint] if self._all_messages_for_summary else []

                summary = self._generate_summary_for_compaction(messages_to_summarize)

                # Update compaction state
                self.compaction_state.checkpoint = new_checkpoint
                self.compaction_state.summary = summary

                logger.debug(
                    f" Checkpoint updated: {new_checkpoint}, "
                    f"summary_length={len(summary) if summary else 0}"
                )

        # Save state to DynamoDB
        self.save_compaction_state(self.compaction_state)

    def _generate_summary_for_compaction(self, messages: List[Dict]) -> Optional[str]:
        """
        Generate a summary of messages for compaction.

        First tries to retrieve from LTM (if SUMMARIZATION strategy is configured),
        falls back to simple extraction of key points.

        Note: New summary completely REPLACES existing summary (no accumulation).
        Each checkpoint has its own summary covering all messages before it.

        Args:
            messages: Messages to summarize (those before the checkpoint)

        Returns:
            Summary text or None if generation fails
        """
        if not messages:
            return None

        # Try to retrieve existing summaries from LTM first
        # Note: New summary REPLACES existing summary (no accumulation)
        summaries = self._retrieve_session_summaries()
        if summaries:
            combined = "\n\n".join(summaries)
            logger.debug(f" Retrieved {len(summaries)} summaries from LTM for compaction")
            return combined

        # Fallback: extract key points from messages (simple approach)
        # This is a basic fallback - LTM summaries are preferred
        try:
            key_points = []
            for msg in messages:
                role = msg.get('role', '')
                content = msg.get('content', [])

                if role == 'user' and isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and 'text' in block:
                            text = block['text']
                            # Extract first line as topic indicator
                            first_line = text.split('\n')[0][:100]
                            if first_line and not first_line.startswith('<'):
                                key_points.append(f"- User asked about: {first_line}")
                                break

            if key_points:
                # Limit to last 10 key points
                new_summary = "Previous conversation topics:\n" + "\n".join(key_points[-10:])
                logger.debug(f" Generated fallback summary with {len(key_points)} key points")
                return new_summary

        except Exception as e:
            logger.warning(f"Failed to generate fallback summary: {e}")

        return None
