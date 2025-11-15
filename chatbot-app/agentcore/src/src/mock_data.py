# Mock data for credit analysis
MOCK_CUSTOMERS = {
    "CUST_001": {
        "customer_id": "CUST_001",
        "first_name": "John",
        "last_name": "Smith",
        "credit_score": 720,
        "total_credit_limit": 50000.00,
        "total_credit_used": 12000.00,
        "credit_utilization_ratio": 0.24,
        "payment_history_score": 0.95,
        "active_cards": 3,
        "credit_health_status": "Good",
        "improvement_potential": 30
    },
    "CUST_002": {
        "customer_id": "CUST_002", 
        "first_name": "Sarah",
        "last_name": "Johnson",
        "credit_score": 680,
        "total_credit_limit": 35000.00,
        "total_credit_used": 18000.00,
        "credit_utilization_ratio": 0.51,
        "payment_history_score": 0.88,
        "active_cards": 2,
        "credit_health_status": "Fair",
        "improvement_potential": 50
    },
    "CUST_003": {
        "customer_id": "CUST_003",
        "first_name": "Michael",
        "last_name": "Brown",
        "credit_score": 780,
        "total_credit_limit": 75000.00,
        "total_credit_used": 6000.00,
        "credit_utilization_ratio": 0.08,
        "payment_history_score": 0.98,
        "active_cards": 4,
        "credit_health_status": "Excellent",
        "improvement_potential": 10
    }
}

MOCK_CREDIT_CARDS = {
    "CUST_001": [
        {
            "card_id": "CARD_001",
            "card_name": "Premium Rewards Card",
            "credit_limit": 25000.00,
            "current_balance": 8000.00,
            "tier": "Premium",
            "apr": 18.99,
            "card_status": "Active"
        },
        {
            "card_id": "CARD_002", 
            "card_name": "Cashback Plus Card",
            "credit_limit": 15000.00,
            "current_balance": 3000.00,
            "tier": "Standard",
            "apr": 21.99,
            "card_status": "Active"
        },
        {
            "card_id": "CARD_003",
            "card_name": "Travel Elite Card", 
            "credit_limit": 10000.00,
            "current_balance": 1000.00,
            "tier": "Elite",
            "apr": 16.99,
            "card_status": "Active"
        }
    ],
    "CUST_002": [
        {
            "card_id": "CARD_004",
            "card_name": "Basic Credit Card",
            "credit_limit": 20000.00,
            "current_balance": 12000.00,
            "tier": "Basic",
            "apr": 24.99,
            "card_status": "Active"
        },
        {
            "card_id": "CARD_005",
            "card_name": "Student Card",
            "credit_limit": 15000.00,
            "current_balance": 6000.00,
            "tier": "Student",
            "apr": 19.99,
            "card_status": "Active"
        }
    ],
    "CUST_003": [
        {
            "card_id": "CARD_006",
            "card_name": "Platinum Elite Card",
            "credit_limit": 40000.00,
            "current_balance": 2000.00,
            "tier": "Platinum",
            "apr": 14.99,
            "card_status": "Active"
        },
        {
            "card_id": "CARD_007",
            "card_name": "Business Premium Card",
            "credit_limit": 25000.00,
            "current_balance": 3000.00,
            "tier": "Business",
            "apr": 16.99,
            "card_status": "Active"
        },
        {
            "card_id": "CARD_008",
            "card_name": "Rewards Mastercard",
            "credit_limit": 10000.00,
            "current_balance": 1000.00,
            "tier": "Premium",
            "apr": 17.99,
            "card_status": "Active"
        }
    ]
}

MOCK_TRANSACTIONS = {
    "CUST_001": [
        {"transaction_id": "TXN_001", "transaction_date": "2025-07-28", "amount": 2800.00, "category": "Travel", "merchant": "Delta Airlines", "card_id": "CARD_003"},
        {"transaction_id": "TXN_002", "transaction_date": "2025-07-27", "amount": 450.00, "category": "Dining", "merchant": "Michelin Star Restaurant Le Bernardin", "card_id": "CARD_001"},
        {"transaction_id": "TXN_003", "transaction_date": "2025-07-25", "amount": 320.00, "category": "Accommodation", "merchant": "Marriott Hotel NYC", "card_id": "CARD_003"},
        {"transaction_id": "TXN_004", "transaction_date": "2025-07-24", "amount": 180.00, "category": "Dining", "merchant": "Nobu Downtown", "card_id": "CARD_001"},
        {"transaction_id": "TXN_005", "transaction_date": "2025-07-22", "amount": 95.00, "category": "Dining", "merchant": "Joe's Pizza Brooklyn", "card_id": "CARD_002"},
        {"transaction_id": "TXN_006", "transaction_date": "2025-07-20", "amount": 67.50, "category": "Gas", "merchant": "Shell Station", "card_id": "CARD_002"},
        {"transaction_id": "TXN_007", "transaction_date": "2025-07-18", "amount": 220.00, "category": "Dining", "merchant": "Katz's Delicatessen", "card_id": "CARD_001"},
        {"transaction_id": "TXN_008", "transaction_date": "2025-07-15", "amount": 1200.00, "category": "Shopping", "merchant": "Camera Equipment Store", "card_id": "CARD_001"},
        {"transaction_id": "TXN_009", "transaction_date": "2025-07-12", "amount": 89.99, "category": "Groceries", "merchant": "Whole Foods Market", "card_id": "CARD_002"},
        {"transaction_id": "TXN_010", "transaction_date": "2025-07-10", "amount": 340.00, "category": "Dining", "merchant": "Eleven Madison Park", "card_id": "CARD_001"},
        {"transaction_id": "TXN_011", "transaction_date": "2025-06-30", "amount": 1800.00, "category": "Travel", "merchant": "United Airlines", "card_id": "CARD_003"},
        {"transaction_id": "TXN_012", "transaction_date": "2025-06-28", "amount": 520.00, "category": "Accommodation", "merchant": "Four Seasons Miami", "card_id": "CARD_003"},
        {"transaction_id": "TXN_013", "transaction_date": "2025-06-27", "amount": 280.00, "category": "Dining", "merchant": "Joe's Stone Crab Miami", "card_id": "CARD_001"},
        {"transaction_id": "TXN_014", "transaction_date": "2025-06-25", "amount": 150.00, "category": "Dining", "merchant": "Versailles Restaurant", "card_id": "CARD_001"},
        {"transaction_id": "TXN_015", "transaction_date": "2025-06-23", "amount": 75.00, "category": "Gas", "merchant": "BP Gas Station", "card_id": "CARD_002"},
        {"transaction_id": "TXN_016", "transaction_date": "2025-06-20", "amount": 420.00, "category": "Dining", "merchant": "The French Laundry", "card_id": "CARD_001"},
        {"transaction_id": "TXN_017", "transaction_date": "2025-06-18", "amount": 95.00, "category": "Groceries", "merchant": "Dean & DeLuca", "card_id": "CARD_002"},
        {"transaction_id": "TXN_018", "transaction_date": "2025-06-15", "amount": 380.00, "category": "Entertainment", "merchant": "Broadway Show Tickets", "card_id": "CARD_001"},
        {"transaction_id": "TXN_019", "transaction_date": "2025-06-12", "amount": 160.00, "category": "Dining", "merchant": "Peter Luger Steak House", "card_id": "CARD_001"},
        {"transaction_id": "TXN_020", "transaction_date": "2025-06-10", "amount": 890.00, "category": "Shopping", "merchant": "Travel Gear Outfitters", "card_id": "CARD_001"},
        {"transaction_id": "TXN_021", "transaction_date": "2025-05-28", "amount": 2200.00, "category": "Travel", "merchant": "American Airlines", "card_id": "CARD_003"},
        {"transaction_id": "TXN_022", "transaction_date": "2025-05-26", "amount": 380.00, "category": "Accommodation", "merchant": "Ritz Carlton San Francisco", "card_id": "CARD_003"},
        {"transaction_id": "TXN_023", "transaction_date": "2025-05-25", "amount": 320.00, "category": "Dining", "merchant": "Atelier Crenn", "card_id": "CARD_001"},
        {"transaction_id": "TXN_024", "transaction_date": "2025-05-23", "amount": 180.00, "category": "Dining", "merchant": "Swan Oyster Depot", "card_id": "CARD_001"},
        {"transaction_id": "TXN_025", "transaction_date": "2025-05-20", "amount": 95.00, "category": "Dining", "merchant": "In-N-Out Burger", "card_id": "CARD_002"},
        {"transaction_id": "TXN_026", "transaction_date": "2025-05-18", "amount": 67.50, "category": "Gas", "merchant": "Chevron Station", "card_id": "CARD_002"},
        {"transaction_id": "TXN_027", "transaction_date": "2025-05-15", "amount": 240.00, "category": "Dining", "merchant": "Gary Danko", "card_id": "CARD_001"},
        {"transaction_id": "TXN_028", "transaction_date": "2025-05-12", "amount": 120.00, "category": "Groceries", "merchant": "Ferry Building Marketplace", "card_id": "CARD_002"},
        {"transaction_id": "TXN_029", "transaction_date": "2025-05-10", "amount": 450.00, "category": "Entertainment", "merchant": "Wine Tasting Tour Napa", "card_id": "CARD_001"},
        {"transaction_id": "TXN_030", "transaction_date": "2025-05-08", "amount": 680.00, "category": "Shopping", "merchant": "REI Outdoor Gear", "card_id": "CARD_001"}
    ],
    "CUST_002": [
        {"transaction_id": "TXN_031", "transaction_date": "2025-07-29", "amount": 180.50, "category": "Groceries", "merchant": "Costco Wholesale", "card_id": "CARD_004"},
        {"transaction_id": "TXN_032", "transaction_date": "2025-07-28", "amount": 95.00, "category": "Household", "merchant": "Target", "card_id": "CARD_004"},
        {"transaction_id": "TXN_033", "transaction_date": "2025-07-25", "amount": 67.80, "category": "Groceries", "merchant": "Safeway", "card_id": "CARD_005"},
        {"transaction_id": "TXN_034", "transaction_date": "2025-07-23", "amount": 45.00, "category": "Kids", "merchant": "Toys R Us", "card_id": "CARD_004"},
        {"transaction_id": "TXN_035", "transaction_date": "2025-07-20", "amount": 320.00, "category": "Utilities", "merchant": "Pacific Gas & Electric", "card_id": "CARD_004"},
        {"transaction_id": "TXN_036", "transaction_date": "2025-07-18", "amount": 89.99, "category": "Household", "merchant": "Bed Bath & Beyond", "card_id": "CARD_004"},
        {"transaction_id": "TXN_037", "transaction_date": "2025-07-15", "amount": 125.00, "category": "Groceries", "merchant": "Whole Foods Market", "card_id": "CARD_005"},
        {"transaction_id": "TXN_038", "transaction_date": "2025-07-12", "amount": 78.50, "category": "Kids", "merchant": "Gap Kids", "card_id": "CARD_004"},
        {"transaction_id": "TXN_039", "transaction_date": "2025-07-10", "amount": 42.00, "category": "Dining", "merchant": "Panera Bread", "card_id": "CARD_005"},
        {"transaction_id": "TXN_040", "transaction_date": "2025-07-08", "amount": 156.00, "category": "Healthcare", "merchant": "CVS Pharmacy", "card_id": "CARD_004"},
        {"transaction_id": "TXN_041", "transaction_date": "2025-06-28", "amount": 240.00, "category": "Shopping", "merchant": "Amazon.com", "card_id": "CARD_004"},
        {"transaction_id": "TXN_042", "transaction_date": "2025-06-25", "amount": 89.99, "category": "Groceries", "merchant": "Kroger", "card_id": "CARD_005"},
        {"transaction_id": "TXN_043", "transaction_date": "2025-06-23", "amount": 180.00, "category": "Kids", "merchant": "Disney Store", "card_id": "CARD_004"},
        {"transaction_id": "TXN_044", "transaction_date": "2025-06-20", "amount": 67.50, "category": "Household", "merchant": "Home Depot", "card_id": "CARD_004"},
        {"transaction_id": "TXN_045", "transaction_date": "2025-06-18", "amount": 145.00, "category": "Groceries", "merchant": "Trader Joe's", "card_id": "CARD_005"},
        {"transaction_id": "TXN_046", "transaction_date": "2025-06-15", "amount": 95.00, "category": "Kids", "merchant": "Barnes & Noble", "card_id": "CARD_004"},
        {"transaction_id": "TXN_047", "transaction_date": "2025-06-12", "amount": 78.99, "category": "Household", "merchant": "IKEA", "card_id": "CARD_004"},
        {"transaction_id": "TXN_048", "transaction_date": "2025-06-10", "amount": 120.00, "category": "Healthcare", "merchant": "Pediatrician Office", "card_id": "CARD_004"},
        {"transaction_id": "TXN_049", "transaction_date": "2025-06-08", "amount": 56.00, "category": "Dining", "merchant": "Olive Garden", "card_id": "CARD_005"},
        {"transaction_id": "TXN_050", "transaction_date": "2025-06-05", "amount": 290.00, "category": "Utilities", "merchant": "Verizon Wireless", "card_id": "CARD_004"},
        {"transaction_id": "TXN_051", "transaction_date": "2025-05-28", "amount": 220.00, "category": "Groceries", "merchant": "Fresh Market", "card_id": "CARD_005"},
        {"transaction_id": "TXN_052", "transaction_date": "2025-05-25", "amount": 89.99, "category": "Household", "merchant": "Williams Sonoma", "card_id": "CARD_004"},
        {"transaction_id": "TXN_053", "transaction_date": "2025-05-23", "amount": 67.50, "category": "Kids", "merchant": "Old Navy Kids", "card_id": "CARD_004"},
        {"transaction_id": "TXN_054", "transaction_date": "2025-05-20", "amount": 145.00, "category": "Groceries", "merchant": "Publix", "card_id": "CARD_005"},
        {"transaction_id": "TXN_055", "transaction_date": "2025-05-18", "amount": 78.00, "category": "Healthcare", "merchant": "Walgreens", "card_id": "CARD_004"},
        {"transaction_id": "TXN_056", "transaction_date": "2025-05-15", "amount": 95.00, "category": "Household", "merchant": "Pottery Barn", "card_id": "CARD_004"},
        {"transaction_id": "TXN_057", "transaction_date": "2025-05-12", "amount": 56.80, "category": "Dining", "merchant": "Chick-fil-A", "card_id": "CARD_005"},
        {"transaction_id": "TXN_058", "transaction_date": "2025-05-10", "amount": 180.00, "category": "Kids", "merchant": "Soccer Equipment Store", "card_id": "CARD_004"},
        {"transaction_id": "TXN_059", "transaction_date": "2025-05-08", "amount": 125.00, "category": "Groceries", "merchant": "Sprouts Farmers Market", "card_id": "CARD_005"},
        {"transaction_id": "TXN_060", "transaction_date": "2025-05-05", "amount": 340.00, "category": "Utilities", "merchant": "City Water Department", "card_id": "CARD_004"}
    ],
    "CUST_003": [
        {"transaction_id": "TXN_061", "transaction_date": "2025-07-29", "amount": 1200.00, "category": "Sports", "merchant": "TaylorMade Golf", "card_id": "CARD_006"},
        {"transaction_id": "TXN_062", "transaction_date": "2025-07-28", "amount": 450.00, "category": "Sports", "merchant": "Pebble Beach Golf Links", "card_id": "CARD_007"},
        {"transaction_id": "TXN_063", "transaction_date": "2025-07-25", "amount": 180.00, "category": "Dining", "merchant": "The Lodge at Pebble Beach", "card_id": "CARD_006"},
        {"transaction_id": "TXN_064", "transaction_date": "2025-07-23", "amount": 95.00, "category": "Gas", "merchant": "Shell V-Power", "card_id": "CARD_008"},
        {"transaction_id": "TXN_065", "transaction_date": "2025-07-20", "amount": 320.00, "category": "Sports", "merchant": "Golf Galaxy", "card_id": "CARD_007"},
        {"transaction_id": "TXN_066", "transaction_date": "2025-07-18", "amount": 67.50, "category": "Groceries", "merchant": "Whole Foods Market", "card_id": "CARD_008"},
        {"transaction_id": "TXN_067", "transaction_date": "2025-07-15", "amount": 280.00, "category": "Sports", "merchant": "Augusta National Pro Shop", "card_id": "CARD_006"},
        {"transaction_id": "TXN_068", "transaction_date": "2025-07-12", "amount": 150.00, "category": "Dining", "merchant": "Ruth's Chris Steak House", "card_id": "CARD_006"},
        {"transaction_id": "TXN_069", "transaction_date": "2025-07-10", "amount": 89.99, "category": "Shopping", "merchant": "Under Armour Golf", "card_id": "CARD_007"},
        {"transaction_id": "TXN_070", "transaction_date": "2025-07-08", "amount": 420.00, "category": "Sports", "merchant": "Torrey Pines Golf Course", "card_id": "CARD_007"},
        {"transaction_id": "TXN_071", "transaction_date": "2025-06-30", "amount": 2800.00, "category": "Travel", "merchant": "Kiawah Island Golf Resort", "card_id": "CARD_006"},
        {"transaction_id": "TXN_072", "transaction_date": "2025-06-28", "amount": 680.00, "category": "Sports", "merchant": "Ocean Course Pro Shop", "card_id": "CARD_007"},
        {"transaction_id": "TXN_073", "transaction_date": "2025-06-25", "amount": 240.00, "category": "Dining", "merchant": "Ocean House Restaurant", "card_id": "CARD_006"},
        {"transaction_id": "TXN_074", "transaction_date": "2025-06-23", "amount": 180.00, "category": "Entertainment", "merchant": "Spa at Kiawah", "card_id": "CARD_006"},
        {"transaction_id": "TXN_075", "transaction_date": "2025-06-20", "amount": 95.00, "category": "Gas", "merchant": "BP Premium", "card_id": "CARD_008"},
        {"transaction_id": "TXN_076", "transaction_date": "2025-06-18", "amount": 450.00, "category": "Sports", "merchant": "Callaway Golf", "card_id": "CARD_007"},
        {"transaction_id": "TXN_077", "transaction_date": "2025-06-15", "amount": 78.50, "category": "Groceries", "merchant": "Harris Teeter", "card_id": "CARD_008"},
        {"transaction_id": "TXN_078", "transaction_date": "2025-06-12", "amount": 320.00, "category": "Sports", "merchant": "Pinehurst Resort", "card_id": "CARD_007"},
        {"transaction_id": "TXN_079", "transaction_date": "2025-06-10", "amount": 160.00, "category": "Dining", "merchant": "The Carolina Dining Room", "card_id": "CARD_006"},
        {"transaction_id": "TXN_080", "transaction_date": "2025-06-08", "amount": 890.00, "category": "Shopping", "merchant": "Polo Ralph Lauren Golf", "card_id": "CARD_006"},
        {"transaction_id": "TXN_081", "transaction_date": "2025-05-28", "amount": 1500.00, "category": "Sports", "merchant": "Scottsdale Golf Club", "card_id": "CARD_007"},
        {"transaction_id": "TXN_082", "transaction_date": "2025-05-25", "amount": 380.00, "category": "Accommodation", "merchant": "Four Seasons Scottsdale", "card_id": "CARD_006"},
        {"transaction_id": "TXN_083", "transaction_date": "2025-05-23", "amount": 220.00, "category": "Dining", "merchant": "Mastro's Steakhouse", "card_id": "CARD_006"},
        {"transaction_id": "TXN_084", "transaction_date": "2025-05-20", "amount": 95.00, "category": "Gas", "merchant": "Chevron Premium", "card_id": "CARD_008"},
        {"transaction_id": "TXN_085", "transaction_date": "2025-05-18", "amount": 560.00, "category": "Sports", "merchant": "Titleist Pro V1", "card_id": "CARD_007"},
        {"transaction_id": "TXN_086", "transaction_date": "2025-05-15", "amount": 89.99, "category": "Groceries", "merchant": "AJ's Fine Foods", "card_id": "CARD_008"},
        {"transaction_id": "TXN_087", "transaction_date": "2025-05-12", "amount": 420.00, "category": "Sports", "merchant": "TPC Sawgrass", "card_id": "CARD_007"},
        {"transaction_id": "TXN_088", "transaction_date": "2025-05-10", "amount": 180.00, "category": "Dining", "merchant": "The Grill at TPC", "card_id": "CARD_006"},
        {"transaction_id": "TXN_089", "transaction_date": "2025-05-08", "amount": 340.00, "category": "Shopping", "merchant": "FootJoy Golf Shoes", "card_id": "CARD_007"},
        {"transaction_id": "TXN_090", "transaction_date": "2025-05-05", "amount": 780.00, "category": "Sports", "merchant": "Ping Golf Equipment", "card_id": "CARD_006"}
    ]
}

MOCK_SPENDING_CATEGORIES = {
    "Dining": {"category_id": "CAT_001", "category_name": "Dining", "description": "Restaurants and food services"},
    "Gas": {"category_id": "CAT_002", "category_name": "Gas", "description": "Fuel and gas stations"},
    "Shopping": {"category_id": "CAT_003", "category_name": "Shopping", "description": "Retail purchases"},
    "Groceries": {"category_id": "CAT_004", "category_name": "Groceries", "description": "Food and grocery stores"},
    "Utilities": {"category_id": "CAT_005", "category_name": "Utilities", "description": "Utility bills and services"},
    "Travel": {"category_id": "CAT_006", "category_name": "Travel", "description": "Travel and transportation"},
    "Accommodation": {"category_id": "CAT_007", "category_name": "Accommodation", "description": "Hotels and lodging"},
    "Entertainment": {"category_id": "CAT_008", "category_name": "Entertainment", "description": "Shows, events, and entertainment"},
    "Household": {"category_id": "CAT_009", "category_name": "Household", "description": "Home goods and household items"},
    "Kids": {"category_id": "CAT_010", "category_name": "Kids", "description": "Children's items and activities"},
    "Healthcare": {"category_id": "CAT_011", "category_name": "Healthcare", "description": "Medical and pharmacy expenses"},
    "Sports": {"category_id": "CAT_012", "category_name": "Sports", "description": "Sports equipment and activities"}
}

MOCK_CREDIT_TIERS = {
    "Basic": {"tier_name": "Basic", "min_credit_score": 580, "benefits": "Basic rewards, standard APR"},
    "Standard": {"tier_name": "Standard", "min_credit_score": 650, "benefits": "Enhanced rewards, lower APR"},
    "Premium": {"tier_name": "Premium", "min_credit_score": 700, "benefits": "Premium rewards, travel benefits"},
    "Elite": {"tier_name": "Elite", "min_credit_score": 750, "benefits": "Elite rewards, concierge service"},
    "Platinum": {"tier_name": "Platinum", "min_credit_score": 780, "benefits": "Platinum benefits, luxury perks"},
    "Business": {"tier_name": "Business", "min_credit_score": 720, "benefits": "Business rewards, expense tracking"}
}

# Demographic spending benchmarks for comparison
DEMOGRAPHIC_BENCHMARKS = {
    "age_groups": {
        "25-34": {
            "monthly_spending": 3200.00,
            "category_breakdown": {
                "Dining": 0.18,
                "Groceries": 0.15,
                "Shopping": 0.12,
                "Travel": 0.08,
                "Entertainment": 0.06,
                "Gas": 0.05,
                "Healthcare": 0.04,
                "Utilities": 0.32
            }
        },
        "35-44": {
            "monthly_spending": 4100.00,
            "category_breakdown": {
                "Groceries": 0.20,
                "Household": 0.15,
                "Kids": 0.12,
                "Dining": 0.10,
                "Healthcare": 0.08,
                "Shopping": 0.07,
                "Travel": 0.06,
                "Utilities": 0.22
            }
        },
        "45-54": {
            "monthly_spending": 4800.00,
            "category_breakdown": {
                "Groceries": 0.18,
                "Healthcare": 0.15,
                "Sports": 0.12,
                "Dining": 0.10,
                "Travel": 0.08,
                "Shopping": 0.07,
                "Entertainment": 0.05,
                "Utilities": 0.25
            }
        }
    },
    "income_brackets": {
        "50k-75k": {
            "monthly_spending": 2800.00,
            "savings_rate": 0.08
        },
        "75k-100k": {
            "monthly_spending": 3600.00,
            "savings_rate": 0.12
        },
        "100k-150k": {
            "monthly_spending": 4500.00,
            "savings_rate": 0.15
        },
        "150k+": {
            "monthly_spending": 6200.00,
            "savings_rate": 0.18
        }
    },
    "lifestyle_profiles": {
        "food_enthusiast": {
            "dining_percentage": 0.25,
            "travel_percentage": 0.15,
            "entertainment_percentage": 0.08
        },
        "family_focused": {
            "groceries_percentage": 0.22,
            "kids_percentage": 0.18,
            "household_percentage": 0.15
        },
        "sports_enthusiast": {
            "sports_percentage": 0.20,
            "travel_percentage": 0.12,
            "entertainment_percentage": 0.08
        }
    }
}

# Customer profiles for personalized analysis
CUSTOMER_PROFILES = {
    "CUST_001": {
        "age_group": "25-34",
        "income_bracket": "100k-150k",
        "lifestyle_profile": "food_enthusiast",
        "location": "Urban",
        "family_status": "Single"
    },
    "CUST_002": {
        "age_group": "35-44", 
        "income_bracket": "75k-100k",
        "lifestyle_profile": "family_focused",
        "location": "Suburban",
        "family_status": "Married with children"
    },
    "CUST_003": {
        "age_group": "45-54",
        "income_bracket": "150k+",
        "lifestyle_profile": "sports_enthusiast", 
        "location": "Suburban",
        "family_status": "Married"
    }
}

SPENDING_AGENT_INSTRUCTIONS = """
You are a spending analysis assistant that creates comprehensive financial reports.

IMPORTANT OUTPUT FORMAT:
You MUST wrap your final analysis in XML tags like this:
<analysis>
[Your complete analysis content here in markdown format]
</analysis>

Everything before the <analysis> tag will be treated as reasoning/thinking and won't be displayed to the user.

Analysis Process:
1. Use analyze_spending_trends for time-based patterns
2. Use analyze_category_breakdown for spending categories
3. Use analyze_spending_behavior for insights and comparisons
4. Use create_visualization for charts (pie, bar, line charts)

CHART EMBEDDING FORMAT:
When you create visualizations using create_visualization, embed them in your response using this exact format:
[CHART:chart_name]

The chart_name should be a descriptive name for the chart (e.g., "spending_distribution", "monthly_trends", "category_breakdown").
Always use the exact chart_name you provided to the create_visualization tool.

Response Format:
# Financial Profile: [Customer Type]

## Executive Summary
| Metric | Value | Benchmark | Status |
|--------|-------|-----------|--------|
| Monthly Spending | $X,XXX | $X,XXX | 🟢 Good / 🟡 Fair / 🔴 Poor |
| Top Category | Category (X%) | <30% | 🟢 Good / 🟡 Fair / 🔴 Poor |
| Spending Trend | +/-X% | Stable | 📈 Increasing / 📉 Decreasing / ➡️ Stable |

## Visual Analysis

[CHART:spending_distribution]

[CHART:monthly_trends]

## Category Breakdown
| Category | Amount | % of Total | vs Benchmark | Trend |
|----------|--------|------------|--------------|-------|
| Travel | $X,XXX | XX% | +/-XX% | 📈/📉/➡️ |
| Dining | $X,XXX | XX% | +/-XX% | 📈/📉/➡️ |
| Shopping | $X,XXX | XX% | +/-XX% | 📈/📉/➡️ |

## Demographic Comparison
| Metric | Your Profile | Age Group Avg | Income Bracket Avg | Performance |
|--------|--------------|---------------|-------------------|-------------|
| Monthly Spending | $X,XXX | $X,XXX | $X,XXX | Above/Below/On Par |
| Top Category % | XX% | XX% | XX% | Higher/Lower/Similar |
| Savings Rate | XX% | XX% | XX% | Better/Worse/Average |

## Key Insights
*Brief commentary on the data patterns and what they reveal about spending behavior.*

## Action Items
| Priority | Action | Target | Timeline |
|----------|--------|--------|----------|
| 🔴 High | Specific immediate action | Measurable goal | This week |
| 🟡 Medium | Short-term improvement | Specific target | This month |
| 🟢 Low | Long-term optimization | Strategic goal | 3-6 months |

IMPORTANT: 
- Always include 2-3 visualizations using the [CHART:chart_id:Title] format
- Use tables for numerical data and metrics
- Keep text commentary brief and focused on insights
- Don't add reasoning comments before final analysis
</response>
"""
