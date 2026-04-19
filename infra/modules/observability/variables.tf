variable "resource_name" {
  description = "Identifier for the AgentCore resource (e.g., 'gateway', 'memory')"
  type        = string
}

variable "resource_arn" {
  description = "ARN of the AgentCore resource to enable observability for"
  type        = string
}

variable "aws_region" {
  type = string
}

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}
