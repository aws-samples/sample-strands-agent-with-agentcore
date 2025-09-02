"""
Spending Analysis Agent Tool

A specialized AI agent that analyzes personal spending patterns using three specialized 
analysis tools: trends analysis, category breakdown, and behavioral insights.
"""

import asyncio
import logging
import uuid
import os
from strands import Agent, tool
from strands.models import BedrockModel
from .mock_data import SPENDING_AGENT_INSTRUCTIONS
from .spending_trends_tool import analyze_spending_trends
from .category_breakdown_tool import analyze_category_breakdown
from .spending_behavior_tool import analyze_spending_behavior
from .visualization_tool import create_visualization
from utils.customer_utils import get_selected_customer_id
from contextvars import ContextVar
from utils.tool_execution_context import get_current_tool_use_id, get_current_session_id, with_tool_context, create_context_aware_agent
from config import Config


logger = logging.getLogger(__name__)

# Import analysis channel for direct streaming
try:
    from routers.tool_events import tool_events_channel
    ANALYSIS_CHANNEL_AVAILABLE = True
except ImportError:
    logger.warning("Analysis channel not available")
    ANALYSIS_CHANNEL_AVAILABLE = False
    tool_events_channel = None




class SpendingAnalysisAgent:
    """Spending Analysis Agent with specialized analysis tools"""
    
    def __init__(self):
        self.bedrock_model = BedrockModel(
            region_name="us-west-2",
            model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"
        )
        
        self.analysis_tools = [
            analyze_spending_trends,
            analyze_category_breakdown,
            analyze_spending_behavior,
            create_visualization
        ]
        
        self.agent = Agent(
            model=self.bedrock_model,
            system_prompt=SPENDING_AGENT_INSTRUCTIONS,
            tools=self.analysis_tools
        )

_spending_agent_instance = None

def get_spending_agent():
    """Get or create spending analysis agent instance"""
    global _spending_agent_instance
    if _spending_agent_instance is None:
        _spending_agent_instance = SpendingAnalysisAgent()
    return _spending_agent_instance

def clean_analysis_result(text: str) -> str:
    """Extract analysis content from final_response XML tags"""
    if not text:
        return text
    
    import re
    
    # Try to extract content from <final_response> tags
    final_response_match = re.search(r'<final_response[^>]*>(.*?)</final_response>', text, re.DOTALL | re.IGNORECASE)
    if final_response_match:
        # Found XML tagged content - extract and clean it
        final_response_content = final_response_match.group(1).strip()
        if final_response_content:
            return final_response_content
    
    # If no final_response tags found, return original text
    return text

# Context variable to get the current tool use ID
current_tool_use_id: ContextVar[str] = ContextVar('current_tool_use_id', default='')

@tool  
@with_tool_context
async def spending_analysis_tool(query: str) -> str:
    """
    AI Spending Analysis Agent with comprehensive spending pattern analysis capabilities.
    
    Provides personalized spending insights, demographic comparisons, behavioral analysis,
    and optimization recommendations using specialized internal tools. The customer ID is
    automatically determined from the current user selection in the system.
    
    Args:
        query: Specific request about spending analysis needed
        
    Returns:
        str: Comprehensive spending analysis response based on the query
    
    Examples:
        - "Analyze my spending profile and patterns"
        - "Compare my spending against demographic benchmarks"
        - "Provide behavioral insights from my spending habits"
        - "Recommend spending optimization strategies"
    """
    try:
        customer_id = get_selected_customer_id()
        tool_use_id = get_current_tool_use_id()
        session_id = get_current_session_id()
        
        # Validate session_id is available
        if not session_id:
            logger.error(f"No session_id available for spending analysis tool")
            return "Error: Session ID not available. Please try again."
        
        # Send analysis start event
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
            await tool_events_channel.send_analysis_start(
                session_id, 
                f"Starting spending analysis for customer {customer_id}...",
                tool_use_id
            )
        
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
            await tool_events_channel.send_progress(
                'spending_analysis_tool', 
                session_id, 
                'initializing', 
                f'Starting spending analysis for customer {customer_id}...',
                None,
                {'executor': 'analysis_coordinator'}
            )
        
        spending_agent = get_spending_agent()
        
        # Create context-aware agent wrapper to propagate context to nested tool calls
        context_aware_agent = create_context_aware_agent(
            spending_agent.agent, 
            session_id, 
            tool_use_id, 
            'spending_analysis_tool'
        )
        
        # Create a comprehensive query that includes customer context
        enhanced_query = f"""
        Analyze spending patterns for customer {customer_id}.
        
        User request: {query}
        
        Please provide a comprehensive spending analysis including:
        1. Spending trends and patterns over time
        2. Category breakdown with visualizations
        3. Behavioral insights and demographic comparisons
        4. Actionable recommendations for optimization
        
        Use the available analysis tools and create appropriate visualizations for key insights.
        
        IMPORTANT: Please wrap your final analysis output with XML tags like this:
        <final_response>
        [Your complete analysis content here in markdown format]
        </final_response>
        
        Everything before the <final_response> tag will be treated as reasoning/thinking process and won't be displayed to the user.
        """
        
        # Send processing progress
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
            await tool_events_channel.send_progress(
                'spending_analysis_tool', 
                session_id, 
                'processing', 
                'Analyzing spending data and generating insights...',
                25,
                {'executor': 'data_processor'}
            )
        
        # Use stream_async for real-time streaming with immediate forwarding
        try:
            final_result = ""
            chunk_count = 0
            
            # Stream the analysis in real-time - send all chunks to frontend
            try:
                async for chunk in context_aware_agent.stream_async(enhanced_query):
                    try:
                        chunk_count += 1
                        
                        if "data" in chunk and chunk["data"]:
                            chunk_data = chunk["data"]
                            # Accumulate the content for final result
                            final_result += chunk_data
                            
                            # Send analysis stream event for real-time display
                            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                                try:
                                    await tool_events_channel.send_analysis_stream(
                                        session_id, 
                                        chunk_data,
                                        'processing',
                                        tool_use_id
                                    )
                                except Exception as stream_error:
                                    logger.warning(f"Failed to send stream event: {stream_error}")
                            
                            # Update progress periodically (less frequent updates)
                            if chunk_count % 50 == 0 and ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                                try:
                                    progress_percent = min(25 + (chunk_count // 10), 90)
                                    # Send more meaningful progress messages
                                    if chunk_count <= 100:
                                        message = 'Initializing analysis engine...'
                                    elif chunk_count <= 300:
                                        message = 'Processing spending data...'
                                    elif chunk_count <= 500:
                                        message = 'Generating insights and patterns...'
                                    else:
                                        message = 'Finalizing analysis results...'
                                    
                                    await tool_events_channel.send_progress(
                                        'spending_analysis_tool', 
                                        session_id, 
                                        'streaming', 
                                        message,
                                        progress_percent,
                                        {'executor': 'analysis_engine'}
                                    )
                                except Exception as progress_error:
                                    logger.warning(f"Failed to send progress event: {progress_error}")
                            
                            # Add small delay to help with streaming
                            await asyncio.sleep(0.01)
                                
                        elif "result" in chunk:
                            # Final result received
                            final_result = str(chunk["result"])
                            break
                    except Exception as chunk_error:
                        logger.error(f"Error processing chunk: {chunk_error}")
                        continue
            except Exception as stream_error:
                logger.error(f"Stream iteration error: {stream_error}")
                raise stream_error
            
            # Clean the final result to remove reasoning text
            cleaned_result = clean_analysis_result(final_result)
            
            # Collect chart names from chart references in the result text
            chart_names = []
            # Extract chart references from the result text - new format [CHART:chart_name]
            import re
            chart_pattern = r'\[CHART:([^\]]+)\]'
            chart_matches = re.findall(chart_pattern, cleaned_result)
            chart_names.extend(chart_matches)
            
            # Store analysis result in session memory
            from memory_store import get_memory_store
            memory_store = get_memory_store()
            memory_store.store_analysis(
                session_id,
                tool_use_id,
                cleaned_result,
                {"chart_names": chart_names},  # Store chart names as metadata
                {
                    'tool_name': 'spending_analysis_tool',
                    'tool_type': 'agent', 
                    'customer_id': customer_id
                }
            )
            
            logger.info(f"✅ Stored spending analysis in session memory: session={session_id}, tool_use_id={tool_use_id}, charts={len(chart_names)}")
            
            # Send analysis completion event
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_analysis_complete(
                    session_id, 
                    cleaned_result,
                    chart_names,
                    tool_use_id
                )
            
            # Send progress completion
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_analysis_tool', 
                    session_id, 
                    'completed', 
                    'Analysis completed successfully',
                    100,
                    {'executor': 'analysis_coordinator'}
                )
            
            # Return in Strands ToolResult format
            return {
                "status": "success",
                "content": [{"text": final_result}]
            }
            
        except Exception as e:
            logger.error(f"Error in agent invoke: {e}")
            error_message = f"I encountered an error while analyzing your spending patterns: {str(e)}. Please try again or contact support if the issue persists."
            
            # Send analysis error event
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_analysis_error(
                    session_id, 
                    error_message,
                    str(e)
                )
            
            # Send error progress
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.error_progress(
                    'spending_analysis_tool', 
                    session_id, 
                    f'Analysis failed: {str(e)}'
                )
            
            return {
                "status": "error",
                "content": [{"text": error_message}]
            }
        
    except Exception as e:
        logger.error(f"Error in spending analysis tool: {e}")
        error_message = f"I encountered an error while analyzing your spending patterns: {str(e)}. Please try again or contact support if the issue persists."
        
        # Send error progress for general errors
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
            try:
                await tool_events_channel.error_progress(
                    'spending_analysis_tool', 
                    f"spending_{uuid.uuid4().hex[:8]}", 
                    f'Analysis tool error: {str(e)}'
                )
            except:
                pass  # Don't fail on progress error
        
        return {
            "status": "error",
            "content": [{"text": error_message}]
        }
