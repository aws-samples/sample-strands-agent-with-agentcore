import json
import base64
import os
from typing import Dict, Any, List, Tuple

class StreamEventFormatter:
    """Handles formatting of streaming events for SSE"""

    @staticmethod
    def format_sse_event(event_data: dict) -> str:
        """Format event data as Server-Sent Event with proper JSON serialization"""
        try:
            return f"data: {json.dumps(event_data)}\n\n"
        except (TypeError, ValueError) as e:
            # Fallback for non-serializable objects
            return f"data: {json.dumps({'type': 'error', 'message': f'Serialization error: {str(e)}'})}\n\n"
    
    @staticmethod
    def extract_final_result_data(final_result) -> Tuple[List[Dict[str, str]], str]:
        """Extract images and text from final result with simplified logic"""
        images = []
        result_text = str(final_result)
        
        try:
            if hasattr(final_result, 'message') and hasattr(final_result.message, 'content'):
                content = final_result.message.content
                text_parts = []
                
                for item in content:
                    if isinstance(item, dict):
                        if "text" in item:
                            text_parts.append(item["text"])
                        elif "image" in item and "source" in item["image"]:
                            # Simple image extraction
                            image_data = item["image"]
                            images.append({
                                "format": image_data.get("format", "png"),
                                "data": image_data["source"].get("data", "")
                            })
                
                if text_parts:
                    result_text = " ".join(text_parts)
        
        except Exception as e:
            pass
        
        return images, result_text
    
    @staticmethod
    def create_init_event() -> str:
        """Create initialization event"""
        return StreamEventFormatter.format_sse_event({
            "type": "init",
            "message": "Initializing..."
        })
    
    @staticmethod
    def create_reasoning_event(reasoning_text: str) -> str:
        """Create reasoning event"""
        return StreamEventFormatter.format_sse_event({
            "type": "reasoning",
            "text": reasoning_text,
            "step": "thinking"
        })
    
    @staticmethod
    def create_response_event(text: str) -> str:
        """Create response event"""
        return StreamEventFormatter.format_sse_event({
            "type": "response",
            "text": text,
            "step": "answering"
        })
    
    @staticmethod
    def create_tool_use_event(tool_use: Dict[str, Any]) -> str:
        """Create tool use event"""
        return StreamEventFormatter.format_sse_event({
            "type": "tool_use",
            "toolUseId": tool_use.get("toolUseId"),
            "name": tool_use.get("name"),
            "input": tool_use.get("input", {})
        })
    
    @staticmethod
    def create_tool_result_event(tool_result: Dict[str, Any]) -> str:
        """Create tool result event - refactored for clarity"""
        import json
        import logging

        logger = logging.getLogger(__name__)

        # Debug: Log tool_result structure to see if metadata is present
        logger.info(f"[DocumentDownload] tool_result keys: {tool_result.keys() if isinstance(tool_result, dict) else 'not a dict'}")
        if isinstance(tool_result, dict) and "metadata" in tool_result:
            logger.info(f"[DocumentDownload] metadata found: {tool_result['metadata']}")

        # Handle case where entire tool_result might be a JSON string (shouldn't happen but defensive)
        if isinstance(tool_result, str):
            try:
                tool_result = json.loads(tool_result)
            except json.JSONDecodeError as e:
                # Wrap it in a basic structure
                tool_result = {
                    "toolUseId": "unknown",
                    "content": [{"text": str(tool_result)}]
                }

        # Unwrap Lambda response if present (Gateway tools)
        # Lambda format: content[0].text = "{\"statusCode\":200,\"body\":\"...\"}"
        if "content" in tool_result and isinstance(tool_result["content"], list):
            if len(tool_result["content"]) > 0:
                first_item = tool_result["content"][0]
                if isinstance(first_item, dict) and "text" in first_item:
                    try:
                        text_content = first_item["text"]
                        logger.info(f"[Lambda Unwrap] Checking text content (first 200 chars): {text_content[:200]}")
                        parsed = json.loads(text_content)
                        if isinstance(parsed, dict) and "statusCode" in parsed and "body" in parsed:
                            logger.info(f"[Lambda Unwrap] Detected Lambda response, unwrapping...")
                            body = json.loads(parsed["body"]) if isinstance(parsed["body"], str) else parsed["body"]
                            logger.info(f"[Lambda Unwrap] Body keys: {body.keys() if isinstance(body, dict) else 'not a dict'}")
                            if "content" in body:
                                # Replace with unwrapped content
                                tool_result["content"] = body["content"]
                                logger.info(f"[Lambda Unwrap] Successfully unwrapped Lambda response")
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(f"[Lambda Unwrap] Failed to unwrap: {e}")
                        pass

        # 1. Extract all content (text and images) and process Base64
        result_text, result_images = StreamEventFormatter._extract_all_content(tool_result)

        # 2. Handle storage based on tool type
        StreamEventFormatter._handle_tool_storage(tool_result, result_text)

        # 3. Extract metadata from JSON result text (for A2A browser-use-agent)
        result_text = StreamEventFormatter._extract_metadata_from_json_result(tool_result, result_text)

        # 4. Build and return the event
        event = StreamEventFormatter._build_tool_result_event(tool_result, result_text, result_images)

        return event
    
    @staticmethod
    def _extract_all_content(tool_result: Dict[str, Any]) -> Tuple[str, List[Dict[str, str]]]:
        """Extract text content and images from tool result and process Base64"""
        # Extract basic content from MCP format
        result_text, result_images = StreamEventFormatter._extract_basic_content(tool_result)

        # Process JSON content for screenshots and additional images
        json_images, cleaned_text = StreamEventFormatter._process_json_content(result_text)
        result_images.extend(json_images)

        return cleaned_text, result_images
    
    @staticmethod
    def _extract_basic_content(tool_result: Dict[str, Any]) -> Tuple[str, List[Dict[str, str]]]:
        """Extract basic text and image content from MCP format"""
        import base64
        import json

        result_text = ""
        result_images = []

        # Handle case where content might be a JSON string (MCP tools sometimes return stringified JSON)
        if "content" in tool_result and isinstance(tool_result["content"], str):
            try:
                parsed_content = json.loads(tool_result["content"])
                tool_result = tool_result.copy()
                tool_result["content"] = parsed_content
            except json.JSONDecodeError:
                pass

        if "content" in tool_result:
            content = tool_result["content"]

            for idx, item in enumerate(content):
                if isinstance(item, dict):

                    if "text" in item:
                        text_content = item["text"]

                        # Check if this text is actually a JSON-stringified response
                        if text_content.strip().startswith('{'):
                            try:
                                parsed_json = json.loads(text_content)

                                if isinstance(parsed_json, dict):
                                    # Handle Google search results with images (URL-based)
                                    if "images" in parsed_json and isinstance(parsed_json["images"], list):
                                        for img in parsed_json["images"]:
                                            if isinstance(img, dict) and "link" in img:
                                                result_images.append({
                                                    "type": "url",
                                                    "url": img.get("link"),
                                                    "thumbnail": img.get("thumbnail"),
                                                    "title": img.get("title", ""),
                                                    "width": img.get("width", 0),
                                                    "height": img.get("height", 0)
                                                })

                                    # Handle A2A tool response format: {"status": "...", "text": "...", "metadata": {...}}
                                    if "text" in parsed_json:
                                        result_text += parsed_json["text"]
                                        # Extract metadata for browserSessionId
                                        if "metadata" in parsed_json and isinstance(parsed_json["metadata"], dict):
                                            if "metadata" not in tool_result:
                                                tool_result["metadata"] = {}
                                            tool_result["metadata"].update(parsed_json["metadata"])
                                        continue

                                    # Handle MCP response format: {"status": "...", "content": [...]}
                                    if "content" in parsed_json and isinstance(parsed_json["content"], list):
                                        # Recursively process the unwrapped content
                                        for unwrapped_item in parsed_json["content"]:
                                            if isinstance(unwrapped_item, dict):
                                                if "text" in unwrapped_item:
                                                    result_text += unwrapped_item["text"]
                                                elif "image" in unwrapped_item and "source" in unwrapped_item["image"]:
                                                    image_source = unwrapped_item["image"]["source"]
                                                    image_data = ""

                                                    if "data" in image_source:
                                                        image_data = image_source["data"]
                                                    elif "bytes" in image_source:
                                                        if isinstance(image_source["bytes"], bytes):
                                                            image_data = base64.b64encode(image_source["bytes"]).decode('utf-8')
                                                        else:
                                                            image_data = str(image_source["bytes"])

                                                    if image_data:
                                                        result_images.append({
                                                            "format": unwrapped_item["image"].get("format", "png"),
                                                            "data": image_data
                                                        })
                                                elif "document" in unwrapped_item:
                                                    # Skip document bytes in MCP format too
                                                    # Document metadata is handled via tool_result["metadata"]
                                                    pass
                                        continue

                            except json.JSONDecodeError:
                                # Fall through to normal text processing
                                pass

                        # Normal text processing (if not unwrapped)
                        result_text += text_content

                    elif "image" in item:
                        if "source" in item["image"]:
                            image_source = item["image"]["source"]
                            image_data = ""

                            if "data" in image_source:
                                image_data = image_source["data"]
                            elif "bytes" in image_source:
                                if isinstance(image_source["bytes"], bytes):
                                    image_data = base64.b64encode(image_source["bytes"]).decode('utf-8')
                                else:
                                    image_data = str(image_source["bytes"])

                            if image_data:
                                result_images.append({
                                    "format": item["image"].get("format", "png"),
                                    "data": image_data
                                })

                    elif "document" in item:
                        # Handle document content block (Word, Excel, PDF, etc.)
                        # These are for agent consumption (Bedrock/Claude can read documents)
                        # Skip bytes from frontend display - metadata is already in tool_result["metadata"]
                        # Frontend will use metadata to show download button
                        import logging
                        doc_logger = logging.getLogger(__name__)
                        doc_info = item["document"]
                        doc_name = doc_info.get("name", "unknown")
                        doc_format = doc_info.get("format", "unknown")
                        doc_logger.info(f"[Document] Skipping document bytes from frontend display: {doc_name}.{doc_format}")
                        # Don't add bytes to result_text - they're binary and would show as garbage
                        # The document metadata (filename, format) is passed via tool_result["metadata"]

        return result_text, result_images
    
    @staticmethod
    def _process_json_content(result_text: str) -> Tuple[List[Dict[str, str]], str]:
        """Process JSON content to extract screenshots and clean text"""
        try:
            import json
            parsed_result = json.loads(result_text)
            extracted_images = StreamEventFormatter._extract_images_from_json_response(parsed_result)
            
            if extracted_images:
                cleaned_text = StreamEventFormatter._clean_result_text_for_display(result_text, parsed_result)
                return extracted_images, cleaned_text
            else:
                return [], result_text
                
        except (json.JSONDecodeError, TypeError):
            return [], result_text
    
    @staticmethod
    def _build_tool_result_event(tool_result: Dict[str, Any], result_text: str, result_images: List[Dict[str, str]]) -> str:
        """Build the final tool result event"""
        import logging
        logger = logging.getLogger(__name__)

        tool_result_data = {
            "type": "tool_result",
            "toolUseId": tool_result.get("toolUseId"),
            "result": result_text
        }

        if result_images:
            tool_result_data["images"] = result_images

        # Include status if present (e.g., "error" for cancelled tools)
        if "status" in tool_result:
            tool_result_data["status"] = tool_result["status"]

        # Include metadata if present (e.g., browserSessionId for Live View)
        if "metadata" in tool_result:
            tool_result_data["metadata"] = tool_result["metadata"]

            # Documents are collected at turn level (event_processor.py) and sent in complete event
            # Don't add documents to tool_result event to avoid duplication
            if "filename" in tool_result["metadata"] and "tool_type" in tool_result["metadata"]:
                logger.info(f"[DocumentDownload] Document metadata found (will be sent in complete event): {tool_result['metadata']['filename']}")

        logger.info(f"[DocumentDownload] Final tool_result_data keys: {tool_result_data.keys()}")

        return StreamEventFormatter.format_sse_event(tool_result_data)
    

    @staticmethod
    def _handle_tool_storage(tool_result: Dict[str, Any], result_text: str):
        """Tool storage handler - currently not used"""
        pass

    @staticmethod
    def create_interrupt_event(interrupts: List[Any]) -> str:
        """Create interrupt event for human-in-the-loop workflows

        Args:
            interrupts: List of Interrupt objects from Strands SDK

        Returns:
            SSE-formatted interrupt event
        """
        # Convert Interrupt objects to serializable dicts
        interrupts_data = []
        for interrupt in interrupts:
            interrupt_dict = {
                "id": interrupt.id,
                "name": interrupt.name,
                "reason": interrupt.reason if hasattr(interrupt, 'reason') else None
            }
            interrupts_data.append(interrupt_dict)

        return StreamEventFormatter.format_sse_event({
            "type": "interrupt",
            "interrupts": interrupts_data
        })

    @staticmethod
    def create_complete_event(message: str, images: List[Dict[str, str]] = None, usage: Dict[str, Any] = None) -> str:
        """Create completion event with optional token usage metrics.
        Documents are now fetched by frontend via S3 workspace API."""
        completion_data = {
            "type": "complete",
            "message": message
        }
        if images:
            completion_data["images"] = images
        if usage:
            completion_data["usage"] = usage

        return StreamEventFormatter.format_sse_event(completion_data)
    
    @staticmethod
    def create_error_event(error_message: str) -> str:
        """Create error event"""
        return StreamEventFormatter.format_sse_event({
            "type": "error",
            "message": error_message
        })
    
    @staticmethod
    def create_thinking_event(message: str = "Processing your request...") -> str:
        """Create thinking event"""
        return StreamEventFormatter.format_sse_event({
            "type": "thinking",
            "message": message
        })

    @staticmethod
    def create_metadata_event(metadata: Dict[str, Any]) -> str:
        """Create metadata update event (e.g., for browser session during tool execution)"""
        return StreamEventFormatter.format_sse_event({
            "type": "metadata",
            "metadata": metadata
        })

    @staticmethod
    def create_browser_progress_event(content: str, step_number: int) -> str:
        """Create browser progress event for real-time step updates in Browser Modal"""
        return StreamEventFormatter.format_sse_event({
            "type": "browser_progress",
            "content": content,
            "stepNumber": step_number
        })

    @staticmethod
    def _extract_images_from_json_response(response_data):
        """Extract images from any JSON tool response automatically"""
        images = []
        
        if isinstance(response_data, dict):
            # Support common image field patterns
            image_fields = ['screenshot', 'image', 'diagram', 'chart', 'visualization', 'figure']
            
            for field in image_fields:
                if field in response_data and isinstance(response_data[field], dict):
                    img_data = response_data[field]
                    
                    # Handle new lightweight screenshot format (Nova Act optimized)
                    if img_data.get("available") and "description" in img_data:
                        # This is the new optimized format - no actual image data
                        # Just skip extraction since there's no base64 data to process
                        print(f"📷 Found optimized screenshot reference: {img_data.get('description')}")
                        continue
                    
                    # Handle legacy format with actual base64 data
                    elif "data" in img_data and "format" in img_data:
                        images.append({
                            "format": img_data["format"],
                            "data": img_data["data"]
                        })
            
            # Preserve existing images array
            if "images" in response_data and isinstance(response_data["images"], list):
                images.extend(response_data["images"])
        
        return images

    @staticmethod
    def _clean_result_text_for_display(original_text: str, parsed_result: dict) -> str:
        """Clean result text by removing large image data but keeping other information"""
        try:
            import json
            import copy
            
            # Create a copy to avoid modifying the original
            cleaned_result = copy.deepcopy(parsed_result)
            
            # Remove large image data fields but keep metadata
            image_fields = ['screenshot', 'image', 'diagram', 'chart', 'visualization', 'figure']
            
            for field in image_fields:
                if field in cleaned_result and isinstance(cleaned_result[field], dict):
                    if "data" in cleaned_result[field]:
                        # Keep format and size info, remove the large base64 data
                        data_size = len(cleaned_result[field]["data"])
                        cleaned_result[field] = {
                            "format": cleaned_result[field].get("format", "unknown"),
                            "size": f"{data_size} characters",
                            "note": "Image data extracted and displayed separately"
                        }
            
            # Return the cleaned JSON string
            return json.dumps(cleaned_result, indent=2)

        except Exception as e:
            # If cleaning fails, return the original
            print(f"Warning: Failed to clean result text: {e}")
            return original_text

    @staticmethod
    def _extract_metadata_from_json_result(tool_result: Dict[str, Any], result_text: str) -> str:
        """
        Extract metadata (like browserSessionId) from JSON result text.
        A2A browser-use-agent returns JSON with metadata containing browserSessionId.
        This method parses the result and extracts metadata into tool_result.
        Returns the cleaned result text (without metadata wrapper if extracted).
        """
        import json

        try:
            # Try to parse result_text as JSON
            parsed = json.loads(result_text)

            if isinstance(parsed, dict):
                # Check for metadata field with browserSessionId
                if "metadata" in parsed and isinstance(parsed["metadata"], dict):
                    browser_session_id = parsed["metadata"].get("browserSessionId")
                    if browser_session_id:
                        # Add to tool_result metadata
                        if "metadata" not in tool_result:
                            tool_result["metadata"] = {}
                        tool_result["metadata"]["browserSessionId"] = browser_session_id
                        print(f"[Live View] Extracted browserSessionId from tool result: {browser_session_id}")

                        # Return the actual text content, not the wrapper JSON
                        if "text" in parsed:
                            return parsed["text"]

                # Check for browser_session_arn field directly
                browser_session_arn = parsed.get("browser_session_arn")
                if browser_session_arn:
                    if "metadata" not in tool_result:
                        tool_result["metadata"] = {}
                    tool_result["metadata"]["browserSessionId"] = browser_session_arn
                    print(f"[Live View] Extracted browser_session_arn from tool result: {browser_session_arn}")

                    if "text" in parsed:
                        return parsed["text"]

        except (json.JSONDecodeError, TypeError):
            # Not JSON, return original
            pass

        return result_text

