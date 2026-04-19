terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Purpose   = "tf-state-bootstrap"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "project_name" {
  type    = string
  default = "strands-agent-chatbot"
}

data "aws_caller_identity" "current" {}

locals {
  state_bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  lock_table   = "${var.project_name}-tflock"
}

resource "aws_s3_bucket" "tfstate" {
  bucket        = local.state_bucket
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tflock" {
  name         = local.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.tflock.name
}

output "backend_hcl" {
  description = "Paste into environments/*/backend.tf"
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.tfstate.bucket}"
    dynamodb_table = "${aws_dynamodb_table.tflock.name}"
    region         = "${var.aws_region}"
    encrypt        = true
  EOT
}
