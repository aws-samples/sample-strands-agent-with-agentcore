---
name: financial-news
description: Stock quotes, price history, financial news, and analysis
---

# Financial Market

## Available Tools

- **stock_quote(symbol)**: Get current stock quote with key metrics.
  - `symbol` (string, required): Stock ticker symbol (e.g., "AAPL", "GOOGL", "MSFT")

- **stock_history(symbol, period?)**: Get historical stock price data for charting and trend analysis.
  - `symbol` (string, required): Stock ticker symbol
  - `period` (string, optional, default: "1mo"): Time period (e.g., "1mo", "3mo", "6mo", "1y", "5y")

- **financial_news(symbol, count?)**: Get latest financial news articles for a stock.
  - `symbol` (string, required): Stock ticker symbol
  - `count` (integer, optional, default: 5): Number of news items to return

- **stock_analysis(symbol)**: Get comprehensive stock analysis including valuation, financials, and analyst recommendations.
  - `symbol` (string, required): Stock ticker symbol

## Usage Guidelines

- Use standard ticker symbols (e.g., AAPL, MSFT, GOOGL, AMZN).
- For stock quotes, present data in a clear tabular format with key metrics highlighted.
- When showing historical data, mention the time period and any notable trends.
- Combine `stock_quote` + `stock_analysis` for comprehensive investment overviews.
- Always include a disclaimer that this is informational only, not investment advice.
- Use `financial_news` to provide context on price movements.
