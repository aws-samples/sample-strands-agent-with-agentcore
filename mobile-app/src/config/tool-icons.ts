import React from 'react'
import type { SvgProps } from 'react-native-svg'

type SvgComponent = React.FC<SvgProps>

// ── Static icon entries (Metro requires these to be static requires) ─────────

interface SvgEntry { kind: 'svg'; Component: SvgComponent }
interface PngEntry { kind: 'png'; source: ReturnType<typeof require> }
type IconEntry = SvgEntry | PngEntry

function svg(Component: SvgComponent): SvgEntry { return { kind: 'svg', Component } }
function png(source: ReturnType<typeof require>): PngEntry { return { kind: 'png', source } }

// Each require() must be a string literal so Metro can bundle the asset.
const ICONS: Record<string, IconEntry> = {
  arxiv:          svg(require('../../assets/tool-icons/arxiv.svg').default),
  calculator:     svg(require('../../assets/tool-icons/calculator.svg').default),
  'code-agent':   svg(require('../../assets/tool-icons/code-agent.svg').default),
  'code-interpreter': svg(require('../../assets/tool-icons/code-interpreter.svg').default),
  diagram:        svg(require('../../assets/tool-icons/diagram.svg').default),
  duckduckgo:     svg(require('../../assets/tool-icons/duckduckgo.svg').default),
  excalidraw:     svg(require('../../assets/tool-icons/excalidraw.svg').default),
  excel:          svg(require('../../assets/tool-icons/excel.svg').default),
  financial:      svg(require('../../assets/tool-icons/financial.svg').default),
  github:         svg(require('../../assets/tool-icons/github.svg').default),
  gmail:          svg(require('../../assets/tool-icons/gmail.svg').default),
  'google-calendar': svg(require('../../assets/tool-icons/google-calendar.svg').default),
  'google-maps':  svg(require('../../assets/tool-icons/google-maps.svg').default),
  'google-search': svg(require('../../assets/tool-icons/google-search.svg').default),
  notion:         svg(require('../../assets/tool-icons/notion.svg').default),
  'nova-act':     png(require('../../assets/tool-icons/nova-act.png')),
  powerpoint:     svg(require('../../assets/tool-icons/powerpoint.svg').default),
  's3-workspace': svg(require('../../assets/tool-icons/s3-workspace.svg').default),
  s3:             svg(require('../../assets/tool-icons/s3.svg').default),
  tavily:         png(require('../../assets/tool-icons/tavily.png')),
  'url-fetcher':  svg(require('../../assets/tool-icons/url-fetcher.svg').default),
  visualization:  svg(require('../../assets/tool-icons/visualization.svg').default),
  weather:        png(require('../../assets/tool-icons/weather.png')),
  wikipedia:      svg(require('../../assets/tool-icons/wikipedia.svg').default),
  word:           svg(require('../../assets/tool-icons/word.svg').default),
}

// ── Tool ID → icon key mapping ───────────────────────────────────────────────

const toolToIconKey: Record<string, string> = {
  // ── Local builtin tools ─────────────────────────────────────
  calculator:                       'calculator',
  create_visualization:             'visualization',
  visual_design:                    'diagram',
  word_document_tools:              'word',
  excel_spreadsheet_tools:          'excel',
  powerpoint_presentation_tools:    'powerpoint',
  create_excalidraw_diagram:        'excalidraw',
  excalidraw:                       'excalidraw',
  code_interpreter_tools:           'code-interpreter',
  agentcore_code_agent:             'code-agent',
  'agentcore_code-agent':           'code-agent',
  code_agent:                       'code-agent',
  workspace_tools:                  's3-workspace',

  // ── Skill tool names (called via skill_executor) ─────────────
  // web-search
  ddg_web_search:                   'duckduckgo',
  // google-web-search
  google_web_search:                'google-search',
  // tavily-search
  tavily_search:                    'tavily',
  tavily_extract:                   'tavily',
  // wikipedia-search
  wikipedia_search:                 'wikipedia',
  wikipedia_get_article:            'wikipedia',
  // arxiv-search
  arxiv_search:                     'arxiv',
  arxiv_get_paper:                  'arxiv',
  // url-fetcher
  fetch_url_content:                'url-fetcher',
  // weather
  get_today_weather:                'weather',
  get_weather_forecast:             'weather',
  get_current_weather:              'weather',
  // financial-news
  stock_quote:                      'financial',
  stock_history:                    'financial',
  financial_news:                   'financial',
  stock_analysis:                   'financial',
  // browser-automation
  browser_act:                      'nova-act',
  browser_get_page_info:            'nova-act',
  browser_manage_tabs:              'nova-act',
  browser_save_screenshot:          'nova-act',
  browser_automation:               'nova-act',
  // code-interpreter
  execute_code:                     'code-interpreter',
  execute_command:                  'code-interpreter',
  file_operations:                  's3-workspace',
  // google-maps
  search_places:                    'google-maps',
  search_nearby_places:             'google-maps',
  get_place_details:                'google-maps',
  // github (MCP)
  github_search_repos:              'github',
  github_get_repo:                  'github',
  github_list_issues:               'github',
  github_create_issue:              'github',
  github_create_pr:                 'github',
  // gmail (MCP)
  list_labels:                      'gmail',
  list_emails:                      'gmail',
  search_emails:                    'gmail',
  send_email:                       'gmail',
  // google-calendar (MCP)
  list_calendars:                   'google-calendar',
  list_events:                      'google-calendar',
  get_event:                        'google-calendar',
  create_event:                     'google-calendar',
  // notion (MCP)
  notion_search:                    'notion',
  notion_fetch:                     'notion',
  notion_create_page:               'notion',

  // ── Gateway tool names (direct calls, legacy) ────────────────
  gateway_google_web_search:        'google-search',
  'gateway_google-web-search':      'google-search',
  gateway_tavily_search:            'tavily',
  'gateway_tavily-search':          'tavily',
  gateway_tavily_extract:           'tavily',
  gateway_wikipedia_search:         'wikipedia',
  'gateway_wikipedia-search':       'wikipedia',
  gateway_arxiv_search:             'arxiv',
  'gateway_arxiv-search':           'arxiv',
  'agentcore_research-agent':       'google-search',
  gateway_google_maps:              'google-maps',
  'gateway_google-maps':            'google-maps',
  gateway_show_on_map:              'google-maps',
  gateway_weather:                  'weather',
  gateway_financial_news:           'financial',
  'gateway_financial-news':         'financial',
  mcp_gmail:                        'gmail',
  mcp_calendar:                     'google-calendar',
  mcp_notion:                       'notion',
  mcp_github:                       'github',
}

const skillToToolId: Record<string, string> = {
  'web-search':               'ddg_web_search',
  'url-fetcher':              'fetch_url_content',
  'visualization':            'create_visualization',
  'visual-design':            'visual_design',
  'word-documents':           'word_document_tools',
  'excel-spreadsheets':       'excel_spreadsheet_tools',
  'powerpoint-presentations': 'powerpoint_presentation_tools',
  'browser-automation':       'browser_automation',
  'code-interpreter':         'code_interpreter_tools',
  'code-agent':               'code_agent',
  'weather':                  'gateway_weather',
  'financial-news':           'gateway_financial-news',
  'arxiv-search':             'gateway_arxiv-search',
  'google-web-search':        'gateway_google-web-search',
  'google-maps':              'gateway_google-maps',
  'wikipedia-search':         'gateway_wikipedia-search',
  'tavily-search':            'gateway_tavily-search',
  'gmail':                    'mcp_gmail',
  'google-calendar':          'mcp_calendar',
  'notion':                   'mcp_notion',
  'github':                   'mcp_github',
  'excalidraw':               'create_excalidraw_diagram',
  'research-agent':           'agentcore_research-agent',
}

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveToolIcon(toolName: string, toolInput?: string): IconEntry | null {
  // skill_dispatcher: resolve by skill_name
  if (toolName === 'skill_dispatcher' && toolInput) {
    try {
      const parsed = JSON.parse(toolInput) as Record<string, unknown>
      const skillName = parsed.skill_name as string | undefined
      if (skillName) {
        const toolId = skillToToolId[skillName]
        if (toolId) return ICONS[toolToIconKey[toolId]] ?? null
      }
    } catch { /* ignore */ }
  }

  // skill_executor: resolve by inner tool_name, fallback to skill_name
  if (toolName === 'skill_executor' && toolInput) {
    try {
      const parsed = JSON.parse(toolInput) as Record<string, unknown>
      // 1. Try tool_name direct lookup
      const innerTool = parsed.tool_name as string | undefined
      if (innerTool) {
        const entry = ICONS[toolToIconKey[innerTool]]
          ?? ICONS[toolToIconKey[innerTool.replace(/_/g, '-')]]
          ?? ICONS[toolToIconKey[innerTool.replace(/-/g, '_')]]
        if (entry) return entry
      }
      // 2. Fallback: skill_name → representative tool icon (same as skill_dispatcher)
      const skillName = parsed.skill_name as string | undefined
      if (skillName) {
        const toolId = skillToToolId[skillName]
        if (toolId) return ICONS[toolToIconKey[toolId]] ?? null
      }
    } catch { /* ignore */ }
  }

  const key = toolToIconKey[toolName]
  return key ? (ICONS[key] ?? null) : null
}

export type { IconEntry, SvgEntry, PngEntry, SvgComponent }
