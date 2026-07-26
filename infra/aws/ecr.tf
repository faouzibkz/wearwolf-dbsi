############################################################################
# ECR (Elastic Container Registry) — private Docker registries for our two
# images. Think of these as "our own private Docker Hub," one repo per
# app. GitHub Actions will push here later; ECS pulls from here to run.
############################################################################

resource "aws_ecr_repository" "web" {
  name                 = "loupgarou-web"
  image_tag_mutability = "MUTABLE" # allows re-pushing e.g. a "latest" tag; fine for a small project without strict release discipline

  image_scanning_configuration {
    scan_on_push = true # free vulnerability scan of OS packages every time an image is pushed
  }

  tags = {
    Name = "loupgarou-web"
  }
}

resource "aws_ecr_repository" "server" {
  name                 = "loupgarou-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "loupgarou-server"
  }
}

# Lifecycle policy: without this, every image you ever push stays forever
# and you pay storage for all of them. This keeps only the 10 most recent
# images per repo and expires the rest automatically.
resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
