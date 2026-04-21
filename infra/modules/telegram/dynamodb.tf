resource "aws_dynamodb_table" "dedup" {
  name         = "${local.name_prefix}-dedup"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "message_id"

  attribute {
    name = "message_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = { Component = "telegram" }
}
