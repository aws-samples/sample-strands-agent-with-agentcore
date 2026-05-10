"""
Finance Lambda for AgentCore Gateway
Provides Yahoo Finance stock data and analysis
"""
import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import after logger setup
import yfinance as yf
import pandas as pd

def lambda_handler(event, context):
    """
    Lambda handler for Finance tools via AgentCore Gateway

    Gateway unwraps tool arguments and passes them directly to Lambda
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")

        # Get tool name from context (set by AgentCore Gateway)
        tool_name = 'unknown'
        if hasattr(context, 'client_context') and context.client_context:
            if hasattr(context.client_context, 'custom'):
                tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
                if '___' in tool_name:
                    tool_name = tool_name.split('___')[-1]

        logger.info(f"Tool name: {tool_name}")

        # Route to appropriate tool
        if tool_name == 'stock_quote':
            return stock_quote(event)
        elif tool_name == 'stock_history':
            return stock_history(event)
        elif tool_name == 'financial_news':
            return financial_news(event)
        elif tool_name == 'stock_analysis':
            return stock_analysis(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def format_number(num):
    """Format a number with commas and 2 decimal places"""
    if num is None:
        return 'N/A'
    try:
        return f"{num:,.2f}"
    except (ValueError, TypeError):
        return 'N/A'


def stock_quote(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get current stock quote"""

    # Extract parameters (Gateway unwraps them)
    symbol = params.get('symbol')

    if not symbol:
        return error_response("symbol parameter required")

    logger.info(f"Stock quote: symbol={symbol}")

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        if not info:
            return error_response(f"No data found for symbol: {symbol}")

        result = f"""
Symbol: {symbol}
Name: {info.get('shortName', 'N/A')}
Price: ${format_number(info.get('regularMarketPrice'))}
Change: ${format_number(info.get('regularMarketChange'))} ({format_number(info.get('regularMarketChangePercent'))}%)
Previous Close: ${format_number(info.get('regularMarketPreviousClose'))}
Open: ${format_number(info.get('regularMarketOpen'))}
Day Range: ${format_number(info.get('regularMarketDayLow'))} - ${format_number(info.get('regularMarketDayHigh'))}
52 Week Range: ${format_number(info.get('fiftyTwoWeekLow'))} - ${format_number(info.get('fiftyTwoWeekHigh'))}
Volume: {format_number(info.get('regularMarketVolume'))}
Market Cap: ${format_number(info.get('marketCap'))}
P/E Ratio: {format_number(info.get('trailingPE'))}
"""

        return success_response(result.strip())

    except Exception as e:
        return error_response(f"Stock quote error: {str(e)}")


def stock_history(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get historical stock price data"""

    # Extract parameters
    symbol = params.get('symbol')
    period = params.get('period', '1mo')

    if not symbol:
        return error_response("symbol parameter required")

    logger.info(f"Stock history: symbol={symbol}, period={period}")

    try:
        ticker = yf.Ticker(symbol)
        history = ticker.history(period=period)

        if history.empty:
            return error_response(f"No historical data found for symbol: {symbol}")

        # Format as simple table
        result = f"Historical data for {symbol} (period: {period})\n\n"
        result += "Date       | Open     | High     | Low      | Close    | Volume\n"
        result += "-----------|----------|----------|----------|----------|-----------\n"

        max_points = 10
        step = max(1, len(history) // max_points)

        for i in range(0, len(history), step):
            date = history.index[i].strftime('%Y-%m-%d')
            row = history.iloc[i]

            result += f"{date} | ${row['Open']:.2f} | ${row['High']:.2f} | ${row['Low']:.2f} | ${row['Close']:.2f} | {int(row['Volume']):,}\n"

        # Add summary
        first_close = history['Close'].iloc[0]
        last_close = history['Close'].iloc[-1]
        change = last_close - first_close
        percent_change = (change / first_close) * 100

        result += f"\nPrice Change: ${change:.2f} ({percent_change:.2f}%)"

        return success_response(result)

    except Exception as e:
        return error_response(f"Stock history error: {str(e)}")


def financial_news(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get financial news for a stock"""

    # Extract parameters
    symbol = params.get('symbol')
    count = params.get('count', 5)

    if not symbol:
        return error_response("symbol parameter required")

    logger.info(f"Financial news: symbol={symbol}, count={count}")

    try:
        ticker = yf.Ticker(symbol)
        news = ticker.news

        if not news:
            return error_response(f"No news found for symbol: {symbol}")

        # Format news (handle new yfinance API structure)
        results = []
        for idx, item in enumerate(news[:count], 1):
            # News items are now nested under 'content' key
            content = item.get('content', {})
            pub_date_str = content.get('pubDate', '')

            # Parse ISO 8601 format: '2025-10-31T16:19:35Z'
            try:
                pub_time = datetime.fromisoformat(pub_date_str.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M')
            except:
                pub_time = 'Unknown'

            provider = content.get('provider', {})
            canonical = content.get('canonicalUrl', {})

            results.append({
                "index": idx,
                "title": content.get('title', 'No title'),
                "publisher": provider.get('displayName', 'Unknown'),
                "published": pub_time,
                "link": canonical.get('url', '')
            })

        result_data = {
            "symbol": symbol,
            "news_count": len(results),
            "news": results
        }

        return success_response(json.dumps(result_data, indent=2))

    except Exception as e:
        return error_response(f"Financial news error: {str(e)}")


def stock_analysis(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get basic stock analysis"""

    # Extract parameters
    symbol = params.get('symbol')

    if not symbol:
        return error_response("symbol parameter required")

    logger.info(f"Stock analysis: symbol={symbol}")

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        if not info:
            return error_response(f"No data found for symbol: {symbol}")

        # Gather analysis data
        analysis = {
            "company_info": {
                "name": info.get('longName', 'N/A'),
                "sector": info.get('sector', 'N/A'),
                "industry": info.get('industry', 'N/A'),
                "country": info.get('country', 'N/A')
            },
            "valuation": {
                "market_cap": format_number(info.get('marketCap')),
                "trailing_pe": format_number(info.get('trailingPE')),
                "forward_pe": format_number(info.get('forwardPE')),
                "price_to_book": format_number(info.get('priceToBook'))
            },
            "financial_metrics": {
                "revenue": format_number(info.get('totalRevenue')),
                "profit_margin": f"{info.get('profitMargins', 0) * 100:.2f}%" if info.get('profitMargins') else 'N/A',
                "operating_margin": f"{info.get('operatingMargins', 0) * 100:.2f}%" if info.get('operatingMargins') else 'N/A',
                "roe": f"{info.get('returnOnEquity', 0) * 100:.2f}%" if info.get('returnOnEquity') else 'N/A'
            },
            "analyst_recommendation": info.get('recommendationKey', 'N/A')
        }

        return success_response(json.dumps(analysis, indent=2))

    except Exception as e:
        return error_response(f"Stock analysis error: {str(e)}")


def success_response(content: str) -> Dict[str, Any]:
    """Format successful MCP response"""
    return {
        'statusCode': 200,
        'body': json.dumps({
            'content': [{
                'type': 'text',
                'text': content
            }]
        })
    }


def error_response(message: str) -> Dict[str, Any]:
    """Format error response"""
    logger.error(f"Error response: {message}")
    return {
        'statusCode': 400,
        'body': json.dumps({
            'error': message
        })
    }
