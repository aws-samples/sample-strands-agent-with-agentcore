"use client";

import React, { useRef, useState } from "react";
import html2canvas from 'html2canvas';
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
        <CardTitle className="text-heading-lg">{data.config.title}</CardTitle>
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
      <CardFooter className="flex-col items-start gap-2 text-label">
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
        <CardTitle className="text-heading-lg">{data.config.title}</CardTitle>
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
      <CardFooter className="flex-col items-start gap-2 text-label">
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
        <CardTitle className="text-heading-lg">{data.config.title}</CardTitle>
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
      <CardFooter className="flex-col items-start gap-2 text-label">
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
        <CardTitle className="text-heading-lg">{data.config.title}</CardTitle>
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
                          className="fill-foreground text-display font-bold"
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
      <CardFooter className="flex-col gap-2 text-label">
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
        <CardTitle className="text-heading-lg">{data.config.title}</CardTitle>
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
        <div className="flex w-full items-start gap-2 text-label">
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
      className="absolute top-2 right-2 z-10 download-button"
      variant="outline"
      size="icon"
      onClick={handleDownload}
      disabled={isDownloading}
      title={isDownloading ? 'Downloading...' : 'Download chart'}
    >
      <Download className="h-4 w-4" />
    </Button>
  );
}

interface ChartRendererProps {
  chartData: any;
}

// Memoized component to prevent unnecessary re-renders
export const ChartRenderer = React.memo<ChartRendererProps>(({ chartData }) => {
  const chartRef = useRef<HTMLDivElement>(null);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-sm text-destructive">No chart data provided</div>
      </div>
    );
  }

  const chartTitleToUse = chartData.config?.title || "Chart";
  
  // Data summary section - shows first few data points
  const renderDataSummary = () => {
    if (!chartData.data || !Array.isArray(chartData.data) || chartData.data.length === 0) return null;

    return (
      <div className="mt-4 border-t pt-4">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
            <span>Data ({chartData.data.length} items)</span>
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className="w-3 h-3 transition-transform group-open:rotate-180"
            >
              <path d="M6 9L2 5H10L6 9Z" fill="currentColor" />
            </svg>
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {Object.keys(chartData.data[0]).map(key => (
                    <th key={key} className="px-3 py-2 text-left font-medium text-muted-foreground">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.data.map((item: any, idx: number) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                    {Object.entries(item).map(([key, value]) => (
                      <td key={key} className="px-3 py-2">
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
        <div className="text-sm text-destructive">Unsupported chart type: {chartData.chartType}</div>
      </div>
    );
  }

  return (
    <div ref={chartRef} className="relative p-1">
      <DownloadButton chartRef={chartRef} title={chartTitleToUse} />
      <ChartComponent data={chartData} />
      {renderDataSummary()}
    </div>
  );
});
