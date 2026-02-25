---
name: browser-automation
description: Web browser automation for tasks requiring UI interaction, login-protected pages, or human-like browsing when APIs are insufficient.
---

# Browser Automation

## Available Tools
- **browser_navigate(url)**: Navigate to a URL and capture screenshot
- **browser_act(instruction)**: Execute browser actions using natural language (click, type, scroll, select). Does NOT support drag.
- **browser_extract(extraction_instruction)**: Extract structured data (auto-scrolls entire page, collects all data in single call)
- **browser_get_page_info()**: Get page structure and all open tabs (fast, no AI)
- **browser_manage_tabs(action, tab_index)**: Switch, close, or create browser tabs
- **browser_save_screenshot(filename)**: Save current page screenshot to workspace

## When to Use
Use browser automation when the task genuinely requires it:
- **UI interactions**: Filling forms, clicking buttons, navigating multi-step workflows
- **Login-required pages**: Accessing content behind authentication that APIs cannot reach
- **Dynamic/JS-heavy pages**: Content rendered client-side that plain HTTP requests can't capture
- **Human-like browsing needed**: Sites that block bots or require realistic interaction patterns
- **Scraping structured data**: When no API exists and the data must be extracted from rendered pages

Prefer **web search or url_fetcher** for general information lookup, news, or publicly accessible pages — browser automation is slower and heavier. Reserve it for tasks where simpler tools are insufficient.

## Tool Selection
- `browser_navigate` + `browser_act`: UI interactions (click, type, scroll, form fill)
- `browser_extract`: Structured data from visible content (auto-scrolls)
- `browser_get_page_info`: Fast page structure check (<300ms)
- `browser_save_screenshot`: Save milestone screenshots (search results, confirmations, key data)

## browser_act Best Practice
- Combine up to 3 predictable steps: "1. Type 'laptop' in search 2. Click search button 3. Click first result"
- On failure: check the screenshot to see current state, then retry from that point
- For visual creation (diagrams, drawings), prefer code/text input methods over mouse interactions
