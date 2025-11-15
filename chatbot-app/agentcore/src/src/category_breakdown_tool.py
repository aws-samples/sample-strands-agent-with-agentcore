"""
Category Breakdown Analysis Tool

Analyzes spending distribution across categories with demographic comparisons.
"""

import asyncio
import json
import logging
import os
import uuid
from typing import Any, Dict, List
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
def analyze_category_breakdown(customer_id: str = None) -> str:
    """
    Analyze customer spending breakdown by category with demographic benchmarking.
    
    Provides comprehensive category analysis including:
    - Detailed spending distribution across all categories
    - Category-wise transaction patterns and average amounts
    - Essential vs discretionary spending classification
    - Demographic category comparisons and peer benchmarking
    - Category concentration risk analysis
    - Special insights on category preferences and lifestyle alignment
    
    Args:
        customer_id: Customer identifier to analyze (optional, uses selected customer if not provided)
        
    Returns:
        str: Comprehensive category breakdown analysis with demographic insights and recommendations
    """
    
    async def analyze_categories_async():
        # Generate unique session ID for this specific tool execution
        session_id = f"categories_{uuid.uuid4().hex[:8]}"
        context = "category_breakdown"
        executor = "analyze_category_breakdown"
        
        try:
            # Use provided customer_id or get selected one
            target_customer_id = customer_id or get_selected_customer_id()
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'category_breakdown_tool',
                    session_id,
                    'analyzing',
                    'Analyzing category spending breakdown...',
                    30,
                    {'executor': 'analyze_category_breakdown'}
                )
            
            customer = MOCK_CUSTOMERS.get(target_customer_id)
            if not customer:
                if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                    await tool_events_channel.send_progress(
                        'category_breakdown_tool',
                        session_id,
                        'error',
                        f'Customer {target_customer_id} not found',
                        None,
                        {'executor': 'analyze_category_breakdown'}
                    )
                return f"Error: Customer {target_customer_id} not found in database."
            
            transactions = MOCK_TRANSACTIONS.get(target_customer_id, [])
            profile = CUSTOMER_PROFILES.get(target_customer_id, {})
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'category_breakdown_tool',
                    session_id,
                    'calculating',
                    'Calculating category distributions and patterns...',
                    70,
                    {'executor': 'analyze_category_breakdown'}
                )
            
            # Calculate category spending breakdown
            category_data = {}
            total_spending = 0
            total_transactions = len(transactions)
            
            for txn in transactions:
                category = txn['category']
                amount = txn['amount']
                total_spending += amount
                
                if category not in category_data:
                    category_data[category] = {
                        'amount': 0,
                        'count': 0,
                        'transactions': []
                    }
                
                category_data[category]['amount'] += amount
                category_data[category]['count'] += 1
                category_data[category]['transactions'].append(amount)
            
            # Calculate percentages and averages
            for category in category_data:
                data = category_data[category]
                data['percentage'] = (data['amount'] / total_spending) * 100 if total_spending > 0 else 0
                data['avg_transaction'] = data['amount'] / data['count'] if data['count'] > 0 else 0
                data['frequency_pct'] = (data['count'] / total_transactions) * 100 if total_transactions > 0 else 0
            
            # Sort categories by spending amount
            sorted_categories = sorted(category_data.items(), key=lambda x: x[1]['amount'], reverse=True)
            
            # Get demographic benchmarks
            age_group = profile.get('age_group')
            income_bracket = profile.get('income_bracket')
            lifestyle = profile.get('lifestyle_profile')
            
            age_benchmark = DEMOGRAPHIC_BENCHMARKS['age_groups'].get(age_group, {})
            income_benchmark = DEMOGRAPHIC_BENCHMARKS['income_brackets'].get(income_bracket, {})
            
            # Classify categories as essential vs discretionary
            essential_categories = ['Groceries', 'Healthcare', 'Utilities', 'Transportation']
            discretionary_categories = ['Dining', 'Entertainment', 'Shopping', 'Travel', 'Sports']
            
            essential_spending = sum(category_data.get(cat, {}).get('amount', 0) for cat in essential_categories)
            discretionary_spending = sum(category_data.get(cat, {}).get('amount', 0) for cat in discretionary_categories)
            
            essential_pct = (essential_spending / total_spending) * 100 if total_spending > 0 else 0
            discretionary_pct = (discretionary_spending / total_spending) * 100 if total_spending > 0 else 0
            
            # Generate special insights
            special_insights = []
            
            # Category concentration insight
            top_category = sorted_categories[0] if sorted_categories else None
            if top_category and top_category[1]['percentage'] > 40:
                special_insights.append(f"⚠️ **High Category Concentration**: {top_category[1]['percentage']:.1f}% of spending in {top_category[0]} - consider diversification")
            
            # Lifestyle alignment insight
            if lifestyle == 'food_enthusiast':
                dining_pct = category_data.get('Dining', {}).get('percentage', 0)
                if dining_pct > 25:
                    special_insights.append(f"🍽️ **Strong Lifestyle Alignment**: {dining_pct:.1f}% dining spending confirms food enthusiast profile")
                elif dining_pct < 15:
                    special_insights.append(f"🤔 **Lifestyle Mismatch**: Only {dining_pct:.1f}% dining spending despite food enthusiast profile")
            
            elif lifestyle == 'family_focused':
                family_categories = ['Kids', 'Groceries', 'Healthcare']
                family_spending = sum(category_data.get(cat, {}).get('amount', 0) for cat in family_categories)
                family_pct = (family_spending / total_spending) * 100 if total_spending > 0 else 0
                if family_pct > 30:
                    special_insights.append(f"👨‍👩‍👧‍👦 **Family-First Spending**: {family_pct:.1f}% on family-related categories shows strong family focus")
            
            elif lifestyle == 'sports_enthusiast':
                sports_pct = category_data.get('Sports', {}).get('percentage', 0)
                if sports_pct > 15:
                    special_insights.append(f"🏃‍♂️ **Active Lifestyle Investment**: {sports_pct:.1f}% sports spending demonstrates commitment to active lifestyle")
            
            # Transaction pattern insight
            high_frequency_categories = [cat for cat, data in category_data.items() if data['frequency_pct'] > 20]
            if high_frequency_categories:
                special_insights.append(f"🔄 **High-Frequency Categories**: {', '.join(high_frequency_categories)} - frequent transaction patterns")
            
            # Demographic comparison insight
            if age_benchmark.get('category_breakdown'):
                significant_differences = []
                for category, benchmark_pct in age_benchmark['category_breakdown'].items():
                    if category in category_data:
                        actual_pct = category_data[category]['percentage']
                        diff = actual_pct - (benchmark_pct * 100)  # Convert to percentage
                        if abs(diff) > 5:  # 5% difference threshold
                            direction = "above" if diff > 0 else "below"
                            significant_differences.append(f"{category} ({abs(diff):.1f}% {direction} peers)")
                
                if significant_differences:
                    special_insights.append(f"📊 **Peer Differences**: {', '.join(significant_differences[:3])}")
            
            # Essential vs discretionary balance insight
            if essential_pct < 40:
                special_insights.append(f"💸 **High Discretionary Spending**: {discretionary_pct:.1f}% on discretionary items - opportunity for savings")
            elif essential_pct > 70:
                special_insights.append(f"🏠 **Essential-Heavy Spending**: {essential_pct:.1f}% on essentials - limited flexibility but good financial discipline")
            
            analysis = f"""
# Category Breakdown Analysis for {customer['first_name']} {customer['last_name']}

## Spending Overview
- **Total Spending**: ${total_spending:,.2f}
- **Categories Active**: {len(category_data)}
- **Essential Spending**: {essential_pct:.1f}% (${essential_spending:,.2f})
- **Discretionary Spending**: {discretionary_pct:.1f}% (${discretionary_spending:,.2f})

## Top Spending Categories
"""
            
            # Show top 5 categories
            for i, (category, data) in enumerate(sorted_categories[:5]):
                analysis += f"""
### {i+1}. {category} - {data['percentage']:.1f}% of total spending
- **Amount**: ${data['amount']:,.2f}
- **Transactions**: {data['count']} ({data['frequency_pct']:.1f}% of all transactions)
- **Average per transaction**: ${data['avg_transaction']:,.2f}
"""
            
            # Show remaining categories if any
            if len(sorted_categories) > 5:
                analysis += f"\n### Other Categories ({len(sorted_categories) - 5} categories)\n"
                for category, data in sorted_categories[5:]:
                    analysis += f"- **{category}**: ${data['amount']:,.2f} ({data['percentage']:.1f}%)\n"
            
            # Add demographic benchmarking
            analysis += f"\n## Demographic Benchmarking\n"
            if age_benchmark.get('category_breakdown'):
                analysis += f"### Age Group Comparison ({age_group})\n"
                for category, benchmark_pct in age_benchmark['category_breakdown'].items():
                    if category in category_data:
                        actual_pct = category_data[category]['percentage']
                        benchmark_display = benchmark_pct * 100  # Convert to percentage
                        diff = actual_pct - benchmark_display
                        status_icon = "📈" if diff > 2 else "📉" if diff < -2 else "➡️"
                        analysis += f"- **{category}**: {actual_pct:.1f}% vs {benchmark_display:.1f}% peer average {status_icon}\n"
            
            # Add category insights
            analysis += f"\n## Category Pattern Analysis\n"
            
            # High-value categories
            high_value_categories = [cat for cat, data in category_data.items() if data['avg_transaction'] > 200]
            if high_value_categories:
                analysis += f"- **High-Value Categories**: {', '.join(high_value_categories)} - average transactions >$200\n"
            
            # Frequent categories
            frequent_categories = [cat for cat, data in category_data.items() if data['count'] > total_transactions * 0.15]
            if frequent_categories:
                analysis += f"- **Frequent Categories**: {', '.join(frequent_categories)} - high transaction frequency\n"
            
            # Category diversity
            category_count = len(category_data)
            diversity_score = "High" if category_count > 8 else "Moderate" if category_count > 5 else "Low"
            analysis += f"- **Spending Diversity**: {diversity_score} ({category_count} active categories)\n"
            
            # Add special insights
            if special_insights:
                analysis += f"\n## 🔍 Special Insights\n"
                for insight in special_insights:
                    analysis += f"{insight}\n"
            
            # Add optimization opportunities
            analysis += f"\n## 💡 Optimization Opportunities\n"
            
            # Category concentration risk
            if top_category and top_category[1]['percentage'] > 35:
                analysis += f"- **Diversification**: Consider reducing {top_category[0]} spending from {top_category[1]['percentage']:.1f}% to 30% for better balance\n"
            
            # High discretionary spending
            if discretionary_pct > 60:
                potential_savings = discretionary_spending * 0.15  # 15% reduction
                analysis += f"- **Discretionary Reduction**: 15% reduction in discretionary spending could save ${potential_savings:,.2f} monthly\n"
            
            # Category-specific recommendations
            if 'Dining' in category_data and category_data['Dining']['percentage'] > 25:
                dining_savings = category_data['Dining']['amount'] * 0.20
                analysis += f"- **Dining Optimization**: 20% dining reduction could save ${dining_savings:,.2f} while maintaining lifestyle\n"
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'category_breakdown_tool',
                    session_id,
                    'completed',
                    'Category breakdown analysis completed successfully!',
                    100,
                    {'executor': 'analyze_category_breakdown'}
                )
            
            return analysis.strip()
            
        except Exception as e:
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'category_breakdown_tool',
                    session_id,
                    'error',
                    f'Error analyzing category breakdown: {str(e)}',
                    None,
                    {'executor': 'analyze_category_breakdown'}
                )
            return f"Error analyzing category breakdown: {str(e)}"
    
    return run_async(analyze_categories_async())
