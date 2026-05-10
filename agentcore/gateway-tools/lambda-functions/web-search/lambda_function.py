"""
Web search + URL fetch Lambda for AgentCore Gateway.

Tools exposed:
  - ddg_web_search(query, max_results?)
  - fetch_url_content(url, include_html?, max_length?)

No API keys required.
"""
import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _resolve_tool_name(event: dict, context: Any) -> str:
    """
    AgentCore Gateway routes tools to the same Lambda and passes the tool name
    either as `context.client_context.custom.bedrockAgentCoreToolName` or in the
    event payload. Strip the target-name prefix if present.
    """
    try:
        cc = getattr(context, "client_context", None)
        if cc and getattr(cc, "custom", None):
            name = cc.custom.get("bedrockAgentCoreToolName")
            if name:
                return name.split("___", 1)[-1]
    except Exception:
        pass

    name = event.get("tool_name") or event.get("name") or ""
    return name.split("___", 1)[-1]


def _ddg_search(query: str, max_results: int = 5) -> dict:
    from ddgs import DDGS

    max_results = max(1, min(int(max_results), 10))
    with DDGS() as ddgs:
        raw = list(ddgs.text(query, max_results=max_results))

    results = [
        {
            "index": i + 1,
            "title": r.get("title", "No title"),
            "snippet": r.get("body", "No snippet"),
            "link": r.get("href", "No link"),
        }
        for i, r in enumerate(raw)
    ]
    return {
        "success": True,
        "query": query,
        "result_count": len(results),
        "results": results,
    }


def _extract_text(html: str, max_length: int) -> str:
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text()
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = "\n".join(c for c in chunks if c)
    except ImportError:
        text = re.sub(r"<[^>]+>", "", html)
        text = re.sub(r"\s+", " ", text).strip()

    if len(text) > max_length:
        text = text[:max_length] + "\n\n[Content truncated...]"
    return text


def _fetch_url(url: str, include_html: bool = False, max_length: int = 50000) -> dict:
    import urllib.request
    import urllib.error

    if not url.startswith(("http://", "https://")):
        return {"success": False, "error": "URL must start with http:// or https://", "url": url}

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; StrandsAgent/1.0; +https://strands.ai)"
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            html = resp.read().decode("utf-8", errors="replace")
            content_type = resp.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        return {
            "success": False,
            "error": f"HTTP error {e.code}: {e.reason}",
            "url": url,
            "status_code": e.code,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "url": url}

    title = "No title"
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        t = soup.find("title")
        if t:
            title = t.get_text().strip()
    except Exception:
        pass

    text = _extract_text(html, max_length)
    result = {
        "success": True,
        "url": url,
        "title": title,
        "content_type": content_type,
        "text_content": text,
        "text_length": len(text),
        "status_code": status,
    }
    if include_html:
        result["html_content"] = html[:max_length]
    return result


def lambda_handler(event, context):
    logger.info("event=%s", json.dumps(event)[:500])
    tool = _resolve_tool_name(event, context)

    # Gateway passes tool args directly at the top of the event.
    args = {k: v for k, v in event.items() if k not in ("tool_name", "name")}

    try:
        if tool == "ddg_web_search":
            return _ddg_search(args.get("query", ""), args.get("max_results", 5))
        if tool == "fetch_url_content":
            return _fetch_url(
                args.get("url", ""),
                bool(args.get("include_html", False)),
                int(args.get("max_length", 50000)),
            )
        return {"success": False, "error": f"Unknown tool: {tool}"}
    except Exception as e:
        logger.exception("Tool execution failed")
        return {"success": False, "error": str(e), "tool": tool}
