############################################################################
# Application Load Balancer. One public entry point, one domain, routed by
# PATH rather than by subdomain:
#
#   - everything else  -> web target group (Next.js, port 3000)
#   - "/socket.io/*"    -> server target group (Socket.IO, port 4000)
#
# Routing by path instead of subdomain means the web app and the Socket.IO
# connection share one origin (once the domain's attached, just
# https://loupgarou-dbsi.com for both). That's simpler than two subdomains:
# NEXT_PUBLIC_SERVER_URL can literally be the same domain, Socket.IO
# defaults to same-origin, and we only need one ACM certificate covering
# one name instead of two. "/socket.io/*" is the actual path Socket.IO
# uses by default for its handshake/polling/websocket traffic — nothing
# to configure app-side to make this match.
#
# HTTP-only for now (port 80) — no ACM cert yet, the domain is still
# finishing registration. Once it's ready we'll add an HTTPS listener on
# 443 and make port 80 just redirect to it.
############################################################################

resource "aws_lb" "main" {
  name               = "loupgarou-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = {
    Name = "loupgarou-alb"
  }
}

resource "aws_lb_target_group" "web" {
  name        = "loupgarou-web-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # required for Fargate's awsvpc network mode — targets are registered by IP, not instance ID

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = {
    Name = "loupgarou-web-tg"
  }
}

resource "aws_lb_target_group" "server" {
  name        = "loupgarou-server-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health" # apps/server/src/index.ts already exposes this, returns 200 + JSON
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = {
    Name = "loupgarou-server-tg"
  }
}

# Port 80 no longer serves traffic directly — it exists only to redirect
# browsers straight to 443. This is the standard pattern: nobody should
# ever actually load content over plain HTTP once a cert exists.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06" # modern policy: TLS 1.2 minimum, prefers 1.3
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "socketio" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }

  condition {
    path_pattern {
      values = ["/socket.io/*"]
    }
  }
}

# --- Security group rules tying the ALB to the internet and to the tasks ---

resource "aws_vpc_security_group_ingress_rule" "alb_http_from_internet" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port          = 80
  to_port            = 80
  ip_protocol        = "tcp"
  description        = "HTTP from anywhere (redirects straight to HTTPS)"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_internet" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port          = 443
  to_port            = 443
  ip_protocol        = "tcp"
  description        = "HTTPS from anywhere"
}

resource "aws_vpc_security_group_ingress_rule" "ecs_tasks_from_alb_web" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  description                  = "Web app port, ALB only"
}

resource "aws_vpc_security_group_ingress_rule" "ecs_tasks_from_alb_server" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 4000
  to_port                      = 4000
  ip_protocol                  = "tcp"
  description                  = "Server port, ALB only"
}
