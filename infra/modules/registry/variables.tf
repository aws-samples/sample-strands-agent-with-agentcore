variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "repo_root" {
  description = "Absolute path to repo root (SKILL.md files live under chatbot-app/agentcore/skills)"
  type        = string
}

variable "enabled_components" {
  description = "Whitelist of component names (YAML basenames) to register. Empty = register all discovered definitions."
  type        = list(string)
  default     = []
}

variable "gateway_url" {
  description = "AgentCore Gateway invocation URL. MCP records for gateway-sourced tools use this as their sync endpoint."
  type        = string
  default     = ""
}

variable "gateway_role_arn" {
  description = "IAM role ARN for SigV4 authentication to the Gateway."
  type        = string
  default     = ""
}

variable "mcp_runtime_url" {
  description = "MCP 3LO Runtime invocation URL. MCP records for 3LO-sourced tools use this as their sync endpoint."
  type        = string
  default     = ""
}

variable "mcp_runtime_role_arn" {
  description = "IAM role ARN for SigV4 authentication to the MCP 3LO Runtime."
  type        = string
  default     = ""
}

variable "a2a_runtime_urls" {
  description = "Map of A2A agent name to Runtime invocation URL."
  type        = map(string)
  default     = {}
}

variable "a2a_runtime_role_arns" {
  description = "Map of A2A agent name to IAM role ARN for SigV4 authentication."
  type        = map(string)
  default     = {}
}
