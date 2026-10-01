terraform {
  required_version = ">= 1.11.0"

  # Backend config (bucket, region) is injected by
  # infra/scripts/deploy.sh via -backend-config flags.
  backend "s3" {
    key          = "payer/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.32"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  allowed_account_ids = [var.destination_account_id]
  region              = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

