import { IconType } from 'react-icons';
import {
  TbCalculator,
  TbChartBar,
  TbChartDots,
  TbSearch,
  TbWorldWww,
  TbBrowser,
  TbRobot,
  TbCloudRain,
  TbFileText,
  TbTable,
  TbPresentation,
  TbChartLine,
} from 'react-icons/tb';
import {
  SiDuckduckgo,
  SiGoogle,
  SiWikipedia,
  SiArxiv,
  SiGooglemaps,
  SiGmail,
  SiGooglecalendar,
  SiNotion,
} from 'react-icons/si';

/**
 * Icon mapping for tools using react-icons
 * Uses professional brand icons where available (Simple Icons)
 * Falls back to Tabler Icons for generic tools
 */
export const toolIconMap: Record<string, IconType> = {
  // Analytics & Reports
  calculator: TbCalculator,
  create_visualization: TbChartBar,
  generate_diagram_and_validate: TbChartDots,
  word_document_tools: TbFileText,
  excel_spreadsheet_tools: TbTable,
  powerpoint_presentation_tools: TbPresentation,
  gateway_financial_news: TbChartLine,
  'gateway_financial-news': TbChartLine,

  // Research & Search
  ddg_web_search: SiDuckduckgo,
  gateway_google_web_search: SiGoogle,
  'gateway_google-web-search': SiGoogle,
  gateway_tavily_search: TbSearch,
  'gateway_tavily-search': TbSearch,
  gateway_wikipedia_search: SiWikipedia,
  'gateway_wikipedia-search': SiWikipedia,
  gateway_arxiv_search: SiArxiv,
  'gateway_arxiv-search': SiArxiv,
  fetch_url_content: TbWorldWww,

  // Web & Automation
  browser_automation: TbBrowser,
  agentcore_browser_use_agent: TbRobot,
  'agentcore_browser-use-agent': TbRobot,

  // Location & Live Data
  gateway_google_maps: SiGooglemaps,
  'gateway_google-maps': SiGooglemaps,
  gateway_show_on_map: SiGooglemaps,
  gateway_weather: TbCloudRain,
  get_current_weather: TbCloudRain,

  // Productivity (MCP)
  mcp_gmail: SiGmail,
  mcp_calendar: SiGooglecalendar,
  mcp_notion: SiNotion,

  // Research Agent
  'agentcore_research-agent': TbSearch,
};

/**
 * Image-based icons for tools that have actual logo files in /public/tool-icons/
 * These take priority over react-icon components when available.
 */
export const toolImageMap: Record<string, string> = {
  'mcp_gmail': '/tool-icons/gmail.svg',
  'mcp_calendar': '/tool-icons/google-calendar.svg',
  'mcp_notion': '/tool-icons/notion.svg',
  'calculator': '/tool-icons/calculator.svg',
  'excel_spreadsheet_tools': '/tool-icons/excel.svg',
  'generate_diagram_and_validate': '/tool-icons/diagram.svg',
  'gateway_arxiv_search': '/tool-icons/arxiv.svg',
  'gateway_arxiv-search': '/tool-icons/arxiv.svg',
  'gateway_google_maps': '/tool-icons/google-maps.svg',
  'gateway_google-maps': '/tool-icons/google-maps.svg',
  'gateway_show_on_map': '/tool-icons/google-maps.svg',
  'gateway_google_web_search': '/tool-icons/google-search.svg',
  'gateway_google-web-search': '/tool-icons/google-search.svg',
  'gateway_google_image_search': '/tool-icons/google-search.svg',
  'browser_automation': '/tool-icons/nova-act.png',
  'powerpoint_presentation_tools': '/tool-icons/powerpoint.svg',
  'word_document_tools': '/tool-icons/word.svg',
  'fetch_url_content': '/tool-icons/url-fetcher.svg',
  'create_visualization': '/tool-icons/visualization.svg',
  'gateway_tavily_search': '/tool-icons/tavily.png',
  'gateway_tavily-search': '/tool-icons/tavily.png',
  'gateway_tavily_extract': '/tool-icons/tavily.png',
  'ddg_web_search': '/tool-icons/duckduckgo.svg',
  'gateway_weather': '/tool-icons/weather.png',
  'get_current_weather': '/tool-icons/weather.png',
  'gateway_wikipedia_search': '/tool-icons/wikipedia.svg',
  'gateway_wikipedia-search': '/tool-icons/wikipedia.svg',
  'gateway_financial_news': '/tool-icons/financial.svg',
  'gateway_financial-news': '/tool-icons/financial.svg',
};

/**
 * Get the image path for a tool ID, if one exists.
 * Returns null if the tool should use a react-icon instead.
 */
export function getToolImageSrc(toolId: string): string | null {
  return toolImageMap[toolId] || null;
}

/**
 * Get the icon component for a tool ID
 * Returns a default icon if tool ID is not found
 */
export function getToolIcon(toolId: string): IconType {
  return toolIconMap[toolId] || TbSearch;
}
