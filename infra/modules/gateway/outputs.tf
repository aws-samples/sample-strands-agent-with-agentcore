output "gateway_id" {
  value = aws_bedrockagentcore_gateway.this.gateway_id
}

output "gateway_arn" {
  value = aws_bedrockagentcore_gateway.this.gateway_arn
}

output "gateway_url" {
  value = aws_bedrockagentcore_gateway.this.gateway_url
}

output "gateway_role_arn" {
  value = aws_iam_role.gateway.arn
}
