#!/usr/bin/env bash
set -euo pipefail

############################################################################
# One-shot AWS environment bootstrap — for a fresh clone of this repo, or
# for a first-time deploy to a brand new AWS account.
#
# What this does, in order: creates the Terraform remote-state backend,
# provisions the entire AWS stack (VPC/RDS/ECR/ECS/ALB/DNS/ACM/GitHub
# OIDC roles), builds and pushes both Docker images, then tells ECS to
# deploy them. It pauses before every `terraform apply` so you can read
# the plan first — nothing billable happens without you explicitly
# confirming with 'y'.
#
# PREREQUISITES (see README.md "Deploying to AWS" for the full walkthrough):
#   - AWS CLI installed and configured (`aws configure`)
#   - Terraform >= 1.5 installed
#   - Docker installed and running
#   - A domain registered in Route53 (or transferred in), with its own
#     hosted zone already existing
#   - You've edited infra/aws/variables.tf's domain_name default (or will
#     pass -var domain_name=... yourself) to match your actual domain
#   - You've changed the S3 bucket name in infra/bootstrap/main.tf AND
#     the "bucket" in infra/aws/backend.tf to something globally unique —
#     S3 bucket names are unique across ALL of AWS, not just your
#     account, so the name already in this repo (tied to the original
#     author's AWS account ID) will fail for you with a "bucket already
#     exists" error until you change it.
#   - You know your GitHub repo as "owner/repo" — this script prompts for it.
#
# Usage: ./scripts/deploy-aws.sh
############################################################################

cd "$(dirname "$0")/.."  # always run from the repo root, regardless of where this script is invoked from

confirm() {
  read -r -p "$1 [y/N] " reply
  case "$reply" in
    [yY][eE][sS]|[yY]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
}

read -r -p "GitHub repo (owner/repo), used to restrict who can assume the CI roles: " GITHUB_REPO
if [[ -z "$GITHUB_REPO" ]]; then
  echo "GitHub repo is required (variables.tf's github_repository has no default, on purpose)." >&2
  exit 1
fi

echo
echo "== Step 1/5: Terraform state backend (S3 + DynamoDB) =="
echo "   (one-time only — safe to skip this step on subsequent runs once it exists)"
pushd infra/bootstrap >/dev/null
terraform init
terraform plan -out=tfplan
confirm "Apply the plan above?"
terraform apply tfplan
popd >/dev/null

echo
echo "== Step 2/5: Core AWS infrastructure (VPC, RDS, ECR, ECS, ALB, DNS, ACM, CI roles) =="
pushd infra/aws >/dev/null
terraform init
terraform plan -var="github_repository=$GITHUB_REPO" -out=tfplan
confirm "Apply the plan above? This provisions billable resources (RDS, ALB, Fargate, etc.)."
terraform apply tfplan
ECR_WEB=$(terraform output -raw ecr_web_repository_url)
ECR_SERVER=$(terraform output -raw ecr_server_repository_url)
SITE_URL=$(terraform output -raw site_url)
AWS_REGION=$(terraform output -raw region)
CLUSTER=$(terraform output -raw ecs_cluster_name)
APP_DEPLOY_ROLE_ARN=$(terraform output -raw github_actions_app_deploy_role_arn)
popd >/dev/null

echo
echo "== Step 3/5: Docker login to ECR =="
REGISTRY="${ECR_WEB%/*}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo
echo "== Step 4/5: Build + push images =="
docker build -f apps/web/Dockerfile -t "$ECR_WEB:latest" --build-arg NEXT_PUBLIC_SERVER_URL="$SITE_URL" .
docker push "$ECR_WEB:latest"
docker build -f apps/server/Dockerfile -t "$ECR_SERVER:latest" .
docker push "$ECR_SERVER:latest"

echo
echo "== Step 5/5: Deploy to ECS =="
aws ecs update-service --cluster "$CLUSTER" --service loupgarou-web --force-new-deployment --region "$AWS_REGION" >/dev/null
aws ecs update-service --cluster "$CLUSTER" --service loupgarou-server --force-new-deployment --region "$AWS_REGION" >/dev/null

cat <<EOF

Done. Give it 1-2 minutes for tasks to become healthy, then visit:
  $SITE_URL

To finish wiring up the GitHub Actions pipeline (.github/workflows/app-deploy.yml),
add this as a repository VARIABLE (not secret — it's not sensitive) at
  https://github.com/$GITHUB_REPO/settings/variables/actions

  AWS_APP_DEPLOY_ROLE_ARN = $APP_DEPLOY_ROLE_ARN

After that, pushing to main (touching apps/** or packages/**) automatically
rebuilds both images and redeploys them to ECS.
EOF
