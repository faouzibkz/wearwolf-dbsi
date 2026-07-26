############################################################################
# This is the main, ongoing infrastructure stack for the project — VPC,
# RDS, ECS, ALB all live here as one Terraform root module, built up file
# by file. Its state is stored remotely in the S3 bucket + DynamoDB table
# created by ../bootstrap (see that folder's main.tf for why).
############################################################################

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "loupgarou-terraform-state-442932344443"
    key            = "aws/terraform.tfstate" # path *within* the bucket for this stack's state
    region         = "eu-west-3"
    dynamodb_table = "loupgarou-terraform-locks"
    encrypt        = true
  }
}
