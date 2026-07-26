############################################################################
# Lets GitHub Actions authenticate to AWS WITHOUT a stored long-lived
# access key/secret in GitHub. Instead: GitHub's own OIDC token service
# issues a short-lived signed token to each workflow run, AWS trusts that
# token (via this "identity provider" resource) only for this specific
# repo, and the workflow exchanges it for temporary AWS credentials
# (sts:AssumeRoleWithWebIdentity) that expire on their own. Nothing to
# rotate, nothing that leaks if a secret ever gets logged by accident.
#
# Just one role for now — github_actions_app_deploy — scoped to only what
# the build/push/deploy pipeline needs (push to our 2 ECR repos, update
# our 2 ECS services). No Terraform-driving CI role yet; that's a
# separate, deliberately-postponed piece (it would need much broader
# permissions since Terraform touches everything it manages).
############################################################################

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"] # GitHub's documented OIDC root CA thumbprint

  tags = {
    Name = "github-actions-oidc"
  }
}

# --- App deploy role: build/push images, redeploy ECS. Restricted to  ---
# --- runs triggered from pushes to master, in this exact repo, only.  ---
# --- (master, not main — this repo's working branch is master.)      ---

resource "aws_iam_role" "github_actions_app_deploy" {
  name = "loupgarou-github-actions-app-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/master"
        }
      }
    }]
  })

  tags = {
    Name = "loupgarou-github-actions-app-deploy"
  }
}

resource "aws_iam_role_policy" "github_actions_app_deploy" {
  name = "loupgarou-app-deploy-permissions"
  role = aws_iam_role.github_actions_app_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ECR requires this specific action to be unscoped (Resource "*") —
        # it's how you fetch a login token, not access to any particular repo.
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = [
          aws_ecr_repository.web.arn,
          aws_ecr_repository.server.arn,
        ]
      },
      {
        Sid    = "EcsDeploy"
        Effect = "Allow"
        Action = [
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:DescribeServices",
        ]
        Resource = "*" # ECS task definitions/describe calls don't support resource-level restriction the way ECR does
      },
      {
        # Needed because RegisterTaskDefinition requires permission to hand
        # the execution role to ECS — scoped to exactly that one role, and
        # only when ECS itself is the service doing the assuming.
        Sid      = "PassExecutionRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.ecs_execution.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}
