############################################################################
# IAM. Two distinct roles ECS supports — this project only needs one of
# them:
#
#   - Execution role: used by the ECS AGENT itself (not your app code) to
#     pull images from ECR, write logs to CloudWatch, and fetch the two
#     secrets and inject them into the container at startup. Built from
#     AWS's managed AmazonECSTaskExecutionRolePolicy, plus one extra
#     inline policy scoped to read exactly our two secrets and nothing
#     else.
#
#   - Task role: the identity your APPLICATION CODE would assume to call
#     other AWS APIs at runtime (e.g. if it wrote to S3 directly). Nothing
#     in this app calls any AWS API from inside the container, so there is
#     no task role at all — the task definitions simply omit
#     task_role_arn. That's deliberate, not an oversight.
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
      ]
    }]
  })
}
