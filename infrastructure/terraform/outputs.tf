output "alb_dns" { value = aws_lb.main.dns_name }
output "instance_id" { value = aws_instance.app.id }
output "db_endpoint" { value = aws_db_instance.main.address }
output "db_bootstrap_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "objects_bucket" { value = aws_s3_bucket.objects.bucket }
