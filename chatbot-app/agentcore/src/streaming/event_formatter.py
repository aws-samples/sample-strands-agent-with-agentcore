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

        # 1. Extract all content (text and images) and process Base64
        result_text, result_images = StreamEventFormatter._extract_all_content(tool_result)

        # 2. Handle storage based on tool type
        StreamEventFormatter._handle_tool_storage(tool_result, result_text)

        # 3. Build and return the event
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
        
        # Process Base64 downloads for Python MCP tools
        final_text = StreamEventFormatter._process_base64_downloads(tool_result, cleaned_text)
        
        return final_text, result_images
    
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

                        # Check if this text is actually a JSON-stringified MCP response
                        if text_content.strip().startswith('{"status":') and '"content":[' in text_content:
                            try:
                                parsed_mcp = json.loads(text_content)

                                # Replace the current tool_result with the parsed MCP response
                                if "content" in parsed_mcp and isinstance(parsed_mcp["content"], list):
                                    # Recursively process the unwrapped content
                                    for unwrapped_item in parsed_mcp["content"]:
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

                                    # Skip the normal text processing since we handled the unwrapped content
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
    def _process_base64_downloads(tool_result: Dict[str, Any], result_text: str) -> str:
        """Process Base64 downloads for Python MCP tools"""
        tool_use_id = tool_result.get("toolUseId")
        if not tool_use_id:
            return result_text
            
        # Get tool info to check if this is a Python MCP tool
        tool_info = StreamEventFormatter._get_tool_info(tool_use_id)
        if not tool_info:
            return result_text
            
        tool_name = tool_info.get('tool_name')
        session_id = tool_info.get('session_id')
        
        # Only process for Python MCP tools
        if tool_name in ['run_python_code', 'finalize_document'] and session_id:
            try:
                processed_text, file_info = StreamEventFormatter._handle_python_mcp_base64(
                    tool_use_id, result_text, session_id)
                if file_info:
                    print(f"📁 Intercepted and saved {len(file_info)} files for {tool_use_id}")
                    return processed_text
            except Exception as e:
                print(f"⚠️ Error processing Base64 downloads: {e}")
        
        return result_text
    
    @staticmethod
    def _build_tool_result_event(tool_result: Dict[str, Any], result_text: str, result_images: List[Dict[str, str]]) -> str:
        """Build the final tool result event"""
        tool_result_data = {
            "type": "tool_result",
            "toolUseId": tool_result.get("toolUseId"),
            "result": result_text
        }

        if result_images:
            tool_result_data["images"] = result_images

        # Include metadata if present (e.g., browserSessionId for Live View)
        if "metadata" in tool_result:
            tool_result_data["metadata"] = tool_result["metadata"]

        return StreamEventFormatter.format_sse_event(tool_result_data)
    

    @staticmethod
    def _handle_tool_storage(tool_result: Dict[str, Any], result_text: str):
        """Tool storage handler - currently not used"""
        pass
    
    @staticmethod
    def create_complete_event(message: str, images: List[Dict[str, str]] = None, usage: Dict[str, Any] = None) -> str:
        """Create completion event with optional token usage metrics"""
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
    def create_progress_event(progress_data: Dict[str, Any]) -> str:
        """Create progress event for tool execution"""
        return StreamEventFormatter.format_sse_event({
            "type": "tool_progress",
            "toolId": progress_data.get("toolId"),
            "sessionId": progress_data.get("sessionId"),
            "step": progress_data.get("step"),
            "message": progress_data.get("message"),
            "progress": progress_data.get("progress"),
            "timestamp": progress_data.get("timestamp"),
            "metadata": progress_data.get("metadata", {})
        })
    
    

    @staticmethod
    def _get_tool_info(tool_use_id: str) -> Dict[str, Any]:
        """Get tool info from the global stream processor's registry"""
        try:
            from agent.agent import get_global_stream_processor
            processor = get_global_stream_processor()
            if processor and hasattr(processor, 'tool_use_registry'):
                return processor.tool_use_registry.get(tool_use_id)
        except ImportError:
            pass
        return None

    @staticmethod
    def _handle_python_mcp_base64(tool_use_id: str, result_text: str, session_id: str) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Intercept Base64 file data from Python MCP results and save to local files
        Returns: (processed_text_without_base64, file_info_list)
        """
        import re
        import base64
        from config import Config
        
        file_info = []
        processed_text = result_text
        
        try:
            # Pattern to match Base64 data URLs with optional filename attribute
            # Matches: <download filename="name.ext">data:mime/type;base64,{data}</download>
            # Use DOTALL flag to match newlines in base64 data, and non-greedy match
            base64_pattern = r'<download(?:\s+filename="([^"]+)")?>data:([^;]+);base64,([A-Za-z0-9+/=\s]+?)</download>'

            # Check if pattern exists
            import re
            matches = re.findall(base64_pattern, result_text)

            def process_base64_match(match):
                custom_filename = match.group(1)  # May be None if not provided
                mime_type = match.group(2)
                base64_data = match.group(3)

                try:
                    # Decode Base64 data (strip whitespace first)
                    clean_base64 = base64_data.replace('\n', '').replace('\r', '').replace(' ', '')
                    file_data = base64.b64decode(clean_base64)

                    # Determine file extension from MIME type
                    extension_map = {
                        'application/zip': '.zip',
                        'text/plain': '.txt',
                        'application/json': '.json',
                        'text/csv': '.csv',
                        'image/png': '.png',
                        'image/jpeg': '.jpg',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
                    }
                    extension = extension_map.get(mime_type, '.bin')

                    # Use custom filename if provided, otherwise generate one
                    if custom_filename:
                        filename = custom_filename
                    else:
                        filename = f"python_output_{len(file_info) + 1}{extension}"
                    
                    # Create output directory using provided session_id
                    if session_id:
                        try:
                            import os
                            session_output_dir = Config.get_session_output_dir(session_id)
                            tool_dir = os.path.join(session_output_dir, tool_use_id)
                            os.makedirs(tool_dir, exist_ok=True)
                        except Exception as dir_error:
                            print(f"❌ Error creating directory: {dir_error}")
                            return match.group(0)

                        # Save file
                        try:
                            file_path = os.path.join(tool_dir, filename)
                            with open(file_path, 'wb') as f:
                                f.write(file_data)

                            # Create download URL (relative to output dir, served from /output/)
                            relative_path = os.path.relpath(file_path, Config.get_output_dir())
                            download_url = f"/output/{relative_path}"
                            
                            file_info.append({
                                'filename': filename,
                                'mime_type': mime_type,
                                'size': len(file_data),
                                'download_url': download_url,
                                'local_path': file_path
                            })
                            
                            print(f"💾 Saved Base64 file: {filename} ({len(file_data)} bytes) -> {file_path}")

                            # Replace Base64 data with file-specific message
                            file_size_kb = len(file_data) / 1024
                            if mime_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                                return f"✅ Document saved: **{filename}** ({file_size_kb:.1f} KB) - [Download]({download_url})"
                            elif mime_type == 'application/zip':
                                return f"📁 Files saved as ZIP archive: **{filename}** ({file_size_kb:.1f} KB) - [Download]({download_url})"
                            else:
                                return f"✅ File saved: **{filename}** ({file_size_kb:.1f} KB) - [Download]({download_url})"
                        except Exception as save_error:
                            print(f"❌ Error saving file: {save_error}")
                            return match.group(0)
                    else:
                        print(f"⚠️ No session ID found for tool_use_id: {tool_use_id}")
                        return match.group(0)  # Keep original if no session
                        
                except Exception as e:
                    print(f"❌ Error processing Base64 data: {e}")
                    return match.group(0)  # Keep original on error
            
            # Process all Base64 matches
            processed_text = re.sub(base64_pattern, process_base64_match, result_text)
            
            if file_info:
                print(f"💾 Processed Python MCP result: found {len(file_info)} files")
            
        except Exception as e:
            print(f"❌ Error in _handle_python_mcp_base64: {e}")
        
        return processed_text, file_info

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

