"""
Financial Narrative Agent Tool

A creative AI agent that generates engaging narratives about customer spending patterns with images.
"""

import asyncio
import json
import logging
import uuid
import os
from typing import Any, Dict
from strands import Agent, tool
from strands.models import BedrockModel
from strands_tools import generate_image
from utils.customer_utils import get_selected_customer_id
from contextvars import ContextVar
try:
    from routers.tool_events import tool_events_channel
    ANALYSIS_CHANNEL_AVAILABLE = tool_events_channel is not None
except ImportError:
    tool_events_channel = None
    ANALYSIS_CHANNEL_AVAILABLE = False
from .spending_behavior_tool import analyze_spending_behavior
from utils.tool_execution_context import get_current_tool_use_id, get_current_session_id, with_tool_context
from config import Config

logger = logging.getLogger(__name__)

async def emit_narrative_event(event_type: str, data: dict):
    """Emit a financial narrative event to unified tool events channel"""
    session_id = data.get('session_id', 'unknown')
    tool_use_id = data.get('tool_use_id')  # Get tool_use_id from data
    logger.info(f"Emitting narrative event to tool events channel: {event_type} for session: {session_id}, tool_use_id: {tool_use_id}")
    
    # Use the unified tool events channel
    if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
        try:
            if event_type == 'analysis_start':
                await tool_events_channel.send_analysis_start(
                    session_id, 
                    f"Starting financial narrative generation for customer {data.get('customer_id', 'unknown')}...",
                    tool_use_id  # Pass tool_use_id
                )
            elif event_type == 'analysis_progress':
                await tool_events_channel.send_analysis_stream(
                    session_id,
                    data.get('data', ''),
                    data.get('step', 'processing'),
                    tool_use_id  # Pass tool_use_id
                )
            elif event_type == 'analysis_complete':
                await tool_events_channel.send_analysis_complete(
                    session_id,
                    data.get('final_summary', 'Financial narrative completed successfully'),
                    [],  # chart_ids (empty for narrative tool)
                    tool_use_id  # Pass tool_use_id
                )
            elif event_type == 'analysis_error':
                await tool_events_channel.send_analysis_error(
                    session_id,
                    data.get('error', 'Unknown error occurred')
                )
        except Exception as e:
            logger.error(f"Error emitting narrative event: {e}")

def clean_narrative_result(text) -> str:
    """Extract narrative content from final_response XML tags"""
    # Ensure we have a string
    if isinstance(text, dict):
        # If it's a dict, try to get common string fields
        if 'content' in text:
            text = text['content']
        elif 'text' in text:
            text = text['text']
        elif 'message' in text:
            text = text['message']
        else:
            text = str(text)
    elif not isinstance(text, str):
        text = str(text)
    
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

FINANCIAL_NARRATIVE_SYSTEM_PROMPT = """
You are "Financial Narrator", a witty and insightful AI storytelling assistant that transforms financial data into captivating narratives with accompanying images.

Your mission is to create 3 delightfully entertaining narratives about customer spending patterns that are:
- PLAYFULLY SATIRICAL but never mean-spirited or offensive
- CLEVERLY OBSERVATIONAL with unexpected metaphors and comparisons  
- RELATABLE through pop culture references and everyday situations
- VISUALLY ENGAGING with AI-generated images
- EMPOWERING with constructive insights hidden in humor

## Your Process:
1. Analyze the provided spending behavior data
2. Create 3 unique, creative narratives
3. For each narrative, generate a matching illustration using the generate_image tool
4. Format everything in markdown with embedded images

## Narrative Guidelines:
- Use gentle self-deprecating humor and relatable observations
- Turn spending habits into mini-adventures or character studies  
- Include surprising comparisons that make people smile
- Always end with positive, actionable insights
- Each narrative should be 2-3 sentences with specific financial data

## Image Guidelines:
- Generate professional, illustration-style images that match each narrative
- Use warm colors, suitable for financial storytelling
- Show positive, aspirational situations
- Include visual metaphors for financial concepts

You have access to the generate_image tool to create illustrations for each narrative.
"""

class FinancialNarrativeAgent:
    """Financial Narrative Agent with creative storytelling and image generation"""
    
    def __init__(self):
        self.bedrock_model = BedrockModel(
            region_name="us-west-2",
            model_id="us.anthropic.claude-sonnet-4-20250514-v1:0"
        )
        
        # Create agent with generate_image and analyze_spending_behavior tools
        self.agent = Agent(
            model=self.bedrock_model,
            system_prompt=FINANCIAL_NARRATIVE_SYSTEM_PROMPT,
            tools=[generate_image, analyze_spending_behavior]
        )
    
    def process_narrative_response(self, response: str, session_id: str, tool_use_id: str) -> str:
        """Process narrative response to convert image paths to proper format and handle session isolation"""
        import re
        import os
        import shutil
        from config import Config
        
        # Find all image markdown patterns
        image_pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        matches = re.findall(image_pattern, response)
        
        for alt_text, original_image_path in matches:
            # Extract just the filename from the path
            if '/' in original_image_path:
                filename = original_image_path.split('/')[-1]
            else:
                filename = original_image_path
            
            # Move image to tool_use_id-specific directory if it's in the global output directory
            if original_image_path.startswith('output/') and not original_image_path.startswith('output/sessions/'):
                try:
                    # Create tool_use_id-specific images directory
                    tool_images_dir = os.path.join('output', 'sessions', session_id, tool_use_id, 'images')
                    os.makedirs(tool_images_dir, exist_ok=True)
                    
                    # Source and destination paths
                    source_path = original_image_path
                    dest_path = os.path.join(tool_images_dir, filename)
                    
                    # Move the image file
                    if os.path.exists(source_path):
                        shutil.move(source_path, dest_path)
                        print(f"✅ Moved image from {source_path} to {dest_path}")
                    
                except Exception as e:
                    print(f"⚠️ Failed to move image to tool_use_id directory: {e}")
            
            # Convert the original markdown to API path (use original_image_path for replacement)
            old_markdown = f'![{alt_text}]({original_image_path})'
            api_path = f'/api/files/images/{session_id}/{tool_use_id}/{filename}'
            new_format = f'![{alt_text or "Financial Narrative Image"}]({api_path})'
            
            response = response.replace(old_markdown, new_format)
        
        return response
    
    async def create_narratives(self, customer_id: str, session_id: str, tool_use_id: str = None) -> str:
        """Create financial narratives with images for a customer"""
        
        # Validate required parameters
        if not session_id:
            raise ValueError(f"❌ session_id is required! Got: {session_id}")
        if not tool_use_id:
            raise ValueError(f"❌ tool_use_id is required! Got: {tool_use_id}")
        
        
        try:
            # Send start event
            await emit_narrative_event('analysis_start', {
                'customer_id': customer_id,
                'session_id': session_id,
                'tool_use_id': tool_use_id
            })
            
            # Create narrative prompt - let Agent call analyze_spending_behavior internally
            prompt = f"""
You are tasked with creating ONE engaging, witty financial narrative for customer ID: {customer_id}.

## Your Task:
1. First, use the analyze_spending_behavior tool to get detailed spending behavior analysis for this customer
2. **CREATIVE PLANNING PHASE**: Before writing the narrative, spend time brainstorming:
   - What unique metaphors could represent this customer's spending pattern? (Think beyond obvious comparisons)
   - What unexpected humor angles emerge from their financial data?
   - What specific facts, percentages, or dollar amounts tell the most interesting story?
   - How can you make this narrative memorable and shareable while being empowering?
3. Create a single compelling narrative that transforms this financial data into an entertaining story
4. **IMAGE GENERATION**: Use the generate_image tool thoughtfully:
   - If the first generated image feels too generic or doesn't capture your narrative well, try again with a more specific or creative prompt
   - Aim for images that truly complement and enhance the story you're telling
5. IMPORTANT: Wrap your final narrative in XML tags like this:

<final_response>
# 📖 [Creative, Catchy Title]

[Write a 2-3 sentence witty, satirical story that includes specific spending insights from the data. Make it playful but empowering, using unexpected metaphors and relatable observations. Include specific dollar amounts or percentages where relevant.]

![Financial Narrative Image](path_to_generated_image)

**Financial Insight**: [Provide one meaningful, actionable financial insight or advice based on the spending patterns]
</final_response>

Everything before the <final_response> tag will be treated as reasoning/thinking process and won't be displayed to the user.

## Creative Guidelines:
- Avoid clichéd financial metaphors (piggy banks, money trees, etc.)
- Look for surprising connections between spending patterns and pop culture, hobbies, or everyday situations
- Use specific data points as story elements, not just statistics
- Make the humor empowering rather than judgmental

## Image Generation Strategy:
- Start with a clear vision that matches your narrative's metaphor
- If the generated image doesn't capture the essence of your story, regenerate with:
  - More specific character descriptions
  - Different artistic styles or settings
  - Alternative visual metaphors
- Ensure the image and narrative work together as a cohesive, memorable piece

Take your time with the creative process - the goal is a truly engaging, original narrative that customers will remember and share.
"""
            
            # Stream the narrative generation
            final_result = ""
            
            # Use stream_async for real-time streaming - send all chunks to frontend
            # The @with_tool_context decorator already provides session context
            async for chunk in self.agent.stream_async(prompt):
                if "data" in chunk and chunk["data"]:
                    chunk_data = chunk["data"]
                    final_result += chunk_data
                    
                    # Send all chunk data to frontend (no filtering)
                    await emit_narrative_event('analysis_progress', {
                        'data': chunk_data,
                        'session_id': session_id,
                        'tool_use_id': tool_use_id
                    })
                elif "result" in chunk:
                    # Final result received
                    final_result = str(chunk["result"])
                    break
            
            # Clean the response and handle image paths
            cleaned_result = clean_narrative_result(final_result)
            cleaned_response = self.process_narrative_response(cleaned_result, session_id, tool_use_id)
            
            # Apply additional filtering to ensure consistent content storage
            final_filtered_content = clean_narrative_result(cleaned_response)
            
            # Store filtered content in session memory
            from memory_store import get_memory_store
            memory_store = get_memory_store()
            memory_store.store_analysis(
                session_id, 
                tool_use_id, 
                final_filtered_content,
                {},  # charts (empty for narrative tool)
                {
                    'tool_name': 'financial_narrative_tool', 
                    'tool_type': 'agent',
                    'customer_id': customer_id
                }
            )
            
            logger.info(f"✅ Stored cleaned narrative in session memory: session={session_id}, tool_use_id={tool_use_id}")
            
            # Send completion event
            await emit_narrative_event('analysis_complete', {
                'final_summary': final_filtered_content,
                'session_id': session_id,
                'tool_use_id': tool_use_id
            })
            
            return final_filtered_content
            
        except Exception as e:
            logger.error(f"Error creating financial narratives: {e}")
            await emit_narrative_event('analysis_error', {
                'error': str(e),
                'session_id': session_id
            })
            raise e


# Global agent instance
_narrative_agent_instance = None

def get_narrative_agent():
    """Get or create financial narrative agent instance"""
    global _narrative_agent_instance
    if _narrative_agent_instance is None:
        _narrative_agent_instance = FinancialNarrativeAgent()
    return _narrative_agent_instance


@tool
@with_tool_context
async def financial_narrative_tool(query: str) -> str:
    """
    AI Financial Narrative Agent that creates engaging narratives about customer spending patterns with images.
    
    Generates 3 compelling, witty narratives about customer financial habits by analyzing 
    spending behavior data. Creates matching AI-generated images for each narrative.
    Transforms financial data into meaningful, empowering stories with visual elements.
    
    Args:
        query: Request for financial narrative generation
        
    Returns:
        str: Markdown-formatted response with 3 creative financial narratives and images
    
    Examples:
        - "Create engaging financial narratives for my account"
        - "Generate creative stories about my spending habits with images"  
        - "Tell me fun stories about my financial personality"
    """
    try:
        # Get the currently selected customer ID
        customer_id = get_selected_customer_id()
        
        # Get current tool use ID and session ID from context manager
        tool_use_id = get_current_tool_use_id()
        session_id = get_current_session_id()
        
        # Use actual session_id, not tool_use_id
        if not session_id:
            session_id = f"narrative_{uuid.uuid4().hex[:8]}"
        
        
        # Get agent and create narratives with proper session_id and tool_use_id
        agent = get_narrative_agent()
        response = await agent.create_narratives(customer_id, session_id, tool_use_id)
        
        # Return in Strands ToolResult format
        return {
            "status": "success",
            "content": [{"text": response}]
        }
        
    except Exception as e:
        logger.error(f"Error in financial narrative agent: {e}")
        return {
            "status": "error",
            "content": [{"text": f"I encountered an error while creating your financial narratives: {str(e)}. Please try again or contact support if the issue persists."}]
        }
