# Response style comparisons

These opt-in evaluations call real Bedrock models and incur usage charges. They
are not part of pytest. Credentials stay in memory and are never written to the
results. Use the application's Python environment (boto3 and httpx required).

Before changing the prompt, save a baseline from the repository root:

```sh
python - <<'PYTHON'
import json
import runpy
from pathlib import Path
runner = runpy.run_path('chatbot-app/agentcore/tests/evals/compare_response_style.py')
Path('/tmp/response-style-baseline.json').write_text(json.dumps(runner['load_current_prompts']()))
PYTHON
```

Then edit the prompt and compare it with that baseline, using
`AWS_BEARER_TOKEN_BEDROCK` or `--secret-id` with your own Secrets Manager secret:

```sh
python chatbot-app/agentcore/tests/evals/compare_response_style.py \
  --baseline /tmp/response-style-baseline.json \
  --output /tmp/response-style-new-run \
  --models us.openai.gpt-5.6-terra us.openai.gpt-5.6-sol
```

Use `--cases file_success --repetitions 3` to repeat a subset. Output must be a
new or empty directory. Each run saves the exact before/after prompts and every
response, including failures. A failed or incomplete request exits nonzero.

Each pair uses identical messages, fixed evidence, date, model, and settings.
The runner sends the shared system prompt through the same Responses
`instructions` field used by the application's Strands model adapter. It does
not execute tools, load the live skill catalog, render UI, or test deployed
sessions. The 4096-token output cap keeps this small evaluation bounded; the
application allows larger outputs. No temperature or reasoning override is set.

Review correctness separately from tone using each case's criteria. In
particular, check net revenue versus gross revenue, unverified file/QA claims,
consistent units, language continuity, and whether failure recovery is useful.
Do not infer naturalness from response length, passing keyword checks, or HTTP
success. Model sampling varies; preserve unfavorable examples and repeat
suspected regressions before claiming improvement. These are development cases,
not a held-out or statistically significant benchmark.

`--evidence-role user` supports a separate sensitivity check of task-data
placement; the default remains `developer` for comparability with earlier runs.
The chosen role is saved per response. Do not mix differently configured pairs
when reporting prompt-only comparisons.

To exercise actual tool selection and result handling through the app's model
factory and Strands, using a local fixture that always returns an access error:

```sh
AWS_REGION=us-west-2 \
python chatbot-app/agentcore/tests/evals/exercise_response_style_agent.py \
  --prompts /tmp/response-style-new-run/prompts.json \
  --output /tmp/response-style-agent-new.jsonl
```

This second runner requires the application's full Python dependencies and makes
billable model calls. It does not access a real shared drive. Each run records
the actual tool calls, conversation messages, final response and stop reason;
it is not a deployed browser E2E test.

The fixture uses an English request by default. Use `--message` for another
language. The comparison cases deliberately include both English and multilingual
preference-continuity checks; none of these fixtures becomes a runtime default.
