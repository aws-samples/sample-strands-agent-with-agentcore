variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "event_expiry_days" {
  type    = number
  default = 90
}
