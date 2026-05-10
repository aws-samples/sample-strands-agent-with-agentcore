"""Cognito USER_PASSWORD_AUTH helper for e2e tests.

Uses the web client (no secret) so no SECRET_HASH is required.

Returns the **access token** — AgentCore Runtime's JWT authorizer validates
the `client_id` claim, which is present on access tokens but not on ID
tokens (ID tokens carry `aud` instead). The frontend uses `accessToken`
for the same reason (see `chatbot-app/frontend/src/lib/api-client.ts`).
"""

from __future__ import annotations

import boto3

_token_cache: dict[tuple[str, str], str] = {}


def get_access_token(
    region: str,
    client_id: str,
    username: str,
    password: str,
) -> str:
    """Return a Cognito access token, caching per (client_id, username) for the session.

    Raises RuntimeError with an actionable message if Cognito returns a challenge
    (e.g. FORCE_CHANGE_PASSWORD on first login).
    """
    key = (client_id, username)
    if key in _token_cache:
        return _token_cache[key]

    client = boto3.client("cognito-idp", region_name=region)
    resp = client.initiate_auth(
        AuthFlow="USER_PASSWORD_AUTH",
        ClientId=client_id,
        AuthParameters={"USERNAME": username, "PASSWORD": password},
    )

    if "ChallengeName" in resp:
        raise RuntimeError(
            f"Cognito returned challenge {resp['ChallengeName']!r} for {username!r}. "
            "Complete the challenge once (e.g. set a permanent password via "
            "`aws cognito-idp admin-set-user-password --permanent`) and retry. "
            "See tests/integration/e2e/README.md."
        )

    auth = resp.get("AuthenticationResult") or {}
    token = auth.get("AccessToken")
    if not token:
        raise RuntimeError(f"Cognito response missing AccessToken: {resp!r}")

    _token_cache[key] = token
    return token
