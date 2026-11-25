# Reserved documentation networks used only for static configuration checks.
internal_alb            = true
ingress_ipv4_cidr       = "192.0.2.0/24"
https_egress_ipv4_cidrs = ["198.51.100.0/24"]
smtp_ipv4_cidrs         = ["203.0.113.0/24"]
bucket_name             = "nexusflow-example-staging"
certificate_arn         = "arn:aws:acm:ap-south-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
