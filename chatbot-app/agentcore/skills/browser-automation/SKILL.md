---
name: browser-automation
description: Web browser automation for tasks requiring UI interaction, login-protected pages, or human-like browsing when APIs are insufficient.
---

# Browser Automation

## Available Tools
- **browser_act(instruction, starting_url?)**: Execute browser actions using natural language (click, type, scroll, select). Use `starting_url` to navigate to a page and act in a single call.
- **browser_get_page_info(url?, text?, tables?, links?)**: Get page structure and DOM data (fast, no AI). Use `url` to navigate first; `text=True` for full text, `tables=True` for table data, `links=True` for all links.
- **browser_manage_tabs(action, tab_index?, url?)**: Switch, close, or create browser tabs
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
- `browser_act`: UI interactions (click, type, scroll, form fill). Use `starting_url` to open a page and act in one call.
- `browser_get_page_info`: Fast page structure check and optional content extraction (<300ms). Use `url` to navigate first.
- `browser_manage_tabs`: Switch/close/create tabs (view tabs via `get_page_info`)
- `browser_save_screenshot`: Save milestone screenshots (search results, confirmations, key data)

## browser_act Best Practice
- Combine up to 3 predictable steps: "1. Type 'laptop' in search 2. Click search button 3. Click first result"
- Use `starting_url` when opening a fresh page: `browser_act(instruction='Search for laptops', starting_url='https://amazon.com')`
- On failure: check the screenshot to see current state, then retry from that point
- For visual creation (diagrams, drawings), prefer code/text input methods over mouse interactions

## browser_get_page_info Best Practice
- Use `url` to navigate and inspect in one call: `browser_get_page_info(url='https://example.com', tables=True)`
- Use `text=True` to get full page text content (useful for reading article text)
- Use `tables=True` to extract structured table data from the page
- Use `links=True` to get all links on the page (up to 200)
