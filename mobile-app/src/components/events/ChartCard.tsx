import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Rect, Circle, Path, Line, Text as SvgText, G } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../context/ThemeContext'
import type { ChartData, ChartConfig } from '../../types/chart'

interface Props {
  chartData: ChartData
}

const CHART_TYPE_LABELS: Record<string, string> = {
  line: 'Line Chart',
  bar: 'Bar Chart',
  multiBar: 'Multi-Bar Chart',
  pie: 'Pie Chart',
  area: 'Area Chart',
  stackedArea: 'Stacked Area Chart',
}

const CHART_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  line: 'trending-up',
  bar: 'bar-chart',
  multiBar: 'bar-chart',
  pie: 'pie-chart',
  area: 'analytics',
  stackedArea: 'analytics',
}

// Default palette when chartConfig colors are missing or use CSS variables
const DEFAULT_COLORS = [
  '#a5b4fc', '#86efac', '#fcd29f', '#ddb6f2', '#fca5a5',
  '#93c5fd', '#6ee7b7', '#fde68a', '#c4b5fd', '#f9a8d4',
]

// CSS variable colors (hsl(var(--chart-N))) can't be used in RN SVG.
function resolveColor(color: string | undefined, index: number): string {
  if (!color || color.includes('var(') || color.includes('hsl(')) {
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length]
  }
  return color
}

// ─── Tooltip state ───────────────────────────────────────────────────────────

interface TooltipData {
  label: string
  values: Array<{ key: string; value: number; color: string }>
}

function Tooltip({ data, colors }: { data: TooltipData; colors: any }) {
  return (
    <View style={[tooltipStyles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[tooltipStyles.label, { color: colors.text }]}>{data.label}</Text>
      {data.values.map((v, i) => (
        <View key={i} style={tooltipStyles.row}>
          <View style={[tooltipStyles.dot, { backgroundColor: v.color }]} />
          <Text style={[tooltipStyles.key, { color: colors.textMuted }]}>{v.key}:</Text>
          <Text style={[tooltipStyles.val, { color: colors.text }]}>{v.value}</Text>
        </View>
      ))}
    </View>
  )
}

const tooltipStyles = StyleSheet.create({
  wrap: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  key: { fontSize: 11 },
  val: { fontSize: 12, fontWeight: '600' },
})

// ─── Bar / MultiBar Chart ────────────────────────────────────────────────────

function BarChart({ data, chartConfig, xAxisKey, valueKeys, colors, selectedIndex, onSelect }: {
  data: ChartData['data']
  chartConfig: ChartConfig
  xAxisKey: string
  valueKeys: string[]
  colors: any
  selectedIndex: number | null
  onSelect: (i: number | null) => void
}) {
  const W = 300
  const H = 180
  const PAD = { top: 12, right: 12, bottom: 28, left: 40 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const allValues = data.flatMap(row => valueKeys.map(k => Number(row[k]) || 0))
  const maxVal = Math.max(...allValues, 1)

  const groupCount = data.length
  const barsPerGroup = valueKeys.length
  const groupWidth = plotW / groupCount
  const barWidth = Math.min(groupWidth * 0.7 / barsPerGroup, 32)
  const groupOffset = (groupWidth - barWidth * barsPerGroup) / 2

  const gridLines = 4
  const gridStep = maxVal / gridLines

  return (
    <Pressable onPress={() => onSelect(null)}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const val = gridStep * i
          const y = PAD.top + plotH - (val / maxVal) * plotH
          return (
            <G key={i}>
              <Line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={colors.border} strokeWidth={0.5} />
              <SvgText x={PAD.left - 4} y={y + 3} fontSize={9} fill={colors.textMuted} textAnchor="end">
                {val % 1 === 0 ? val : val.toFixed(1)}
              </SvgText>
            </G>
          )
        })}

        {/* Bars */}
        {data.map((row, gi) => {
          const gx = PAD.left + gi * groupWidth
          const isSelected = selectedIndex === gi
          return (
            <G key={gi} onPress={() => onSelect(selectedIndex === gi ? null : gi)}>
              {/* Hit area */}
              <Rect x={gx} y={PAD.top} width={groupWidth} height={plotH} fill="transparent" />
              {valueKeys.map((key, bi) => {
                const val = Number(row[key]) || 0
                const barH = (val / maxVal) * plotH
                const x = gx + groupOffset + bi * barWidth
                const y = PAD.top + plotH - barH
                const color = resolveColor(chartConfig[key]?.color, bi)
                return (
                  <Rect
                    key={key}
                    x={x}
                    y={y}
                    width={barWidth - 2}
                    height={barH}
                    rx={3}
                    fill={color}
                    opacity={selectedIndex == null || isSelected ? 0.85 : 0.3}
                  />
                )
              })}
              <SvgText x={gx + groupWidth / 2} y={H - 6} fontSize={9} fill={colors.textMuted} textAnchor="middle">
                {String(row[xAxisKey] ?? '').slice(0, 8)}
              </SvgText>
            </G>
          )
        })}
      </Svg>
    </Pressable>
  )
}

// ─── Line / Area Chart ───────────────────────────────────────────────────────

function LineChart({ data, chartConfig, xAxisKey, valueKeys, colors, filled, selectedIndex, onSelect }: {
  data: ChartData['data']
  chartConfig: ChartConfig
  xAxisKey: string
  valueKeys: string[]
  colors: any
  filled?: boolean
  selectedIndex: number | null
  onSelect: (i: number | null) => void
}) {
  const W = 300
  const H = 180
  const PAD = { top: 12, right: 12, bottom: 28, left: 40 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const allValues = data.flatMap(row => valueKeys.map(k => Number(row[k]) || 0))
  const maxVal = Math.max(...allValues, 1)
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW

  const gridLines = 4
  const gridStep = maxVal / gridLines

  return (
    <Pressable onPress={() => onSelect(null)}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* Grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const val = gridStep * i
          const y = PAD.top + plotH - (val / maxVal) * plotH
          return (
            <G key={i}>
              <Line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={colors.border} strokeWidth={0.5} />
              <SvgText x={PAD.left - 4} y={y + 3} fontSize={9} fill={colors.textMuted} textAnchor="end">
                {val % 1 === 0 ? val : val.toFixed(1)}
              </SvgText>
            </G>
          )
        })}

        {/* X labels */}
        {data.map((row, i) => {
          const x = PAD.left + (data.length > 1 ? i * step : plotW / 2)
          return (
            <SvgText key={i} x={x} y={H - 6} fontSize={9} fill={colors.textMuted} textAnchor="middle">
              {String(row[xAxisKey] ?? '').slice(0, 8)}
            </SvgText>
          )
        })}

        {/* Lines + fill */}
        {valueKeys.map((key, ki) => {
          const color = resolveColor(chartConfig[key]?.color, ki)
          const points = data.map((row, i) => {
            const x = PAD.left + (data.length > 1 ? i * step : plotW / 2)
            const val = Number(row[key]) || 0
            const y = PAD.top + plotH - (val / maxVal) * plotH
            return { x, y }
          })
          const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
          const areaPath = linePath +
            ` L${points[points.length - 1].x},${PAD.top + plotH} L${points[0].x},${PAD.top + plotH} Z`

          return (
            <G key={key}>
              {filled && <Path d={areaPath} fill={color} opacity={0.2} />}
              <Path d={linePath} stroke={color} strokeWidth={2} fill="none" />
              {points.map((p, i) => (
                <Circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={selectedIndex === i ? 5 : 3}
                  fill={color}
                  onPress={() => onSelect(selectedIndex === i ? null : i)}
                />
              ))}
            </G>
          )
        })}

        {/* Selected line indicator */}
        {selectedIndex != null && (
          <Line
            x1={PAD.left + selectedIndex * step}
            y1={PAD.top}
            x2={PAD.left + selectedIndex * step}
            y2={PAD.top + plotH}
            stroke={colors.textMuted}
            strokeWidth={0.5}
            strokeDasharray="3,3"
          />
        )}
      </Svg>
    </Pressable>
  )
}

// ─── Pie Chart ───────────────────────────────────────────────────────────────

function PieChart({ data, chartConfig, colors, selectedIndex, onSelect }: {
  data: ChartData['data']
  chartConfig: ChartConfig
  colors: any
  selectedIndex: number | null
  onSelect: (i: number | null) => void
}) {
  const SIZE = 180
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R = 70
  const IR = 40

  const valueKey = data.length > 0
    ? Object.keys(data[0]).find(k => k !== 'segment' && k !== 'name' && k !== 'label' && k !== 'category' && typeof data[0][k] === 'number') || 'value'
    : 'value'

  const total = data.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0)
  if (total === 0) return null

  let startAngle = -Math.PI / 2
  const slices = data.map((row, i) => {
    const segment = String(row.segment ?? row.name ?? row.label ?? '')
    const val = Number(row[valueKey]) || 0
    const angle = (val / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const largeArc = angle > Math.PI ? 1 : 0

    const x1 = CX + R * Math.cos(startAngle)
    const y1 = CY + R * Math.sin(startAngle)
    const x2 = CX + R * Math.cos(endAngle)
    const y2 = CY + R * Math.sin(endAngle)
    const ix1 = CX + IR * Math.cos(startAngle)
    const iy1 = CY + IR * Math.sin(startAngle)
    const ix2 = CX + IR * Math.cos(endAngle)
    const iy2 = CY + IR * Math.sin(endAngle)

    const d = [
      `M${x1},${y1}`,
      `A${R},${R} 0 ${largeArc} 1 ${x2},${y2}`,
      `L${ix2},${iy2}`,
      `A${IR},${IR} 0 ${largeArc} 0 ${ix1},${iy1}`,
      'Z',
    ].join(' ')

    const color = resolveColor(chartConfig[segment]?.color, i)
    startAngle = endAngle
    return { d, color, segment, val }
  })

  return (
    <View style={pieStyles.wrap}>
      <Pressable onPress={() => onSelect(null)}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {slices.map((s, i) => (
            <Path
              key={i}
              d={s.d}
              fill={s.color}
              opacity={selectedIndex == null || selectedIndex === i ? 0.85 : 0.3}
              onPress={() => onSelect(selectedIndex === i ? null : i)}
            />
          ))}
          <SvgText x={CX} y={CY - 4} fontSize={16} fontWeight="bold" fill={colors.text} textAnchor="middle">
            {selectedIndex != null ? slices[selectedIndex].val : total}
          </SvgText>
          <SvgText x={CX} y={CY + 12} fontSize={9} fill={colors.textMuted} textAnchor="middle">
            {selectedIndex != null ? slices[selectedIndex].segment : 'Total'}
          </SvgText>
        </Svg>
      </Pressable>

      <View style={pieStyles.legend}>
        {slices.map((s, i) => (
          <Pressable key={i} onPress={() => onSelect(selectedIndex === i ? null : i)}>
            <View style={[pieStyles.legendRow, selectedIndex === i && { opacity: 1 }, selectedIndex != null && selectedIndex !== i && { opacity: 0.4 }]}>
              <View style={[pieStyles.dot, { backgroundColor: s.color }]} />
              <Text style={[pieStyles.legendLabel, { color: colors.text }]} numberOfLines={1}>
                {chartConfig[s.segment]?.label || s.segment}
              </Text>
              <Text style={[pieStyles.legendValue, { color: colors.textMuted }]}>
                {s.val} ({((s.val / total) * 100).toFixed(0)}%)
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const pieStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  legend: { flex: 1, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 12, fontWeight: '500' },
  legendValue: { fontSize: 11 },
})

// ─── Legend ───────────────────────────────────────────────────────────────────

function ChartLegend({ valueKeys, chartConfig, colors }: {
  valueKeys: string[]
  chartConfig: ChartConfig
  colors: any
}) {
  if (valueKeys.length <= 1) return null
  return (
    <View style={legendStyles.row}>
      {valueKeys.map((key, i) => (
        <View key={key} style={legendStyles.item}>
          <View style={[legendStyles.dot, { backgroundColor: resolveColor(chartConfig[key]?.color, i) }]} />
          <Text style={[legendStyles.text, { color: colors.textMuted }]} numberOfLines={1}>
            {chartConfig[key]?.label || key}
          </Text>
        </View>
      ))}
    </View>
  )
}

const legendStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12, paddingBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 10 },
})

// ─── Main ChartCard ──────────────────────────────────────────────────────────

export default function ChartCard({ chartData }: Props) {
  const { colors } = useTheme()
  const { config, data, chartConfig, chartType } = chartData
  const isPie = chartType === 'pie'
  const xAxisKey = config.xAxisKey || (data.length > 0 ? Object.keys(data[0])[0] : '')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  let valueKeys = Object.keys(chartConfig).filter(k => k !== xAxisKey)
  if (!isPie && valueKeys.length === 0 && data.length > 0) {
    valueKeys = Object.keys(data[0]).filter(k => k !== xAxisKey && typeof data[0][k] === 'number')
  }

  // Build tooltip data for selected point
  const tooltipData: TooltipData | null = selectedIndex != null && !isPie && data[selectedIndex]
    ? {
        label: String(data[selectedIndex][xAxisKey] ?? ''),
        values: valueKeys.map((key, ki) => ({
          key: chartConfig[key]?.label || key,
          value: Number(data[selectedIndex][key]) || 0,
          color: resolveColor(chartConfig[key]?.color, ki),
        })),
      }
    : null

  const renderChart = () => {
    if (data.length === 0) return null
    if (isPie) {
      return <PieChart data={data} chartConfig={chartConfig} colors={colors} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
    }
    if (chartType === 'line') {
      return <LineChart data={data} chartConfig={chartConfig} xAxisKey={xAxisKey} valueKeys={valueKeys} colors={colors} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
    }
    if (chartType === 'area' || chartType === 'stackedArea') {
      return <LineChart data={data} chartConfig={chartConfig} xAxisKey={xAxisKey} valueKeys={valueKeys} colors={colors} filled selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
    }
    return <BarChart data={data} chartConfig={chartConfig} xAxisKey={xAxisKey} valueKeys={valueKeys} colors={colors} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons
            name={CHART_TYPE_ICONS[chartType] || 'bar-chart'}
            size={18}
            color={colors.primary}
          />
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {config.title}
            </Text>
            {config.description ? (
              <Text style={[styles.description, { color: colors.textMuted }]} numberOfLines={2}>
                {config.description}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: colors.primaryBg }]}>
          <Text style={[styles.typeBadgeText, { color: colors.primary }]}>
            {CHART_TYPE_LABELS[chartType] || chartType}
          </Text>
        </View>
      </View>

      {/* Tooltip */}
      {tooltipData && <Tooltip data={tooltipData} colors={colors} />}

      {/* Chart */}
      <View style={styles.chartArea}>
        {renderChart()}
      </View>

      {/* Legend */}
      {!isPie && <ChartLegend valueKeys={valueKeys} chartConfig={chartConfig} colors={colors} />}

      {/* Trend */}
      {config.trend && (
        <View style={styles.footer}>
          <Ionicons
            name={config.trend.direction === 'up' ? 'trending-up' : 'trending-down'}
            size={14}
            color={config.trend.direction === 'up' ? '#22c55e' : '#ef4444'}
          />
          <Text
            style={[styles.trendText, { color: config.trend.direction === 'up' ? '#22c55e' : '#ef4444' }]}
          >
            {config.trend.percentage}%
          </Text>
        </View>
      )}

      {/* Footer */}
      {config.footer && (
        <View style={[styles.footer, { borderTopColor: colors.borderLight, borderTopWidth: 1 }]}>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>{config.footer}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flex: 1,
  },
  titleWrap: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  description: { fontSize: 12, marginTop: 2 },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '600' },
  chartArea: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trendText: { fontSize: 12, fontWeight: '600' },
  footerText: { fontSize: 11 },
})
