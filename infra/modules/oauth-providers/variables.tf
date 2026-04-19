variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "google_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "notion_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "notion_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}
