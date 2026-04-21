import pino from "pino";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  runtimeInvocationUrl: required("RUNTIME_INVOCATION_URL"),
  cognitoTokenUrl: required("COGNITO_TOKEN_URL"),
  m2mClientId: required("M2M_CLIENT_ID"),
  m2mClientSecret: required("M2M_CLIENT_SECRET"),
  dedupTableName: required("DEDUP_TABLE_NAME"),
  artifactBucket: process.env["ARTIFACT_BUCKET"] ?? "",
  ownerUserId: process.env["OWNER_USER_ID"] ?? "",
  allowedUserIds: (process.env["ALLOWED_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n)),
  logLevel: (process.env["LOG_LEVEL"] ?? "info") as pino.Level,
  healthPort: parseInt(process.env["HEALTH_PORT"] ?? "8080", 10),
} as const;

export const logger = pino({ level: config.logLevel });
