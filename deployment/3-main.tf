terraform {
  backend "s3" {
    bucket  = "chatt-app-terraform-state"
    key     = "staging/chatapp-tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

locals {
  prefix = var.prefix

  common_tags = {
    Environment = terraform.workspace
    Project     = var.project
    ManagedBy   = "Terraform"
    Owner       = "Chris Kalla"

  }
}

