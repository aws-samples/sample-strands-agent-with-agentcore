/**
 * Gateway Target Stack for AgentCore Gateway
 * Creates Gateway Targets that connect Lambda functions to the Gateway
 * Total: 20 tools across 7 Lambda functions
 */
import * as cdk from 'aws-cdk-lib'
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'

export interface GatewayTargetStackProps extends cdk.StackProps {
  gateway: agentcore.CfnGateway
  functions: Map<string, lambda.Function>
}

export class GatewayTargetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GatewayTargetStackProps) {
    super(scope, id, props)

    const { gateway, functions } = props

    // ============================================================
    // Tavily Targets (2 tools)
    // ============================================================

    const tavilyFn = functions.get('tavily')!

    new agentcore.CfnGatewayTarget(this, 'TavilySearchTarget', {
      name: 'tavily-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Tavily AI-powered web search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: tavilyFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'tavily_search',
                  description:
                    'AI-powered web search using Tavily. Returns up to 5 high-quality results with relevance scores.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                    required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query',
                      },
                      search_depth: {
                        type: 'string',
                        description: "Search depth: 'basic' or 'advanced' (default: basic)",
                      },
                      topic: {
                        type: 'string',
                        description: "Search topic: 'general' or 'news' (default: general)",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'TavilyExtractTarget', {
      name: 'tavily-extract',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Tavily content extraction from URLs',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: tavilyFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'tavily_extract',
                  description:
                    'Extract clean content from web URLs using Tavily. Removes ads and boilerplate.',
                  inputSchema: {
                    type: 'object',
                    description: 'Extraction parameters',
                        required: ['urls'],
                    properties: {
                      urls: {
                        type: 'string',
                        description: 'Comma-separated URLs to extract content from',
                      },
                      extract_depth: {
                        type: 'string',
                        description: "Extraction depth: 'basic' or 'advanced' (default: basic)",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Wikipedia Targets (2 tools)
    // ============================================================

    const wikipediaFn = functions.get('wikipedia')!

    new agentcore.CfnGatewayTarget(this, 'WikipediaSearchTarget', {
      name: 'wikipedia-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Wikipedia article search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: wikipediaFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'wikipedia_search',
                  description:
                    'Search Wikipedia for articles. Returns up to 5 results with titles, snippets, and URLs.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query for Wikipedia articles',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'WikipediaGetArticleTarget', {
      name: 'wikipedia-get-article',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Wikipedia article retrieval',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: wikipediaFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'wikipedia_get_article',
                  description: 'Get full content of a specific Wikipedia article by title.',
                  inputSchema: {
                    type: 'object',
                    description: 'Article retrieval parameters',
                        required: ['title'],
                    properties: {
                      title: {
                        type: 'string',
                        description: 'Exact title of the Wikipedia article',
                      },
                      summary_only: {
                        type: 'boolean',
                        description:
                          'If true, return only summary; if false, return full text (default: false)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // ArXiv Targets (2 tools)
    // ============================================================

    const arxivFn = functions.get('arxiv')!

    new agentcore.CfnGatewayTarget(this, 'ArxivSearchTarget', {
      name: 'arxiv-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'ArXiv paper search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: arxivFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'arxiv_search',
                  description:
                    'Search for scientific papers on ArXiv. Returns up to 5 results with title, authors, abstract, and paper ID.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query for ArXiv papers',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ArxivGetPaperTarget', {
      name: 'arxiv-get-paper',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'ArXiv paper retrieval',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: arxivFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'arxiv_get_paper',
                  description:
                    "Get full paper content from ArXiv by paper ID. Supports batch retrieval with comma-separated IDs.",
                  inputSchema: {
                    type: 'object',
                    description: 'Paper retrieval parameters',
                        required: ['paper_ids'],
                    properties: {
                      paper_ids: {
                        type: 'string',
                        description:
                          "ArXiv paper ID or comma-separated IDs (e.g., '2308.08155' or '2308.08155,2401.12345')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Google Search Targets (1 tool - web search includes images)
    // ============================================================

    const googleFn = functions.get('google-search')!

    new agentcore.CfnGatewayTarget(this, 'GoogleWebSearchTarget', {
      name: 'google-web-search',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google web search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'google_web_search',
                  description:
                    'Search the web using Google Custom Search API. Returns up to 5 high-quality results.',
                  inputSchema: {
                    type: 'object',
                    description: 'Search parameters',
                        required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: 'Search query string',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Finance Targets (4 tools)
    // ============================================================

    const financeFn = functions.get('finance')!

    new agentcore.CfnGatewayTarget(this, 'StockQuoteTarget', {
      name: 'stock-quote',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock quote data',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_quote',
                  description:
                    'Get current stock quote with price, change, volume, and key metrics.',
                  inputSchema: {
                    type: 'object',
                    description: 'Stock quote parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'StockHistoryTarget', {
      name: 'stock-history',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock historical data',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_history',
                  description:
                    'Get historical stock price data (OHLCV) over a specified time period.',
                  inputSchema: {
                    type: 'object',
                    description: 'Historical data parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                      period: {
                        type: 'string',
                        description:
                          'Time period: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max (default: 1mo)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'FinancialNewsTarget', {
      name: 'financial-news',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Financial news articles',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'financial_news',
                  description: 'Get latest financial news articles for a stock symbol.',
                  inputSchema: {
                    type: 'object',
                    description: 'News parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                      count: {
                        type: 'integer',
                        description: 'Number of news articles to return (1-20, default: 5)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'StockAnalysisTarget', {
      name: 'stock-analysis',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Stock analysis and metrics',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: financeFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'stock_analysis',
                  description:
                    'Get comprehensive stock analysis including valuation metrics, financial metrics, and analyst recommendations.',
                  inputSchema: {
                    type: 'object',
                    description: 'Analysis parameters',
                        required: ['symbol'],
                    properties: {
                      symbol: {
                        type: 'string',
                        description: 'Stock ticker symbol (e.g., AAPL, MSFT, TSLA)',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Google Maps Targets (6 tools)
    // ============================================================

    const googleMapsFn = functions.get('google-maps')!

    new agentcore.CfnGatewayTarget(this, 'SearchPlacesTarget', {
      name: 'search-places',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps place search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'search_places',
                  description:
                    "Search for places using text query like 'restaurants in Manhattan' or 'hotels near Times Square'. Returns up to 10 results with place_id, name, ratings, address, and location coordinates. Use place_id with get_place_details for reviews and contact info.",
                  inputSchema: {
                    type: 'object',
                    description: 'Place search parameters',
                    required: ['query'],
                    properties: {
                      query: {
                        type: 'string',
                        description: "Search query (e.g., 'Italian restaurant in SoHo' or 'coffee shops near Central Park')",
                      },
                      location: {
                        type: 'string',
                        description: "Optional: Center location as 'lat,lng' to bias results",
                      },
                      radius: {
                        type: 'integer',
                        description: 'Optional: Search radius in meters (max 50000)',
                      },
                      type: {
                        type: 'string',
                        description:
                          "Optional: Place type (e.g., 'restaurant', 'tourist_attraction', 'lodging')",
                      },
                      open_now: {
                        type: 'boolean',
                        description: 'Optional: Only return places that are open now',
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'SearchNearbyPlacesTarget', {
      name: 'search-nearby-places',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps nearby search',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'search_nearby_places',
                  description:
                    "Search for places within radius of coordinates. Requires location (lat,lng) and radius in meters. Use for 'nearby' or 'closest' queries when you have exact coordinates. Returns up to 10 results with place details.",
                  inputSchema: {
                    type: 'object',
                    description: 'Nearby search parameters',
                    required: ['location'],
                    properties: {
                      location: {
                        type: 'string',
                        description: "Center location as 'lat,lng' (e.g., '40.7580,-73.9855' for Times Square)",
                      },
                      radius: {
                        type: 'integer',
                        description: 'Search radius in meters (max 50000)',
                      },
                      keyword: {
                        type: 'string',
                        description: 'Optional: Search keyword',
                      },
                      type: {
                        type: 'string',
                        description: "Optional: Place type (e.g., 'cafe', 'restaurant')",
                      },
                      rank_by: {
                        type: 'string',
                        description: "Optional: 'prominence' (default) or 'distance'",
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'GetPlaceDetailsTarget', {
      name: 'get-place-details',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps place details',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'get_place_details',
                  description:
                    "Get detailed info about a place using place_id from search results. Returns address, phone, website, opening hours, up to 5 reviews, and photos count. Use when user wants reviews, contact information, or operating hours.",
                  inputSchema: {
                    type: 'object',
                    description: 'Place details parameters',
                    required: ['place_id'],
                    properties: {
                      place_id: {
                        type: 'string',
                        description: 'Place ID from search results',
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                      reviews_sort: {
                        type: 'string',
                        description: "Optional: 'most_relevant' (default) or 'newest'",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'GetDirectionsTarget', {
      name: 'get-directions',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps directions',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'get_directions',
                  description:
                    "Get turn-by-turn directions between two locations. Supports 4 modes: driving, walking, bicycling, transit. Returns distance, duration, and step-by-step instructions. Can avoid tolls/highways/ferries and provide alternative routes.",
                  inputSchema: {
                    type: 'object',
                    description: 'Directions parameters',
                    required: ['origin', 'destination'],
                    properties: {
                      origin: {
                        type: 'string',
                        description: "Starting point (address or 'lat,lng')",
                      },
                      destination: {
                        type: 'string',
                        description: "Destination (address or 'lat,lng')",
                      },
                      mode: {
                        type: 'string',
                        description:
                          "Optional: Travel mode - 'driving' (car, default), 'walking' (pedestrian), 'bicycling' (bike), 'transit' (bus/subway). Choose based on user's transportation method.",
                      },
                      alternatives: {
                        type: 'boolean',
                        description: 'Optional: Return alternative routes',
                      },
                      avoid: {
                        type: 'string',
                        description: "Optional: 'tolls', 'highways', 'ferries'",
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'GeocodeAddressTarget', {
      name: 'geocode-address',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps geocoding',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'geocode_address',
                  description:
                    "Convert address to coordinates (lat, lng). Returns formatted address, coordinates, place_id, and location_type. Use when you need coordinates for nearby search or mapping. Can return multiple results if address is ambiguous.",
                  inputSchema: {
                    type: 'object',
                    description: 'Geocoding parameters',
                    required: ['address'],
                    properties: {
                      address: {
                        type: 'string',
                        description: "Address to geocode (e.g., '1600 Amphitheatre Parkway, Mountain View, CA' or '350 5th Ave, New York, NY')",
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                      region: {
                        type: 'string',
                        description: "Optional: Country code for result bias (e.g., 'us', 'kr', 'jp'). Helps disambiguate addresses.",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ReverseGeocodeTarget', {
      name: 'reverse-geocode',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Google Maps reverse geocoding',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'reverse_geocode',
                  description:
                    "Convert coordinates to address. Input format: 'lat,lng' (e.g., '40.7580,-73.9855'). Returns multiple address formats from specific (street) to general (city, country). Use when you have coordinates and need the address.",
                  inputSchema: {
                    type: 'object',
                    description: 'Reverse geocoding parameters',
                    required: ['latlng'],
                    properties: {
                      latlng: {
                        type: 'string',
                        description: "Coordinates as 'lat,lng' (e.g., '40.7580,-73.9855' for Times Square)",
                      },
                      language: {
                        type: 'string',
                        description: "Optional: Language code (default: 'en')",
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'ShowOnMapTarget', {
      name: 'show-on-map',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Display locations and routes on interactive Google Map',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: googleMapsFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'show_on_map',
                  description:
                    'Display locations, routes, or areas on an interactive Google Map. Use after collecting location data from search or directions. Show 1-5 most relevant places per map.',
                  inputSchema: {
                    type: 'object',
                    description: 'Map visualization parameters',
                    required: ['map_type'],
                    properties: {
                      map_type: {
                        type: 'string',
                        description: 'Type of map: "markers" (location pins), "directions" (route), or "area" (region). Must be one of: markers, directions, area',
                      },
                      markers: {
                        type: 'array',
                        description: 'List of location markers (required for map_type="markers")',
                        items: {
                          type: 'object',
                          required: ['lat', 'lng'],
                          properties: {
                            lat: { type: 'number', description: 'Latitude' },
                            lng: { type: 'number', description: 'Longitude' },
                            title: { type: 'string', description: 'Marker title' },
                            description: { type: 'string', description: 'Marker description' },
                            label: { type: 'string', description: 'Single character label (A-Z)' },
                            place_id: { type: 'string', description: 'Google place_id for linking' },
                          },
                        },
                      },
                      directions: {
                        type: 'object',
                        description: 'Route data (required for map_type="directions")',
                        properties: {
                          origin: {
                            type: 'object',
                            required: ['lat', 'lng'],
                            properties: {
                              lat: { type: 'number' },
                              lng: { type: 'number' },
                              address: { type: 'string' },
                            },
                          },
                          destination: {
                            type: 'object',
                            required: ['lat', 'lng'],
                            properties: {
                              lat: { type: 'number' },
                              lng: { type: 'number' },
                              address: { type: 'string' },
                            },
                          },
                          polyline: { type: 'string', description: 'Encoded polyline from get_directions' },
                          mode: { type: 'string', description: 'Travel mode' },
                          distance: { type: 'string', description: 'Distance text' },
                          duration: { type: 'string', description: 'Duration text' },
                        },
                      },
                      center: {
                        type: 'object',
                        description: 'Map center {lat, lng}. Auto-calculated if omitted.',
                        properties: {
                          lat: { type: 'number' },
                          lng: { type: 'number' },
                        },
                      },
                      zoom: {
                        type: 'number',
                        description: 'Zoom level 1-20 (1=World, 20=Buildings). Auto-calculated if omitted. Valid range: 1-20',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Weather Targets (2 tools)
    // ============================================================

    const weatherFn = functions.get('weather')!

    new agentcore.CfnGatewayTarget(this, 'GetTodayWeatherTarget', {
      name: 'get-today-weather',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: "Get today's weather with current conditions and hourly forecast",

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: weatherFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'get_today_weather',
                  description:
                    "Get today's weather with current conditions and hourly forecast (24 hours). Includes temperature, humidity, wind, precipitation, and weather conditions. Powered by Open-Meteo API (worldwide coverage).",
                  inputSchema: {
                    type: 'object',
                    description: 'Weather query parameters',
                    required: ['city_name'],
                    properties: {
                      city_name: {
                        type: 'string',
                        description: 'City name (e.g., "Seoul", "New York", "London")',
                      },
                      country: {
                        type: 'string',
                        description: 'Optional: Country name for disambiguation (e.g., "South Korea", "USA")',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    new agentcore.CfnGatewayTarget(this, 'GetWeatherForecastTarget', {
      name: 'get-weather-forecast',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      description: 'Get multi-day weather forecast (up to 16 days)',

      credentialProviderConfigurations: [
        {
          credentialProviderType: 'GATEWAY_IAM_ROLE',
        },
      ],

      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: weatherFn.functionArn,
            toolSchema: {
              inlinePayload: [
                {
                  name: 'get_weather_forecast',
                  description:
                    'Get multi-day weather forecast with daily max/min temperatures, precipitation, sunrise/sunset. Supports 1-16 days forecast. Powered by Open-Meteo API (worldwide coverage).',
                  inputSchema: {
                    type: 'object',
                    description: 'Forecast parameters',
                    required: ['city_name'],
                    properties: {
                      city_name: {
                        type: 'string',
                        description: 'City name (e.g., "Tokyo", "Paris", "Sydney")',
                      },
                      days: {
                        type: 'number',
                        description: 'Number of forecast days (1-16, default: 7)',
                      },
                      country: {
                        type: 'string',
                        description: 'Optional: Country name for disambiguation',
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    })

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'TotalTargets', {
      value: '21',
      description: 'Total number of Gateway Targets (tools)',
    })

    new cdk.CfnOutput(this, 'TargetsSummary', {
      value: 'Tavily (2), Wikipedia (2), ArXiv (2), Google Search (2), Finance (4), Google Maps (7), Weather (2)',
      description: 'Gateway Targets by category',
    })
  }
}
