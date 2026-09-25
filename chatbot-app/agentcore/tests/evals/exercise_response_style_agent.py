"""Opt-in live-model smoke test through the app's model factory and Strands.

The model chooses and executes a local fixture tool. No real drive is accessed.
Requires app dependencies and its usual Bedrock credentials; incurs model usage.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src'))

from strands import Agent, tool
from agents.model_factory import build_model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompts', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--message', default='Read the weekly operations report from the shared drive and briefly summarize it.')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a new output file to preserve earlier evidence')
    prompts = json.loads(args.prompts.read_text())
    message = args.message

    def run(model, variant):
        calls = []

        @tool
        def read_weekly_report() -> dict:
            """Read the weekly operations report from the shared drive."""
            result = {'status': 'error', 'error': 'HTTP 403 AccessDenied',
                      'detail': 'The current account cannot read this report.',
                      'retryable': False,
                      'recovery': 'User can upload a copy or grant sharing access.'}
            calls.append(result)
            return result

        agent = Agent(model=build_model(model, max_tokens=4096),
                      system_prompt=prompts[variant]['normal'],
                      tools=[read_weekly_report], callback_handler=None)
        result = agent(message)
        return {'model': model, 'variant': variant, 'message': message,
                'tool_results': calls, 'text': str(result),
                'stop_reason': result.stop_reason, 'messages': agent.messages}

    jobs = [(model, variant) for model in ('us.openai.gpt-5.6-terra', 'us.openai.gpt-5.6-sol')
            for variant in ('before', 'after')]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as output, concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda job: run(*job), jobs):
            output.write(json.dumps(result, ensure_ascii=False, default=str) + '\n')
            output.flush()
            print(result['model'], result['variant'], len(result['tool_results']), result['text'], flush=True)
            if not result['tool_results'] or result['stop_reason'] != 'end_turn':
                raise RuntimeError('Agent did not complete the fixture tool flow')


if __name__ == '__main__':
    main()
