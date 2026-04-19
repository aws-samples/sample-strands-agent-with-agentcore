# AgentCore OAuth2 Credential Providers for MCP 3LO Runtime.
#
# Each provider is optional — enabled only when both client_id and client_secret
# are supplied. Callback URL is not exposed as a Terraform attribute, so we fetch
# it post-create via AWS CLI and write it to SSM. The orchestrator and MCP 3LO
# runtime read this SSM param to set the OAuth2CallbackUrl header.

locals {
  google_enabled = var.google_client_id != "" && var.google_client_secret != ""
  github_enabled = var.github_client_id != "" && var.github_client_secret != ""
  notion_enabled = var.notion_client_id != "" && var.notion_client_secret != ""
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "google" {
  count = local.google_enabled ? 1 : 0

  name                       = "google-oauth-provider"
  credential_provider_vendor = "GoogleOauth2"

  oauth2_provider_config {
    google_oauth2_provider_config {
      client_id     = var.google_client_id
      client_secret = var.google_client_secret
    }
  }
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "github" {
  count = local.github_enabled ? 1 : 0

  name                       = "github-oauth-provider"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id     = var.github_client_id
      client_secret = var.github_client_secret

      oauth_discovery {
        authorization_server_metadata {
          issuer                 = "https://github.com"
          authorization_endpoint = "https://github.com/login/oauth/authorize"
          token_endpoint         = "https://github.com/login/oauth/access_token"
        }
      }
    }
  }
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "notion" {
  count = local.notion_enabled ? 1 : 0

  name                       = "notion-oauth-provider"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id     = var.notion_client_id
      client_secret = var.notion_client_secret

      oauth_discovery {
        authorization_server_metadata {
          issuer                 = "https://api.notion.com"
          authorization_endpoint = "https://api.notion.com/v1/oauth/authorize"
          token_endpoint         = "https://api.notion.com/v1/oauth/token"
        }
      }
    }
  }
}

# Note: The OAuth2 callback URL registered with each OAuth app (Google/GitHub/Notion)
# is the CloudFront distribution URL (https://<cloudfront>/oauth-complete).
# It is written to SSM by the chat module after CloudFront is created.
# See modules/chat/main.tf :: aws_ssm_parameter.oauth_callback_url.
