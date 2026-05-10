#!/usr/bin/env python3
"""
Local test script for weather Lambda function
"""
import json
from lambda_function import lambda_handler


class MockContext:
    """Mock Lambda context for testing"""
    def __init__(self, tool_name):
        self.client_context = MockClientContext(tool_name)


class MockClientContext:
    """Mock client context"""
    def __init__(self, tool_name):
        self.custom = {'bedrockAgentCoreToolName': f'gateway_weather___{tool_name}'}


def test_get_today_weather():
    """Test get_today_weather tool"""
    print("\n" + "="*60)
    print("Testing get_today_weather")
    print("="*60)

    event = {
        "city_name": "Seoul"
    }

    context = MockContext('get_today_weather')
    result = lambda_handler(event, context)

    # Print summary instead of full result to avoid logging sensitive data
    if 'error' not in result:
        print(f"✅ Success: {result.get('location', {}).get('name')} - {result.get('current_weather', {}).get('temperature')}°C")
        print("\n✅ Test passed!")
    else:
        print(f"❌ Error: {result.get('error')}")
        print("\n❌ Test failed!")

    return result


def test_get_weather_forecast():
    """Test get_weather_forecast tool"""
    print("\n" + "="*60)
    print("Testing get_weather_forecast")
    print("="*60)

    event = {
        "city_name": "Tokyo",
        "days": 7
    }

    context = MockContext('get_weather_forecast')
    result = lambda_handler(event, context)

    # Print summary instead of full result to avoid logging sensitive data
    if 'error' not in result:
        forecast = result.get('forecast', [])
        print(f"✅ Success: {result.get('location', {}).get('name')} - {len(forecast)} days forecast")
        print("\n✅ Test passed!")
    else:
        print(f"❌ Error: {result.get('error')}")
        print("\n❌ Test failed!")

    return result


def test_multiple_cities():
    """Test with multiple cities"""
    print("\n" + "="*60)
    print("Testing multiple cities")
    print("="*60)

    cities = ["New York", "London", "Sydney", "Paris"]

    for city in cities:
        print(f"\n--- Testing {city} ---")
        event = {"city_name": city}
        context = MockContext('get_today_weather')
        result = lambda_handler(event, context)

        if 'error' not in result:
            location = result.get('location', {})
            current = result.get('current_weather', {})
            print(f"✅ {location.get('name')}, {location.get('country')}: "
                  f"{current.get('temperature')}°C, {current.get('weather_description')}")
        else:
            print(f"❌ Error: {result.get('error')}")


if __name__ == '__main__':
    print("="*60)
    print("Weather Lambda Function - Local Tests")
    print("="*60)

    # Test 1: Today's weather
    test_get_today_weather()

    # Test 2: Weather forecast
    test_get_weather_forecast()

    # Test 3: Multiple cities
    test_multiple_cities()

    print("\n" + "="*60)
    print("All tests completed!")
    print("="*60)
