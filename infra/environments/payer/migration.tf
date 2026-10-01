# Initial infrastructure migration retains the existing user identities.
variable "destination_account_id" {
  description = "Only this destination AWS account may be managed by the payer environment."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.destination_account_id))
    error_message = "Provide the 12-digit destination AWS account ID."
  }
}

variable "existing_auth" {
  type = object({
    user_pool_id  = string
    domain        = string
    app_client_id = string
    web_client_id = string
    m2m_client_id = string
  })
}

data "aws_secretsmanager_secret_version" "existing_cognito_m2m" {
  secret_id = "${var.project_name}/migration/cognito-m2m"
}

locals {
  existing_auth_m2m               = jsondecode(data.aws_secretsmanager_secret_version.existing_cognito_m2m.secret_string)
  existing_auth_m2m_client_secret = local.existing_auth_m2m.clientSecret
}

variable "telegram_desired_count" {
  type    = number
  default = 0
  validation {
    condition     = contains([0, 1], var.telegram_desired_count)
    error_message = "Telegram receiver must be stopped or a single task."
  }
}

check "existing_cognito_client_matches" {
  assert {
    condition     = local.existing_auth_m2m.clientId == var.existing_auth.m2m_client_id && length(local.existing_auth_m2m_client_secret) > 0
    error_message = "Retained Cognito M2M secret must match the configured client."
  }
}

variable "background_processing_enabled" {
  description = "Enable only after data migration and pending-work reconciliation."
  type        = bool
  default     = false
}
