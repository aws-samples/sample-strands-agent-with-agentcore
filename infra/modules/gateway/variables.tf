variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}

# Inbound JWT auth
variable "cognito_issuer_url" {
  type = string
}

variable "cognito_allowed_clients" {
  description = "Cognito client IDs allowed to invoke this Gateway"
  type        = list(string)
}

# Lambda tool arns, keyed by tool id (e.g., tavily, wikipedia)
variable "lambda_tool_arns" {
  description = "Map of tool id → Lambda function ARN"
  type        = map(string)
  default     = {}
}

# MCP Runtime targets (e.g., mcp-3lo). Keyed by target name → runtime invocation URL.
variable "runtime_targets" {
  description = "Map of target name → Runtime invocation URL (MCP over HTTP)"
  type        = map(string)
  default     = {}
}

# Outbound OAuth2 credential provider ARN (for runtime targets). Optional — when empty, GATEWAY_IAM_ROLE is used.
variable "oauth2_credential_provider_arn" {
  type    = string
  default = ""
}
