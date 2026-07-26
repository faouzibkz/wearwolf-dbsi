output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "availability_zones" {
  value = local.azs
}

output "db_endpoint" {
  description = "Postgres connection endpoint, host:port. Only reachable from inside the VPC (i.e. from the ECS tasks) — this won't be pingable from your laptop."
  value       = aws_db_instance.main.endpoint
}

output "db_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the auto-generated master password. The ECS task definition (next stack) reads this directly — nobody ever types or sees the actual password."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}
