output "state_bucket_name" {
  description = "Name of the S3 bucket holding Terraform state for every other stack."
  value       = aws_s3_bucket.tf_state.bucket
}

output "lock_table_name" {
  description = "Name of the DynamoDB table used for Terraform state locking."
  value       = aws_dynamodb_table.tf_locks.name
}

output "region" {
  description = "Region everything in this project lives in."
  value       = var.aws_region
}
