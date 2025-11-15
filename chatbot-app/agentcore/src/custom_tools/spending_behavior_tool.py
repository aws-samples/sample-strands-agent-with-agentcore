"""
Spending Behavior Analysis Tool

Analyzes spending behavior patterns, habits, and psychological insights.
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
def analyze_spending_behavior(customer_id: str = None) -> str:
    """
    Analyze customer spending behavior patterns and psychological insights.
    
    Provides comprehensive behavioral analysis including:
    - Transaction frequency vs amount patterns (impulse vs planned spending)
    - Lifestyle alignment and authenticity assessment
    - Spending personality profiling and behavioral triggers
    - Risk tolerance and financial decision-making patterns
    - Demographic behavioral comparisons and peer insights
    - Special psychological insights and behavioral recommendations
    
    Args:
        customer_id: Customer identifier to analyze (optional, uses selected customer if not provided)
        
    Returns:
        str: Comprehensive spending behavior analysis with psychological insights and recommendations
    """
    
    async def analyze_behavior_async():
        # Import here to avoid circular dependency
        from utils.tool_execution_context import get_current_session_id
        
        # Use actual session ID from context, not a new one
        session_id = get_current_session_id()
        if not session_id:
            session_id = f"behavior_{uuid.uuid4().hex[:8]}"
        
        print(f"🔍 Spending Behavior - using session_id: {session_id}")
        context = "spending_behavior"
        executor = "analyze_spending_behavior"
        
        try:
            # Use provided customer_id or get selected one
            target_customer_id = customer_id or get_selected_customer_id()
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_behavior_tool',
                    session_id,
                    'analyzing',
                    'Analyzing spending behavior patterns...',
                    30,
                    {'executor': 'analyze_spending_behavior'}
                )
            
            customer = MOCK_CUSTOMERS.get(target_customer_id)
            if not customer:
                logger.error(f"Customer {target_customer_id} not found in MOCK_CUSTOMERS")
                if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                    await tool_events_channel.send_progress(
                        'spending_behavior_tool',
                        session_id,
                        'error',
                        f'Customer {target_customer_id} not found',
                        None,
                        {'executor': 'analyze_spending_behavior'}
                    )
                return f"Error: Customer {target_customer_id} not found in database."
            
            transactions = MOCK_TRANSACTIONS.get(target_customer_id, [])
            profile = CUSTOMER_PROFILES.get(target_customer_id, {})
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_behavior_tool',
                    session_id,
                    'calculating',
                    'Analyzing behavioral patterns and psychological insights...',
                    70,
                    {'executor': 'analyze_spending_behavior'}
                )
            
            # Calculate basic spending metrics
            total_spending = sum(txn['amount'] for txn in transactions)
            total_transactions = len(transactions)
            avg_transaction = total_spending / total_transactions if total_transactions > 0 else 0
            
            # Analyze transaction amounts for spending patterns
            amounts = [txn['amount'] for txn in transactions]
            amounts.sort()
            
            # Calculate spending distribution
            small_txns = [amt for amt in amounts if amt < avg_transaction * 0.5]
            medium_txns = [amt for amt in amounts if avg_transaction * 0.5 <= amt <= avg_transaction * 2]
            large_txns = [amt for amt in amounts if amt > avg_transaction * 2]
            
            small_pct = len(small_txns) / total_transactions * 100 if total_transactions > 0 else 0
            medium_pct = len(medium_txns) / total_transactions * 100 if total_transactions > 0 else 0
            large_pct = len(large_txns) / total_transactions * 100 if total_transactions > 0 else 0
            
            # Analyze category spending for lifestyle alignment
            category_spending = {}
            for txn in transactions:
                category = txn['category']
                if category not in category_spending:
                    category_spending[category] = 0
                category_spending[category] += txn['amount']
            
            # Calculate category percentages
            category_percentages = {}
            for category, amount in category_spending.items():
                category_percentages[category] = (amount / total_spending) * 100 if total_spending > 0 else 0
            
            # Get demographic and lifestyle info
            age_group = profile.get('age_group')
            income_bracket = profile.get('income_bracket')
            lifestyle = profile.get('lifestyle_profile')
            family_status = profile.get('family_status')
            
            age_benchmark = DEMOGRAPHIC_BENCHMARKS['age_groups'].get(age_group, {})
            
            # Determine spending personality
            spending_personality = _determine_spending_personality(
                category_percentages, profile, small_pct, medium_pct, large_pct
            )
            
            # Generate behavioral insights
            behavioral_insights = []
            
            # Transaction pattern analysis
            if large_pct > 25:
                behavioral_insights.append("🎯 **Strategic Spender**: High proportion of large transactions suggests planned, deliberate spending decisions")
            elif small_pct > 60:
                behavioral_insights.append("🛒 **Frequent Spender**: High frequency of small transactions indicates regular, habitual spending patterns")
            else:
                behavioral_insights.append("⚖️ **Balanced Spender**: Mix of transaction sizes shows flexible spending approach")
            
            # Lifestyle alignment analysis
            lifestyle_alignment_score = _calculate_lifestyle_alignment(category_percentages, lifestyle)
            if lifestyle_alignment_score > 80:
                behavioral_insights.append(f"✅ **Strong Lifestyle Alignment**: {lifestyle_alignment_score:.0f}% alignment between declared lifestyle ({lifestyle}) and spending patterns")
            elif lifestyle_alignment_score < 50:
                behavioral_insights.append(f"⚠️ **Lifestyle Mismatch**: Only {lifestyle_alignment_score:.0f}% alignment with declared {lifestyle} lifestyle - potential identity shift or aspirational spending")
            
            # Risk tolerance analysis
            risk_tolerance = _assess_risk_tolerance(category_percentages, large_pct, profile)
            behavioral_insights.append(f"📊 **Risk Profile**: {risk_tolerance['level']} - {risk_tolerance['description']}")
            
            # Emotional spending patterns
            emotional_patterns = _analyze_emotional_patterns(category_percentages, amounts, lifestyle)
            if emotional_patterns:
                behavioral_insights.extend(emotional_patterns)
            
            # Generate special psychological insights
            psychological_insights = []
            
            # Impulse vs planned spending
            impulse_categories = ['Shopping', 'Entertainment', 'Dining']
            impulse_spending = sum(category_spending.get(cat, 0) for cat in impulse_categories)
            impulse_pct = (impulse_spending / total_spending) * 100 if total_spending > 0 else 0
            
            if impulse_pct > 50:
                psychological_insights.append(f"🧠 **High Impulse Tendency**: {impulse_pct:.1f}% spending in impulse categories suggests emotional or spontaneous decision-making")
            elif impulse_pct < 25:
                psychological_insights.append(f"🎯 **Disciplined Spender**: {impulse_pct:.1f}% impulse spending indicates strong self-control and planning")
            
            # Social influence analysis
            if lifestyle == 'food_enthusiast' and category_percentages.get('Dining', 0) > 25:
                psychological_insights.append("👥 **Social Identity Spending**: High dining expenses may reflect social identity and community belonging needs")
            
            # Status and achievement patterns
            status_categories = ['Shopping', 'Travel', 'Entertainment']
            status_spending = sum(category_spending.get(cat, 0) for cat in status_categories)
            status_pct = (status_spending / total_spending) * 100 if total_spending > 0 else 0
            
            if status_pct > 40:
                psychological_insights.append(f"🏆 **Status-Conscious Spending**: {status_pct:.1f}% on status categories suggests importance of social perception and achievement")
            
            # Family influence (if applicable)
            if family_status == 'married_with_children':
                family_categories = ['Kids', 'Groceries', 'Healthcare']
                family_spending = sum(category_spending.get(cat, 0) for cat in family_categories)
                family_pct = (family_spending / total_spending) * 100 if total_spending > 0 else 0
                
                if family_pct > 35:
                    psychological_insights.append(f"👨‍👩‍👧‍👦 **Family-Centric Values**: {family_pct:.1f}% family spending reflects strong nurturing and responsibility priorities")
            
            # Generate optimization recommendations
            optimization_recommendations = []
            
            # Based on spending personality
            if large_pct > 30:
                optimization_recommendations.append("💡 **Large Purchase Strategy**: Consider 24-hour waiting period for purchases >$" + f"{avg_transaction * 2:.0f} to ensure alignment with goals")
            
            if impulse_pct > 40:
                potential_savings = impulse_spending * 0.20
                optimization_recommendations.append(f"💰 **Impulse Control**: 20% reduction in impulse categories could save ${potential_savings:,.2f} monthly")
            
            # Lifestyle-specific recommendations
            if lifestyle == 'food_enthusiast' and category_percentages.get('Dining', 0) > 30:
                optimization_recommendations.append("🍽️ **Dining Balance**: Consider alternating restaurant visits with premium home cooking to maintain food passion while optimizing costs")
            
            analysis = f"""
# Spending Behavior Analysis for {customer['first_name']} {customer['last_name']}

## Behavioral Profile
- **Spending Personality**: {spending_personality}
- **Transaction Pattern**: {small_pct:.1f}% small, {medium_pct:.1f}% medium, {large_pct:.1f}% large transactions
- **Average Transaction**: ${avg_transaction:,.2f}
- **Lifestyle Alignment**: {lifestyle_alignment_score:.0f}% match with {lifestyle} profile

## Transaction Behavior Analysis
- **Small Transactions (<${avg_transaction * 0.5:.0f})**: {len(small_txns)} transactions ({small_pct:.1f}%)
- **Medium Transactions (${avg_transaction * 0.5:.0f}-${avg_transaction * 2:.0f})**: {len(medium_txns)} transactions ({medium_pct:.1f}%)
- **Large Transactions (>${avg_transaction * 2:.0f})**: {len(large_txns)} transactions ({large_pct:.1f}%)

## Spending Psychology Insights
"""
            
            # Add behavioral insights
            for insight in behavioral_insights:
                analysis += f"{insight}\n"
            
            # Add psychological insights
            if psychological_insights:
                analysis += f"\n## 🧠 Psychological Patterns\n"
                for insight in psychological_insights:
                    analysis += f"{insight}\n"
            
            # Add demographic comparison
            if age_benchmark.get('monthly_spending'):
                monthly_spending = total_spending / 3  # Assuming 3-month period
                peer_comparison = (monthly_spending / age_benchmark['monthly_spending'] - 1) * 100
                analysis += f"\n## Peer Behavioral Comparison\n"
                analysis += f"- **Spending Level vs {age_group} Peers**: {peer_comparison:+.1f}% {'above' if peer_comparison > 0 else 'below'} average\n"
                
                if abs(peer_comparison) > 20:
                    if peer_comparison > 0:
                        analysis += f"- **Behavioral Implication**: Higher spending may indicate different priorities or lifestyle aspirations than peer group\n"
                    else:
                        analysis += f"- **Behavioral Implication**: Conservative spending suggests strong financial discipline or different value priorities\n"
            
            # Add category behavior patterns
            analysis += f"\n## Category Behavior Patterns\n"
            top_categories = sorted(category_percentages.items(), key=lambda x: x[1], reverse=True)[:3]
            
            for category, percentage in top_categories:
                behavior_type = _get_category_behavior_type(category, percentage)
                analysis += f"- **{category}**: {percentage:.1f}% - {behavior_type}\n"
            
            # Add optimization recommendations
            if optimization_recommendations:
                analysis += f"\n## 🎯 Behavioral Optimization Recommendations\n"
                for recommendation in optimization_recommendations:
                    analysis += f"{recommendation}\n"
            
            # Add behavioral monitoring suggestions
            analysis += f"\n## 📊 Behavioral Monitoring Suggestions\n"
            analysis += f"- **Weekly Review**: Track impulse purchases and emotional triggers\n"
            analysis += f"- **Monthly Assessment**: Evaluate alignment between spending and stated values\n"
            analysis += f"- **Quarterly Goals**: Set behavioral targets for spending personality development\n"
            
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_behavior_tool',
                    session_id,
                    'completed',
                    'Spending behavior analysis completed successfully!',
                    100,
                    {'executor': 'analyze_spending_behavior'}
                )
            
            return analysis.strip()
            
        except Exception as e:
            logger.error(f"Error in spending_behavior_tool: {str(e)}", exc_info=True)
            if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel:
                await tool_events_channel.send_progress(
                    'spending_behavior_tool',
                    session_id,
                    'error',
                    f'Error analyzing spending behavior: {str(e)}',
                    None,
                    {'executor': 'analyze_spending_behavior'}
                )
            return f"Error analyzing spending behavior: {str(e)}"
    
    return run_async(analyze_behavior_async())

def _determine_spending_personality(category_percentages: Dict[str, float], profile: Dict[str, Any],
                                  small_pct: float, medium_pct: float, large_pct: float) -> str:
    """Determine spending personality based on patterns"""
    lifestyle = profile.get('lifestyle_profile', '')
    
    if large_pct > 30:
        if lifestyle == 'food_enthusiast' and category_percentages.get('Dining', 0) > 20:
            return "Strategic Culinary Investor - Planned high-value food experiences"
        elif category_percentages.get('Travel', 0) > 15:
            return "Experience Maximizer - Large investments in memorable experiences"
        else:
            return "Deliberate High-Value Spender - Careful consideration for major purchases"
    
    elif small_pct > 60:
        if lifestyle == 'family_focused':
            return "Nurturing Micro-Manager - Frequent small purchases for family needs"
        else:
            return "Habitual Frequent Spender - Regular small transaction patterns"
    
    else:
        if lifestyle == 'sports_enthusiast':
            return "Balanced Active Lifestyle Spender - Mix of equipment and experience investments"
        else:
            return "Adaptive Balanced Spender - Flexible approach across transaction sizes"

def _calculate_lifestyle_alignment(category_percentages: Dict[str, float], lifestyle: str) -> float:
    """Calculate how well spending aligns with declared lifestyle"""
    alignment_score = 50  # Base score
    
    if lifestyle == 'food_enthusiast':
        dining_pct = category_percentages.get('Dining', 0)
        if dining_pct > 25:
            alignment_score += 30
        elif dining_pct > 15:
            alignment_score += 15
        elif dining_pct < 10:
            alignment_score -= 20
    
    elif lifestyle == 'family_focused':
        family_categories = ['Kids', 'Groceries', 'Healthcare']
        family_total = sum(category_percentages.get(cat, 0) for cat in family_categories)
        if family_total > 30:
            alignment_score += 30
        elif family_total > 20:
            alignment_score += 15
        elif family_total < 15:
            alignment_score -= 15
    
    elif lifestyle == 'sports_enthusiast':
        sports_pct = category_percentages.get('Sports', 0)
        if sports_pct > 15:
            alignment_score += 30
        elif sports_pct > 10:
            alignment_score += 15
        elif sports_pct < 5:
            alignment_score -= 20
    
    return max(0, min(100, alignment_score))

def _assess_risk_tolerance(category_percentages: Dict[str, float], large_pct: float, 
                         profile: Dict[str, Any]) -> Dict[str, str]:
    """Assess financial risk tolerance based on spending patterns"""
    
    discretionary_categories = ['Travel', 'Entertainment', 'Shopping', 'Dining']
    discretionary_total = sum(category_percentages.get(cat, 0) for cat in discretionary_categories)
    
    if large_pct > 25 and discretionary_total > 50:
        return {
            'level': 'High Risk Tolerance',
            'description': 'Comfortable with large discretionary purchases and financial flexibility'
        }
    elif large_pct < 15 and discretionary_total < 30:
        return {
            'level': 'Conservative Risk Profile',
            'description': 'Prefers smaller, essential purchases with financial security focus'
        }
    else:
        return {
            'level': 'Moderate Risk Tolerance',
            'description': 'Balanced approach between security and discretionary spending'
        }

def _analyze_emotional_patterns(category_percentages: Dict[str, float], amounts: List[float], 
                              lifestyle: str) -> List[str]:
    """Analyze emotional spending patterns"""
    patterns = []
    
    # Comfort spending analysis
    comfort_categories = ['Dining', 'Shopping', 'Entertainment']
    comfort_total = sum(category_percentages.get(cat, 0) for cat in comfort_categories)
    
    if comfort_total > 45:
        patterns.append("😌 **Comfort Spending Pattern**: High allocation to comfort categories suggests spending as emotional regulation")
    
    # Achievement spending
    if category_percentages.get('Travel', 0) > 20:
        patterns.append("🏆 **Achievement Reward Pattern**: High travel spending may indicate celebrating milestones or self-reward behavior")
    
    # Social connection spending
    if lifestyle == 'food_enthusiast' and category_percentages.get('Dining', 0) > 25:
        patterns.append("🤝 **Social Connection Spending**: High dining expenses suggest spending as social bonding and relationship building")
    
    return patterns

def _get_category_behavior_type(category: str, percentage: float) -> str:
    """Get behavioral interpretation for category spending"""
    
    behavior_map = {
        'Dining': {
            'high': 'Social and experiential priority',
            'medium': 'Balanced lifestyle choice',
            'low': 'Practical approach to food'
        },
        'Shopping': {
            'high': 'Material comfort and status focus',
            'medium': 'Moderate retail therapy',
            'low': 'Minimalist or practical approach'
        },
        'Travel': {
            'high': 'Experience and adventure priority',
            'medium': 'Balanced exploration mindset',
            'low': 'Homebody or budget-conscious approach'
        },
        'Sports': {
            'high': 'Health and activity investment',
            'medium': 'Recreational wellness focus',
            'low': 'Sedentary or indoor preferences'
        }
    }
    
    if category in behavior_map:
        if percentage > 25:
            return behavior_map[category]['high']
        elif percentage > 10:
            return behavior_map[category]['medium']
        else:
            return behavior_map[category]['low']
    
    return 'Standard spending pattern'
