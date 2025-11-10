#!/usr/bin/env python3
"""
Generate Sample Data for S3 Iceberg AgentCore MCP Server

This script generates e-commerce sample data and loads it into S3 Tables
created by the S3IcebergAgentCoreStack CDK deployment.

Usage:
    python generate_sample_data.py                  # Load sample data
    python generate_sample_data.py --regenerate     # Clear and reload data
    python generate_sample_data.py --auto           # Non-interactive mode
"""
import sys
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
import random

def main():
    import argparse

    parser = argparse.ArgumentParser(description='Generate sample data for S3 Iceberg tables')
    parser.add_argument('--regenerate', action='store_true',
                       help='Clear existing tables and regenerate data')
    parser.add_argument('--auto', action='store_true',
                       help='Run in non-interactive mode (no prompts)')

    args = parser.parse_args()

    print("=" * 60)
    print("S3 ICEBERG AGENTCORE - SAMPLE DATA GENERATOR")
    print("=" * 60)

    try:
        # Step 1: Load CDK outputs
        print("\n📋 Step 1: Loading deployment configuration...")
        cdk_outputs = load_cdk_outputs()

        table_bucket_name = cdk_outputs.get('TableBucketName')
        table_bucket_arn = cdk_outputs.get('TableBucketArn')
        region = cdk_outputs.get('Region', 'us-west-2')
        namespace = 'default'

        if not table_bucket_name or not table_bucket_arn:
            print("❌ Error: Could not find table bucket in CDK outputs")
            print("   Make sure the CDK stack has been deployed successfully")
            sys.exit(1)

        print(f"✅ Configuration loaded:")
        print(f"   Table Bucket: {table_bucket_name}")
        print(f"   Region: {region}")
        print(f"   Namespace: {namespace}")

        # Step 2: Import required dependencies
        print("\n📦 Step 2: Checking dependencies...")
        try:
            import boto3
            import pyarrow as pa
            from pyiceberg.catalog import load_catalog
            print("✅ All dependencies available")
        except ImportError as e:
            print(f"❌ Missing dependency: {e}")
            print("   Install with: pip install boto3 pyarrow pyiceberg")
            sys.exit(1)

        # Step 3: Connect to AWS
        print("\n🔌 Step 3: Connecting to AWS...")
        session = boto3.Session(region_name=region)
        s3tables_client = session.client('s3tables')
        sts_client = session.client('sts')
        account_id = sts_client.get_caller_identity()['Account']
        print(f"✅ Connected to AWS (Account: {account_id})")

        # Step 4: Generate sample data
        print("\n📊 Step 4: Generating sample e-commerce data...")
        data = generate_sample_data()
        print(f"✅ Generated sample data:")
        print(f"   - {len(data['customers'])} customers")
        print(f"   - {len(data['products'])} products")
        print(f"   - {len(data['orders'])} orders")

        # Step 5: Create tables and load data
        print("\n🏗️  Step 5: Creating tables and loading data...")

        schemas = {
            'customers_iceberg': pa.schema([
                pa.field("customer_id", pa.int64()),
                pa.field("email", pa.string()),
                pa.field("first_name", pa.string()),
                pa.field("last_name", pa.string()),
                pa.field("phone", pa.string()),
                pa.field("registration_date", pa.date32()),
                pa.field("country", pa.string()),
                pa.field("city", pa.string()),
            ]),
            'products_iceberg': pa.schema([
                pa.field("product_id", pa.int64()),
                pa.field("product_name", pa.string()),
                pa.field("category", pa.string()),
                pa.field("price", pa.float64()),
                pa.field("stock_quantity", pa.int32()),
                pa.field("brand", pa.string()),
                pa.field("created_date", pa.date32()),
            ]),
            'orders_iceberg': pa.schema([
                pa.field("order_id", pa.int64()),
                pa.field("customer_id", pa.int64()),
                pa.field("product_id", pa.int64()),
                pa.field("order_date", pa.date32()),
                pa.field("order_status", pa.string()),
                pa.field("quantity", pa.int32()),
                pa.field("unit_price", pa.float64()),
                pa.field("total_amount", pa.float64()),
                pa.field("shipping_address", pa.string()),
                pa.field("payment_method", pa.string()),
            ])
        }

        # Connect to PyIceberg catalog
        catalog = load_catalog(
            's3tablescatalog',
            **{
                'type': 'rest',
                'warehouse': table_bucket_arn,
                'uri': f'https://s3tables.{region}.amazonaws.com/iceberg',
                'rest.sigv4-enabled': 'true',
                'rest.signing-name': 's3tables',
                'rest.signing-region': region,
            }
        )

        for table_name, table_data in data.items():
            iceberg_table_name = f"{table_name}_iceberg"
            schema = schemas[iceberg_table_name]

            print(f"  📊 Creating table: {iceberg_table_name}...")

            # Create table if it doesn't exist
            try:
                # Try to load existing table
                table = catalog.load_table(f"{namespace}.{iceberg_table_name}")

                if args.regenerate:
                    print(f"    ♻️  Regenerating table (dropping old data)...")
                    # Drop and recreate table
                    catalog.drop_table(f"{namespace}.{iceberg_table_name}")
                    table = catalog.create_table(
                        f"{namespace}.{iceberg_table_name}",
                        schema=schema
                    )
                else:
                    print(f"    ℹ️  Table exists, appending data...")

            except Exception as e:
                # Table doesn't exist, create it
                print(f"    🆕 Creating new table...")
                table = catalog.create_table(
                    f"{namespace}.{iceberg_table_name}",
                    schema=schema
                )

            # Prepare and load data
            import pandas as pd

            df = pd.DataFrame(table_data)

            # Convert date columns
            if table_name == 'customers':
                df['registration_date'] = pd.to_datetime(df['registration_date']).dt.date
            elif table_name == 'products':
                df['created_date'] = pd.to_datetime(df['created_date']).dt.date
            elif table_name == 'orders':
                df['order_date'] = pd.to_datetime(df['order_date']).dt.date

            # Convert to PyArrow table
            arrow_table = pa.Table.from_pandas(df, schema=schema)

            # Append data
            table.append(arrow_table)
            print(f"    ✅ Loaded {len(table_data)} records into {iceberg_table_name}")

        # Step 6: Add S3 bucket permissions for AgentCore runtime
        print("\n🔐 Step 6: Adding S3 bucket permissions for AgentCore...")
        add_s3_permissions_for_runtime(
            s3tables_client=s3tables_client,
            table_bucket_arn=table_bucket_arn,
            namespace=namespace,
            cdk_outputs=cdk_outputs,
            region=region
        )

        # Step 7: Summary
        print("\n" + "=" * 60)
        print("✅ SAMPLE DATA GENERATION COMPLETE!")
        print("=" * 60)
        print(f"\n📊 Created tables in namespace '{namespace}':")
        print("   - customers_iceberg (100 records)")
        print("   - products_iceberg (200 records)")
        print("   - orders_iceberg (500 records)")
        print(f"\n🔗 S3 Tables Bucket: {table_bucket_name}")
        print(f"🌍 Region: {region}")
        print("\n💡 Test queries:")
        print("   - 'What tables are available?'")
        print("   - 'How many customers do we have?'")
        print("   - 'Show me the top 10 products by price'")
        print("   - 'List orders from the last 30 days'")
        print("=" * 60)

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


def load_cdk_outputs():
    """Load CDK stack outputs from outputs.json"""
    script_dir = Path(__file__).parent
    outputs_file = script_dir.parent / 'cdk' / 'outputs.json'

    if not outputs_file.exists():
        raise FileNotFoundError(
            f"CDK outputs file not found: {outputs_file}\n"
            "Please deploy the CDK stack first: ./deploy.sh"
        )

    with open(outputs_file, 'r') as f:
        outputs = json.load(f)

    # Extract outputs from the first stack
    stack_outputs = list(outputs.values())[0] if outputs else {}

    # Map CDK output keys to friendly names
    result = {}
    for key, value in stack_outputs.items():
        if 'TableBucketName' in key:
            result['TableBucketName'] = value
        elif 'TableBucketArn' in key:
            result['TableBucketArn'] = value
        elif 'RuntimeRoleArn' in key:
            result['RuntimeRoleArn'] = value
        elif 'Region' in key or 'region' in key.lower():
            result['Region'] = value

    # Try to infer region from ARN if not explicitly provided
    if 'Region' not in result and 'TableBucketArn' in result:
        arn_parts = result['TableBucketArn'].split(':')
        if len(arn_parts) > 3:
            result['Region'] = arn_parts[3]

    return result


def generate_sample_data():
    """Generate sample e-commerce data"""
    def random_date(start_days_ago=365, end_days_ago=0):
        start = datetime.now() - timedelta(days=start_days_ago)
        end = datetime.now() - timedelta(days=end_days_ago)
        return start + timedelta(seconds=random.randint(0, int((end - start).total_seconds())))

    # Customers data
    customers_data = []
    for i in range(100):
        customers_data.append({
            'customer_id': i + 1,
            'email': f'customer{i+1}@example.com',
            'first_name': f'FirstName{i+1}',
            'last_name': f'LastName{i+1}',
            'phone': f'+1-555-{random.randint(1000, 9999)}',
            'registration_date': random_date(365, 30).strftime('%Y-%m-%d'),
            'country': random.choice(['US', 'CA', 'UK', 'DE', 'FR', 'JP', 'AU']),
            'city': random.choice(['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'London', 'Tokyo'])
        })

    # Products data
    categories = ['Electronics', 'Clothing', 'Books', 'Home & Garden', 'Sports', 'Beauty', 'Automotive', 'Health']
    products_data = []
    for i in range(200):
        products_data.append({
            'product_id': i + 1,
            'product_name': f'Product {i+1}',
            'category': random.choice(categories),
            'price': round(random.uniform(10.0, 500.0), 2),
            'stock_quantity': random.randint(0, 1000),
            'brand': f'Brand{random.randint(1, 20)}',
            'created_date': random_date(180, 0).strftime('%Y-%m-%d')
        })

    # Orders data
    orders_data = []
    for i in range(500):
        order_date = random_date(90, 0)
        quantity = random.randint(1, 5)
        unit_price = round(random.uniform(10.0, 500.0), 2)

        orders_data.append({
            'order_id': i + 1,
            'customer_id': random.randint(1, 100),
            'product_id': random.randint(1, 200),
            'order_date': order_date.strftime('%Y-%m-%d'),
            'order_status': random.choice(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
            'quantity': quantity,
            'unit_price': unit_price,
            'total_amount': round(quantity * unit_price, 2),
            'shipping_address': f'{random.randint(100, 9999)} Main St, City, State',
            'payment_method': random.choice(['credit_card', 'debit_card', 'paypal', 'bank_transfer'])
        })

    return {
        'customers': customers_data,
        'products': products_data,
        'orders': orders_data
    }


def add_s3_permissions_for_runtime(s3tables_client, table_bucket_arn, namespace, cdk_outputs, region):
    """
    Add S3 bucket permissions to AgentCore runtime role for accessing Iceberg data

    This function:
    1. Discovers the underlying S3 bucket used by S3 Tables
    2. Adds S3:GetObject, S3:ListBucket permissions to the AgentCore runtime role
    """
    import boto3

    try:
        # Get the runtime role ARN from CDK outputs
        runtime_role_arn = cdk_outputs.get('RuntimeRoleArn')
        if not runtime_role_arn:
            print("  ⚠️  Warning: Could not find RuntimeRoleArn in CDK outputs")
            print("     S3 permissions must be added manually")
            return

        # Extract role name from ARN
        role_name = runtime_role_arn.split('/')[-1]
        print(f"  📋 AgentCore Runtime Role: {role_name}")

        # Discover the underlying S3 bucket by getting metadata location
        print(f"  🔍 Discovering underlying S3 bucket...")
        response = s3tables_client.get_table_metadata_location(
            tableBucketARN=table_bucket_arn,
            namespace=namespace,
            name='customers_iceberg'  # Use first table to discover bucket
        )

        metadata_location = response.get('metadataLocation', '')
        if not metadata_location.startswith('s3://'):
            print(f"  ⚠️  Warning: Unexpected metadata location format: {metadata_location}")
            return

        # Extract S3 bucket name from s3://bucket-name/path
        s3_bucket_name = metadata_location.replace('s3://', '').split('/')[0]
        print(f"  ✅ Found underlying S3 bucket: {s3_bucket_name}")

        # Create IAM client
        iam_client = boto3.client('iam', region_name=region)

        # Create inline policy for S3 access
        policy_name = "S3TablesDataAccessPolicy"
        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": [
                        "s3:GetObject",
                        "s3:ListBucket",
                        "s3:GetObjectVersion"
                    ],
                    "Resource": [
                        f"arn:aws:s3:::{s3_bucket_name}",
                        f"arn:aws:s3:::{s3_bucket_name}/*"
                    ],
                    "Sid": "S3TablesDataAccess"
                }
            ]
        }

        # Check if policy already exists
        try:
            iam_client.get_role_policy(RoleName=role_name, PolicyName=policy_name)
            print(f"  ℹ️  Policy '{policy_name}' already exists, updating...")
        except iam_client.exceptions.NoSuchEntityException:
            print(f"  🆕 Creating new policy '{policy_name}'...")

        # Put (create or update) the inline policy
        iam_client.put_role_policy(
            RoleName=role_name,
            PolicyName=policy_name,
            PolicyDocument=json.dumps(policy_document)
        )

        print(f"  ✅ Successfully added S3 bucket permissions to runtime role")
        print(f"     Bucket: {s3_bucket_name}")
        print(f"     Permissions: s3:GetObject, s3:ListBucket, s3:GetObjectVersion")

    except Exception as e:
        print(f"  ⚠️  Warning: Failed to add S3 permissions automatically: {e}")
        print(f"     You may need to add S3 permissions manually to the runtime role")
        print(f"     Bucket pattern: *--table-s3")


if __name__ == "__main__":
    main()
