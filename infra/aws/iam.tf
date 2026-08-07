############################################################################
# IAM. Two distinct roles ECS supports:
#
#   - Execution role: used by the ECS AGENT itself (not your app code) to
#     pull images from ECR, write logs to CloudWatch, and fetch secrets and
#     inject them into the container at startup. Built from AWS's managed
#     AmazonECSTaskExecutionRolePolicy, plus one extra inline policy scoped
#     to read exactly our secrets and nothing else.
#
#   - Task role: the identity your APPLICATION CODE would assume to call
#     other AWS APIs at runtime. Nothing in this app calls an AWS API from
#     inside the container, so this role grants exactly one thing: the
#     ssmmessages permissions ECS Exec needs to open an interactive shell
#     into the SERVER task (see ecs.tf's enable_execute_command) — used
#     for one-off maintenance like running `npx prisma db push` against
#     the (deliberately private, unreachable-from-a-laptop) RDS instance.
############################################################################

resource "aws_iam_role" "ecs_execution" {
  name = "loupgarou-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = {
    Name = "loupgarou-ecs-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "loupgarou-ecs-read-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.admin_secret.arn,
        aws_secretsmanager_secret.auth_jwt_secret.arn,
      ]
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "loupgarou-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = {
    Name = "loupgarou-ecs-task-role"
  }
}

# The exact 4 actions AWS's ECS Exec documentation requires — nothing
# broader. Resource "*" is correct here: these actions don't support
# resource-level scoping (they operate on the SSM data channel for
# whichever task the AWS CLI's `ecs execute-command` targets, which is
# already gated by IAM permissions on the *caller* of that command, not by
# this role).
resource "aws_iam_role_policy" "ecs_exec_ssm" {
  name = "loupgarou-ecs-exec-ssm"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  })
}
