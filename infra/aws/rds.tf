############################################################################
# Postgres database. Notable choices:
#
#   - manage_master_user_password = true: RDS generates a strong random
#     password itself and stores it in AWS Secrets Manager. Nobody — not
#     us, not this file, not Terraform state in plain text — ever sees or
#     types the actual password. The ECS task definition (next stack)
#     will reference the secret by ARN, and AWS injects it into the
#     container's environment at startup. This is the standard modern
#     pattern for any DB credential; a plaintext password variable is
#     what we're deliberately avoiding.
#
#   - db.t4g.micro, 20GB gp3, single-AZ: matches the RDS free tier
#     (750 hrs/month, only for a new account's first 12 months). If that
#     doesn't apply to your account, this runs roughly $12-15/month.
#
#   - publicly_accessible = false, and the security group below only
#     allows inbound from the ECS tasks security group. This database
#     cannot be reached from the public internet at all, by anyone.
############################################################################

resource "aws_db_subnet_group" "main" {
  name       = "loupgarou-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "loupgarou-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name        = "loupgarou-rds-sg"
  description = "Allows Postgres traffic only from the ECS tasks security group"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "loupgarou-rds-sg"
  }
}

# Identity-based rule: the *source* is another security group, not an IP
# range. Any task that ends up in aws_security_group.ecs_tasks can reach
# port 5432, regardless of what private IP it's assigned — much more
# robust than hardcoding a CIDR block that could drift out of date.
resource "aws_vpc_security_group_ingress_rule" "rds_from_ecs" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.ecs_tasks.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from ECS tasks"
}

resource "aws_db_instance" "main" {
  identifier     = "loupgarou-db"
  engine         = "postgres"
  engine_version = "17" # major version only — RDS picks the latest supported minor (currently 17.9) automatically
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username

  manage_master_user_password = true

  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  publicly_accessible     = false
  multi_az                = false

  backup_retention_period = 7
  skip_final_snapshot     = true # fine for a hobby project — flip to false + set final_snapshot_identifier if this ever holds data you can't afford to lose

  tags = {
    Name = "loupgarou-db"
  }
}
