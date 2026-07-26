############################################################################
# Security groups, created "bare" here (no inline ingress/egress rules).
# Actual rules are added as their own separate aws_vpc_security_group_*_rule
# resources, in whichever file first needs them — rds.tf (this same commit)
# already adds one for ecs_tasks -> rds. The alb and ecs stack (next) will
# add the rest (internet -> alb, alb -> ecs_tasks).
#
# Why separate rule resources instead of the classic inline
# `ingress { ... }` blocks on aws_security_group? Two reasons: (1) it lets
# different files/stacks add rules to the same group without having to
# edit or fully re-declare it, and (2) it avoids a well-known Terraform
# footgun where an inline block silently deletes any rule not listed in it.
############################################################################

resource "aws_security_group" "alb" {
  name        = "loupgarou-alb-sg"
  description = "Public-facing security group for the Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "loupgarou-alb-sg"
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "loupgarou-ecs-tasks-sg"
  description = "Security group for the web + server ECS Fargate tasks"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "loupgarou-ecs-tasks-sg"
  }
}

# Explicit outbound rules. Tasks need to reach ECR (to pull images),
# Secrets Manager (to fetch DATABASE_URL/ADMIN_SECRET), and CloudWatch
# Logs (to ship logs) — all public AWS API endpoints, reached over the
# public internet path since these subnets have no NAT Gateway or VPC
# endpoints. The ALB also needs outbound access to actually forward
# requests to the tasks on 3000/4000. Being explicit here instead of
# assuming AWS's automatic default-allow-all-egress rule survives on a
# bare security group avoids exactly the timeout failures just seen.
resource "aws_vpc_security_group_egress_rule" "ecs_tasks_all_outbound" {
  security_group_id = aws_security_group.ecs_tasks.id
  cidr_ipv4          = "0.0.0.0/0"
  ip_protocol        = "-1" # all protocols/ports
  description        = "All outbound - needed to reach ECR, Secrets Manager, CloudWatch Logs"
}

resource "aws_vpc_security_group_egress_rule" "alb_all_outbound" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  ip_protocol        = "-1"
  description        = "All outbound - needed to forward requests to ECS tasks"
}
