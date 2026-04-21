output "ecs_service_name" {
  value = aws_ecs_service.telegram.name
}

output "dedup_table_name" {
  value = aws_dynamodb_table.dedup.name
}
