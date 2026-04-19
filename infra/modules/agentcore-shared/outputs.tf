output "code_interpreter_id" {
  value = aws_bedrockagentcore_code_interpreter.this.code_interpreter_id
}

output "code_interpreter_arn" {
  value = aws_bedrockagentcore_code_interpreter.this.code_interpreter_arn
}

output "browser_id" {
  value = aws_bedrockagentcore_browser.this.browser_id
}

output "browser_arn" {
  value = aws_bedrockagentcore_browser.this.browser_arn
}

output "browser_name" {
  value = aws_bedrockagentcore_browser.this.name
}

output "nova_act_workflow_name" {
  value = var.nova_act_workflow_name
}
