"""Built-in tools powered by AWS Bedrock services

This package contains tools that leverage AWS Bedrock capabilities:
- Code Interpreter: Execute Python code for diagrams and charts
- Browser Automation: Navigate, interact, and extract data from web pages using Nova Act AI

⚠️  IMPORTANT: When adding a NEW TOOL, you MUST complete ALL 3 steps:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Add tool import and export in THIS file (__init__.py)
2. Add tool definition in: chatbot-app/frontend/src/config/tools-config.json
3. Sync to DynamoDB: POST http://localhost:3000/api/tools/sync-registry
   (Or in production: POST https://your-domain.com/api/tools/sync-registry)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Why? The tool registry is stored in DynamoDB (userId='TOOL_REGISTRY') and
must be manually synced whenever tools-config.json changes. Without step 3,
your new tool will NOT appear in the agent's tool list!

You can verify the sync with: GET http://localhost:3000/api/tools
"""

from .code_interpreter_diagram_tool import generate_diagram_and_validate
from .browser_tools import browser_navigate, browser_act, browser_extract, browser_get_page_info, browser_manage_tabs

__all__ = [
    'generate_diagram_and_validate',
    'browser_navigate',
    'browser_act',
    'browser_extract',
    'browser_get_page_info',
    'browser_manage_tabs'
]
