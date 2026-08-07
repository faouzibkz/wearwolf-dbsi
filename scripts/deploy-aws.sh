#!/usr/bin/env bash
set -euo pipefail

############################################################################
# One-shot AWS environment bootstrap — for a fresh clone of this repo, or
# for a first-time deploy to a brand new AWS account.
#
# What this does, in order: creates the Terraform remote-state backend,
# provisions the entire AWS stack (VPC/RDS/ECR/ECS/ALB/DNS/ACM/GitHub OIDC
# role), wires up your GitHub repo's Actions variable so the CI pipeline
# can deploy too, builds and pushes both Docker images, then tells ECS to
# deploy them. It pauses before every `terraform apply` so you can read the
# plan first — nothing billable happens without you explicitly confirming.
#
# PREREQUISITES:
#   - AWS CLI installed and configured (`aws configure`) with a real IAM
#     user/role that has enough permissions to create all of the above.
#     Terraform uses these same credentials — there's no separate
#     "Terraform credential" to set up.
#   - Terraform >= 1.5 installed
#   - Docker installed and running
#   - A domain you own with a Route53 hosted zone already existing in this
#     AWS account (Route53 creates one automatically when you register a
#     domain through it; if registered elsewhere, create the hosted zone
#     yourself and point your registrar's nameservers at it first — this
#     one step can't be automated, it requires you to actually own a domain)
#   - Optional: GitHub CLI (`gh`) installed and logged in (`gh auth login`)
#     — if present, this script sets your repo's AWS_APP_DEPLOY_ROLE_ARN
#     variable for you automatically; otherwise it just prints the value
#     and where to paste it.
#
# You do NOT need to hand-edit any file before running this — bucket
# names, the domain, and the GitHub repo are all resolved automatically or
# prompted for below.
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

echo "== Checking prerequisites =="
missing=()
for cmd in aws terraform docker; do
  command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required tool(s): ${missing[*]}" >&2
  echo "Install them, then re-run this script." >&2
  exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "AWS CLI isn't authenticated yet." >&2
  echo "Run 'aws configure' with your IAM access key ID and secret access key, then re-run this script." >&2
  echo "(Same credentials Terraform will use — nothing separate to set up for it.)" >&2
  exit 1
fi
echo "AWS CLI authenticated as: $(aws sts get-caller-identity --query Arn --output text)"

HAVE_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  HAVE_GH=1
  echo "GitHub CLI authenticated — will set the repo variable for you automatically."
else
  echo "GitHub CLI not available/authenticated — you'll get manual instructions for the last step instead."
fi

echo
read -r -p "GitHub repo (owner/repo), used to restrict who can assume the CI role: " GITHUB_REPO
if [[ -z "$GITHUB_REPO" ]]; then
  echo "GitHub repo is required (variables.tf's github_repository has no default, on purpose)." >&2
  exit 1
fi

read -r -p "Your domain (apex, e.g. example.com — must already be a Route53 hosted zone in this AWS account): " DOMAIN_NAME
if [[ -z "$DOMAIN_NAME" ]]; then
  echo "Domain is required (variables.tf's domain_name has no default, on purpose)." >&2
  exit 1
fi

echo
echo "== Step 1/6: Terraform state backend (S3 + DynamoDB) =="
echo "   (one-time only — safe to re-run, it'll just show 'no changes' if it already exists)"
pushd infra/bootstrap >/dev/null
terraform init
terraform plan -out=tfplan
confirm "Apply the plan above?"
terraform apply tfplan
STATE_BUCKET=$(terraform output -raw state_bucket_name)
LOCK_TABLE=$(terraform output -raw lock_table_name)
BOOTSTRAP_REGION=$(terraform output -raw region)
popd >/dev/null

echo
echo "== Step 2/6: Core AWS infrastructure (VPC, RDS, ECR, ECS, ALB, DNS, ACM, CI role) =="
pushd infra/aws >/dev/null
# backend.tf is deliberately partial (no hardcoded bucket — see that file's
# comment for why); these -backend-config flags are what point THIS run at
# the bucket/table Step 1 just created in YOUR account.
terraform init \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="dynamodb_table=$LOCK_TABLE" \
  -backend-config="region=$BOOTSTRAP_REGION" \
  -reconfigure
terraform plan -var="github_repository=$GITHUB_REPO" -var="domain_name=$DOMAIN_NAME" -out=tfplan
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
echo "== Step 3/6: Wire up the GitHub Actions pipeline =="
# Three repo variables the workflow (.github/workflows/app-deploy.yml)
# needs and deliberately does NOT hardcode, precisely so that forking this
# repo never silently builds pointing at the original deployment's domain:
#   AWS_APP_DEPLOY_ROLE_ARN — lets the workflow assume the OIDC role
#   SITE_URL                — baked into the web image as NEXT_PUBLIC_SERVER_URL
#   AWS_REGION               — which region to deploy into (defaults to eu-west-3 if unset)
if [[ "$HAVE_GH" -eq 1 ]]; then
  if gh variable set AWS_APP_DEPLOY_ROLE_ARN --repo "$GITHUB_REPO" --body "$APP_DEPLOY_ROLE_ARN" \
    && gh variable set SITE_URL --repo "$GITHUB_REPO" --body "$SITE_URL" \
    && gh variable set AWS_REGION --repo "$GITHUB_REPO" --body "$AWS_REGION"; then
    echo "Set AWS_APP_DEPLOY_ROLE_ARN, SITE_URL, and AWS_REGION on $GITHUB_REPO automatically."
  else
    echo "Automatic gh variable set failed — you'll need to set these manually (see the summary at the end)." >&2
    HAVE_GH=0
  fi
else
  echo "Skipping — see the manual instructions printed at the end."
fi

echo
echo "== Step 4/6: Docker login to ECR =="
REGISTRY="${ECR_WEB%/*}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo
echo "== Step 5/6: Build + push images =="
docker build -f apps/web/Dockerfile -t "$ECR_WEB:latest" --build-arg NEXT_PUBLIC_SERVER_URL="$SITE_URL" .
docker push "$ECR_WEB:latest"
docker build -f apps/server/Dockerfile -t "$ECR_SERVER:latest" .
docker push "$ECR_SERVER:latest"

echo
echo "== Step 6/6: Deploy to ECS =="
aws ecs update-service --cluster "$CLUSTER" --service loupgarou-web --force-new-deployment --region "$AWS_REGION" >/dev/null
aws ecs update-service --cluster "$CLUSTER" --service loupgarou-server --force-new-deployment --region "$AWS_REGION" >/dev/null

cat <<EOF

Done. Give it 1-2 minutes for tasks to become healthy, then visit:
  $SITE_URL

EOF

if [[ "$HAVE_GH" -eq 0 ]]; then
  cat <<EOF
To finish wiring up the GitHub Actions pipeline (.github/workflows/app-deploy.yml),
add these three as repository VARIABLES (not secrets — none of them are sensitive) at
  https://github.com/$GITHUB_REPO/settings/variables/actions

  AWS_APP_DEPLOY_ROLE_ARN = $APP_DEPLOY_ROLE_ARN
  SITE_URL                = $SITE_URL
  AWS_REGION              = $AWS_REGION

EOF
fi

cat <<EOF
Once those variables are set, pushing to master (touching apps/** or packages/**)
automatically rebuilds both images and redeploys them to ECS — no need to
run this script again except after infra changes (new resources in infra/aws).
EOF
