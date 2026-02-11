#!/usr/bin/env python3
"""
Gmail MCP Server with AgentCore Identity 3LO Integration
Provides Gmail tools with per-user OAuth authentication via Google.

Runs as a FastMCP server on AgentCore Runtime.
"""
import os
import sys
import json
import httpx
import asyncio
import base64
import uvicorn
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Dict, List, Optional

import logging
from mcp.server.fastmcp import Context, FastMCP
from starlette.responses import JSONResponse
from starlette.routing import Route

from agentcore_context_middleware import AgentCoreContextMiddleware
from agentcore_oauth import OAuthHelper, get_token_with_elicitation

# Setup logger
logger = logging.getLogger(__name__)

# Set UTF-8 encoding for stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='ignore')
elif hasattr(sys.stdout, 'buffer'):
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'ignore')


# ── FastMCP Server ─────────────────────────────────────────────────────

mcp = FastMCP(host="0.0.0.0", port=8000, stateless_http=True)

# Gmail API configuration
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

# OAuth helper for Gmail (uses reusable agentcore_oauth module)
_gmail_oauth = OAuthHelper(
    provider_name="google-oauth-provider",
    scopes=[
        "https://mail.google.com/",  # Full access (required for batchDelete)
        "https://www.googleapis.com/auth/gmail.modify",  # Read, send, delete, and modify emails
        "https://www.googleapis.com/auth/gmail.compose",  # Create and send emails
    ],
)



# ── Gmail API Callers ─────────────────────────────────────────────────
# These functions take access_token as a parameter (no decorator).
# Each tool calls get_token_with_elicitation() once at the start,
# then passes the token to these helpers. This solves N+1 token requests.

# Shared HTTP client for connection pooling
_http_client: Optional[httpx.AsyncClient] = None


async def _get_http_client() -> httpx.AsyncClient:
    """Get or create shared HTTP client for connection reuse."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def call_gmail_api_get(
    access_token: str, endpoint: str, params: Optional[Dict] = None
) -> Dict:
    """Gmail REST API GET caller."""
    url = f"{GMAIL_API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {access_token}"}

    client = await _get_http_client()
    response = await client.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()


async def call_gmail_api_post(
    access_token: str, endpoint: str, data: Optional[Dict] = None, params: Optional[Dict] = None
) -> Dict:
    """Gmail REST API POST caller."""
    url = f"{GMAIL_API_BASE}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    client = await _get_http_client()
    response = await client.post(url, headers=headers, json=data, params=params)
    response.raise_for_status()

    # Handle empty response (e.g., batchDelete returns empty body on success)
    if not response.content:
        return {}
    return response.json()


async def call_gmail_api_delete(access_token: str, endpoint: str) -> bool:
    """Gmail REST API DELETE caller."""
    url = f"{GMAIL_API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {access_token}"}

    client = await _get_http_client()
    response = await client.delete(url, headers=headers)
    response.raise_for_status()
    return True


# ── Helper Functions ─────────────────────────────────────────────────


def _parse_headers(headers: List[Dict]) -> Dict[str, str]:
    """Extract common headers into a dict."""
    result = {}
    for h in headers:
        name = h.get("name", "").lower()
        if name in ("subject", "from", "to", "date", "cc", "bcc", "message-id"):
            result[name] = h.get("value", "")
    return result


def _extract_body(payload: Dict) -> str:
    """Recursively extract text body from MIME payload.

    Prefers text/plain, falls back to text/html.
    """
    mime_type = payload.get("mimeType", "")

    # Leaf node with body data
    if "body" in payload and payload["body"].get("data"):
        data = payload["body"]["data"]
        decoded = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        if mime_type == "text/plain":
            return decoded
        if mime_type == "text/html":
            return decoded

    # Multipart: recurse into parts
    parts = payload.get("parts", [])
    plain_text = ""
    html_text = ""

    for part in parts:
        part_mime = part.get("mimeType", "")
        if part_mime.startswith("multipart/"):
            result = _extract_body(part)
            if result:
                return result
        elif part_mime == "text/plain":
            body_data = part.get("body", {}).get("data", "")
            if body_data:
                plain_text = base64.urlsafe_b64decode(body_data + "==").decode(
                    "utf-8", errors="replace"
                )
        elif part_mime == "text/html":
            body_data = part.get("body", {}).get("data", "")
            if body_data:
                html_text = base64.urlsafe_b64decode(body_data + "==").decode(
                    "utf-8", errors="replace"
                )

    return plain_text or html_text


def _extract_attachments(payload: Dict) -> List[Dict]:
    """Extract attachment metadata from MIME payload."""
    attachments = []

    def _walk(part: Dict):
        filename = part.get("filename")
        body = part.get("body", {})
        if filename and body.get("attachmentId"):
            attachments.append(
                {
                    "filename": filename,
                    "mimeType": part.get("mimeType", "unknown"),
                    "size": body.get("size", 0),
                    "attachmentId": body["attachmentId"],
                }
            )
        for sub in part.get("parts", []):
            _walk(sub)

    _walk(payload)
    return attachments


def _create_email_message(
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    reply_to: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    html_body: Optional[str] = None,
) -> str:
    """Create RFC 2822 email message and return base64url encoded."""
    if html_body:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    else:
        msg = MIMEText(body, "plain", "utf-8")

    msg["To"] = to
    msg["Subject"] = subject

    if cc:
        msg["Cc"] = cc
    if bcc:
        msg["Bcc"] = bcc
    if reply_to:
        msg["Reply-To"] = reply_to
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to

    # Encode to base64url (Gmail API requirement)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    return raw


# ── Tools ──────────────────────────────────────────────────────────


@mcp.tool()
async def list_labels(ctx: Context) -> str:
    """List all Gmail labels.

    Returns all labels including system labels (INBOX, SENT, TRASH, etc.)
    and user-created labels.
    """
    logger.debug("[Tool] list_labels called")

    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        logger.debug("[Tool] Calling Gmail API for labels...")
        data = await call_gmail_api_get(access_token, "labels")
        logger.debug(f"[Tool] Gmail API response received: {len(data.get('labels', []))} labels")
        labels = data.get("labels", [])

        # Categorize labels
        system_labels = []
        user_labels = []

        for label in labels:
            label_info = {
                "id": label.get("id", ""),
                "name": label.get("name", ""),
                "type": label.get("type", ""),
            }
            if label.get("type") == "system":
                system_labels.append(label_info)
            else:
                user_labels.append(label_info)

        result = {
            "system_labels": sorted(system_labels, key=lambda x: x["name"]),
            "user_labels": sorted(user_labels, key=lambda x: x["name"]),
            "total_count": len(labels),
        }

        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"[Tool] Error listing labels: {e}")
        return f"Error listing labels: {str(e)}"


@mcp.tool()
async def list_emails(
    label: str = "INBOX",
    max_results: int = 10,
    include_spam_trash: bool = False,
    ctx: Context = None,
) -> str:
    """List emails by label.

    Args:
        label: Label to filter by (INBOX, SENT, DRAFT, TRASH, SPAM, STARRED, IMPORTANT, or custom label ID). Default: INBOX.
        max_results: Maximum number of results (1-100, default 10).
        include_spam_trash: Include emails from SPAM and TRASH. Default: False.
    """
    max_results = max(1, min(100, max_results))

    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        params = {
            "labelIds": label,
            "maxResults": max_results,
            "includeSpamTrash": include_spam_trash,
        }

        list_data = await call_gmail_api_get(access_token, "messages", params=params)

        messages = list_data.get("messages", [])
        if not messages:
            return f"No emails found in {label}"

        # Fetch metadata for each message (reusing the same token)
        results = []
        for msg_stub in messages:
            msg_id = msg_stub["id"]
            try:
                msg = await call_gmail_api_get(
                    access_token,
                    f"messages/{msg_id}",
                    params={"format": "metadata", "metadataHeaders": "Subject,From,Date"},
                )
                hdrs = _parse_headers(msg.get("payload", {}).get("headers", []))
                results.append(
                    {
                        "id": msg_id,
                        "threadId": msg.get("threadId", ""),
                        "subject": hdrs.get("subject", "(no subject)"),
                        "from": hdrs.get("from", ""),
                        "date": hdrs.get("date", ""),
                        "snippet": msg.get("snippet", ""),
                        "labelIds": msg.get("labelIds", []),
                    }
                )
            except Exception as e:
                results.append({"id": msg_id, "error": str(e)})

        return json.dumps(results, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"[Tool] Error listing emails: {e}")
        return f"Error listing emails: {str(e)}"


@mcp.tool()
async def search_emails(query: str, max_results: int = 10, ctx: Context = None) -> str:
    """Search Gmail using Gmail query syntax.

    Supports operators: from:, to:, subject:, is:unread, has:attachment,
    after:, before:, label:, in:, newer_than:, older_than:, etc.

    Args:
        query: Gmail search query string.
        max_results: Maximum number of results (1-50, default 10).
    """
    max_results = max(1, min(50, max_results))

    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        list_data = await call_gmail_api_get(
            access_token,
            "messages",
            params={"q": query, "maxResults": max_results},
        )

        messages = list_data.get("messages", [])
        if not messages:
            return f"No emails found for query: {query}"

        # Fetch each message's metadata (reusing the same token)
        results = []
        for msg_stub in messages:
            msg_id = msg_stub["id"]
            try:
                msg = await call_gmail_api_get(
                    access_token,
                    f"messages/{msg_id}",
                    params={"format": "metadata", "metadataHeaders": "Subject,From,Date"},
                )
                hdrs = _parse_headers(msg.get("payload", {}).get("headers", []))
                results.append(
                    {
                        "id": msg_id,
                        "threadId": msg.get("threadId", ""),
                        "subject": hdrs.get("subject", "(no subject)"),
                        "from": hdrs.get("from", ""),
                        "date": hdrs.get("date", ""),
                        "snippet": msg.get("snippet", ""),
                        "labelIds": msg.get("labelIds", []),
                    }
                )
            except Exception as e:
                results.append({"id": msg_id, "error": str(e)})

        return json.dumps(results, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"[Tool] Error searching emails: {e}")
        return f"Error searching emails: {str(e)}"


@mcp.tool()
async def read_email(message_id: str, ctx: Context = None) -> str:
    """Read a full email message by its ID.

    Returns subject, from, to, date, body text, and attachment metadata.

    Args:
        message_id: The Gmail message ID (obtained from search_emails or list_emails).
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        msg = await call_gmail_api_get(
            access_token,
            f"messages/{message_id}",
            params={"format": "full"},
        )

        payload = msg.get("payload", {})
        hdrs = _parse_headers(payload.get("headers", []))
        body = _extract_body(payload)
        attachments = _extract_attachments(payload)

        result = {
            "id": msg.get("id", ""),
            "threadId": msg.get("threadId", ""),
            "subject": hdrs.get("subject", "(no subject)"),
            "from": hdrs.get("from", ""),
            "to": hdrs.get("to", ""),
            "cc": hdrs.get("cc", ""),
            "date": hdrs.get("date", ""),
            "labelIds": msg.get("labelIds", []),
            "body": body,
            "attachments": attachments,
        }

        return json.dumps(result, ensure_ascii=False, indent=2)

    except Exception as e:
        logger.error(f"[Tool] Error reading email: {e}")
        return f"Error reading email: {str(e)}"


@mcp.tool()
async def send_email(
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    reply_to: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    html_body: Optional[str] = None,
    ctx: Context = None,
) -> str:
    """Send an email.

    Args:
        to: Recipient email address(es). Multiple addresses separated by commas.
        subject: Email subject line.
        body: Plain text email body.
        cc: CC recipient(s). Optional.
        bcc: BCC recipient(s). Optional.
        reply_to: Reply-To address. Optional.
        in_reply_to: Message-ID to reply to (for threading). Optional.
        html_body: HTML version of the email body. Optional.
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        raw_message = _create_email_message(
            to=to,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            reply_to=reply_to,
            in_reply_to=in_reply_to,
            html_body=html_body,
        )

        result = await call_gmail_api_post(
            access_token,
            "messages/send",
            data={"raw": raw_message},
        )

        return json.dumps(
            {
                "success": True,
                "message": "Email sent successfully",
                "id": result.get("id", ""),
                "threadId": result.get("threadId", ""),
                "labelIds": result.get("labelIds", []),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"[Tool] Error sending email: {e}")
        return f"Error sending email: {str(e)}"


@mcp.tool()
async def draft_email(
    to: str,
    subject: str,
    body: str,
    cc: Optional[str] = None,
    bcc: Optional[str] = None,
    reply_to: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    html_body: Optional[str] = None,
    ctx: Context = None,
) -> str:
    """Create an email draft.

    The draft will be saved in the Drafts folder and can be edited or sent later.

    Args:
        to: Recipient email address(es). Multiple addresses separated by commas.
        subject: Email subject line.
        body: Plain text email body.
        cc: CC recipient(s). Optional.
        bcc: BCC recipient(s). Optional.
        reply_to: Reply-To address. Optional.
        in_reply_to: Message-ID to reply to (for threading). Optional.
        html_body: HTML version of the email body. Optional.
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        raw_message = _create_email_message(
            to=to,
            subject=subject,
            body=body,
            cc=cc,
            bcc=bcc,
            reply_to=reply_to,
            in_reply_to=in_reply_to,
            html_body=html_body,
        )

        result = await call_gmail_api_post(
            access_token,
            "drafts",
            data={"message": {"raw": raw_message}},
        )

        draft_info = result.get("message", {})
        return json.dumps(
            {
                "success": True,
                "message": "Draft created successfully",
                "draft_id": result.get("id", ""),
                "message_id": draft_info.get("id", ""),
                "threadId": draft_info.get("threadId", ""),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"[Tool] Error creating draft: {e}")
        return f"Error creating draft: {str(e)}"


@mcp.tool()
async def delete_email(message_id: str, permanent: bool = False, ctx: Context = None) -> str:
    """Delete an email.

    By default, moves the email to Trash. Use permanent=True to permanently delete.

    Args:
        message_id: The Gmail message ID to delete.
        permanent: If True, permanently deletes the email. If False (default), moves to Trash.
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        if permanent:
            # Permanently delete
            await call_gmail_api_delete(access_token, f"messages/{message_id}")
            return json.dumps(
                {
                    "success": True,
                    "message": "Email permanently deleted",
                    "message_id": message_id,
                },
                ensure_ascii=False,
                indent=2,
            )
        else:
            # Move to Trash
            result = await call_gmail_api_post(
                access_token,
                f"messages/{message_id}/trash",
                data={},
            )
            return json.dumps(
                {
                    "success": True,
                    "message": "Email moved to Trash",
                    "message_id": result.get("id", message_id),
                    "labelIds": result.get("labelIds", []),
                },
                ensure_ascii=False,
                indent=2,
            )

    except Exception as e:
        logger.error(f"[Tool] Error deleting email: {e}")
        return f"Error deleting email: {str(e)}"


@mcp.tool()
async def bulk_delete_emails(
    query: str,
    reason: str,
    max_delete: int = 50,
    ctx: Context = None,
) -> str:
    """Bulk permanently delete emails matching a Gmail search query using batchDelete API.

    This tool requires user approval before execution. The reason parameter
    will be shown to the user to explain why these emails are being deleted.

    WARNING: This permanently deletes emails. They cannot be recovered.
    For moving to Trash, use delete_email tool individually.

    Common query examples:
    - "is:spam" - All spam emails
    - "is:spam older_than:7d" - Spam older than 7 days
    - "in:inbox is:unread older_than:14d" - Unread inbox emails older than 14 days
    - "from:newsletter@example.com" - Emails from specific sender
    - "category:promotions older_than:30d" - Old promotional emails

    Args:
        query: Gmail search query to find emails to delete.
        reason: Human-readable explanation of why these emails are being deleted.
                This will be shown to the user for approval.
        max_delete: Maximum number of emails to delete (1-100, default 50).

    Returns:
        JSON with deletion results including count of deleted emails.
    """
    max_delete = max(1, min(100, max_delete))

    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        # Search for emails matching the query
        list_data = await call_gmail_api_get(
            access_token,
            "messages",
            params={"q": query, "maxResults": max_delete},
        )

        messages = list_data.get("messages", [])
        if not messages:
            return json.dumps(
                {
                    "success": True,
                    "message": f"No emails found matching query: {query}",
                    "deleted_count": 0,
                },
                ensure_ascii=False,
                indent=2,
            )

        # Use batchDelete for permanent deletion
        message_ids = [msg["id"] for msg in messages]
        await call_gmail_api_post(
            access_token,
            "messages/batchDelete",
            data={"ids": message_ids},
        )

        return json.dumps(
            {
                "success": True,
                "message": f"Permanently deleted {len(message_ids)} emails",
                "query": query,
                "reason": reason,
                "deleted_count": len(message_ids),
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"[Tool] Error bulk deleting emails: {e}")
        return f"Error bulk deleting emails: {str(e)}"


@mcp.tool()
async def modify_email(
    message_id: str,
    add_labels: Optional[str] = None,
    remove_labels: Optional[str] = None,
    ctx: Context = None,
) -> str:
    """Modify email labels.

    Can be used to mark as read/unread, star/unstar, archive, or apply custom labels.

    Common label IDs:
    - UNREAD: Mark as unread (remove to mark as read)
    - STARRED: Star the email
    - IMPORTANT: Mark as important
    - INBOX: In inbox (remove to archive)
    - TRASH: In trash
    - SPAM: In spam

    Args:
        message_id: The Gmail message ID to modify.
        add_labels: Comma-separated label IDs to add (e.g., "STARRED,IMPORTANT").
        remove_labels: Comma-separated label IDs to remove (e.g., "UNREAD,INBOX").
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        # Parse label lists
        add_list = [l.strip() for l in add_labels.split(",")] if add_labels else []
        remove_list = [l.strip() for l in remove_labels.split(",")] if remove_labels else []

        if not add_list and not remove_list:
            return json.dumps(
                {"success": False, "message": "No labels specified to add or remove"},
                ensure_ascii=False,
                indent=2,
            )

        data = {}
        if add_list:
            data["addLabelIds"] = add_list
        if remove_list:
            data["removeLabelIds"] = remove_list

        result = await call_gmail_api_post(
            access_token,
            f"messages/{message_id}/modify",
            data=data,
        )

        return json.dumps(
            {
                "success": True,
                "message": "Email labels modified",
                "message_id": result.get("id", message_id),
                "labelIds": result.get("labelIds", []),
                "added": add_list,
                "removed": remove_list,
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"[Tool] Error modifying email: {e}")
        return f"Error modifying email: {str(e)}"


@mcp.tool()
async def get_email_thread(thread_id: str, ctx: Context = None) -> str:
    """Get all messages in an email thread/conversation.

    Args:
        thread_id: The Gmail thread ID (obtained from read_email or search_emails).
    """
    try:
        # Get OAuth token (once per tool call)
        access_token = await get_token_with_elicitation(ctx, _gmail_oauth, "Gmail")
        if access_token is None:
            return "Authorization was declined by the user."

        thread = await call_gmail_api_get(
            access_token,
            f"threads/{thread_id}",
            params={"format": "metadata", "metadataHeaders": "Subject,From,To,Date"},
        )

        messages = thread.get("messages", [])
        results = []

        for msg in messages:
            hdrs = _parse_headers(msg.get("payload", {}).get("headers", []))
            results.append(
                {
                    "id": msg.get("id", ""),
                    "subject": hdrs.get("subject", "(no subject)"),
                    "from": hdrs.get("from", ""),
                    "to": hdrs.get("to", ""),
                    "date": hdrs.get("date", ""),
                    "snippet": msg.get("snippet", ""),
                    "labelIds": msg.get("labelIds", []),
                }
            )

        return json.dumps(
            {
                "thread_id": thread_id,
                "message_count": len(results),
                "messages": results,
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as e:
        logger.error(f"[Tool] Error getting thread: {e}")
        return f"Error getting thread: {str(e)}"


# ── Entrypoint ─────────────────────────────────────────────────────


class PingRequestFilter(logging.Filter):
    """Filter out noisy PingRequest and session termination logs."""

    def filter(self, record):
        msg = record.getMessage()
        # Filter out PingRequest and session termination noise
        if "PingRequest" in msg or "Terminating session" in msg:
            return False
        return True


async def main():
    # Set logging level (INFO for debugging, WARNING for production)
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Set our logger to always show warnings
    logger.setLevel(logging.WARNING)

    # Add filter to suppress PingRequest noise
    ping_filter = PingRequestFilter()
    logging.getLogger().addFilter(ping_filter)
    logging.getLogger("mcp").addFilter(ping_filter)
    logging.getLogger("mcp.server").addFilter(ping_filter)

    # Enable debug logging for AgentCore Identity to see OAuth token flow
    logging.getLogger("bedrock_agentcore").setLevel(logging.DEBUG)
    logging.getLogger("bedrock_agentcore.identity").setLevel(logging.DEBUG)

    if log_level == "WARNING":
        logging.getLogger("mcp").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    logger.warning("Gmail MCP Server with 3LO starting...")
    logger.warning(f"[OAuth2] Using callback URL: {_gmail_oauth.callback_url}")
    logger.warning(f"[OAuth2] Scopes: {_gmail_oauth.scopes}")
    logger.warning("[Tools] Available tools: list_labels, list_emails, search_emails, read_email, send_email, draft_email, delete_email, modify_email, get_email_thread")

    # Build Starlette app from FastMCP with health check
    app = mcp.streamable_http_app()
    app.routes.insert(0, Route("/ping", lambda r: JSONResponse({"status": "ok"}), methods=["GET"]))

    # Add AgentCore context middleware to extract WorkloadAccessToken from headers
    # This is REQUIRED for @requires_access_token decorator to work on AgentCore Runtime
    app.add_middleware(AgentCoreContextMiddleware)

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
