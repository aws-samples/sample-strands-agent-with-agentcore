output "alb_dns" {
  value = aws_lb.this.dns_name
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "cognito_login_url" {
  value = "https://${var.cognito_user_pool_domain}.auth.${var.aws_region}.amazoncognito.com/login?client_id=${var.cognito_user_pool_client_id}&response_type=code&scope=openid+email+profile&redirect_uri=https://${aws_cloudfront_distribution.this.domain_name}/oauth2/idpresponse"
}
