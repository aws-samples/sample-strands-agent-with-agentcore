"""Built-in tools powered by AWS Bedrock services

This package contains tools that leverage AWS Bedrock capabilities:
- Code Interpreter: Execute Python code for diagrams, charts, and document creation
- Browser Automation: Navigate, interact, and extract data from web pages using Nova Act AI
- Word Documents: Create, modify, and manage Word documents with persistent storage
- Excel Spreadsheets: Create, modify, and manage Excel spreadsheets with persistent storage
- PowerPoint Presentations: Create, modify, and manage PowerPoint presentations with persistent storage

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

from .diagram_tool import generate_diagram_and_validate
from .artifact_editor_tool import update_artifact

# Nova Act browser tools
from .nova_act_browser_tools import browser_navigate, browser_act, browser_extract, browser_get_page_info, browser_manage_tabs, browser_drag, browser_save_screenshot

from .word_document_tool import (
    create_word_document,
    modify_word_document,
    list_my_word_documents,
    read_word_document
)
from .excel_spreadsheet_tool import (
    create_excel_spreadsheet,
    modify_excel_spreadsheet,
    list_my_excel_spreadsheets,
    read_excel_spreadsheet
)
from .powerpoint_presentation_tool import (
    list_my_powerpoint_presentations,
    get_presentation_layouts,
    analyze_presentation,
    create_presentation,
    update_slide_content,
    add_slide,
    delete_slides,
    move_slide,
    duplicate_slide,
    update_slide_notes
)

__all__ = [
    'generate_diagram_and_validate',
    'update_artifact',
    'browser_navigate',
    'browser_act',
    'browser_extract',
    'browser_get_page_info',
    'browser_manage_tabs',
    'browser_drag',
    'browser_save_screenshot',
    'create_word_document',
    'modify_word_document',
    'list_my_word_documents',
    'read_word_document',
    'create_excel_spreadsheet',
    'modify_excel_spreadsheet',
    'list_my_excel_spreadsheets',
    'read_excel_spreadsheet',
    # PowerPoint tools
    'list_my_powerpoint_presentations',
    'get_presentation_layouts',
    'analyze_presentation',
    'create_presentation',
    'update_slide_content',
    'add_slide',
    'delete_slides',
    'move_slide',
    'duplicate_slide',
    'update_slide_notes'
]

# Collection of all builtin tools for registry sync
BUILTIN_TOOLS = [
    generate_diagram_and_validate,
    update_artifact,
    create_word_document,
    modify_word_document,
    list_my_word_documents,
    read_word_document,
    create_excel_spreadsheet,
    modify_excel_spreadsheet,
    list_my_excel_spreadsheets,
    read_excel_spreadsheet,
    list_my_powerpoint_presentations,
    get_presentation_layouts,
    analyze_presentation,
    create_presentation,
    update_slide_content,
    add_slide,
    delete_slides,
    move_slide,
    duplicate_slide,
    update_slide_notes
]

# Nova Act browser tools
BUILTIN_TOOLS.extend([
    browser_navigate,
    browser_act,
    browser_extract,
    browser_get_page_info,
    browser_manage_tabs,
    browser_drag,
    browser_save_screenshot,
])
