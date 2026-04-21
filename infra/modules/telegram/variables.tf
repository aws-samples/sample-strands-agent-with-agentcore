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

variable "repo_root" {
  description = "Absolute path to repository root."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "runtime_invocation_url" {
  description = "AgentCore Runtime invocation URL."
  type        = string
}

variable "cognito_domain_url" {
  description = "Cognito domain URL (e.g. https://xxx.auth.region.amazoncognito.com)."
  type        = string
}

variable "m2m_client_id" {
  description = "Cognito M2M client ID."
  type        = string
}

variable "m2m_client_secret" {
  description = "Cognito M2M client secret."
  type        = string
  sensitive   = true
}

variable "telegram_bot_token" {
  description = "Telegram Bot API token from BotFather."
  type        = string
  sensitive   = true
}

variable "allowed_user_ids" {
  description = "Comma-separated Telegram user IDs for allowlist (empty = allow all)."
  type        = string
  default     = ""
}

variable "owner_user_id" {
  description = "Cognito user ID to use for AgentCore sessions (links Telegram to web identity)."
  type        = string
  default     = ""
}

variable "artifact_bucket_arn" {
  description = "ARN of the S3 bucket storing workspace artifacts (PPTX, DOCX, XLSX)."
  type        = string
  default     = ""
}
