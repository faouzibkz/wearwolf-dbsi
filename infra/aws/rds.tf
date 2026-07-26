############################################################################
# Postgres database. Notable choices:
#
#   - password = random_password.db_password.result: a password Terraform
#     generates itself (see secrets.tf), never typed by a human, never
#     hardcoded. We use this instead of RDS's own manage_master_user_password
#     feature because that feature stores ONLY the password in Secrets
#     Manager — but Prisma needs one single assembled DATABASE_URL
#     connection string, and ECS can only inject a secret's raw value into
#     one env var, it can't stitch several secrets into one string at
#     runtime. So secrets.tf composes the full connection string itself
#     (using this same random password) and stores THAT as the secret ECS
#     actually injects. Same security property, different mechanism.
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

  password = random_password.db_password.result

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
