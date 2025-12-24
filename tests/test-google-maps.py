#!/usr/bin/env python3
"""
Test script for Google Maps tools via AgentCore Gateway
Tests all 6 Google Maps tools: search_places, search_nearby_places, get_place_details,
get_directions, geocode_address, reverse_geocode
"""

import asyncio
import boto3
import json
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.tools.mcp import MCPClient
from gateway_auth import get_sigv4_auth, get_gateway_region_from_url

# AWS configuration
REGION = "us-west-2"
PROJECT_NAME = "strands-agent-chatbot"
ENVIRONMENT = "dev"

def get_gateway_url():
    """Retrieve Gateway URL from SSM Parameter Store"""
    ssm = boto3.client('ssm', region_name=REGION)
    try:
        response = ssm.get_parameter(
            Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/mcp/gateway-url'
        )
        return response['Parameter']['Value']
    except Exception as e:
        print(f"❌ Failed to get Gateway URL from Parameter Store: {e}")
        return None

async def test_list_google_maps_tools():
    """Test 1: List all Google Maps tools"""
    gateway_url = get_gateway_url()
    if not gateway_url:
        return None

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📋 Test 1: Listing Google Maps Tools")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()

            # Filter Google Maps tools
            google_maps_tools = [
                t for t in tools
                if any(keyword in t.tool_name.lower() for keyword in
                       ['place', 'direction', 'geocode'])
            ]

            print(f"✅ Found {len(google_maps_tools)} Google Maps tools:")
            for tool in google_maps_tools:
                desc = getattr(tool, 'tool_description', 'No description')
                print(f"   • {tool.tool_name}")
                print(f"     {desc}")
            print()

            return gateway_client, google_maps_tools

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None, None

async def test_search_places():
    """Test 2: Search for places (restaurants in Seoul)"""
    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🍽️  Test 2: Search Places - New York Restaurants")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]

            # Find search_places tool
            search_tool = next((name for name in tool_names if 'search_places' in name.lower() and 'nearby' not in name.lower()), None)

            if not search_tool:
                print("❌ search_places tool not found")
                return None

            print(f"📞 Calling {search_tool}...")
            print(f"   Query: 'Italian restaurant in New York Manhattan'")
            print()

            result = gateway_client.call_tool_sync(
                tool_use_id="test-search-001",
                name=search_tool,
                arguments={
                    "query": "Italian restaurant in New York Manhattan",
                    "language": "en"
                }
            )

            print("✅ Search Results:")
            print(f"   Status: {result['status']}")

            if result['content'] and len(result['content']) > 0:
                content = result['content'][0]['text']
                try:
                    data = json.loads(content)
                    print(f"   Found: {data.get('results_count', 0)} places")

                    # Show first 3 places
                    places = data.get('places', [])[:3]
                    for place in places:
                        print(f"   • {place.get('name')} ({place.get('rating', 'N/A')}⭐)")
                        print(f"     {place.get('address', 'No address')}")

                    # Return first place_id for next test
                    if places:
                        return places[0].get('place_id')
                except json.JSONDecodeError:
                    print(f"   Content: {content[:300]}...")
            print()
            return None

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

async def test_get_place_details(place_id):
    """Test 3: Get detailed place information including reviews"""
    if not place_id:
        print("⚠️  Skipping place details test (no place_id from previous test)")
        return

    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🔍 Test 3: Get Place Details + Reviews")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]

            # Find get_place_details tool
            details_tool = next((name for name in tool_names if 'place_details' in name.lower()), None)

            if not details_tool:
                print("❌ get_place_details tool not found")
                return

            print(f"📞 Calling {details_tool}...")
            print(f"   Place ID: {place_id}")
            print()

            result = gateway_client.call_tool_sync(
                tool_use_id="test-details-001",
                name=details_tool,
                arguments={
                    "place_id": place_id,
                    "language": "en"
                }
            )

            print("✅ Place Details:")
            print(f"   Status: {result['status']}")

            if result['content'] and len(result['content']) > 0:
                content = result['content'][0]['text']
                try:
                    data = json.loads(content)
                    print(f"   Name: {data.get('name', 'N/A')}")
                    print(f"   Address: {data.get('formatted_address', 'N/A')}")
                    print(f"   Phone: {data.get('formatted_phone_number', 'N/A')}")
                    print(f"   Rating: {data.get('rating', 'N/A')} ({data.get('user_ratings_total', 0)} reviews)")
                    print(f"   Website: {data.get('website', 'N/A')}")

                    # Show opening hours
                    opening_hours = data.get('opening_hours')
                    if opening_hours:
                        print(f"   Open Now: {opening_hours.get('open_now', 'N/A')}")

                    # Show first 2 reviews
                    reviews = data.get('reviews', [])[:2]
                    if reviews:
                        print(f"\n   📝 Recent Reviews:")
                        for review in reviews:
                            print(f"   • {review.get('author_name')} ({review.get('rating')}⭐)")
                            print(f"     {review.get('text', '')[:100]}...")

                except json.JSONDecodeError:
                    print(f"   Content: {content[:300]}...")
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_get_directions():
    """Test 4: Get directions between two locations"""
    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🗺️  Test 4: Get Directions (Times Square -> Central Park)")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]

            # Find get_directions tool
            directions_tool = next((name for name in tool_names if 'directions' in name.lower()), None)

            if not directions_tool:
                print("❌ get_directions tool not found")
                return

            print(f"📞 Calling {directions_tool}...")
            print(f"   From: Times Square, New York")
            print(f"   To: Central Park, New York")
            print(f"   Mode: transit")
            print()

            result = gateway_client.call_tool_sync(
                tool_use_id="test-directions-001",
                name=directions_tool,
                arguments={
                    "origin": "Times Square, New York, NY",
                    "destination": "Central Park, New York, NY",
                    "mode": "transit",
                    "language": "en"
                }
            )

            print("✅ Directions:")
            print(f"   Status: {result['status']}")

            if result['content'] and len(result['content']) > 0:
                content = result['content'][0]['text']
                try:
                    data = json.loads(content)
                    routes = data.get('routes', [])
                    if routes:
                        route = routes[0]
                        print(f"   Distance: {route.get('distance', 'N/A')}")
                        print(f"   Duration: {route.get('duration', 'N/A')}")
                        print(f"   Summary: {route.get('summary', 'N/A')}")

                        # Show first 3 steps
                        steps = route.get('steps', [])[:3]
                        if steps:
                            print(f"\n   📍 First 3 Steps:")
                            for i, step in enumerate(steps, 1):
                                print(f"   {i}. {step.get('instructions', 'N/A')}")
                                print(f"      {step.get('distance', 'N/A')} - {step.get('duration', 'N/A')}")

                except json.JSONDecodeError:
                    print(f"   Content: {content[:300]}...")
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_geocode_address():
    """Test 5: Convert address to coordinates"""
    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📍 Test 5: Geocode Address -> Coordinates")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]

            # Find geocode_address tool
            geocode_tool = next((name for name in tool_names if 'geocode_address' in name.lower()), None)

            if not geocode_tool:
                print("❌ geocode_address tool not found")
                return None

            print(f"📞 Calling {geocode_tool}...")
            print(f"   Address: 1600 Amphitheatre Parkway, Mountain View, CA")
            print()

            result = gateway_client.call_tool_sync(
                tool_use_id="test-geocode-001",
                name=geocode_tool,
                arguments={
                    "address": "1600 Amphitheatre Parkway, Mountain View, CA",
                    "language": "en"
                }
            )

            print("✅ Geocoding Result:")
            print(f"   Status: {result['status']}")

            coordinates = None
            if result['content'] and len(result['content']) > 0:
                content = result['content'][0]['text']
                try:
                    data = json.loads(content)
                    locations = data.get('locations', [])
                    if locations:
                        location = locations[0]
                        coords = location.get('location', {})
                        print(f"   Address: {location.get('formatted_address', 'N/A')}")
                        print(f"   Latitude: {coords.get('lat', 'N/A')}")
                        print(f"   Longitude: {coords.get('lng', 'N/A')}")
                        coordinates = f"{coords.get('lat')},{coords.get('lng')}"

                except json.JSONDecodeError:
                    print(f"   Content: {content[:300]}...")
            print()
            return coordinates

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None

async def test_reverse_geocode(latlng):
    """Test 6: Convert coordinates to address"""
    if not latlng:
        # Use Google Headquarters coordinates as default
        latlng = "37.4220,-122.0841"
        print("⚠️  Using default coordinates (Google Headquarters)")

    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📍 Test 6: Reverse Geocode (Coordinates -> Address)")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        )
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            tool_names = [t.tool_name for t in tools]

            # Find reverse_geocode tool
            reverse_tool = next((name for name in tool_names if 'reverse_geocode' in name.lower()), None)

            if not reverse_tool:
                print("❌ reverse_geocode tool not found")
                return

            print(f"📞 Calling {reverse_tool}...")
            print(f"   Coordinates: {latlng}")
            print()

            result = gateway_client.call_tool_sync(
                tool_use_id="test-reverse-001",
                name=reverse_tool,
                arguments={
                    "latlng": latlng,
                    "language": "en"
                }
            )

            print("✅ Reverse Geocoding Result:")
            print(f"   Status: {result['status']}")

            if result['content'] and len(result['content']) > 0:
                content = result['content'][0]['text']
                try:
                    data = json.loads(content)
                    addresses = data.get('addresses', [])
                    if addresses:
                        # Show first 2 addresses
                        for i, addr in enumerate(addresses[:2], 1):
                            print(f"   {i}. {addr.get('formatted_address', 'N/A')}")

                except json.JSONDecodeError:
                    print(f"   Content: {content[:300]}...")
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

async def test_agent_with_google_maps():
    """Test 7: Use Agent with Google Maps tools for complex query"""
    gateway_url = get_gateway_url()
    if not gateway_url:
        return

    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🤖 Test 7: Agent with Google Maps Tools")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            gateway_url,
            auth=auth
        ),
        prefix="gateway"
    )

    try:
        with gateway_client:
            tools = gateway_client.list_tools_sync()
            agent = Agent(
                tools=tools,
                model="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
            )

            print("🎯 Query: Find Italian restaurants in New York Manhattan, get details of the top-rated one")
            print()

            response = agent(
                "Find Italian restaurants in New York Manhattan area. "
                "Then get detailed information including reviews for the highest rated one."
            )

            print("✅ Agent Response:")
            print(response.message['content'][0]['text'])
            print()

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Run all Google Maps tests"""
    print()
    print("╔═══════════════════════════════════════════════════════╗")
    print("║   Google Maps API Test Suite via AgentCore Gateway   ║")
    print("╚═══════════════════════════════════════════════════════╝")
    print()

    # Run tests sequentially
    asyncio.run(test_list_google_maps_tools())

    # Test 2: Search places (returns place_id)
    place_id = asyncio.run(test_search_places())

    # Test 3: Get place details (uses place_id from Test 2)
    asyncio.run(test_get_place_details(place_id))

    # Test 4: Get directions
    asyncio.run(test_get_directions())

    # Test 5: Geocode (returns coordinates)
    coordinates = asyncio.run(test_geocode_address())

    # Test 6: Reverse geocode (uses coordinates from Test 5)
    asyncio.run(test_reverse_geocode(coordinates))

    # Test 7: Agent with complex query
    asyncio.run(test_agent_with_google_maps())

    print()
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ All Google Maps tests completed!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print()

if __name__ == "__main__":
    main()
