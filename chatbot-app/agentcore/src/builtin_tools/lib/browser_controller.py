"""
Browser Controller for AgentCore Browser + Nova Act integration.
Simplified implementation for browser automation with natural language.
"""

import os
import logging
import asyncio
import base64
from typing import Dict, Any, Optional
from bedrock_agentcore.tools.browser_client import BrowserClient

# Import Nova Act error types for better error handling
from nova_act import (
    ActInvalidModelGenerationError,
    ActExceededMaxStepsError,
    ActTimeoutError,
    ActAgentError,
    ActClientError
)

logger = logging.getLogger(__name__)

# Global session cache
_browser_sessions: Dict[str, 'BrowserController'] = {}


class BrowserController:
    """Simplified browser controller using AgentCore Browser + Nova Act"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.region = os.getenv('AWS_REGION', 'us-west-2')

        # Get Custom Browser ID from environment or Parameter Store
        self.browser_id = self._get_browser_id()
        self.browser_name = os.getenv('BROWSER_NAME')

        # Nova Act authentication - AWS IAM via workflow definition name
        self.nova_workflow_definition_name = os.getenv('NOVA_ACT_WORKFLOW_DEFINITION_NAME')
        self.nova_model_id = os.getenv('NOVA_ACT_MODEL_ID', 'nova-act-latest')
        self.nova_act_region = os.getenv('NOVA_ACT_REGION', 'us-east-1')

        if not self.nova_workflow_definition_name:
            raise ValueError(
                "Nova Act authentication not configured. "
                "Set NOVA_ACT_WORKFLOW_DEFINITION_NAME for AWS IAM auth. "
                "Create a workflow with: aws nova-act create-workflow-definition --name 'my-workflow'"
            )

        logger.info(f"Nova Act: Using AWS IAM authentication (workflow: {self.nova_workflow_definition_name}, model: {self.nova_model_id})")

        self.browser_session_client = None
        self.page = None  # Will be set from NovaAct.page
        self.nova_client = None
        self.workflow = None  # Will be set in connect()
        self._connected = False
        self._current_tab_index: int = 0  # Track current active tab index

    def get_tab_list(self) -> list:
        """Get list of all open tabs with basic info"""
        if not self._connected or not self.nova_client:
            return []

        tabs = []
        for index, page in enumerate(self.nova_client.pages):
            tabs.append({
                "index": index,
                "url": page.url,
                "title": page.title(),
                "is_current": index == self._current_tab_index
            })
        return tabs

    def _get_current_page(self):
        """Get the current tab's page object"""
        if not self.nova_client:
            return None
        try:
            return self.nova_client.get_page(self._current_tab_index)
        except Exception:
            # Fallback to last page if current index is invalid
            self._current_tab_index = len(self.nova_client.pages) - 1
            return self.nova_client.get_page(self._current_tab_index)

    def _get_browser_id(self) -> Optional[str]:
        """Get Custom Browser ID from environment or Parameter Store"""
        # 1. Check environment variable (set by AgentCore Runtime)
        browser_id = os.getenv('BROWSER_ID')
        if browser_id:
            logger.info(f"Found BROWSER_ID in environment: {browser_id}")
            return browser_id

        # 2. Try Parameter Store (for local development or alternative configuration)
        try:
            import boto3
            project_name = os.getenv('PROJECT_NAME', 'strands-agent-chatbot')
            environment = os.getenv('ENVIRONMENT', 'dev')
            param_name = f"/{project_name}/{environment}/agentcore/browser-id"

            logger.info(f"Checking Parameter Store for Browser ID: {param_name}")
            ssm = boto3.client('ssm', region_name=self.region)
            response = ssm.get_parameter(Name=param_name)
            browser_id = response['Parameter']['Value']
            logger.info(f"Found BROWSER_ID in Parameter Store: {browser_id}")
            return browser_id
        except Exception as e:
            logger.warning(f"Custom Browser ID not found in Parameter Store: {e}")
            return None

    def connect(self):
        """Connect to AgentCore Browser via WebSocket/CDP (synchronous)"""
        if self._connected:
            logger.info(f"Session {self.session_id} already connected")
            return

        try:
            logger.info(f"Connecting to AgentCore Browser for session {self.session_id}")

            # Require Custom Browser ID - no fallback to system browser
            if not self.browser_id:
                raise ValueError(
                    "Custom Browser ID not found. "
                    "Browser tools require Custom Browser with Web Bot Auth. "
                    "Please deploy AgentCore Runtime Stack to create Custom Browser."
                )

            # Create AgentCore Browser session using BrowserClient with Custom Browser
            self.browser_session_client = BrowserClient(region=self.region)

            logger.info(f"🔐 Starting Custom Browser with Web Bot Auth: {self.browser_name} (ID: {self.browser_id})")
            # Pass identifier parameter to use Custom Browser
            # Nova Act recommended resolution: 1600x813 (±20%)
            # Valid range: width 1280-1920, height 650-976
            session_id = self.browser_session_client.start(
                identifier=self.browser_id,
                session_timeout_seconds=3600,
                viewport={'width': 1600, 'height': 900}
            )

            logger.debug(f" Browser session started: {session_id}")
            ws_url, headers = self.browser_session_client.generate_ws_headers()

            # Initialize Nova Act client with AgentCore Browser CDP connection
            # Supports both API Key and AWS IAM authentication
            from nova_act import NovaAct

            nova_kwargs = {
                'cdp_endpoint_url': ws_url,
                'cdp_headers': headers,
                'cdp_use_existing_page': True,  # Re-use existing page from AgentCore Browser
                'go_to_url_timeout': 5,  # Max wait time for go_to_url() in seconds
                'ignore_https_errors': True  # Ignore SSL certificate errors (ads, trackers, etc.)
            }

            # AWS IAM authentication via workflow definition
            from nova_act import Workflow

            self.workflow = Workflow(
                model_id=self.nova_model_id,
                workflow_definition_name=self.nova_workflow_definition_name,
                boto_session_kwargs={"region_name": self.nova_act_region},
            )
            logger.info(f"Nova Act: IAM auth, workflow={self.nova_workflow_definition_name}, model={self.nova_model_id}, region={self.nova_act_region}")

            # Enter Workflow context manager first
            self.workflow.__enter__()
            nova_kwargs['workflow'] = self.workflow

            self.nova_client = NovaAct(**nova_kwargs)
            # Start NovaAct (enters context manager)
            self.nova_client.__enter__()

            # Get page from NovaAct for screenshots
            self.page = self.nova_client.page

            self._connected = True
            logger.info(f"Successfully connected to AgentCore Browser for session {self.session_id}")

        except Exception as e:
            logger.error(f"Failed to connect to AgentCore Browser: {e}")
            self.close()
            raise

    def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to URL and return result with screenshot"""
        try:
            # First navigation: connect then navigate
            # cdp_use_existing_page=True ensures only 1 tab exists (reuses AgentCore Browser's tab)
            if not self._connected:
                logger.info(f"First navigation: connecting to browser")
                self.connect()  # Connect without starting_page (reuse existing tab)

            # Always use go_to_url() for navigation (both first and subsequent)
            logger.info(f"Navigating to {url}")
            try:
                logger.info("Calling go_to_url()...")
                self.nova_client.go_to_url(url)
                logger.info("go_to_url() completed")
            except Exception as timeout_error:
                # Timeout or other errors: continue anyway as page may be partially loaded
                logger.warning(f"go_to_url() timeout/error, continuing: {timeout_error}")

            # Use current tab's page
            logger.info("Getting current page...")
            page = self._get_current_page()
            current_url = page.url
            page_title = page.title()

            logger.info("Taking screenshot...")
            screenshot_data = self._take_screenshot()

            logger.debug(f" Successfully navigated to: {current_url}")
            logger.info(f"   Page title: {page_title}")

            return {
                "status": "success",
                "message": f"Navigated to {current_url}",
                "current_url": current_url,
                "page_title": page_title,
                "current_tab": self._current_tab_index,
                "tabs": self.get_tab_list(),
                "screenshot": screenshot_data
            }
        except Exception as e:
            logger.error(f"Navigation failed: {e}")
            return {
                "status": "error",
                "message": f"Navigation failed: {str(e)}",
                "tabs": self.get_tab_list(),
                "screenshot": None
            }

    def act(self, instruction: str, max_steps: int = 5, timeout: int = 120) -> Dict[str, Any]:
        """Execute natural language instruction using Nova Act

        Args:
            instruction: Natural language instruction for the browser
            max_steps: Maximum number of steps (default: 3 for focused actions)
            timeout: Timeout in seconds for the entire act call
        """
        try:
            if not self._connected:
                self.connect()

            logger.info(f"Executing action: {instruction}")
            logger.info(f"Parameters: max_steps={max_steps}, timeout={timeout}s")

            # Execute Nova Act instruction (first arg is positional)
            # observation_delay_ms: Wait after action for page loads (500ms for dynamic content)
            result = self.nova_client.act(
                instruction,
                max_steps=max_steps,
                timeout=timeout,
                observation_delay_ms=500  # 0.5 second delay for page loads
            )

            # Check if new tabs were opened during action
            num_tabs_after = len(self.nova_client.pages)
            if num_tabs_after > self._current_tab_index + 1:
                # New tab(s) opened - switch to the newest one
                self._current_tab_index = num_tabs_after - 1
                logger.info(f"New tab opened, switched to tab {self._current_tab_index}")

            # Use current tab's page
            page = self._get_current_page()
            current_url = page.url
            page_title = page.title()
            screenshot_data = self._take_screenshot()

            # Parse Nova Act result
            success = getattr(result, 'success', False)
            details = getattr(result, 'details', '') or str(result)

            # Extract and log execution metadata
            metadata = getattr(result, 'metadata', None)
            execution_info = ""
            if metadata:
                session_id = getattr(metadata, 'session_id', None)
                act_id = getattr(metadata, 'act_id', None)
                steps_executed = getattr(metadata, 'num_steps_executed', None)
                start_time = getattr(metadata, 'start_time', None)
                end_time = getattr(metadata, 'end_time', None)

                # Log detailed metadata
                logger.debug(f" Act completed:")
                if session_id:
                    logger.info(f"   Session ID: {session_id}")
                if act_id:
                    logger.info(f"   Act ID: {act_id}")
                if steps_executed is not None:
                    logger.info(f"   Steps: {steps_executed}/{max_steps}")
                    execution_info = f" (executed {steps_executed}/{max_steps} steps)"
                if start_time and end_time:
                    duration = end_time - start_time
                    logger.info(f"   Duration: {duration:.2f}s")

            # Note: Bedrock API only accepts "success" or "error" status
            # Even if action was partial, we return "success" with details in message
            return {
                "status": "success",  # Always "success" if no exception (Bedrock requirement)
                "message": f"{'' if success else '[WARN] '}{details}{execution_info}",
                "instruction": instruction,
                "current_url": current_url,
                "page_title": page_title,
                "current_tab": self._current_tab_index,
                "tabs": self.get_tab_list(),
                "screenshot": screenshot_data
            }

        except ActInvalidModelGenerationError as e:
            # Schema validation failed or model generated invalid output
            logger.error(f" Invalid model generation: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Invalid model output: {str(e)}\n\nCheck the screenshot to see current state and retry from that point.",
                "instruction": instruction,
                "screenshot": screenshot_data
            }

        except ActExceededMaxStepsError as e:
            # Task too complex for the given max_steps
            logger.error(f" Exceeded max steps ({max_steps}): {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Task exceeded {max_steps} steps without completing. Check the screenshot to see current state and retry from that point.",
                "instruction": instruction,
                "screenshot": screenshot_data
            }

        except ActTimeoutError as e:
            # Operation timed out
            logger.error(f" Timeout ({timeout}s): {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Operation timed out after {timeout}s. Task may be too complex or page is slow.",
                "instruction": instruction,
                "screenshot": screenshot_data
            }

        except (ActAgentError, ActClientError) as e:
            # Retriable errors - agent failed or invalid request
            logger.error(f" Act error: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Action failed: {str(e)}\n\nYou may retry with a different instruction.",
                "instruction": instruction,
                "screenshot": screenshot_data
            }

        except Exception as e:
            # Unknown error
            logger.error(f" Unexpected error: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Action failed: {str(e)}",
                "instruction": instruction,
                "screenshot": screenshot_data
            }

    def _get_error_screenshot(self) -> Optional[bytes]:
        """Helper to safely capture screenshot on error"""
        try:
            if self._connected and self.nova_client:
                return self._take_screenshot()
        except:
            pass
        return None

    def extract(self, description: str, schema: Optional[Dict] = None, max_steps: int = 12, timeout: int = 180) -> Dict[str, Any]:
        """Extract structured data using Nova Act

        Args:
            description: Natural language description of what data to extract
            schema: Optional JSON schema for validation (None = no schema validation)
            max_steps: Maximum number of steps for extraction (default: 12 allows scrolling/pagination)
            timeout: Timeout in seconds for extraction (default: 180s = 3 minutes)
        """
        try:
            if not self._connected:
                self.connect()

            logger.info(f"Extracting data: {description}")
            logger.info(f"Parameters: max_steps={max_steps}, timeout={timeout}s, schema={schema is not None}")

            # Build extraction prompt
            prompt = f"{description} from the current webpage"

            # Execute Nova Act extraction (first arg is positional)
            # observation_delay_ms: Wait after action for page loads (500ms for dynamic content)
            result = self.nova_client.act(
                prompt,
                schema=schema,
                max_steps=max_steps,
                timeout=timeout,
                observation_delay_ms=500  # 0.5 second delay for page loads
            )

            # Use current tab's page
            page = self._get_current_page()
            current_url = page.url
            page_title = page.title()
            screenshot_data = self._take_screenshot()

            # Parse extracted data
            extracted_data = getattr(result, 'parsed_response', None) or getattr(result, 'response', {})

            # Extract and log execution metadata
            metadata = getattr(result, 'metadata', None)
            execution_info = ""
            if metadata:
                session_id = getattr(metadata, 'session_id', None)
                act_id = getattr(metadata, 'act_id', None)
                steps_executed = getattr(metadata, 'num_steps_executed', None)
                start_time = getattr(metadata, 'start_time', None)
                end_time = getattr(metadata, 'end_time', None)

                # Log detailed metadata
                logger.debug(f" Extraction completed:")
                if session_id:
                    logger.info(f"   Session ID: {session_id}")
                if act_id:
                    logger.info(f"   Act ID: {act_id}")
                if steps_executed is not None:
                    logger.info(f"   Steps: {steps_executed}/{max_steps}")
                    execution_info = f" (executed {steps_executed}/{max_steps} steps)"
                if start_time and end_time:
                    duration = end_time - start_time
                    logger.info(f"   Duration: {duration:.2f}s")

            return {
                "status": "success",
                "message": f"Data extracted successfully{execution_info}",
                "data": extracted_data,
                "description": description,
                "current_url": current_url,
                "page_title": page_title,
                "current_tab": self._current_tab_index,
                "tabs": self.get_tab_list(),
                "screenshot": screenshot_data
            }

        except ActInvalidModelGenerationError as e:
            # Schema validation failed - this is the error you experienced!
            logger.error(f" Schema validation failed: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Schema validation failed: {str(e)}\n\nThe extracted data didn't match the expected format. Check the screenshot and adjust the schema or description.",
                "description": description,
                "screenshot": screenshot_data
            }

        except ActExceededMaxStepsError as e:
            # Extraction too complex
            logger.error(f" Exceeded max steps ({max_steps}): {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Extraction exceeded {max_steps} steps. Check the screenshot to see current state and retry with adjusted approach.",
                "description": description,
                "screenshot": screenshot_data
            }

        except ActTimeoutError as e:
            # Extraction timed out
            logger.error(f" Timeout ({timeout}s): {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Extraction timed out after {timeout}s. Data may be too large or page is slow.",
                "description": description,
                "screenshot": screenshot_data
            }

        except (ActAgentError, ActClientError) as e:
            # Retriable errors
            logger.error(f" Extraction error: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Extraction failed: {str(e)}\n\nYou may retry with a different description.",
                "description": description,
                "screenshot": screenshot_data
            }

        except Exception as e:
            # Unknown error
            logger.error(f" Unexpected error: {e}")
            screenshot_data = self._get_error_screenshot()
            return {
                "status": "error",
                "message": f"Extraction failed: {str(e)}",
                "description": description,
                "screenshot": screenshot_data
            }

    def get_page_info(self, text: bool = False, tables: bool = False, all_links: bool = False) -> Dict[str, Any]:
        """Get structured information about the current page state.

        Fast and reliable - uses Playwright API directly (no AI inference).
        Returns comprehensive page state for quick situation assessment.

        Args:
            text: If True, include full page text content
            tables: If True, extract and return table data
            all_links: If True, return all links (default: top 10 visible)
        """
        try:
            if not self._connected:
                self.connect()

            logger.info("Getting page info")

            # Use current tab's page
            page = self._get_current_page()

            # Page context
            page_info = {
                "url": page.url,
                "title": page.title(),
                "load_state": "complete" if page.url != "about:blank" else "initial"
            }

            # Scroll position
            scroll_info = page.evaluate("""() => {
                return {
                    current: window.scrollY,
                    max: Math.max(
                        document.body.scrollHeight,
                        document.documentElement.scrollHeight
                    ) - window.innerHeight,
                    viewport_height: window.innerHeight
                }
            }""")

            max_scroll = max(scroll_info['max'], 1)  # Avoid division by zero
            page_info["scroll"] = {
                "current": scroll_info['current'],
                "max": max_scroll,
                "percentage": int((scroll_info['current'] / max_scroll) * 100) if max_scroll > 0 else 0
            }

            # Interactive elements (visible only, top 10 each)
            buttons = page.evaluate("""() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
                return buttons
                    .filter(btn => {
                        const rect = btn.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 &&
                               rect.top < window.innerHeight && rect.bottom > 0;
                    })
                    .slice(0, 10)
                    .map(btn => ({
                        text: (btn.innerText || btn.value || btn.getAttribute('aria-label') || '').trim().slice(0, 50),
                        visible: true,
                        enabled: !btn.disabled
                    }))
                    .filter(btn => btn.text.length > 0);
            }""")

            links = page.evaluate("""() => {
                const links = Array.from(document.querySelectorAll('a[href]'));
                return links
                    .filter(link => {
                        const rect = link.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 &&
                               rect.top < window.innerHeight && rect.bottom > 0;
                    })
                    .slice(0, 10)
                    .map(link => ({
                        text: (link.innerText || link.textContent || '').trim().slice(0, 50),
                        href: link.getAttribute('href')
                    }))
                    .filter(link => link.text.length > 0);
            }""")

            inputs = page.evaluate("""() => {
                const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'));
                return inputs
                    .filter(input => {
                        const rect = input.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    })
                    .slice(0, 10)
                    .map(input => {
                        const base = {
                            type: input.type || input.tagName.toLowerCase(),
                            name: input.name || input.id || '',
                            placeholder: input.placeholder || '',
                            label: (input.labels?.[0]?.textContent || '').trim().slice(0, 50)
                        };

                        if (input.tagName.toLowerCase() === 'select') {
                            base.options = Array.from(input.options).slice(0, 5).map(opt => opt.text.trim());
                        }

                        return base;
                    });
            }""")

            interactive = {
                "buttons": buttons,
                "links": links,
                "inputs": inputs
            }

            # Content structure
            headings = page.evaluate("""() => {
                const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
                return headings
                    .slice(0, 10)
                    .map(h => h.textContent.trim().slice(0, 100))
                    .filter(text => text.length > 0);
            }""")

            content_info = page.evaluate("""() => {
                return {
                    image_count: document.querySelectorAll('img').length,
                    has_form: document.querySelectorAll('form').length > 0,
                    has_table: document.querySelectorAll('table').length > 0
                };
            }""")

            content = {
                "headings": headings,
                "image_count": content_info['image_count'],
                "has_form": content_info['has_form'],
                "has_table": content_info['has_table']
            }

            # Optional: full page text
            if text:
                content["text"] = page.evaluate("() => document.body.innerText")

            # Optional: extract table data
            if tables and content_info['has_table']:
                content["tables"] = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('table')).slice(0, 5).map(table => {
                        const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
                        const rows = Array.from(table.querySelectorAll('tr')).slice(0, 50).map(tr =>
                            Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
                        ).filter(row => row.length > 0);
                        return { headers, rows };
                    });
                }""")

            # Optional: all links (not just top 10 visible)
            if all_links:
                interactive["links"] = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .map(link => ({
                            text: (link.innerText || link.textContent || '').trim().slice(0, 80),
                            href: link.getAttribute('href')
                        }))
                        .filter(link => link.text.length > 0)
                        .slice(0, 200);
                }""")

            # State indicators
            state_info = page.evaluate("""() => {
                const alerts = Array.from(document.querySelectorAll('[role="alert"], .alert, .error, .warning'));
                const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [aria-modal="true"]'));
                const loading = Array.from(document.querySelectorAll('.loading, .spinner, [aria-busy="true"]'));

                return {
                    has_alerts: alerts.length > 0,
                    alert_messages: alerts.slice(0, 3).map(a => a.textContent.trim().slice(0, 100)).filter(t => t),
                    has_modals: modals.filter(m => {
                        const style = window.getComputedStyle(m);
                        return style.display !== 'none';
                    }).length > 0,
                    has_loading: loading.filter(l => {
                        const style = window.getComputedStyle(l);
                        return style.display !== 'none';
                    }).length > 0
                };
            }""")

            state = {
                "has_alerts": state_info['has_alerts'],
                "alert_messages": state_info['alert_messages'],
                "has_modals": state_info['has_modals'],
                "has_loading": state_info['has_loading']
            }

            # Navigation
            breadcrumbs = page.evaluate("""() => {
                const crumbs = document.querySelectorAll('[aria-label*="breadcrumb"] a, .breadcrumb a, .breadcrumbs a');
                return Array.from(crumbs)
                    .map(a => a.textContent.trim())
                    .filter(text => text.length > 0);
            }""")

            navigation = {
                "can_go_back": page.evaluate("() => window.history.length > 1"),
                "can_go_forward": False,  # Not easily detectable
                "breadcrumbs": breadcrumbs
            }

            logger.debug(f" Page info collected: {len(buttons)} buttons, {len(links)} links, {len(inputs)} inputs")

            return {
                "status": "success",
                "page": page_info,
                "interactive": interactive,
                "content": content,
                "state": state,
                "navigation": navigation,
                "current_tab": self._current_tab_index,
                "tabs": self.get_tab_list()
            }

        except Exception as e:
            logger.error(f"Failed to get page info: {e}")
            return {
                "status": "error",
                "message": f"Failed to get page info: {str(e)}"
            }

    def _take_screenshot(self, tab_index: Optional[int] = None, timeout: int = 5000) -> Optional[bytes]:
        """Take screenshot of a specific tab (default: current tab)

        Args:
            tab_index: Tab index to screenshot. None means current tab.
            timeout: Timeout in milliseconds (default: 5000ms = 5 seconds)
        """
        import time
        start_time = time.time()

        try:
            if not self.nova_client:
                return None

            # Use specified tab or current tab
            index = tab_index if tab_index is not None else self._current_tab_index
            page = self.nova_client.get_page(index)

            # Use CDP directly to capture screenshot without waiting for fonts
            # This bypasses Playwright's font loading wait which can timeout on some pages
            cdp = page.context.new_cdp_session(page)
            try:
                result = cdp.send('Page.captureScreenshot', {
                    'format': 'jpeg',
                    'quality': 85,
                    'fromSurface': True,  # Capture from compositor surface (faster)
                    'captureBeyondViewport': False  # Only viewport
                })
                screenshot_bytes = base64.b64decode(result['data'])

                duration = time.time() - start_time
                size_kb = len(screenshot_bytes) / 1024
                logger.debug(f" Screenshot: {duration:.2f}s, {size_kb:.1f}KB")

                return screenshot_bytes
            finally:
                cdp.detach()

        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"Screenshot failed after {duration:.2f}s: {e}")
            return None

    def switch_tab(self, tab_index: int) -> Dict[str, Any]:
        """Switch to a specific tab by index

        Args:
            tab_index: Tab index (0-based). Use -1 for last tab.
        """
        try:
            if not self._connected:
                self.connect()

            num_tabs = len(self.nova_client.pages)

            # Handle negative indexing
            if tab_index < 0:
                tab_index = num_tabs + tab_index

            # Validate index
            if tab_index < 0 or tab_index >= num_tabs:
                return {
                    "status": "error",
                    "message": f"Invalid tab index {tab_index}. Available tabs: 0 to {num_tabs - 1}",
                    "tabs": self.get_tab_list()
                }

            # Switch to the tab
            self._current_tab_index = tab_index
            page = self._get_current_page()

            logger.info(f"Switched to tab {tab_index}: {page.url}")

            return {
                "status": "success",
                "message": f"Switched to tab {tab_index}",
                "current_tab": tab_index,
                "current_url": page.url,
                "page_title": page.title(),
                "tabs": self.get_tab_list(),
                "screenshot": self._take_screenshot()
            }

        except Exception as e:
            logger.error(f"Failed to switch tab: {e}")
            return {
                "status": "error",
                "message": f"Failed to switch tab: {str(e)}",
                "tabs": self.get_tab_list()
            }

    def close_tab(self, tab_index: int) -> Dict[str, Any]:
        """Close a specific tab by index

        Args:
            tab_index: Tab index (0-based). Use -1 for last tab.
        """
        try:
            if not self._connected:
                self.connect()

            num_tabs = len(self.nova_client.pages)

            # Must keep at least one tab
            if num_tabs <= 1:
                return {
                    "status": "error",
                    "message": "Cannot close the last remaining tab. At least one tab must stay open.",
                    "tabs": self.get_tab_list()
                }

            # Handle negative indexing
            original_index = tab_index
            if tab_index < 0:
                tab_index = num_tabs + tab_index

            # Validate index
            if tab_index < 0 or tab_index >= num_tabs:
                return {
                    "status": "error",
                    "message": f"Invalid tab index {original_index}. Available tabs: 0 to {num_tabs - 1}",
                    "tabs": self.get_tab_list()
                }

            # Get the page to close
            page_to_close = self.nova_client.get_page(tab_index)
            closed_url = page_to_close.url

            # Close the tab
            page_to_close.close()

            # Adjust current tab index if needed
            if tab_index == self._current_tab_index:
                # Closed current tab - switch to previous or first
                self._current_tab_index = max(0, tab_index - 1)
            elif tab_index < self._current_tab_index:
                # Closed a tab before current - adjust index
                self._current_tab_index -= 1

            logger.info(f"Closed tab {tab_index}: {closed_url}")

            page = self._get_current_page()

            return {
                "status": "success",
                "message": f"Closed tab {tab_index} ({closed_url})",
                "current_tab": self._current_tab_index,
                "current_url": page.url,
                "page_title": page.title(),
                "tabs": self.get_tab_list(),
                "screenshot": self._take_screenshot()
            }

        except Exception as e:
            logger.error(f"Failed to close tab: {e}")
            return {
                "status": "error",
                "message": f"Failed to close tab: {str(e)}",
                "tabs": self.get_tab_list()
            }

    def create_tab(self, url: str = "about:blank") -> Dict[str, Any]:
        """Create a new tab and navigate to URL

        Args:
            url: URL to open in the new tab (default: about:blank)
        """
        try:
            if not self._connected:
                self.connect()

            logger.info(f"Creating new tab with URL: {url}")

            # Create new page in the browser context
            new_page = self.nova_client.page.context.new_page()

            # Switch to the new tab (it's the last one)
            self._current_tab_index = len(self.nova_client.pages) - 1
            logger.info(f"Created new tab {self._current_tab_index}")

            # Navigate to URL if not about:blank using go_to_url (consistent with navigate())
            if url != "about:blank":
                try:
                    logger.info(f"Navigating new tab to {url}")
                    self.nova_client.go_to_url(url)
                    logger.info("Navigation completed")
                except Exception as nav_error:
                    logger.warning(f"go_to_url timeout in new tab, continuing: {nav_error}")

            page = self._get_current_page()
            logger.info(f"New tab ready: {page.url}")

            return {
                "status": "success",
                "message": f"Created new tab {self._current_tab_index}",
                "current_tab": self._current_tab_index,
                "current_url": page.url,
                "page_title": page.title(),
                "tabs": self.get_tab_list(),
                "screenshot": self._take_screenshot()
            }

        except Exception as e:
            logger.error(f"Failed to create tab: {e}")
            return {
                "status": "error",
                "message": f"Failed to create tab: {str(e)}",
                "tabs": self.get_tab_list()
            }

    def close(self):
        """Close browser session and cleanup"""
        try:
            # Close NovaAct context manager first
            if self.nova_client:
                try:
                    self.nova_client.__exit__(None, None, None)
                except Exception as e:
                    logger.warning(f"Error closing NovaAct client: {e}")

            # Close Workflow context manager
            if hasattr(self, 'workflow') and self.workflow:
                try:
                    self.workflow.__exit__(None, None, None)
                except Exception as e:
                    logger.warning(f"Error closing Workflow: {e}")

            # Close browser session
            if self.browser_session_client:
                try:
                    self.browser_session_client.stop()
                except Exception as e:
                    logger.warning(f"Error stopping browser session: {e}")

            self._connected = False
            logger.info(f"Browser session {self.session_id} closed")

        except Exception as e:
            logger.error(f"Error closing browser session: {e}")


def get_or_create_controller(session_id: Optional[str] = None) -> BrowserController:
    """Get existing controller or create new one (auto-detects session_id from agent context)"""
    # Auto-detect session_id from environment (set by ChatbotAgent)
    # Uses SESSION_ID (per-conversation) for isolated browser sessions
    if not session_id:
        session_id = os.getenv('SESSION_ID') or os.getenv('USER_ID') or "default"
        logger.info(f"Auto-detected browser session_id: {session_id}")

    if session_id not in _browser_sessions:
        logger.info(f"Creating new browser controller for session {session_id}")
        _browser_sessions[session_id] = BrowserController(session_id)
    return _browser_sessions[session_id]


def close_session(session_id: str):
    """Close and remove browser session"""
    if session_id in _browser_sessions:
        controller = _browser_sessions[session_id]
        controller.close()
        del _browser_sessions[session_id]
        logger.info(f"Closed and removed browser session {session_id}")
