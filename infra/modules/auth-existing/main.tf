# This module publishes references in the destination account only.
# It never imports, updates, or destroys the source Cognito resources.
variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "existing_auth" {
  type = object({
    user_pool_id  = string
    domain        = string
    app_client_id = string
    web_client_id = string
    m2m_client_id = string
  })
}
variable "m2m_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

locals {
  issuer_url = "https://cognito-idp.${var.aws_region}.amazonaws.com/${var.existing_auth.user_pool_id}"
  parameters = {
    "user-pool-id"  = var.existing_auth.user_pool_id
    "app-client-id" = var.existing_auth.app_client_id
    "web-client-id" = var.existing_auth.web_client_id
    "m2m-client-id" = var.existing_auth.m2m_client_id
    "issuer-url"    = local.issuer_url
  }
}

resource "aws_ssm_parameter" "auth" {
  for_each = local.parameters
  name     = "/${var.project_name}/${var.environment}/auth/${each.key}"
  type     = "String"
  value    = each.value
}

output "user_pool_id" { value = var.existing_auth.user_pool_id }
output "domain" { value = var.existing_auth.domain }
output "domain_url" { value = "https://${var.existing_auth.domain}.auth.${var.aws_region}.amazoncognito.com" }
output "issuer_url" { value = local.issuer_url }
output "discovery_url" { value = "${local.issuer_url}/.well-known/openid-configuration" }
output "app_client_id" { value = var.existing_auth.app_client_id }
output "web_client_id" { value = var.existing_auth.web_client_id }
output "m2m_client_id" { value = var.existing_auth.m2m_client_id }
output "m2m_client_secret" {
  value     = var.m2m_client_secret
  sensitive = true
}
