############################################################################
# This is the main, ongoing infrastructure stack for the project — VPC,
# RDS, ECS, ALB all live here as one Terraform root module, built up file
# by file. Its state is stored remotely in the S3 bucket + DynamoDB table
# created by ../bootstrap (see that folder's main.tf for why).
#
# The backend block below is DELIBERATELY PARTIAL — Terraform doesn't allow
# variables/expressions inside a "backend" block (it has to be resolvable
# before any provider or state exists), and the bucket/table names are
# account-specific (see bootstrap/main.tf). So bucket/region/dynamodb_table
# are supplied at `terraform init` time via -backend-config flags instead
# of being hardcoded here — that's what makes this whole stack copy-paste
# reusable across AWS accounts. scripts/deploy-aws.sh does this for you
# automatically, reading bootstrap's own outputs. Doing it by hand looks
# like:
#
#   terraform init \
#     -backend-config="bucket=<bootstrap output: state_bucket_name>" \
#     -backend-config="dynamodb_table=<bootstrap output: lock_table_name>" \
#     -backend-config="region=<bootstrap output: region>"
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
    key     = "aws/terraform.tfstate" # path *within* the bucket for this stack's state — same for everyone, safe to hardcode
    encrypt = true
    # bucket, region, dynamodb_table: supplied via -backend-config, see above.
  }
}
