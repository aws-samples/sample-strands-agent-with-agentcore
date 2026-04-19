/**
 * Elicitation Complete API endpoint
 *
 * Writes the OAuth completion signal directly to the shared DynamoDB store
 * that the orchestrator's elicitation_bridge reads. We do NOT call the
 * orchestrator runtime here — the runtime only trusts user JWTs, and this
 * request originates from a popup context where the Amplify session is
 * sometimes not hydrated yet. The BFF (ECS task) has IAM permissions on the
 * shared DynamoDB users table, so it can write the signal directly.
 *
 * Keeping the backend's /invocations handler for `elicitation_complete`
 * is also fine for local/dev testing, but cloud traffic skips it.
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'
const TABLE_NAME = process.env.DYNAMODB_USERS_TABLE || 'strands-agent-chatbot-users-v2'

const dynamoClient = new DynamoDBClient({ region: AWS_REGION })

const COMPLETION_TTL_SECONDS = 600

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId: string | undefined = body.sessionId
    const elicitationId: string | undefined = body.elicitationId

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 }
      )
    }

    const eid = elicitationId || '__all__'
    const now = Math.floor(Date.now() / 1000)

    await dynamoClient.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        userId: { S: `ELICIT#${sessionId}` },
        sk: { S: `EID#${eid}` },
        status: { S: 'completed' },
        ttl: { N: String(now + COMPLETION_TTL_SECONDS) },
      },
    }))

    console.log(`[Elicitation] Signalled in DynamoDB: session=${sessionId}, eid=${eid}`)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[Elicitation] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
