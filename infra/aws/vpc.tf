############################################################################
# Networking. Two kinds of subnet:
#
#   - "public" subnets: hold the ALB and the ECS tasks (web + server). They
#     have a route to the internet gateway, and tasks get a public IP so
#     they can pull images from ECR / talk to CloudWatch. They are NOT
#     wide open, though — a security group (defined in the ECS stack, once
#     we get there) only allows inbound traffic from the ALB. This avoids
#     paying for a NAT Gateway (~$32+/month) while staying just as secure,
#     since nothing on the internet can reach a task's ports directly
#     regardless of it having a public IP.
#
#   - "private" subnets: hold RDS only. No route to the internet at all —
#     Postgres never needs to initiate outbound traffic, so it doesn't need
#     one. Resources within the same VPC can always reach each other over
#     their private IPs without needing any internet route.
############################################################################

# Query AWS for the AZs actually available in this region/account, instead
# of hardcoding "eu-west-3a" etc. — AZ availability can vary by account.
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "loupgarou-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "loupgarou-igw"
  }
}

# cidrsubnet(base, 8, N) carves a /24 out of the /16 base CIDR, offset by N.
# With vpc_cidr = 10.0.0.0/16, this produces 10.0.0.0/24, 10.0.1.0/24, ...
resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "loupgarou-public-${local.azs[count.index]}"
  }
}

# Offset by +10 (10.0.10.0/24, 10.0.11.0/24) purely so public/private
# ranges are easy to tell apart at a glance — no functional difference.
resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = local.azs[count.index]

  tags = {
    Name = "loupgarou-private-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "loupgarou-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private route table has no 0.0.0.0/0 route at all — intentionally. That
# absence is what makes these subnets "private": nothing in them can reach
# or be reached from the internet.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "loupgarou-private-rt"
  }
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
