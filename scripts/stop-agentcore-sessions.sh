#!/usr/bin/env bash
#
# stop_all_agentcore_sessions.sh
#
# Stop all AgentCore Runtime sessions for a given runtime ARN.
#
# Usage:
#   ./stop_all_agentcore_sessions.sh <AGENT_RUNTIME_ARN> <SESSIONS_FILE> [AWS_PROFILE]
#
#   AGENT_RUNTIME_ARN  The ARN of the AgentCore Runtime.
#   SESSIONS_FILE      Path to a file with one runtimeSessionId per line.
#   AWS_PROFILE        Optional AWS CLI profile name.

set -euo pipefail

AGENT_RUNTIME_ARN="${1:-}"
SESSIONS_FILE="${2:-}"
AWS_PROFILE="${3:-}"

if [ -z "$AGENT_RUNTIME_ARN" ] || [ -z "$SESSIONS_FILE" ]; then
  echo "Usage: $0 <AGENT_RUNTIME_ARN> <SESSIONS_FILE> [AWS_PROFILE]" >&2
  exit 1
fi

if [ ! -f "$SESSIONS_FILE" ]; then
  echo "Error: sessions file '$SESSIONS_FILE' does not exist" >&2
  exit 1
fi

AWS_CMD="aws"
if [ -n "$AWS_PROFILE" ]; then
  AWS_CMD="aws --profile $AWS_PROFILE"
fi

echo "Stopping AgentCore Runtime sessions from '$SESSIONS_FILE' for ARN:"
echo "  $AGENT_RUNTIME_ARN"
echo

while IFS= read -r SESSION_ID; do
  # Skip empty lines and comments
  if [ -z "$SESSION_ID" ] || printf '%s' "$SESSION_ID" | grep -qE '^[[:space:]]*#'; then
    continue
  fi

  echo "Stopping session: $SESSION_ID"

  set +e
  $AWS_CMD bedrock-agentcore stop-runtime-session \
    --agent-runtime-arn "$AGENT_RUNTIME_ARN" \
    --runtime-session-id "$SESSION_ID"

  STATUS=$?
  set -e

  if [ $STATUS -ne 0 ]; then
    echo "  -> Failed to stop session $SESSION_ID (exit code $STATUS)" >&2
  else
    echo "  -> Session $SESSION_ID stopped"
  fi
done < "$SESSIONS_FILE"

echo
echo "Done."
