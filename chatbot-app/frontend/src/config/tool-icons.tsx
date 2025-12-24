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
};

/**
 * Get the icon component for a tool ID
 * Returns a default icon if tool ID is not found
 */
export function getToolIcon(toolId: string): IconType {
  return toolIconMap[toolId] || TbSearch;
}
