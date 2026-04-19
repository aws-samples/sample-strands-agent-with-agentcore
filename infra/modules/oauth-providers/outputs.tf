output "google_provider_arn" {
  value = local.google_enabled ? aws_bedrockagentcore_oauth2_credential_provider.google[0].credential_provider_arn : ""
}

output "github_provider_arn" {
  value = local.github_enabled ? aws_bedrockagentcore_oauth2_credential_provider.github[0].credential_provider_arn : ""
}

output "notion_provider_arn" {
  value = local.notion_enabled ? aws_bedrockagentcore_oauth2_credential_provider.notion[0].credential_provider_arn : ""
}
