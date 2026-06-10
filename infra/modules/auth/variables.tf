variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "callback_urls" {
  type    = list(string)
  default = ["http://localhost:3000/api/auth/callback"]
}

variable "logout_urls" {
  type    = list(string)
  default = ["http://localhost:3000"]
}

variable "enable_cowork" {
  description = "Provision a separate Cognito client dedicated to the Cowork sidecar so its refresh tokens are not invalidated when the main app client is modified."
  type        = bool
  default     = false
}

variable "cowork_callback_urls" {
  description = "Callback URLs registered on the Cowork-only Cognito client (typically http://127.0.0.1:8976/callback)."
  type        = list(string)
  default     = []
}
