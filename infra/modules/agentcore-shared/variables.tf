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

variable "nova_act_workflow_name" {
  description = "Nova Act Workflow Definition Name. Create via: aws nova-act create-workflow-definition --name <name>."
  type        = string
  default     = ""
}
