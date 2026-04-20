# AgentCore Registry — Custom Resource via Lambda + CloudFormation stack.
#
# AgentCore Registry / RegistryRecord have no Terraform provider. We wrap the
# boto3 API in a Lambda, invoke it as a CFN Custom Resource, and let CFN drive
# Create/Update/Delete lifecycle. Definitions live in YAML under
# infra/registry/definitions/ and are split into mcp/, a2a/, and skills/.
#
# Records are batched into 3 stacks by type (mcp, a2a, skills) to minimize
# CloudFormation stack count while keeping type-level isolation.

data "aws_caller_identity" "current" {}

locals {
  registry_name  = "${var.project_name}-${var.environment}-registry"
  function_name  = "${var.project_name}-${var.environment}-registry-manager"
  definitions_root = "${path.module}/../../registry/definitions"
  skills_md_root   = "${var.repo_root}/chatbot-app/agentcore/skills"

  # -- MCP defs --------------------------------------------------------------
  _mcp_files = fileset("${local.definitions_root}/mcp", "*.yaml")
  mcp_defs = {
    for f in local._mcp_files :
    trimsuffix(f, ".yaml") => merge(
      yamldecode(file("${local.definitions_root}/mcp/${f}")),
      { descriptor_type = "MCP" }
    )
  }

  # -- A2A defs --------------------------------------------------------------
  _a2a_files = fileset("${local.definitions_root}/a2a", "*.yaml")
  a2a_defs = {
    for f in local._a2a_files :
    trimsuffix(f, ".yaml") => merge(
      yamldecode(file("${local.definitions_root}/a2a/${f}")),
      { descriptor_type = "A2A" }
    )
  }

  # -- AGENT_SKILLS defs -----------------------------------------------------
  _skill_files = fileset("${local.definitions_root}/skills", "*.yaml")
  skill_defs = {
    for f in local._skill_files :
    trimsuffix(f, ".yaml") => merge(
      yamldecode(file("${local.definitions_root}/skills/${f}")),
      {
        descriptor_type = "AGENT_SKILLS"
        skill_md = file("${local.skills_md_root}/${yamldecode(file("${local.definitions_root}/skills/${f}")).skill_md_path}")
      }
    )
  }

  # MCP records get "-mcp-server" suffix; A2A and AGENT_SKILLS use the bare
  # name. A skill YAML that shares a basename with an A2A definition is used
  # only for its SKILL.md content — the record uses the A2A descriptor.
  _mcp_records   = { for k, v in local.mcp_defs : "${k}-mcp-server" => v }
  _a2a_records   = { for k, v in local.a2a_defs : k => v }
  _skill_records = {
    for k, v in local.skill_defs : k => v
    if !contains(keys(local.a2a_defs), k)
  }

  all_records = merge(local._mcp_records, local._a2a_records, local._skill_records)

  records_to_register = {
    for k, v in local.all_records : k => v
    if length(var.enabled_components) == 0 || contains(var.enabled_components, k)
  }

  # Split records by type for batched stacks
  mcp_records = { for k, v in local.records_to_register : k => v if v.descriptor_type == "MCP" }
  a2a_records = { for k, v in local.records_to_register : k => v if v.descriptor_type == "A2A" }
  skill_records = { for k, v in local.records_to_register : k => v if v.descriptor_type == "AGENT_SKILLS" }
}

# ============================================================
# Registry Manager Lambda
# ============================================================

resource "aws_iam_role" "registry_manager" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "registry_manager" {
  name = "registry-manager-policy"
  role = aws_iam_role.registry_manager.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateRegistry",
          "bedrock-agentcore:GetRegistry",
          "bedrock-agentcore:UpdateRegistry",
          "bedrock-agentcore:DeleteRegistry",
          "bedrock-agentcore:ListRegistries",
          "bedrock-agentcore:CreateRegistryRecord",
          "bedrock-agentcore:GetRegistryRecord",
          "bedrock-agentcore:UpdateRegistryRecord",
          "bedrock-agentcore:DeleteRegistryRecord",
          "bedrock-agentcore:ListRegistryRecords",
          "bedrock-agentcore:SubmitRegistryRecordForApproval",
          "bedrock-agentcore:UpdateRegistryRecordStatus",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateWorkloadIdentity",
          "bedrock-agentcore:GetWorkloadIdentity",
          "bedrock-agentcore:UpdateWorkloadIdentity",
          "bedrock-agentcore:DeleteWorkloadIdentity",
          "bedrock-agentcore:ListWorkloadIdentities",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_lambda_function" "registry_manager" {
  function_name    = local.function_name
  filename         = "${path.module}/lambda/registry-manager.zip"
  source_code_hash = filemd5("${path.module}/lambda/registry-manager.zip")
  handler          = "index.lambda_handler"
  runtime          = "python3.14"
  timeout          = 300
  memory_size      = 256
  role             = aws_iam_role.registry_manager.arn

  tags = {
    Component = "registry"
  }
}

# ============================================================
# Registry (Custom Resource)
# ============================================================

resource "aws_cloudformation_stack" "registry" {
  name = "${var.project_name}-${var.environment}-registry"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      Registry = {
        Type = "Custom::AgentCoreRegistry"
        Properties = {
          ServiceToken        = aws_lambda_function.registry_manager.arn
          Action              = "MANAGE_REGISTRY"
          RegistryName        = local.registry_name
          RegistryDescription = "Central catalog for ${var.project_name} (${var.environment})"
          AutoApproval        = "true"
        }
      }
    }
    Outputs = {
      RegistryId = {
        Value = { "Fn::GetAtt" = ["Registry", "RegistryId"] }
      }
    }
  })

  depends_on = [aws_lambda_function.registry_manager]
}

# ============================================================
# Registry Records — batched by type (3 stacks total)
# ============================================================

# Helper: build CFN resource properties for a single record
locals {
  _record_properties = {
    for k, v in local.records_to_register : k => merge(
      {
        ServiceToken      = aws_lambda_function.registry_manager.arn
        Action            = "MANAGE_RECORD"
        RegistryId        = aws_cloudformation_stack.registry.outputs["RegistryId"]
        RecordName        = k
        RecordDescription = v.description
        RecordVersion     = "1.0.0"
        DescriptorType    = v.descriptor_type
      },
      v.descriptor_type == "AGENT_SKILLS" ? {
        SkillMdContent = v.skill_md
      } : {},
      v.descriptor_type == "A2A" ? {
        AgentCardJson = jsonencode(v.agent_card)
      } : {},
      v.descriptor_type == "MCP" ? {
        ServerName        = "${var.project_name}/${lookup(lookup(v, "server", {}), "name", "${v.name}-mcp-server")}"
        ServerDescription = v.description
        DisplayName       = lookup(v, "display_name", v.name)
        ToolsJson         = jsonencode({ tools = [
          for t in v.tools : {
            name        = t.name
            description = t.description
            inputSchema = {
              type        = t.input_type
              description = lookup(t, "input_description", null)
              properties = {
                for p in t.properties : p.name => merge(
                  { type = p.type },
                  lookup(p, "description", null) == null ? {} : { description = p.description }
                )
              }
              required = [for p in t.properties : p.name if lookup(p, "required", false)]
            }
          }
        ] })
      } : {}
    )
  }
}

# --- MCP Records Stack ---
resource "aws_cloudformation_stack" "records_mcp" {
  count = length(local.mcp_records) > 0 ? 1 : 0
  name  = "${var.project_name}-${var.environment}-records-mcp"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      for k, _ in local.mcp_records : "Record${replace(replace(k, "-", ""), "_", "")}" => {
        Type = "Custom::AgentCoreRegistryRecord"
        Properties = local._record_properties[k]
      }
    }
    Outputs = {
      for k, _ in local.mcp_records : "RecordId${replace(replace(k, "-", ""), "_", "")}" => {
        Value = { "Fn::GetAtt" = ["Record${replace(replace(k, "-", ""), "_", "")}", "RecordId"] }
      }
    }
  })

  depends_on = [aws_cloudformation_stack.registry]
}

# --- A2A Records Stack ---
resource "aws_cloudformation_stack" "records_a2a" {
  count = length(local.a2a_records) > 0 ? 1 : 0
  name  = "${var.project_name}-${var.environment}-records-a2a"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      for k, _ in local.a2a_records : "Record${replace(replace(k, "-", ""), "_", "")}" => {
        Type = "Custom::AgentCoreRegistryRecord"
        Properties = local._record_properties[k]
      }
    }
    Outputs = {
      for k, _ in local.a2a_records : "RecordId${replace(replace(k, "-", ""), "_", "")}" => {
        Value = { "Fn::GetAtt" = ["Record${replace(replace(k, "-", ""), "_", "")}", "RecordId"] }
      }
    }
  })

  depends_on = [aws_cloudformation_stack.registry]
}

# --- Skills Records Stacks (one stack per record) ---
# Bundled SKILL.md content exceeds CFN's 51,200-byte inline template limit.
resource "aws_cloudformation_stack" "records_skills" {
  for_each = local.skill_records
  name     = "${var.project_name}-${var.environment}-record-${each.key}"

  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Resources = {
      Record = {
        Type = "Custom::AgentCoreRegistryRecord"
        Properties = local._record_properties[each.key]
      }
    }
    Outputs = {
      RecordId = {
        Value = { "Fn::GetAtt" = ["Record", "RecordId"] }
      }
    }
  })

  depends_on = [aws_cloudformation_stack.registry]
}

# ============================================================
# SSM
# ============================================================

resource "aws_ssm_parameter" "registry_id" {
  name  = "/${var.project_name}/${var.environment}/registry/registry-id"
  type  = "String"
  value = aws_cloudformation_stack.registry.outputs["RegistryId"]
}
