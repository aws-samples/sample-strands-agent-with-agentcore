data "aws_caller_identity" "current" {}

locals {
  name_prefix   = "${var.project_name}-${var.environment}-tg"
  prefix        = "${var.project_name}-${var.environment}-tg"
  account_id    = var.account_id
  app_dir       = "${var.repo_root}/telegram-app"
  ecr_repo_name = "${var.project_name}/telegram"
  s3_source_key = "telegram/${local.source_hash}.zip"

  source_hash = sha1(join("", concat(
    [for f in sort(fileset("${local.app_dir}/src", "**/*.ts")) : filesha1("${local.app_dir}/src/${f}")],
    [
      filesha1("${local.app_dir}/package.json"),
      filesha1("${local.app_dir}/tsconfig.json"),
      filesha1("${local.app_dir}/Dockerfile"),
    ],
  )))
}
