############################################################################
# TLS certificate, validated via DNS (the standard, no-manual-steps
# method). ACM certificates used with an ALB are free and auto-renew
# forever as long as the validation DNS records stay in place — which
# they will, since Terraform manages them permanently, not just once.
############################################################################

resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "loupgarou-cert"
  }
}

# ACM tells us, for each name on the certificate, exactly which DNS record
# to create to prove we control the domain. This builds one Route53
# record per name (apex + www) straight from that list instead of us
# copy-pasting values out of the console by hand.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

# Blocks here until ACM actually observes the validation records resolve
# and marks the certificate ISSUED. Apply will pause on this step for
# roughly 30s-a few minutes while DNS propagates — that wait is expected.
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
