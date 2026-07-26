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
