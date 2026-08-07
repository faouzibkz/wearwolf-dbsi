############################################################################
# Bootstrap stack — creates the S3 bucket + DynamoDB table that ALL OTHER
# Terraform stacks in this project (infra/aws/...) will use as their remote
# state backend.
#
# This is a classic chicken-and-egg problem: you can't tell Terraform to
# store its state in an S3 bucket that doesn't exist yet. So this one small
# stack is the one exception in the whole project that uses local state
# (a terraform.tfstate file, gitignored, sitting right here on disk).
#
# You run this ONCE, ever, per environment. After it exists, you never touch
# it again except in rare cases (e.g. deleting the whole project).
############################################################################

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Deliberately no "backend" block here — this stack's state lives locally.
}

variable "aws_region" {
  description = "AWS region the state bucket + lock table (and everything else) live in."
  type        = string
  default     = "eu-west-3" # Paris — lowest latency for players in France
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "loupgarou"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

# S3 bucket names must be globally unique across ALL of AWS, not just your
# account — so this can't be a fixed string (two different people running
# this same repo would collide). The account ID is a cheap, guaranteed-unique
# suffix that requires no input from whoever's running this.
data "aws_caller_identity" "current" {}

# S3 bucket to hold every other stack's state file.
resource "aws_s3_bucket" "tf_state" {
  bucket = "loupgarou-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true # refuse to destroy this even if you run `terraform destroy` here by mistake
  }
}

# Versioning: if state ever gets corrupted or a bad apply overwrites it,
# you can roll back to a previous version of the state file.
resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Encrypt state at rest. State files can contain sensitive values
# (e.g. DB passwords if you're not careful), so this is not optional.
resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Belt-and-braces: make sure nobody can accidentally make this bucket public.
resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# DynamoDB table for state locking: prevents two "terraform apply" runs
# from racing each other and corrupting the state file. Not needed if
# you're 100% sure you'll never run terraform from two places at once,
# but it's cheap (pay-per-request, a few cents a month at most) and it's
# the standard, correct way to do this.
resource "aws_dynamodb_table" "tf_locks" {
  name         = "loupgarou-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
