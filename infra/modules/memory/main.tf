locals {
  memory_name = replace("${var.project_name}_${var.environment}_memory", "-", "_")
}

resource "aws_iam_role" "memory_execution" {
  name = "${var.project_name}-${var.environment}-memory-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "memory_execution" {
  role       = aws_iam_role.memory_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy"
}

resource "aws_bedrockagentcore_memory" "this" {
  name                      = local.memory_name
  description               = "Agent memory for ${var.project_name} ${var.environment}"
  event_expiry_duration     = var.event_expiry_days
  memory_execution_role_arn = aws_iam_role.memory_execution.arn

  tags = {
    Component = "memory"
  }
}

resource "aws_bedrockagentcore_memory_strategy" "semantic" {
  name       = "semantic_fact_extraction"
  memory_id  = aws_bedrockagentcore_memory.this.id
  type       = "SEMANTIC"
  namespaces = ["/strategies/{memoryStrategyId}/actors/{actorId}"]
}

resource "aws_bedrockagentcore_memory_strategy" "user_preference" {
  name       = "user_preference_extraction"
  memory_id  = aws_bedrockagentcore_memory.this.id
  type       = "USER_PREFERENCE"
  namespaces = ["/strategies/{memoryStrategyId}/actors/{actorId}"]
}

resource "aws_bedrockagentcore_memory_strategy" "summary" {
  name       = "conversation_summary"
  memory_id  = aws_bedrockagentcore_memory.this.id
  type       = "SUMMARIZATION"
  namespaces = ["/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}"]
}

resource "aws_ssm_parameter" "memory_id" {
  name  = "/${var.project_name}/${var.environment}/memory/memory-id"
  type  = "String"
  value = aws_bedrockagentcore_memory.this.id
}
