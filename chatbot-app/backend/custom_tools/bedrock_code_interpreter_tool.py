"""
Bedrock Code Interpreter Tool

A custom tool that executes Python code using AWS Bedrock Code Interpreter with file management and download support.
"""

import json
import logging
import time
import uuid
import os
from typing import Dict, Any, Optional, List
from pathlib import Path
from strands import tool
from config import Config
from utils.tool_execution_context import get_current_tool_use_id, get_current_session_id, with_tool_context

try:
    from routers.tool_events import tool_events_channel
    ANALYSIS_CHANNEL_AVAILABLE = tool_events_channel is not None
except ImportError:
    tool_events_channel = None
    ANALYSIS_CHANNEL_AVAILABLE = False

logger = logging.getLogger(__name__)

class BedrockCodeInterpreterClient:
    """AWS Bedrock Code Interpreter client wrapper"""
    
    def __init__(self, region: str = "us-east-1"):
        self.region = region
        self.session_id = None
        self._active = False
        self.client = None
        logger.info(f"Initialized Bedrock Code Interpreter client for region: {region}")
    
    def start_session(self) -> str:
        """Start a new code interpreter session"""
        try:
            from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
            self.client = CodeInterpreter(self.region)
            self.client.start()
            
            self.session_id = f"bedrock_session_{uuid.uuid4().hex[:12]}"
            self._active = True
            logger.info(f"Started Bedrock Code Interpreter session: {self.session_id}")
            return self.session_id
            
        except Exception as e:
            logger.error(f"Failed to start Bedrock Code Interpreter session: {e}")
            raise
    
    def execute_code(self, code: str, clear_context: bool = False) -> Dict[str, Any]:
        """Execute Python code in the Bedrock Code Interpreter"""
        try:
            if not self._active:
                raise RuntimeError("Code Interpreter session not active")
            
            # Real Bedrock Code Interpreter execution
            response = self.client.invoke("executeCode", {
                "code": code,
                "language": "python",
                "clearContext": clear_context
            })
            
            # Extract sessionId from top level of response
            response_session_id = response.get("sessionId", self.session_id)
            
            # Extract the result from the stream
            for event in response.get("stream", []):
                result = event.get("result", {})
                
                # Get structured content safely
                structured_content = result.get("structuredContent", {})
                
                return {
                    "success": not result.get("isError", False),
                    "output": structured_content.get("stdout", ""),
                    "error": structured_content.get("stderr", "") if result.get("isError", False) else None,
                    "execution_time": structured_content.get("executionTime", 0),
                    "session_id": response_session_id,  # Use sessionId from top level
                    "request_id": result.get("id", None)
                }
            
            # If no events in stream, return empty result
            return {
                "success": False,
                "output": "",
                "error": "No result returned from Bedrock Code Interpreter",
                "execution_time": 0,
                "session_id": response_session_id,
                "request_id": None
            }
                
        except Exception as e:
            logger.error(f"Code execution failed: {e}")
            return {
                "success": False,
                "output": "",
                "error": str(e),
                "execution_time": 0,
                "session_id": self.session_id,
                "request_id": None
            }
    
    def list_files(self, path: str = "") -> List[Dict[str, Any]]:
        """List files in the code interpreter session"""
        try:
            if not self._active:
                return []
            
            # Real Bedrock Code Interpreter file listing
            response = self.client.invoke("listFiles", {"path": path})
            
            for event in response.get("stream", []):
                result = event.get("result", {})
                if "files" in result:
                    files = []
                    for file_info in result["files"]:
                        files.append({
                            "name": file_info.get("name", ""),
                            "type": file_info.get("type", "file"),
                            "size": file_info.get("size", 0)
                        })
                    return files
                return []
            
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            return []
    
    def write_files(self, files: List[Dict[str, str]]) -> bool:
        """Write files to the code interpreter session"""
        try:
            if not self._active:
                return False
            
            # Real Bedrock Code Interpreter file writing
            response = self.client.invoke("writeFiles", {"content": files})
            
            # Check if the operation was successful
            for event in response.get("stream", []):
                result = event.get("result", {})
                if result.get("isError", False):
                    logger.error(f"Failed to write files: {result.get('error', 'Unknown error')}")
                    return False
            
            logger.info(f"Successfully wrote {len(files)} files to session")
            return True
            
        except Exception as e:
            logger.error(f"Failed to write files: {e}")
            return False
    
    def download_file(self, file_path: str, local_path: str) -> bool:
        """Download a file from the code interpreter session"""
        try:
            if not self._active:
                return False
            
            # Real Bedrock Code Interpreter file download
            file_content = self.client.download_file(file_path)
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            # Write file content as binary to preserve format
            with open(local_path, 'wb') as f:
                f.write(file_content)
            
            logger.info(f"Downloaded file from {file_path} to {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download file: {e}")
            return False
    
    def stop_session(self):
        """Stop the code interpreter session"""
        try:
            if self._active and self.client:
                self.client.stop()
                self._active = False
                logger.info(f"Stopped Bedrock Code Interpreter session: {self.session_id}")
        except Exception as e:
            logger.error(f"Error stopping session: {e}")
            # Force stop even if there's an error
            self._active = False


class BedrockCodeExecutor:
    """Bedrock Code Interpreter executor with session management"""
    
    def __init__(self):
        # Session management by tool use ID
        self.sessions = {}  # tool_use_id -> client instance
        self.execution_contexts = {}  # tool_use_id -> context data
    
    def get_or_create_session(self, tool_use_id: str, region: str = "us-east-1") -> BedrockCodeInterpreterClient:
        """Get or create a Bedrock Code Interpreter session for a tool use ID"""
        if tool_use_id not in self.sessions:
            client = BedrockCodeInterpreterClient(region)
            client.start_session()
            self.sessions[tool_use_id] = client
            
            # Initialize execution context
            self.execution_contexts[tool_use_id] = {
                'session_id': client.session_id,
                'execution_history': [],
                'created_at': time.time(),
                'region': region
            }
            
            logger.info(f"Created new Bedrock session for tool use ID: {tool_use_id}")
        
        return self.sessions[tool_use_id]
    
    def get_execution_directory(self, tool_use_id: str) -> str:
        """Get execution directory for downloads and outputs"""
        from utils.tool_execution_context import get_session_repl_dir
        
        session_repl_dir = get_session_repl_dir()
        execution_dir = os.path.join(session_repl_dir, tool_use_id)
        os.makedirs(execution_dir, exist_ok=True)
        return execution_dir
    
    def _analyze_file(self, file_path: Path) -> Dict[str, Any]:
        """Analyze downloaded file and extract metadata"""
        try:
            stat = file_path.stat()
            file_size = stat.st_size
            
            # Get relative path from output directory
            try:
                relative_path = file_path.relative_to(Config.OUTPUT_DIR)
                web_path = f"/output/{relative_path}"
            except ValueError:
                web_path = str(file_path)
            
            file_info = {
                'path': web_path,
                'name': file_path.name,
                'size': file_size,
                'size_human': self._format_file_size(file_size),
                'type': self._get_file_type(file_path),
                'extension': file_path.suffix.lower(),
                'created': time.time(),
                'description': f"Downloaded from Bedrock Code Interpreter"
            }
            
            return file_info
            
        except Exception as e:
            logger.error(f"Error analyzing file {file_path}: {e}")
            return {
                'path': str(file_path),
                'name': file_path.name,
                'type': 'unknown',
                'error': str(e)
            }
    
    def _get_file_type(self, file_path: Path) -> str:
        """Determine file type based on extension"""
        ext = file_path.suffix.lower()
        
        image_exts = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'}
        data_exts = {'.csv', '.json', '.xlsx', '.xls', '.parquet', '.tsv'}
        document_exts = {'.pdf', '.html', '.md', '.txt', '.docx', '.doc'}
        code_exts = {'.py', '.js', '.ts', '.sql', '.r', '.ipynb'}
        
        if ext in image_exts:
            return 'image'
        elif ext in data_exts:
            return 'data'
        elif ext in document_exts:
            return 'document'
        elif ext in code_exts:
            return 'code'
        else:
            return 'file'
    
    def _format_file_size(self, size_bytes: int) -> str:
        """Format file size in human readable format"""
        if size_bytes == 0:
            return "0 B"
        
        size_names = ["B", "KB", "MB", "GB"]
        i = 0
        while size_bytes >= 1024 and i < len(size_names) - 1:
            size_bytes /= 1024.0
            i += 1
        
        return f"{size_bytes:.1f} {size_names[i]}"
    
    def _create_zip_file(self, execution_dir: str, tool_use_id: str) -> Optional[str]:
        """Create a ZIP file containing all files in the execution directory"""
        try:
            import zipfile
            
            # Create ZIP file path
            zip_filename = f"code_interpreter_{tool_use_id}.zip"
            zip_path = os.path.join(execution_dir, zip_filename)
            
            # Check if directory exists
            if not os.path.exists(execution_dir):
                logger.error(f"Execution directory does not exist: {execution_dir}")
                return None
            
            # Get all files in the directory using simple os.listdir
            files_to_zip = []
            try:
                for item in os.listdir(execution_dir):
                    item_path = os.path.join(execution_dir, item)
                    if os.path.isfile(item_path) and item != zip_filename:  # Don't include the zip file itself
                        files_to_zip.append((item_path, item))
            except Exception as e:
                logger.error(f"Error listing files in {execution_dir}: {e}")
                return None
            
            if not files_to_zip:
                logger.info(f"No files to zip for {tool_use_id}")
                return None
            
            # Create ZIP file
            try:
                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for file_path, arcname in files_to_zip:
                        zipf.write(file_path, arcname)
                
                # Verify ZIP file was created
                if os.path.exists(zip_path):
                    zip_size = os.path.getsize(zip_path)
                    logger.info(f"Created ZIP file: {zip_path} ({zip_size} bytes)")
                    return zip_path
                else:
                    logger.error(f"ZIP file was not created: {zip_path}")
                    return None
                    
            except Exception as e:
                logger.error(f"Error writing ZIP file: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Error creating ZIP file for {tool_use_id}: {e}")
            return None
    
    async def execute(self, code: str, tool_use_id: str, region: str = "us-east-1", 
                     clear_context: bool = False) -> Dict[str, Any]:
        """Execute Python code using Bedrock Code Interpreter"""
        start_time = time.time()
        
        try:
            # Get or create session
            client = self.get_or_create_session(tool_use_id, region)
            context = self.execution_contexts[tool_use_id]
            execution_dir = self.get_execution_directory(tool_use_id)
            
            # Send progress update if available
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                try:
                    session_id = get_current_session_id()
                    await tool_events_channel.send_progress(
                        'bedrock_code_interpreter',
                        session_id,
                        'processing',
                        'Executing code in Bedrock Code Interpreter...',
                        30,
                        {'executor': 'bedrock_code_interpreter'}
                    )
                except Exception as e:
                    logger.debug(f"Progress update failed (non-critical): {e}")
            
            # Execute the code
            result = client.execute_code(code, clear_context)
            
            # Track execution
            execution_number = len(context['execution_history']) + 1
            execution_record = {
                'code': code,
                'timestamp': time.time(),
                'execution_time': result['execution_time'],
                'success': result['success'],
                'session_id': result['session_id'],
                'request_id': result['request_id']
            }
            context['execution_history'].append(execution_record)
            
            # Save the executed code as a Python file
            code_filename = f"script_{execution_number:03d}.py"
            code_file_path = os.path.join(execution_dir, code_filename)
            try:
                with open(code_file_path, 'w', encoding='utf-8') as f:
                    f.write(f"# Executed at: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
                    f.write(f"# Session ID: {result['session_id']}\n")
                    f.write(f"# Execution time: {result['execution_time']}s\n\n")
                    f.write(code)
                logger.info(f"Saved executed code to: {code_file_path}")
            except Exception as e:
                logger.error(f"Failed to save code file: {e}")
            
            # List files in the session to see what was created
            session_files = client.list_files()
            downloaded_files = []
            
            # Add the saved code file to downloaded files first
            if os.path.exists(code_file_path):
                code_file_analysis = self._analyze_file(Path(code_file_path))
                code_file_analysis['description'] = f"Executed Python script #{execution_number}"
                downloaded_files.append(code_file_analysis)
            
            # Download files that were created
            for file_info in session_files:
                if file_info['type'] == 'file':
                    local_file_path = os.path.join(execution_dir, file_info['name'])
                    if client.download_file(file_info['name'], local_file_path):
                        file_analysis = self._analyze_file(Path(local_file_path))
                        downloaded_files.append(file_analysis)
            
            # Create ZIP file with all files in the execution directory
            zip_path = self._create_zip_file(execution_dir, tool_use_id)
            zip_download_info = None
            if zip_path:
                logger.info(f"Successfully created ZIP file: {zip_path}")
                # Get relative path for web access
                try:
                    relative_path = Path(zip_path).relative_to(Config.OUTPUT_DIR)
                    zip_web_path = f"/output/{relative_path}"
                    zip_download_info = {
                        'path': zip_web_path,
                        'name': f"code_interpreter_{tool_use_id}.zip",
                        'type': 'archive',
                        'size': os.path.getsize(zip_path),
                        'size_human': self._format_file_size(os.path.getsize(zip_path)),
                        'description': f"All files from code interpreter execution {tool_use_id}"
                    }
                except ValueError:
                    zip_web_path = str(zip_path)
                    zip_download_info = {
                        'path': zip_web_path,
                        'name': f"code_interpreter_{tool_use_id}.zip",
                        'type': 'archive',
                        'description': f"All files from code interpreter execution {tool_use_id}"
                    }
            else:
                logger.warning(f"Failed to create ZIP file for {tool_use_id}")
            
            # Send completion progress
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                try:
                    session_id = get_current_session_id()
                    await tool_events_channel.send_progress(
                        'bedrock_code_interpreter',
                        session_id,
                        'completed',
                        'Code execution completed!',
                        100,
                        {'executor': 'bedrock_code_interpreter'}
                    )
                except Exception as e:
                    logger.debug(f"Progress completion failed (non-critical): {e}")
            
            execution_time = time.time() - start_time
            
            return {
                'success': result['success'],
                'output': result['output'],
                'error': result['error'],
                'execution_time': round(execution_time, 3),
                'bedrock_execution_time': result['execution_time'],
                'files_created': downloaded_files,
                'zip_download': zip_download_info,
                'session_info': {
                    'session_id': result['session_id'],
                    'request_id': result['request_id'],
                    'region': region
                },
                'execution_directory': f"/output/sessions/{get_current_session_id()}/{tool_use_id}",
                'download_available': len(downloaded_files) > 0 or zip_download_info is not None
            }
            
        except Exception as e:
            execution_time = time.time() - start_time
            error_msg = f"{type(e).__name__}: {str(e)}"
            
            logger.error(f"Bedrock code execution failed: {error_msg}")
            
            return {
                'success': False,
                'output': '',
                'error': error_msg,
                'execution_time': round(execution_time, 3),
                'bedrock_execution_time': 0,
                'files_created': [],
                'zip_download': None,
                'session_info': {
                    'session_id': None,
                    'request_id': None,
                    'region': region
                },
                'execution_directory': f"/output/sessions/{get_current_session_id()}/{tool_use_id}",
                'download_available': False
            }
    
    def cleanup_session(self, tool_use_id: str):
        """Clean up a specific session"""
        if tool_use_id in self.sessions:
            self.sessions[tool_use_id].stop_session()
            del self.sessions[tool_use_id]
            del self.execution_contexts[tool_use_id]
            logger.info(f"Cleaned up Bedrock session for tool use ID: {tool_use_id}")
    
    def cleanup_all_sessions(self):
        """Clean up all sessions"""
        for tool_use_id in list(self.sessions.keys()):
            self.cleanup_session(tool_use_id)
        logger.info("Cleaned up all Bedrock sessions")


# Global executor instance
_bedrock_executor = BedrockCodeExecutor()

@tool
@with_tool_context
async def bedrock_code_interpreter(code: str, region: str = "us-west-2", 
                                  clear_context: bool = False) -> str:
    """Execute Python code using AWS Bedrock Code Interpreter with automatic file download support.

    Features:
    - Cloud-based Python execution using AWS Bedrock Code Interpreter
    - Secure, isolated execution environment
    - Automatic file download and management
    - Session persistence between executions
    - Support for data analysis libraries (pandas, matplotlib, numpy, etc.)
    - Files accessible via web interface with download links

    Args:
        code: The Python code to execute
        region: AWS region for Bedrock Code Interpreter (default: us-east-1)
        clear_context: Whether to clear the execution context before running (default: False)

    Returns:
        str: JSON containing execution results and downloadable file information

    Examples:
        # Data analysis with automatic file download
        bedrock_code_interpreter(code='''
import pandas as pd
import matplotlib.pyplot as plt

# Create sample data
data = {'quarter': ['Q1', 'Q2', 'Q3', 'Q4'], 'revenue': [100, 150, 130, 180]}
df = pd.DataFrame(data)

# Save data file (automatically downloaded)
df.to_csv('quarterly_revenue.csv', index=False)

# Create visualization (automatically downloaded)
plt.figure(figsize=(10, 6))
plt.bar(df['quarter'], df['revenue'])
plt.title('Quarterly Revenue Analysis')
plt.ylabel('Revenue (millions)')
plt.savefig('revenue_chart.png', dpi=300, bbox_inches='tight')
plt.show()

print(f"Total revenue: ${df['revenue'].sum()} million")
        ''')
    """
    
    global _bedrock_executor
    
    try:
        # Get the current tool use ID from context
        tool_use_id = get_current_tool_use_id()
        if not tool_use_id:
            tool_use_id = f"bedrock_{uuid.uuid4().hex[:8]}"
        
        # Execute the code
        result = await _bedrock_executor.execute(code, tool_use_id, region, clear_context)
        
        # Format response for agent
        if result['success']:
            agent_message = result['output']
            
            # Add file information
            if result['files_created']:
                file_descriptions = []
                for file_info in result['files_created']:
                    file_desc = f"{file_info['name']} ({file_info.get('description', file_info['type'])})"
                    file_descriptions.append(file_desc)
                
                if file_descriptions:
                    agent_message += f"\n\nFiles created and downloaded: {', '.join(file_descriptions)}"
            
            # Add ZIP download information
            if result['zip_download']:
                zip_info = result['zip_download']
                agent_message += f"\n\n📦 All files packaged: {zip_info['name']} ({zip_info.get('size_human', 'N/A')})"
                agent_message += f"\n   Download: {zip_info['path']}"
            
            # Add session information
            session_info = result['session_info']
            if session_info['session_id']:
                agent_message += f"\n\nBedrock Session: {session_info['session_id'][:12]}... (Region: {session_info['region']})"
            
            # Add execution time
            agent_message += f"\nExecution time: {result['execution_time']}s (Bedrock: {result['bedrock_execution_time']}s)"
            
            if result['download_available']:
                agent_message += f"\n\nFiles available for download in: {result['execution_directory']}"
            
        else:
            agent_message = f"Error executing code in Bedrock Code Interpreter: {result['error']}"
            if result['output']:
                agent_message += f"\n\nOutput before error:\n{result['output']}"
        
        # Log full result for debugging
        logger.info(f"Bedrock Code Interpreter result: {json.dumps(result, indent=2)}")
        
        # Return result in Strands ToolResult format
        content = []
        
        # Add text output
        if result.get('output'):
            content.append({"text": result['output']})
        elif result.get('success'):
            content.append({"text": "Code executed successfully"})
        
        # Add JSON data for additional information
        content.append({"json": result})
        
        return {
            "status": "success" if result.get('success') else "error",
            "content": content
        }
        
    except Exception as e:
        logger.error(f"Error in bedrock_code_interpreter: {e}")
        return {
            "status": "error",
            "content": [{"text": f"Error executing Python code in Bedrock Code Interpreter: {str(e)}"}]
        }