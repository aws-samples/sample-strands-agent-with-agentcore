---
name: financial-news
description: Stock quotes, price history, financial news, and analysis
available_tools:
  - finance___stock_quote
  - finance___stock_history
  - finance___financial_news
  - finance___stock_analysis
---
# Financial Market

## Available Tools

- **finance___stock_quote(symbol)**: Get current stock quote with key metrics.
  - `symbol` (string, required): Ticker symbol (e.g., "AAPL", "GOOGL")

- **finance___stock_history(symbol, period)**: Get historical price data.
  - `symbol` (string, required): Ticker symbol
  - `period` (string, default: "1mo"): "1mo", "3mo", "6mo", "1y", "5y"

- **finance___financial_news(symbol, count)**: Get latest financial news.
  - `symbol` (string, required): Ticker symbol
  - `count` (int, default: 5): Number of articles

- **finance___stock_analysis(symbol)**: Get comprehensive stock analysis.
  - `symbol` (string, required): Ticker symbol

## Usage Guidelines
- Use standard ticker symbols (AAPL, MSFT, GOOGL, AMZN).
- Combine stock_quote + stock_analysis for comprehensive overviews.
- Always include a disclaimer that this is informational only, not investment advice.
