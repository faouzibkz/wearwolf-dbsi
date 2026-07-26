############################################################################
# ECS cluster, task definitions, and services.
#
# One constraint drives a key decision here: the server keeps live game
# state in memory (packages/game-engine), not just in Postgres. It MUST
# run as exactly one task, always — desired_count = 1, no auto-scaling,
# ever. The web app is stateless and could scale, but there's no reason
# to for a 10-20 player game, so it's pinned to 1 as well.
############################################################################

resource "aws_ecs_cluster" "main" {
  name = "loupgarou-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # extra CloudWatch metrics/cost; not worth it at this scale
  }

  tags = {
    Name = "loupgarou-cluster"
  }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/loupgarou-web"
  retention_in_days = 14 # without this, logs accumulate forever and quietly cost more over time

  tags = {
    Name = "loupgarou-web-logs"
  }
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/loupgarou-server"
  retention_in_days = 14

  tags = {
    Name = "loupgarou-server-logs"
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "loupgarou-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc" # required for Fargate
  cpu                      = "256"    # 0.25 vCPU
  memory                   = "512"    # 0.5 GB
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  # No task_role_arn — the web app never calls an AWS API directly.

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.web.repository_url}:latest"
      essential = true
      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]
      # No secrets/env vars: NEXT_PUBLIC_SERVER_URL is baked into the
      # Next.js build at IMAGE-BUILD time (apps/web/Dockerfile), not read
      # at container-start time, so there's nothing to inject here.
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])

  tags = {
    Name = "loupgarou-web-task"
  }
}

resource "aws_ecs_task_definition" "server" {
  family                   = "loupgarou-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = "${aws_ecr_repository.server.repository_url}:latest"
      essential = true
      portMappings = [
        { containerPort = 4000, protocol = "tcp" }
      ]
      environment = [
        { name = "SERVER_PORT", value = "4000" },
        { name = "CORS_ORIGIN", value = "https://${var.domain_name}" },
      ]
      # "secrets", not "environment" — AWS resolves these from Secrets
      # Manager at container start and injects the real value directly
      # into the process env. The value itself never appears in the task
      # definition, the console, or any log.
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "ADMIN_SECRET", valueFrom = aws_secretsmanager_secret.admin_secret.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "server"
        }
      }
    }
  ])

  tags = {
    Name = "loupgarou-server-task"
  }
}

resource "aws_ecs_service" "web" {
  name            = "loupgarou-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true # needed to reach ECR/CloudWatch — see the "public subnets, no NAT" decision in vpc.tf
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  # A target group can't be attached to an ECS service until it's actually
  # wired to a listener — this makes that ordering explicit rather than
  # relying on Terraform to infer it.
  depends_on = [aws_lb_listener.https]

  tags = {
    Name = "loupgarou-web-service"
  }
}

resource "aws_ecs_service" "server" {
  name            = "loupgarou-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = 1 # must stay 1 — the game keeps live state in memory, see packages/game-engine
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 4000
  }

  depends_on = [aws_lb_listener.https]

  tags = {
    Name = "loupgarou-server-service"
  }
}
