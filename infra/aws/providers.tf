provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "loupgarou"
      ManagedBy = "terraform"
      Stack     = "aws"
    }
  }
}
