"""
Spending Trends Analysis Tool

Analyzes spending trends over time, seasonal patterns, and future predictions.
"""

import asyncio
import json
import logging
import os
import uuid
from typing import Any, Dict, List
from datetime import datetime, timedelta
from strands import tool
from utils.customer_utils import get_selected_customer_id, run_async
try:
    from routers.tool_events import tool_events_channel
    ANALYSIS_CHANNEL_AVAILABLE = tool_events_channel is not None
except ImportError:
    tool_events_channel = None
    ANALYSIS_CHANNEL_AVAILABLE = False
from .mock_data import (
    MOCK_CUSTOMERS,
    MOCK_TRANSACTIONS,
    DEMOGRAPHIC_BENCHMARKS,
    CUSTOMER_PROFILES
)

logger = logging.getLogger(__name__)


@tool
def analyze_spending_trends(customer_id: str = None) -> str:
    """
    Analyze customer spending trends over time, including seasonal patterns and growth trajectories.
    
    Provides comprehensive trend analysis including:
    - Monthly spending progression and growth rates
    - Seasonal spending patterns and cyclical behaviors
    - Trend momentum and velocity indicators
    - Demographic trend comparisons and peer benchmarking
    - Future spending predictions based on historical patterns
    - Special insights on spending acceleration/deceleration periods
    
    Args:
        customer_id: Customer identifier to analyze (optional, uses selected customer if not provided)
        
    Returns:
        str: Comprehensive spending trends analysis with demographic insights and predictions
    """
    
    async def analyze_trends_async():
        # Generate unique session ID for this specific tool execution
        session_id = f"trends_{uuid.uuid4().hex[:8]}"
        context = "spending_trends"
        executor = "analyze_spending_trends"
        
        try:
            # Use provided customer_id or get selected one
            target_customer_id = customer_id or get_selected_customer_id()
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_trends_tool',  # Use specific tool name
                    session_id, 
                    'analyzing', 
                    'Analyzing spending trends and patterns...',
                    30,
                    {'executor': 'analyze_spending_trends'}
                )
            
            customer = MOCK_CUSTOMERS.get(target_customer_id)
            if not customer:
                if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                    await tool_events_channel.send_progress(
                        'spending_trends_tool',
                        session_id,
                        'error',
                        f'Customer {target_customer_id} not found',
                        None,
                        {'executor': 'analyze_spending_trends'}
                    )
                return f"Error: Customer {target_customer_id} not found in database."
            
            transactions = MOCK_TRANSACTIONS.get(target_customer_id, [])
            profile = CUSTOMER_PROFILES.get(target_customer_id, {})
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_trends_tool',
                    session_id,
                    'calculating', 
                    'Calculating trend patterns and seasonal analysis...',
                    70,
                    {'executor': 'analyze_spending_trends'}
                )
            
            # Calculate monthly spending trends
            monthly_spending = {}
            category_trends = {}
            
            for txn in transactions:
                # Extract month from transaction (assuming date format)
                month_key = txn.get('date', '2024-01')[:7]  # YYYY-MM format
                category = txn['category']
                amount = txn['amount']
                
                if month_key not in monthly_spending:
                    monthly_spending[month_key] = 0
                monthly_spending[month_key] += amount
                
                if category not in category_trends:
                    category_trends[category] = {}
                if month_key not in category_trends[category]:
                    category_trends[category][month_key] = 0
                category_trends[category][month_key] += amount
            
            # Calculate growth rates
            sorted_months = sorted(monthly_spending.keys())
            growth_rates = []
            
            for i in range(1, len(sorted_months)):
                prev_month = monthly_spending[sorted_months[i-1]]
                curr_month = monthly_spending[sorted_months[i]]
                if prev_month > 0:
                    growth_rate = ((curr_month - prev_month) / prev_month) * 100
                    growth_rates.append(growth_rate)
            
            avg_growth_rate = sum(growth_rates) / len(growth_rates) if growth_rates else 0
            
            # Get demographic benchmarks
            age_group = profile.get('age_group')
            income_bracket = profile.get('income_bracket')
            lifestyle = profile.get('lifestyle_profile')
            
            age_benchmark = DEMOGRAPHIC_BENCHMARKS['age_groups'].get(age_group, {})
            income_benchmark = DEMOGRAPHIC_BENCHMARKS['income_brackets'].get(income_bracket, {})
            
            # Calculate total spending
            total_spending = sum(monthly_spending.values())
            avg_monthly = total_spending / len(monthly_spending) if monthly_spending else 0
            
            # Identify spending personality based on trends
            spending_velocity = "High" if avg_growth_rate > 5 else "Moderate" if avg_growth_rate > 0 else "Declining"
            
            # Generate special insights
            special_insights = []
            
            # Seasonal pattern insight
            if len(monthly_spending) >= 3:
                values = list(monthly_spending.values())
                max_month = max(monthly_spending, key=monthly_spending.get)
                min_month = min(monthly_spending, key=monthly_spending.get)
                seasonal_variance = (max(values) - min(values)) / avg_monthly * 100 if avg_monthly > 0 else 0
                
                if seasonal_variance > 30:
                    special_insights.append(f"🌊 **High Seasonal Variance**: {seasonal_variance:.1f}% difference between peak ({max_month}) and low ({min_month}) spending months")
            
            # Growth momentum insight
            if len(growth_rates) >= 2:
                recent_trend = sum(growth_rates[-2:]) / 2 if len(growth_rates) >= 2 else growth_rates[-1]
                if abs(recent_trend - avg_growth_rate) > 10:
                    trend_direction = "accelerating" if recent_trend > avg_growth_rate else "decelerating"
                    special_insights.append(f"📈 **Trend Shift Detected**: Spending growth is {trend_direction} - recent trend {recent_trend:.1f}% vs average {avg_growth_rate:.1f}%")
            
            # Demographic comparison insight
            if age_benchmark.get('monthly_spending'):
                peer_comparison = (avg_monthly / age_benchmark['monthly_spending'] - 1) * 100
                if abs(peer_comparison) > 20:
                    comparison_text = "above" if peer_comparison > 0 else "below"
                    special_insights.append(f"👥 **Peer Comparison**: Spending {abs(peer_comparison):.1f}% {comparison_text} typical {age_group} consumers")
            
            # Lifestyle alignment insight
            if lifestyle == 'food_enthusiast':
                dining_trend = category_trends.get('Dining', {})
                if dining_trend:
                    dining_growth = []
                    sorted_dining_months = sorted(dining_trend.keys())
                    for i in range(1, len(sorted_dining_months)):
                        prev = dining_trend[sorted_dining_months[i-1]]
                        curr = dining_trend[sorted_dining_months[i]]
                        if prev > 0:
                            dining_growth.append(((curr - prev) / prev) * 100)
                    
                    if dining_growth:
                        avg_dining_growth = sum(dining_growth) / len(dining_growth)
                        if avg_dining_growth > avg_growth_rate + 5:
                            special_insights.append(f"🍽️ **Lifestyle Amplification**: Dining spending growing {avg_dining_growth:.1f}% vs overall {avg_growth_rate:.1f}% - strong food enthusiast behavior")
            
            analysis = f"""
# Spending Trends Analysis for {customer['first_name']} {customer['last_name']}

## Trend Overview
- **Analysis Period**: {len(monthly_spending)} months of data
- **Average Monthly Spending**: ${avg_monthly:,.2f}
- **Total Period Spending**: ${total_spending:,.2f}
- **Growth Velocity**: {spending_velocity} ({avg_growth_rate:+.1f}% average monthly growth)

## Monthly Progression
"""
            
            for month in sorted_months:
                amount = monthly_spending[month]
                analysis += f"- **{month}**: ${amount:,.2f}\n"
            
            if growth_rates:
                analysis += f"\n## Growth Pattern Analysis\n"
                analysis += f"- **Average Growth Rate**: {avg_growth_rate:+.1f}% per month\n"
                analysis += f"- **Growth Consistency**: {'Stable' if max(growth_rates) - min(growth_rates) < 20 else 'Volatile'}\n"
                analysis += f"- **Recent Momentum**: {growth_rates[-1]:+.1f}% last month\n"
            
            # Add demographic benchmarking
            analysis += f"\n## Demographic Benchmarking\n"
            if age_benchmark.get('monthly_spending'):
                benchmark_diff = avg_monthly - age_benchmark['monthly_spending']
                analysis += f"- **Age Group Comparison ({age_group})**: {benchmark_diff:+,.2f} vs peer average\n"
            
            if income_benchmark.get('monthly_spending'):
                income_diff = avg_monthly - income_benchmark['monthly_spending']
                analysis += f"- **Income Bracket Comparison ({income_bracket})**: {income_diff:+,.2f} vs income peer average\n"
            
            # Add category trend highlights
            analysis += f"\n## Category Trend Highlights\n"
            for category, trend_data in category_trends.items():
                if len(trend_data) >= 2:
                    values = list(trend_data.values())
                    category_growth = ((values[-1] - values[0]) / values[0]) * 100 if values[0] > 0 else 0
                    trend_indicator = "📈" if category_growth > 10 else "📉" if category_growth < -10 else "➡️"
                    analysis += f"- **{category}**: {trend_indicator} {category_growth:+.1f}% trend\n"
            
            # Add special insights
            if special_insights:
                analysis += f"\n## 🔍 Special Insights\n"
                for insight in special_insights:
                    analysis += f"{insight}\n"
            
            # Future predictions
            if avg_growth_rate != 0:
                next_month_prediction = avg_monthly * (1 + avg_growth_rate/100)
                analysis += f"\n## 🔮 Trend Predictions\n"
                analysis += f"- **Next Month Forecast**: ${next_month_prediction:,.2f} (based on {avg_growth_rate:+.1f}% trend)\n"
                analysis += f"- **Trend Sustainability**: {'Sustainable' if abs(avg_growth_rate) < 10 else 'Monitor for adjustment'}\n"
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_trends_tool',
                    session_id,
                    'completed',
                    'Spending trends analysis completed successfully!',
                    100,
                    {'executor': 'analyze_spending_trends'}
                )
            
            return analysis.strip()
            
        except Exception as e:
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_trends_tool',
                    session_id,
                    'error',
                    f'Error analyzing spending trends: {str(e)}',
                    None,
                    {'executor': 'analyze_spending_trends'}
                )
            return f"Error analyzing spending trends: {str(e)}"
    
    return run_async(analyze_trends_async())
