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

output "database_url_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the full assembled DATABASE_URL. The ECS task definition reads this directly — nobody ever types or sees the actual value."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "admin_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the admin dashboard's auth secret."
  value       = aws_secretsmanager_secret.admin_secret.arn
}

output "ecr_web_repository_url" {
  description = "Push web images here, e.g. docker push <this>:latest"
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_server_repository_url" {
  description = "Push server images here."
  value       = aws_ecr_repository.server.repository_url
}

output "alb_dns_name" {
  description = "The ALB's own AWS-generated URL — useful for debugging, but the real entry point is site_url below."
  value       = aws_lb.main.dns_name
}

output "site_url" {
  description = "The real, public HTTPS URL for the game once DNS + the cert are live. This is what NEXT_PUBLIC_SERVER_URL and CORS_ORIGIN should be set to."
  value       = "https://${var.domain_name}"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_web_service_name" {
  value = aws_ecs_service.web.name
}

output "ecs_server_service_name" {
  value = aws_ecs_service.server.name
}

output "region" {
  value = var.aws_region
}

output "github_actions_app_deploy_role_arn" {
  description = "Add this as a repository VARIABLE (not secret — it's not sensitive) in GitHub: Settings -> Secrets and variables -> Actions -> Variables, named AWS_APP_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_actions_app_deploy.arn
}
