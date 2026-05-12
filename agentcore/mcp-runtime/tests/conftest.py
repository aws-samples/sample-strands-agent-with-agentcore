import sys
from pathlib import Path
from unittest.mock import MagicMock

# Mock AWS/AgentCore packages before any source imports so tests run
# without cloud SDK installations.
for mod in [
    "bedrock_agentcore",
    "bedrock_agentcore.runtime",
    "bedrock_agentcore.services",
    "bedrock_agentcore.services.identity",
    "boto3",
    "botocore",
]:
    sys.modules.setdefault(mod, MagicMock())

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
