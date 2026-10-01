# Payer migration environment

This environment provisions destination infrastructure while retaining the
existing Cognito user pool and clients. The `auth-existing` module publishes
references; it does not manage the source Cognito resources.

Copy `migration.auto.tfvars.json.example` to `migration.auto.tfvars.json` and
replace the example account and Cognito identifiers. The local file is ignored
by Git. `destination_account_id` is required and restricts the AWS provider to
that account. Supply the S3 backend bucket and region during `terraform init`;
this environment uses the `payer/terraform.tfstate` key.

The destination Secrets Manager secret `<project_name>/migration/cognito-m2m`
must contain JSON fields `clientId` and `clientSecret` for the retained M2M
client. Keep secret values out of committed files. Source and destination
authentication regions must match `aws_region`.

Background processing defaults to disabled and Telegram defaults to stopped.
Enable them only after data migration and pending-work reconciliation. DynamoDB
stream consumption starts at `LATEST`, so copied historical rows are not replayed.
Coordinate any migration or deployment with the owners of the source resources.
