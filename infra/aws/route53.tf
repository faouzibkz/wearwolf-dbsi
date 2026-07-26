############################################################################
# DNS. The hosted zone already exists — Route53 created it automatically
# the moment you registered the domain — so we look it up rather than
# create a new one (creating a duplicate would just conflict).
############################################################################

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ALBs don't have a static IP (they can scale to more nodes and change
# addresses any time), so a normal A record can't point at one reliably,
# and a CNAME isn't allowed at a zone's apex per the DNS spec. An "alias"
# record is Route53's own record type that solves both problems: it
# behaves like an A record at the apex, but transparently tracks whatever
# IPs the ALB currently has.
resource "aws_route53_record" "apex" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
