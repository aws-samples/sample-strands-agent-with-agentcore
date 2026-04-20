locals {
  src_dir   = "${var.source_root}/${var.tool_name}"
  build_dir = "${path.module}/.build/${var.tool_name}"
  zip_path  = "${path.module}/.build/${var.tool_name}.zip"
  fn_name   = "${var.project_name}-${var.environment}-tool-${var.tool_name}"

  # Source hash = lambda_function.py + requirements.txt (if present).
  source_hash = sha1(join("", compact([
    fileexists("${local.src_dir}/lambda_function.py") ? filesha1("${local.src_dir}/lambda_function.py") : "",
    fileexists("${local.src_dir}/requirements.txt") ? filesha1("${local.src_dir}/requirements.txt") : "",
  ])))
}

# ----------------------------------------------------------------
# Build: pip install deps into build dir, copy source file.
# Produces <module>/.build/<tool>.zip gated by source_hash.
# ----------------------------------------------------------------

resource "null_resource" "build" {
  triggers = {
    source_hash = local.source_hash
    # Force rebuild when the .build output directory has been wiped out of band
    # (branch switch, manual cleanup). Without this, data.archive_file below
    # fails at plan time because null_resource.build doesn't rerun on hash alone.
    build_present = fileexists("${local.build_dir}/lambda_function.py") ? "present" : "missing"
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      rm -rf "${local.build_dir}"
      mkdir -p "${local.build_dir}"
      cp "${local.src_dir}/lambda_function.py" "${local.build_dir}/"
      if [ -f "${local.src_dir}/requirements.txt" ]; then
        # Binary-only on ARM64 Linux for compiled deps; fall back to any-platform
        # for pure-Python deps that only ship as sdist (e.g., sgmllib3k).
        pip install -q --upgrade --target "${local.build_dir}" \
          --platform manylinux2014_aarch64 --implementation cp --python-version 3.13 \
          --only-binary=:all: \
          -r "${local.src_dir}/requirements.txt" \
        || pip install -q --upgrade --target "${local.build_dir}" \
          --prefer-binary \
          -r "${local.src_dir}/requirements.txt"
      fi
    EOT
  }
}

data "archive_file" "zip" {
  type        = "zip"
  source_dir  = local.build_dir
  output_path = local.zip_path
  depends_on  = [null_resource.build]
}

# ----------------------------------------------------------------
# IAM
# ----------------------------------------------------------------

resource "aws_iam_role" "this" {
  name = "${local.fn_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "logs" {
  name = "logs"
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:aws:logs:${var.aws_region}:${var.account_id}:*"
    }]
  })
}

resource "aws_iam_role_policy" "secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0
  name  = "secrets"
  role  = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secret_arns
    }]
  })
}

# ----------------------------------------------------------------
# Function
# ----------------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.fn_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_s3_object" "zip" {
  count  = var.upload_to_s3 ? 1 : 0
  bucket = var.artifact_bucket
  key    = "lambda-tools/${var.tool_name}/${local.source_hash}.zip"
  source = data.archive_file.zip.output_path
  etag   = data.archive_file.zip.output_md5
}

resource "aws_lambda_function" "this" {
  function_name = local.fn_name
  role          = aws_iam_role.this.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.13"
  architectures = ["arm64"]
  timeout       = var.timeout
  memory_size   = var.memory_size

  filename         = var.upload_to_s3 ? null : data.archive_file.zip.output_path
  s3_bucket        = var.upload_to_s3 ? var.artifact_bucket : null
  s3_key           = var.upload_to_s3 ? aws_s3_object.zip[0].key : null
  source_code_hash = data.archive_file.zip.output_base64sha256

  environment {
    variables = merge(
      {
        PROJECT_NAME = var.project_name
        ENVIRONMENT  = var.environment
      },
      var.env_vars,
    )
  }

  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.logs, aws_s3_object.zip]
}
