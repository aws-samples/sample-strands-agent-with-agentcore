import type { MapData } from './map'

export interface ChartConfig {
  [key: string]: {
    label: string
    color: string
  }
}

export interface ChartTrend {
  percentage: number
  direction: 'up' | 'down'
}

export interface ChartConfigData {
  title: string
  description: string
  footer?: string
  xAxisKey?: string
  totalLabel?: string
  trend?: ChartTrend
}

export interface ChartDataPoint {
  [key: string]: any
}

export interface ChartData {
  chartType: 'line' | 'bar' | 'multiBar' | 'pie' | 'area' | 'stackedArea'
  imageAnalysis?: string
  config: ChartConfigData
  data: ChartDataPoint[]
  chartConfig: ChartConfig
}

export interface ChartToolResult {
  success: boolean
  chart_id?: string
  file_path?: string
  chart_type?: string
  title?: string
  message: string
  error?: string
  chart_data?: ChartData
  map_data?: MapData
}
