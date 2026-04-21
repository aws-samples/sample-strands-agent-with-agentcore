import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { config, logger } from "./config.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function isDuplicate(messageId: string): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: config.dedupTableName,
        Item: {
          message_id: messageId,
          ttl: Math.floor(Date.now() / 1000) + 3600,
        },
        ConditionExpression: "attribute_not_exists(message_id)",
      }),
    );
    return false;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      logger.debug({ messageId }, "Duplicate message");
      return true;
    }
    throw err;
  }
}
