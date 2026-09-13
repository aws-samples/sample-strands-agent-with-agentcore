"""Preserve streamed text before the SDK cancellation placeholder is persisted."""
from dataclasses import dataclass

STOPPED_TEXT = "*Stopped by you.*"


@dataclass
class CancellationHistory:
    partial_text: str = ""
    requested: bool = False
    persisted: bool = False

    def message(self):
        text = self.partial_text.strip()
        return {"role": "assistant", "content": [{"text": (text + "\n\n" if text else "") + STOPPED_TEXT}]}


def prepare_message(message, agent):
    state = getattr(agent, "_cancellation_history", None)
    if not isinstance(state, CancellationHistory) or message.get("role") != "assistant":
        return message
    if state.requested and message.get("content") == [{"text": "Cancelled by user"}]:
        message["content"] = state.message()["content"]
        state.persisted = True
    # Each complete assistant message has its own durable copy. Only retain
    # the currently streaming segment, otherwise tool cycles duplicate prose.
    state.partial_text = ""
    return message
