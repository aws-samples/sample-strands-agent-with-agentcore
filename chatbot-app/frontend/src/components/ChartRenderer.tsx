"use client";

import React, { useRef, useState, useEffect } from "react";
import html2canvas from 'html2canvas';
import { getApiUrl } from '@/config/environment';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendingUp, TrendingDown, Download } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartData } from "@/types/chart";
import { Button } from "@/components/ui/button";

function BarChartComponent({ data }: { data: ChartData }) {
  const dataKey = Object.keys(data.chartConfig)[0];

  // Process data to include custom colors if provided
  const processedData = React.useMemo(() => {
    return data.data.map((item, index) => {
      // Check if the item has a custom color field
      const customColor = item.color;
      return {
        ...item,
        fill: customColor || `hsl(var(--chart-${index + 1}))`,
      };
    });
  }, [data.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{data.config.title}</CardTitle>
        <CardDescription>{data.config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={data.chartConfig}>
          <BarChart accessibilityLayer data={processedData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={data.config.xAxisKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tick={{ fill: 'hsl(var(--foreground))' }}
              tickFormatter={(value) => {
                return value.length > 20
                  ? `${value.substring(0, 17)}...`
                  : value;
              }}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar
              dataKey={dataKey}
              fill={`var(--color-${dataKey}, hsl(var(--chart-1)))`}
              radius={8}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        {data.config.trend && (
          <div className="flex gap-2 font-medium leading-none">
            Trending {data.config.trend.direction} by{" "}
            {data.config.trend.percentage}% this period{" "}
            {data.config.trend.direction === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
          </div>
        )}
        {data.config.footer && (
          <div className="leading-none text-muted-foreground">
            {data.config.footer}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

function MultiBarChartComponent({ data }: { data: ChartData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{data.config.title}</CardTitle>
        <CardDescription>{data.config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={data.chartConfig}>
          <BarChart accessibilityLayer data={data.data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={data.config.xAxisKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tick={{ fill: 'hsl(var(--foreground))' }}
              tickFormatter={(value) => {
                return value.length > 20
                  ? `${value.substring(0, 17)}...`
                  : value;
              }}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dashed" />}
            />
            {Object.keys(data.chartConfig).map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={`var(--color-${key}, hsl(var(--chart-${index + 1})))`}
                radius={4}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        {data.config.trend && (
          <div className="flex gap-2 font-medium leading-none">
            Trending {data.config.trend.direction} by{" "}
            {data.config.trend.percentage}% this period{" "}
            {data.config.trend.direction === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
          </div>
        )}
        {data.config.footer && (
          <div className="leading-none text-muted-foreground">
            {data.config.footer}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

function LineChartComponent({ data }: { data: ChartData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{data.config.title}</CardTitle>
        <CardDescription>{data.config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={data.chartConfig}>
          <LineChart
            accessibilityLayer
            data={data.data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={data.config.xAxisKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: 'hsl(var(--foreground))' }}
              tickFormatter={(value) => {
                return value.length > 20
                  ? `${value.substring(0, 17)}...`
                  : value;
              }}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            {Object.keys(data.chartConfig).map((key, index) => {
              const configColor = data.chartConfig[key]?.color;
              const fallbackColor = `hsl(var(--chart-${index + 1}))`;
              const finalColor = configColor || fallbackColor;
              
              return (
                <Line
                  key={key}
                  type="natural"
                  dataKey={key}
                  stroke={finalColor}
                  strokeWidth={3}
                  strokeOpacity={1}
                  dot={false}
                />
              );
            })}
          </LineChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        {data.config.trend && (
          <div className="flex gap-2 font-medium leading-none">
            Trending {data.config.trend.direction} by{" "}
            {data.config.trend.percentage}% this period{" "}
            {data.config.trend.direction === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
          </div>
        )}
        {data.config.footer && (
          <div className="leading-none text-muted-foreground">
            {data.config.footer}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

function PieChartComponent({ data }: { data: ChartData }) {
  const totalValue = React.useMemo(() => {
    return data.data.reduce((acc, curr) => acc + curr.value, 0);
  }, [data.data]);

  const chartData = data.data.map((item, index) => {
    // Get custom color from chartConfig if available
    const segment = item.segment;
    const customColor = segment && data.chartConfig[segment]?.color;

    return {
      ...item,
      fill: customColor || `hsl(var(--chart-${index + 1}))`,
    };
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle className="text-xl">{data.config.title}</CardTitle>
        <CardDescription>{data.config.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={data.chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="segment"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalValue.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          {data.config.totalLabel}
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        {data.config.trend && (
          <div className="flex items-center gap-2 font-medium leading-none">
            Trending {data.config.trend.direction} by{" "}
            {data.config.trend.percentage}% this period{" "}
            {data.config.trend.direction === "up" ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
          </div>
        )}
        {data.config.footer && (
          <div className="leading-none text-muted-foreground">
            {data.config.footer}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

function AreaChartComponent({
  data,
  stacked,
}: {
  data: ChartData;
  stacked?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{data.config.title}</CardTitle>
        <CardDescription>{data.config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={data.chartConfig}>
          <AreaChart
            accessibilityLayer
            data={data.data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey={data.config.xAxisKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: 'hsl(var(--foreground))' }}
              tickFormatter={(value) => {
                return value.length > 20
                  ? `${value.substring(0, 17)}...`
                  : value;
              }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent indicator={stacked ? "dot" : "line"} />
              }
            />
            {Object.keys(data.chartConfig).map((key, index) => (
              <Area
                key={key}
                type="natural"
                dataKey={key}
                fill={`var(--color-${key}, hsl(var(--chart-${index + 1})))`}
                fillOpacity={0.4}
                stroke={`var(--color-${key}, hsl(var(--chart-${index + 1})))`}
                stackId={stacked ? "a" : undefined}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
      <CardFooter>
        <div className="flex w-full items-start gap-2 text-sm">
          <div className="grid gap-2">
            {data.config.trend && (
              <div className="flex items-center gap-2 font-medium leading-none">
                Trending {data.config.trend.direction} by{" "}
                {data.config.trend.percentage}% this period{" "}
                {data.config.trend.direction === "up" ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
              </div>
            )}
            {data.config.footer && (
              <div className="leading-none text-muted-foreground">
                {data.config.footer}
              </div>
            )}
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

function DownloadButton({ chartRef, title }: { chartRef: React.RefObject<HTMLDivElement>, title: string }) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (chartRef.current) {
      setIsDownloading(true);

      const downloadButton = chartRef.current.querySelector('.download-button');
      if (downloadButton) {
        (downloadButton as HTMLElement).style.display = 'none';
      }

      try {
        const canvas = await html2canvas(chartRef.current);
        const image = canvas.toDataURL("image/png", 1.0);
        const link = document.createElement('a');
        link.download = `${title.replace(/\s+/g, '_')}.png`;
        link.href = image;
        link.click();
      } finally {
        if (downloadButton) {
          (downloadButton as HTMLElement).style.display = '';
        }
        setIsDownloading(false);
      }
    }
  };

  return (
    <Button
      className="absolute top-2 right-2 z-10 download-button h-8 w-8 p-0"
      variant="ghost"
      size="sm"
      onClick={handleDownload}
      disabled={isDownloading}
      title={isDownloading ? 'Downloading...' : 'Download chart'}
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}

interface ChartRendererProps {
  chartId?: string;
  sessionId?: string;
  toolUseId?: string;
  chartData?: any;
}

// Chart data cache to avoid repeated API calls
const chartCache = new Map<string, ChartData>();

// Global loading state to prevent duplicate requests for the same chart
const loadingCharts = new Set<string>();

// Global promise cache to share loading promises between components
const loadingPromises = new Map<string, Promise<ChartData>>();

// Memoized component to prevent unnecessary re-renders
export const ChartRenderer = React.memo<ChartRendererProps>(({ chartId, sessionId, toolUseId, chartData: providedChartData }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartData, setChartData] = useState<ChartData | null>(() => {
    // If chartData is provided directly, use it
    if (providedChartData) {
      return providedChartData;
    }
    // Otherwise, initialize with cached data if available
    return chartId ? chartCache.get(chartId) || null : null;
  });
  const [loading, setLoading] = useState(() => {
    // If chartData is provided directly, no loading needed
    if (providedChartData) return false;
    // Otherwise, check if we need to load from cache
    return chartId ? !chartCache.has(chartId) : false;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If chartData is provided directly, use it and skip loading
    if (providedChartData) {
      setChartData(providedChartData);
      setLoading(false);
      return;
    }

    // If no chartId, can't load data
    if (!chartId) {
      setError('No chart data or chart ID provided');
      setLoading(false);
      return;
    }

    // Skip loading if data is already cached
    if (chartCache.has(chartId)) {
      setChartData(chartCache.get(chartId)!);
      setLoading(false);
      return;
    }

    // If already loading, wait for the existing promise
    if (loadingPromises.has(chartId)) {
      loadingPromises.get(chartId)!
        .then((data) => {
          setChartData(data);
          setLoading(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
          setLoading(false);
        });
      return;
    }

    // Create and cache the loading promise
    const loadChartData = async (): Promise<ChartData> => {
      try {
        // Request chart data from backend via Next.js proxy
        // Include sessionId and toolUseId if available
        const queryParams = new URLSearchParams();
        if (sessionId) queryParams.append('session_id', sessionId);
        if (toolUseId) queryParams.append('tool_use_id', toolUseId);
        
        const url = getApiUrl(`charts/${chartId}.json?${queryParams.toString()}`);
        
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        };
        
        // Also include sessionId in headers as fallback
        if (sessionId) {
          headers['X-Session-ID'] = sessionId;
        }
        
        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error(`Failed to load chart data: ${response.status} ${response.statusText}`);
        }
        
        // Get response text first to debug JSON parsing issues
        const responseText = await response.text();
        
        try {
          const data = JSON.parse(responseText);
          
          // Cache the data
          chartCache.set(chartId, data);
          return data;
        } catch (jsonError) {
          console.error('JSON parsing error for chart:', chartId);
          console.error('Response text:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
          console.error('JSON error:', jsonError);
          const errorMessage = jsonError instanceof Error ? jsonError.message : 'Unknown JSON parsing error';
          throw new Error(`Invalid JSON response for chart ${chartId}: ${errorMessage}. Response preview: ${responseText.substring(0, 100)}...`);
        }
      } finally {
        // Clean up loading state
        loadingCharts.delete(chartId);
        loadingPromises.delete(chartId);
      }
    };

    // Only start loading if not already in progress
    if (!loadingCharts.has(chartId)) {
      loadingCharts.add(chartId);
      const promise = loadChartData();
      loadingPromises.set(chartId, promise);
      
      promise
        .then((data) => {
          setChartData(data);
          setLoading(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'An unknown error occurred');
          setLoading(false);
        });
    }
  }, [chartId, sessionId, toolUseId, providedChartData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-muted-foreground">Loading chart...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-red-600">Error: {error}</div>
      </div>
    );
  }

  if (!chartData) return null;

  const chartTitleToUse = chartData.config?.title || "Chart";
  
  // Data summary section - shows first few data points
  const renderDataSummary = () => {
    if (!chartData.data || !Array.isArray(chartData.data) || chartData.data.length === 0) return null;
    
    return (
      <div className="chart-data-summary">
        <details>
          <summary className="chart-data-summary-header">
            <span className="chart-data-count">Data ({chartData.data.length} items)</span>
            <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className="details-icon">
              <path d="M6 9L2 5H10L6 9Z" fill="currentColor" />
            </svg>
          </summary>
          <div className="chart-data-summary-content">
            <table className="chart-data-table">
              <thead>
                <tr className="chart-data-table-header">
                  {Object.keys(chartData.data[0]).map(key => (
                    <th key={key} className="chart-data-table-header-cell">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.data.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'chart-data-table-row-even' : 'chart-data-table-row-odd'}>
                    {Object.entries(item).map(([key, value]) => (
                      <td key={key} className="chart-data-table-cell">
                        {typeof value === 'number' 
                          ? new Intl.NumberFormat().format(value)
                          : String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    );
  };
  
  const ChartComponent = (() => {
    switch (chartData.chartType) {
      case "bar":
        return BarChartComponent;
      case "multiBar":
        return MultiBarChartComponent;
      case "line":
        return LineChartComponent;
      case "pie":
        return PieChartComponent;
      case "area":
        return (props: any) => <AreaChartComponent {...props} />;
      case "stackedArea":
        return (props: any) => <AreaChartComponent {...props} stacked />;
      default:
        return null;
    }
  })();

  if (!ChartComponent) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-red-600">Unsupported chart type: {chartData.chartType}</div>
      </div>
    );
  }

  return (
    <div ref={chartRef} className="relative chat-chart-content">
      <DownloadButton chartRef={chartRef} title={chartTitleToUse} />
      <ChartComponent data={chartData} />
      {renderDataSummary()}
    </div>
  );
});
