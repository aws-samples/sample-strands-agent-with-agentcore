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
