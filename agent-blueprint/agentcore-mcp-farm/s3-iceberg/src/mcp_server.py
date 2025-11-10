#!/usr/bin/env python3
"""
Memory Text2SQL MCP Server - Clean Version

A simplified MCP server that provides natural language to SQL conversion
and querying capabilities for Iceberg tables stored in S3.
Uses default configuration from sample_data_config.json - no parameters required.
"""
import sys
import os
import json
from typing import Any, Dict, List, Optional
from fastmcp import FastMCP

# S3 Tables / PyIceberg functionality
try:
    from pyiceberg.catalog import load_catalog
    import daft
    from daft import Catalog as DaftCatalog
    from daft.session import Session
    import pyarrow as pa
    import pyarrow.json as pj
    import io
    import boto3
    import os
    HAS_PYICEBERG = True
except ImportError:
    HAS_PYICEBERG = False
    print("⚠️ PyIceberg not available. Install with: pip install pyiceberg daft boto3")

# PyIceberg utility function
def pyiceberg_load_catalog(
    catalog_name: str,
    warehouse: str,
    uri: str,
    region: str,
    rest_signing_name: str = 's3tables',
    rest_sigv4_enabled: str = 'true',
):
    """Load a PyIceberg catalog with the given parameters."""
    catalog = load_catalog(
        catalog_name,
        **{
            'type': 'rest',
            'warehouse': warehouse,
            'uri': uri,
            'rest.sigv4-enabled': rest_sigv4_enabled,
            'rest.signing-name': rest_signing_name,
            'rest.signing-region': region,
        },
    )
    return catalog

# Initialize MCP server
mcp = FastMCP(host="0.0.0.0", stateless_http=True)

# Global configuration loaded at startup
DEFAULT_CONFIG = None

def get_region() -> str:
    """
    Get AWS region from multiple sources in priority order:
    1. Environment variable AWS_REGION (set by CDK/AgentCore)
    2. boto3 session default region
    3. Fallback to us-west-2
    """
    # Try environment variable first
    region = os.environ.get('AWS_REGION')
    if region:
        print(f"✅ Region from environment: {region}")
        return region

    # Try boto3 session
    try:
        session = boto3.Session()
        region = session.region_name
        if region:
            print(f"✅ Region from boto3 session: {region}")
            return region
    except Exception as e:
        print(f"⚠️  Could not get region from boto3 session: {e}")

    # Fallback
    region = 'us-west-2'
    print(f"⚠️  Using fallback region: {region}")
    return region

def discover_s3_tables_config() -> Optional[Dict[str, str]]:
    """
    Auto-discover S3 Tables configuration using boto3.
    Returns config dict with warehouse, uri, region, namespace.
    """
    try:
        # Get region
        region = get_region()

        # Create S3 Tables client
        s3tables_client = boto3.client('s3tables', region_name=region)

        # Check for environment variable override (set by CDK)
        warehouse_arn = os.environ.get('ICEBERG_WAREHOUSE_ARN') or os.environ.get('TABLE_BUCKET_ARN')

        if warehouse_arn:
            print(f"✅ Using warehouse ARN from environment: {warehouse_arn}")
        else:
            # Discover table buckets
            print(f"🔍 Discovering S3 Tables buckets in region {region}...")
            response = s3tables_client.list_table_buckets()
            buckets = response.get('tableBuckets', [])

            if not buckets:
                print(f"❌ No S3 Tables buckets found in region {region}")
                return None

            # Use first bucket
            warehouse_arn = buckets[0]['arn']
            bucket_name = buckets[0]['name']
            print(f"✅ Discovered S3 Tables bucket: {bucket_name}")
            print(f"   ARN: {warehouse_arn}")

        # Get namespace from environment or use default
        namespace = os.environ.get('NAMESPACE', 'default')

        # Construct URI
        uri_from_env = os.environ.get('ICEBERG_URI')
        if uri_from_env:
            uri = uri_from_env
            # Ensure it ends with /iceberg
            if not uri.endswith('/iceberg'):
                uri = f"{uri}/iceberg"
        else:
            uri = f"https://s3tables.{region}.amazonaws.com/iceberg"

        config = {
            'warehouse': warehouse_arn,
            'uri': uri,
            'region': region,
            'namespace': namespace
        }

        print(f"✅ Configuration discovered successfully:")
        print(f"   Region: {region}")
        print(f"   Namespace: {namespace}")
        print(f"   URI: {uri}")

        return config

    except Exception as e:
        print(f"❌ Failed to discover S3 Tables configuration: {e}")
        import traceback
        traceback.print_exc()
        return None

def load_default_config():
    """
    Load configuration using pure boto3 auto-discovery.
    No config files needed - everything is discovered dynamically.
    """
    global DEFAULT_CONFIG

    print("🚀 Starting auto-discovery of S3 Tables configuration...")

    # Use boto3 auto-discovery
    DEFAULT_CONFIG = discover_s3_tables_config()

    if DEFAULT_CONFIG:
        print("✅ Configuration loaded successfully")
        return DEFAULT_CONFIG
    else:
        print("❌ Failed to load configuration")
        return None

# Configuration class for PyIceberg connection
class IcebergConfig:
    def __init__(self, warehouse: str, uri: str, region: str, namespace: str):
        self.warehouse = warehouse
        self.uri = uri
        self.region = region
        self.namespace = namespace
        self.catalog_name = 's3tablescatalog'
        self.rest_signing_name = 's3tables'
        self.rest_sigv4_enabled = 'true'

# Simple PyIceberg Engine
class SimpleIcebergEngine:
    def __init__(self, config: IcebergConfig):
        if not HAS_PYICEBERG:
            raise ImportError("PyIceberg not available")

        self.config = config
        self._catalog = None
        self._session = None
        self._initialize_connection()

    def _initialize_connection(self):
        """Initialize PyIceberg connection"""
        self._catalog = pyiceberg_load_catalog(
            self.config.catalog_name,
            self.config.warehouse,
            self.config.uri,
            self.config.region,
            self.config.rest_signing_name,
            self.config.rest_sigv4_enabled,
        )
        # Set up Daft with explicit AWS configuration for AgentCore Runtime
        import os

        # Get current AWS session info
        session = boto3.Session()
        credentials = session.get_credentials()

        # Set environment variables for Daft to use
        if credentials:
            os.environ['AWS_ACCESS_KEY_ID'] = credentials.access_key
            os.environ['AWS_SECRET_ACCESS_KEY'] = credentials.secret_key
            if credentials.token:
                os.environ['AWS_SESSION_TOKEN'] = credentials.token
        os.environ['AWS_REGION'] = self.config.region
        os.environ['AWS_DEFAULT_REGION'] = self.config.region

        self._session = Session()
        self._session.attach(DaftCatalog.from_iceberg(self._catalog))
        self._session.set_namespace(self.config.namespace)
        print(f"✅ Connected to PyIceberg catalog")
        print(f"🔑 AWS credentials configured for Daft")

    def list_tables(self) -> List[str]:
        """List available tables in the namespace using S3 Tables API"""
        try:
            # Use boto3 S3 Tables client instead of PyIceberg REST API
            # This is more reliable with S3 Tables service
            s3tables_client = boto3.client('s3tables', region_name=self.config.region)

            response = s3tables_client.list_tables(
                tableBucketARN=self.config.warehouse,
                namespace=self.config.namespace
            )

            # Extract table names from response
            tables = [table['name'] for table in response.get('tables', [])]
            return tables
        except Exception as e:
            print(f"⚠️  Failed to list tables via S3 Tables API: {e}")
            print(f"   Falling back to PyIceberg catalog method...")
            # Fallback to PyIceberg method (may not work with S3 Tables)
            try:
                tables = self._catalog.list_tables(self.config.namespace)
                return [str(table) for table in tables]
            except Exception as fallback_error:
                print(f"❌ Fallback also failed: {fallback_error}")
                raise

    def get_table_schema(self, table_name: str) -> Dict[str, Any]:
        """Get schema information for a specific table"""
        # Use catalog to load table and get schema
        table = self._catalog.load_table(f"{self.config.namespace}.{table_name}")
        schema = table.schema()

        columns = []
        for field in schema.fields:
            columns.append({
                "name": field.name,
                "type": str(field.field_type),
                "required": field.required
            })

        return {
            "table_name": table_name,
            "column_count": len(columns),
            "columns": columns
        }

    def execute_query(self, query: str) -> Dict[str, Any]:
        """Execute SQL query using Daft session"""
        # Use Daft session for SQL execution
        result = self._session.sql(query)
        df = result.collect()

        # Convert to standard format
        columns = df.column_names
        rows = df.to_pylist()

        return {
            "status": "success",
            "row_count": len(rows),
            "columns": columns,
            "rows": [list(row.values()) for row in rows]
        }

# Global engine instance
_engine = None

def _get_engine() -> SimpleIcebergEngine:
    """Get or create engine instance using default config"""
    global _engine
    if _engine is None and DEFAULT_CONFIG:
        config = IcebergConfig(
            DEFAULT_CONFIG['warehouse'],
            DEFAULT_CONFIG['uri'],
            DEFAULT_CONFIG['region'],
            DEFAULT_CONFIG['namespace']
        )
        _engine = SimpleIcebergEngine(config)
    return _engine

# MCP Tools - All use default configuration, no parameters required
@mcp.tool()
def get_connection_info() -> str:
    """Get current connection configuration information."""
    if not DEFAULT_CONFIG:
        return json.dumps({"error": "No configuration loaded"})

    return json.dumps({
        "status": "connected",
        "warehouse_arn": DEFAULT_CONFIG['warehouse'],
        "uri": DEFAULT_CONFIG['uri'],
        "region": DEFAULT_CONFIG['region'],
        "namespace": DEFAULT_CONFIG['namespace'],
        "catalog_name": "s3tablescatalog"
    }, indent=2)

@mcp.tool()
def list_tables() -> str:
    """List all available tables in the namespace."""
    engine = _get_engine()
    tables = engine.list_tables()

    if not tables:
        return json.dumps({"message": "No tables found", "tables": []})

    return json.dumps({
        "message": f"Found {len(tables)} table(s)",
        "tables": tables
    })

@mcp.tool()
def describe_table(table_name: str) -> str:
    """Get detailed schema information for a specific table.

    Args:
        table_name: Name of the table to describe (e.g., 'customers_iceberg')
    """
    engine = _get_engine()
    schema_info = engine.get_table_schema(table_name)

    output = f"Table: {schema_info['table_name']}\n"
    output += f"Columns ({schema_info['column_count']}):\n\n"

    for col in schema_info['columns']:
        required = "NOT NULL" if col['required'] else "NULL"
        output += f"  {col['name']} ({col['type']}) {required}\n"

    return output

@mcp.tool()
def query_database(query: str) -> str:
    """Execute SQL query against Iceberg tables.

    Args:
        query: SQL query to execute (e.g., "SELECT * FROM customers_iceberg LIMIT 10")
    """
    engine = _get_engine()
    result = engine.execute_query(query)

    if result['status'] == 'error':
        return f"Query failed: {result['error']}"

    # Format results for display
    if result['row_count'] == 0:
        return "Query executed successfully but returned no results."

    # Create table-like output
    columns = result['columns']
    rows = result['rows']

    # Format as simple table
    output = f"Query Results ({result['row_count']} rows):\n\n"
    output += " | ".join(columns) + "\n"
    output += "-" * (len(" | ".join(columns))) + "\n"

    # Show first 20 rows max
    display_rows = rows[:20]
    for row in display_rows:
        output += " | ".join(str(val) for val in row) + "\n"

    if len(rows) > 20:
        output += f"\n... and {len(rows) - 20} more rows"

    return output

if __name__ == "__main__":
    if not HAS_PYICEBERG:
        print("❌ PyIceberg dependencies not available")
        print("Install with: pip install pyiceberg daft pyarrow")
        sys.exit(1)

    # Load default configuration at startup
    print("📋 Loading default configuration...")
    load_default_config()

    if DEFAULT_CONFIG:
        print(f"✅ Configuration loaded successfully")
        print(f"   S3 Bucket: {DEFAULT_CONFIG['warehouse']}")
        print(f"   Region: {DEFAULT_CONFIG['region']}")
        print(f"   Namespace: {DEFAULT_CONFIG['namespace']}")
    else:
        print("⚠️  No configuration loaded - tools may not work")

    print("🔧 MCP: Starting Memory Text2SQL server...")
    mcp.run(transport="streamable-http")