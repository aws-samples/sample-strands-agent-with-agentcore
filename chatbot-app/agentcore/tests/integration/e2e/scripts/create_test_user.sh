#!/usr/bin/env bash
# Provision a dedicated e2e test user in the Cognito User Pool.
# Prereqs: AWS CLI configured, E2E_COGNITO_USER_POOL_ID, E2E_TEST_USERNAME,
# E2E_TEST_PASSWORD exported in the shell.
set -euo pipefail

: "${E2E_COGNITO_USER_POOL_ID:?required}"
: "${E2E_TEST_USERNAME:?required}"
: "${E2E_TEST_PASSWORD:?required}"

aws cognito-idp admin-create-user \
  --user-pool-id "$E2E_COGNITO_USER_POOL_ID" \
  --username "$E2E_TEST_USERNAME" \
  --user-attributes Name=email,Value="$E2E_TEST_USERNAME" Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --temporary-password "$E2E_TEST_PASSWORD" >/dev/null

aws cognito-idp admin-set-user-password \
  --user-pool-id "$E2E_COGNITO_USER_POOL_ID" \
  --username "$E2E_TEST_USERNAME" \
  --password "$E2E_TEST_PASSWORD" \
  --permanent

echo "Created e2e user $E2E_TEST_USERNAME in $E2E_COGNITO_USER_POOL_ID"
