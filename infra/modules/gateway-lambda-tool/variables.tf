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

variable "tool_name" {
  description = "Tool id (matches directory under source_root)"
  type        = string
}

variable "source_root" {
  description = "Absolute path to the directory containing <tool_name>/lambda_function.py"
  type        = string
}

variable "secret_arns" {
  description = "Secrets Manager ARNs this Lambda may read"
  type        = list(string)
  default     = []
}

variable "env_vars" {
  description = "Extra environment variables"
  type        = map(string)
  default     = {}
}

variable "timeout" {
  type    = number
  default = 30
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "artifact_bucket" {
  description = "S3 bucket for large Lambda artifacts (>50MB). When upload_to_s3 = true, zip is uploaded here instead of inlined."
  type        = string
  default     = ""
}

variable "upload_to_s3" {
  description = "If true, upload zip to artifact_bucket instead of inlining (needed for packages >70MB)."
  type        = bool
  default     = false
}
