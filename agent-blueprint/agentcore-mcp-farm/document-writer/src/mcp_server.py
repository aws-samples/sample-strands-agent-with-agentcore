"""Document Writer MCP Server (Markdown-based)

MCP server for creating structured Word documents using markdown as the intermediate format.
Supports natural markdown writing with automatic DOCX conversion on finalization.
"""

import os
import io
import json
import logging
import base64
from typing import List, Dict, Any, Optional, Union
from datetime import datetime
import boto3
from botocore.exceptions import ClientError
from fastmcp import FastMCP
from mcp.types import TextContent, ImageContent
from document_manager import DocumentManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastMCP server
mcp = FastMCP("document-writer", stateless_http=True)

# Global document manager instance
_doc_manager: DocumentManager = None
_s3_client = None
_document_bucket = None

# Chart storage (session_id -> {chart_filename -> chart_data})
_chart_storage: Dict[str, Dict[str, Dict[str, Any]]] = {}


def _get_doc_manager() -> DocumentManager:
    """Get or create document manager instance"""
    global _doc_manager
    if _doc_manager is None:
        _doc_manager = DocumentManager()
    return _doc_manager


def _get_s3_client():
    """Get or create S3 client"""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client('s3')
    return _s3_client


def _get_document_bucket() -> str:
    """Get S3 bucket name from environment"""
    global _document_bucket
    if _document_bucket is None:
        _document_bucket = os.environ.get('DOCUMENT_BUCKET_NAME')
        if not _document_bucket:
            raise ValueError("DOCUMENT_BUCKET_NAME environment variable not set")
    return _document_bucket


# Simplified Markdown-based Tools

@mcp.tool()
def create_document(title: str, outline: Optional[Union[List[Dict[str, Any]], str]] = None) -> str:
    """
    Create a new markdown document with title and optional outline.
    The outline is embedded as HTML comments for AI context and returned in the response.

    Args:
        title: The title of the document
        outline: Optional document structure as nested dictionaries or JSON string
            Example: [
                {"title": "Introduction", "subsections": [{"title": "Background"}]},
                {"title": "Methods"},
                {"title": "Results"}
            ]

    Returns:
        Success message with outline preview

    Example:
        create_document(
            "Research Paper on AI",
            [
                {"title": "Introduction", "subsections": [{"title": "Background"}]},
                {"title": "Methods"},
                {"title": "Results"},
                {"title": "Conclusion"}
            ]
        )
    """
    try:
        manager = _get_doc_manager()

        # Parse outline if it's a JSON string
        parsed_outline = outline
        if isinstance(outline, str):
            try:
                parsed_outline = json.loads(outline)
                logger.info("Parsed outline from JSON string")
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse outline JSON: {e}")
                return f"❌ Error: outline must be a valid JSON array, not a string. Parse error: {str(e)}"

        return f"Document created: {manager.create(title, parsed_outline)}. Ask the user to confirm the outline and continue."
    except Exception as e:
        logger.error(f"Error creating document: {e}")
        return f"❌ Error creating document: {str(e)}"


@mcp.tool()
def write_section(section_title: str, content: str) -> str:
    """
    Write a complete section with heading and content to the document.
    This is the primary tool for building document content section by section.
    Always add citations to the content if you need to quote sources.

    The section is written in markdown format with:
    - A heading based on the section depth (## for main sections, ### for subsections)
    - Content with full markdown support

    Supports full markdown syntax in content:
    - Paragraphs: Regular text with automatic spacing
    - Bullet lists: - item or * item
    - Numbered lists: 1. item
    - Tables: Markdown table syntax with | separators
    - Citations: [Author et al., Year] (formatted in blue italic in DOCX)
    - Blockquotes: > quoted text for citations
    - Code blocks: ```code```
    - Subheadings: ### for subsections, #### for sub-subsections

    Args:
        section_title: The title of the section (e.g., "Introduction", "Methods", "Key Findings")
        content: Markdown-formatted content for this section

    Returns:
        Success message with line/character count

    Example:
        write_section(
            "Introduction",
            '''This study examines the impact of AI on retail [Smith et al., 2024].

### Background
The retail industry has undergone significant transformation:
- Digital transformation initiatives
- Customer behavior evolution
- Technology adoption acceleration

### Research Gap
Previous studies have focused primarily on e-commerce [Johnson, 2023], but limited research exists on in-store AI applications.'''
        )
    """
    try:
        manager = _get_doc_manager()

        # Format as a complete section with heading
        full_content = f"## {section_title}\n\n{content}"

        return manager.write_content(full_content)
    except Exception as e:
        logger.error(f"Error writing section: {e}")
        return f"❌ Error writing section: {str(e)}"


@mcp.tool()
def read_document() -> str:
    """
    Read the current markdown document content.
    Returns the full markdown text for review or context.

    Returns:
        The complete markdown content of the document

    Example:
        read_document()
    """
    try:
        manager = _get_doc_manager()
        return manager.read_document()
    except Exception as e:
        logger.error(f"Error reading document: {e}")
        return f"❌ Error reading document: {str(e)}"


@mcp.tool()
def replace_content(find: str, replace: str) -> str:
    """
    Find and replace text in the document.
    Replaces all occurrences of the find text with the replace text.

    Args:
        find: Text to search for
        replace: Text to replace with

    Returns:
        Success message with count of replacements made

    Example:
        replace_content("old text", "new text")
    """
    try:
        manager = _get_doc_manager()
        return manager.replace_content(find, replace)
    except Exception as e:
        logger.error(f"Error replacing content: {e}")
        return f"❌ Error replacing content: {str(e)}"
        

@mcp.tool()
def get_outline() -> str:
    """
    Get the document outline defined during creation.
    Returns the hierarchical structure as formatted text.

    Returns:
        Document outline as formatted text, or message if no outline exists

    Example:
        get_outline()
    """
    try:
        manager = _get_doc_manager()
        return manager.get_outline()
    except Exception as e:
        logger.error(f"Error getting outline: {e}")
        return f"❌ Error getting outline: {str(e)}"


@mcp.tool()
def clear_document() -> str:
    """
    Clear the current document and start fresh.
    This removes the document from memory and deletes working files.

    Returns:
        Success message

    Example:
        clear_document()
    """
    try:
        manager = _get_doc_manager()
        return manager.clear()
    except Exception as e:
        logger.error(f"Error clearing document: {e}")
        return f"❌ Error clearing document: {str(e)}"


@mcp.tool()
def finalize_document(filename: str, session_id: str) -> str:
    """
    Convert markdown to DOCX and save to S3 storage.
    This requires explicit user consent and should be used when the document is complete.
    Document is cleared from memory after successful upload.

    The conversion process:
    1. Parses markdown content
    2. Converts to formatted DOCX with:
       - Proper heading styles
       - Formatted tables
       - Bullet/numbered lists
       - Blue italic citations
       - Blockquotes
    3. Saves to S3 bucket
    4. Clears working files

    Args:
        filename: The filename to save as (e.g., "final_report.docx")
        session_id: Session identifier for organizing documents (e.g., user ID or session ID)

    Returns:
        JSON string with S3 URI, bucket, key, and size information

    Example:
        finalize_document("research_paper.docx", "user_12345")
    """
    try:
        manager = _get_doc_manager()
        if not manager.has_document():
            return "❌ No document to finalize."

        # Ensure filename ends with .docx
        if not filename.endswith('.docx'):
            filename += '.docx'

        # Convert markdown to DOCX
        logger.info("Converting markdown to DOCX...")
        doc = manager.markdown_to_docx()

        # Save to BytesIO buffer
        buffer = io.BytesIO()
        doc.save(buffer)
        buffer.seek(0)
        file_size = len(buffer.getvalue())

        # Upload to S3
        s3_client = _get_s3_client()
        bucket = _get_document_bucket()
        key = f"documents/{session_id}/{filename}"

        logger.info(f"Uploading to S3: s3://{bucket}/{key}")
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=buffer.getvalue(),
            ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            Metadata={
                'original-format': 'markdown',
                'created-at': datetime.now().isoformat(),
                'session-id': session_id
            }
        )

        s3_uri = f"s3://{bucket}/{key}"

        # Get markdown stats before clearing
        markdown_content = manager.read_document()
        markdown_lines = markdown_content.count('\n')
        markdown_words = len(markdown_content.split())

        # Clear document from memory
        manager.clear()

        # Return base64 encoded DOCX wrapped in expected format for event_formatter
        import base64
        result = base64.b64encode(buffer.getvalue()).decode('utf-8')

        # Wrap in <download> tags with DOCX MIME type and filename for event_formatter to intercept
        return f"<download filename=\"{filename}\">data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,{result}</download>"

    except ClientError as e:
        logger.error(f"S3 error finalizing document: {e}")
        return f"❌ S3 error finalizing document: {str(e)}"
    except Exception as e:
        logger.error(f"Error finalizing document: {e}")
        return f"❌ Error finalizing document: {str(e)}"


@mcp.tool()
def generate_chart(
    python_code: str,
    chart_filename: str,
    session_id: str
) -> List[Union[TextContent, ImageContent]]:
    """
    Generate a chart using Bedrock Code Interpreter and return base64 image for review.

    Args:
        python_code: Complete Python code for chart generation.
                    Available: matplotlib.pyplot, seaborn, pandas, numpy
                    Required: plt.savefig('filename.png', dpi=300, bbox_inches='tight')
        chart_filename: PNG filename. Must exactly match filename in savefig().
                       Example: "performance_chart.png"
        session_id: Session identifier for organizing charts

    Returns:
        List of ContentBlock objects (TextContent and ImageContent) for multimodal model review

    Example:
        generate_chart(
            '''
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.figure(figsize=(10, 6))
plt.plot(x, y)
plt.title('Sine Wave')
plt.xlabel('X')
plt.ylabel('Y')
plt.grid(True)
plt.savefig('sine_wave.png', dpi=300, bbox_inches='tight')
            ''',
            "sine_wave.png",
            "session_123"
        )
    """
    try:
        # Validate filename
        if not chart_filename.endswith('.png'):
            return [
                TextContent(
                    type="text",
                    text=f"❌ Invalid filename: '{chart_filename}' must end with .png"
                )
            ]

        logger.info(f"Generating chart via Code Interpreter: {chart_filename}")

        # Execute Python code in Bedrock Code Interpreter
        region = os.getenv('AWS_REGION', 'us-west-2')

        from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

        code_interpreter = CodeInterpreter(region)
        code_interpreter.start()

        logger.info(f"Code Interpreter executeCode starting - session: {session_id}")
        response = code_interpreter.invoke("executeCode", {
            "code": python_code,
            "language": "python",
            "clearContext": False
        })
        logger.info(f"Code Interpreter executeCode returned - session: {session_id}")

        # Check for errors
        execution_success = False
        execution_output = ""
        for event in response.get("stream", []):
            result = event.get("result", {})
            if result.get("isError", False):
                error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                logger.error(f"Code Interpreter execution failed: {error_msg[:200]}")
                code_interpreter.stop()

                return [
                    TextContent(
                        type="text",
                        text=f"""❌ Python code execution failed

**Error Output:**
```
{error_msg}
```

**Your Code:**
```python
{python_code[:500]}{'...' if len(python_code) > 500 else ''}
```

Please fix the error and try again."""
                    )
                ]

            execution_output = result.get("structuredContent", {}).get("stdout", "")
            execution_success = True

        if not execution_success:
            logger.warning("Code Interpreter: No result returned")
            code_interpreter.stop()
            return [
                TextContent(
                    type="text",
                    text="❌ No result from Bedrock Code Interpreter. Please try again or simplify your code."
                )
            ]

        logger.info("Code Interpreter execution successful")

        # Download the generated chart file
        file_content = None
        try:
            download_response = code_interpreter.invoke("readFiles", {"paths": [chart_filename]})

            for event in download_response.get("stream", []):
                result = event.get("result", {})
                if "content" in result and len(result["content"]) > 0:
                    content_block = result["content"][0]
                    # File content can be in 'data' (bytes) or 'resource.blob'
                    if "data" in content_block:
                        file_content = content_block["data"]
                    elif "resource" in content_block and "blob" in content_block["resource"]:
                        file_content = content_block["resource"]["blob"]

                    if file_content:
                        break

            if file_content is None:
                raise Exception(f"No file content returned for {chart_filename}")

            logger.info(f"Successfully downloaded chart file: {chart_filename} ({len(file_content)} bytes)")

        except Exception as download_error:
            logger.error(f"Failed to download chart file {chart_filename}: {str(download_error)}")
            code_interpreter.stop()

            # List available files to help debug
            available_files = []
            try:
                file_list_response = code_interpreter.invoke("listFiles", {"path": ""})
                for event in file_list_response.get("stream", []):
                    result = event.get("result", {})
                    if "content" in result:
                        for item in result.get("content", []):
                            if item.get("description") == "File":
                                filename = item.get("name", "")
                                if filename:
                                    available_files.append(filename)
            except:
                pass

            return [
                TextContent(
                    type="text",
                    text=f"""❌ Failed to download file

**Error:** Could not download '{chart_filename}'
**Exception:** {str(download_error)}

**Available files:** {', '.join(available_files) if available_files else 'None'}

**Fix:** Make sure your code creates the file with the exact filename:
```python
plt.savefig('{chart_filename}', dpi=300, bbox_inches='tight')
```"""
                )
            ]

        code_interpreter.stop()

        # Store chart in memory
        image_b64 = base64.b64encode(file_content).decode('utf-8')

        if session_id not in _chart_storage:
            _chart_storage[session_id] = {}

        _chart_storage[session_id][chart_filename] = {
            'filename': chart_filename,
            'base64_content': image_b64,
            'original_code': python_code,
            'execution_output': execution_output
        }

        file_size_kb = len(file_content) / 1024

        logger.info(f"Chart stored: {chart_filename} ({file_size_kb:.1f} KB)")

        # Return multimodal response with text and image as ContentBlock list
        return [
            TextContent(
                type="text",
                text=f"✅ Chart generated: {chart_filename} ({file_size_kb:.1f} KB)\n\nReview the chart below. If it looks good, use insert_chart() to add it to your document."
            ),
            ImageContent(
                type="image",
                data=image_b64,
                mimeType="image/png"
            )
        ]

    except Exception as e:
        logger.error(f"Error generating chart: {e}")
        import traceback
        return [
            TextContent(
                type="text",
                text=f"❌ Failed to execute code\n\n**Error:** {str(e)}\n\n**Traceback:**\n```\n{traceback.format_exc()}\n```"
            )
        ]


@mcp.tool()
def insert_chart(
    chart_filename: str,
    chart_title: str,
    chart_description: str,
    session_id: str
) -> str:
    """
    Insert a previously generated chart into the markdown document.
    The chart will be embedded as an image with a caption.

    Args:
        chart_filename: Exact filename from generate_chart (e.g., "perf_chart.png")
        chart_title: Title for the chart
        chart_description: 1-2 sentence description of what the chart shows
        session_id: Session identifier

    Returns:
        Success message or error

    Example:
        insert_chart(
            "sales_trend.png",
            "Q4 Sales Trend",
            "Monthly sales performance showing 15% growth in Q4 2024",
            "session_123"
        )
    """
    try:
        manager = _get_doc_manager()

        if not manager.has_document():
            return "❌ No document exists. Create a document first using create_document()"

        # Check if chart exists in storage
        if session_id not in _chart_storage or chart_filename not in _chart_storage[session_id]:
            available = list(_chart_storage.get(session_id, {}).keys())
            return f"❌ Chart '{chart_filename}' not found. Available charts: {', '.join(available) if available else 'None'}\n\nGenerate the chart first using generate_chart()"

        chart_data = _chart_storage[session_id][chart_filename]

        # Create markdown for embedded chart
        # Note: For now, we're just adding a placeholder since we need to handle base64 embedding
        chart_markdown = f"\n\n### {chart_title}\n\n"
        chart_markdown += f"![{chart_title}](data:image/png;base64,{chart_data.get('base64_content', 'PLACEHOLDER')})\n\n"
        chart_markdown += f"*{chart_description}*\n\n"

        # Append to document
        result = manager.write_content(chart_markdown)

        logger.info(f"Inserted chart {chart_filename} into document")

        return f"✅ Chart inserted successfully!\n\n**Title:** {chart_title}\n**File:** {chart_filename}\n\n{result}"

    except Exception as e:
        logger.error(f"Error inserting chart: {e}")
        return f"❌ Error inserting chart: {str(e)}"


if __name__ == "__main__":
    logger.info("Starting Document Writer MCP Server (Markdown-based)...")

    # Verify environment configuration
    try:
        bucket = _get_document_bucket()
        logger.info(f"Document bucket configured: {bucket}")
    except ValueError as e:
        logger.warning(f"S3 bucket not configured: {e}")

    # Start the MCP server
    logger.info("Document Writer MCP Server starting on port 8000")
    logger.info("Document format: Markdown → DOCX conversion on finalization")
    mcp.run(transport="streamable-http")
