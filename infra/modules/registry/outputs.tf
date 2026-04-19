output "registry_id" {
  value = aws_cloudformation_stack.registry.outputs["RegistryId"]
}

output "registry_name" {
  value = local.registry_name
}

output "mcp_definitions" {
  description = "Parsed MCP YAML definitions (map of name => def). Gateway module reuses this to build tool targets."
  value       = local.mcp_defs
}

output "a2a_definitions" {
  value = local.a2a_defs
}

output "skill_definitions" {
  value = local.skill_defs
}
