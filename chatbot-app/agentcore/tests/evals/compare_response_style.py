"""Compare saved baseline/current prompts using real models and fixed evidence.

No tools are executed. Fixed evidence removes tool variability; model sampling
still varies, so these comparisons are qualitative rather than deterministic.
Credentials stay in memory. The output contains synthetic test cases and answers.
Run from any directory; requires boto3 and httpx (application dependencies).
"""
import argparse
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import time

import boto3
import httpx

ROOT = Path(__file__).resolve().parents[2]


def load_current_prompts():
    spec = importlib.util.spec_from_file_location('prompt_under_test', ROOT / 'src/agent/config/prompt_builder.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {mode: module.system_prompt_to_string(module.build_text_system_prompt(concise=mode == 'concise')) for mode in ('normal', 'concise')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--secret-id', default=os.environ.get('BEDROCK_API_KEY_SECRET_NAME'))
    parser.add_argument('--region', default=os.environ.get('AWS_REGION', 'us-west-2'))
    parser.add_argument('--models', nargs='+', default=['us.openai.gpt-5.6-terra'])
    parser.add_argument('--cases', nargs='*')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--repetitions', type=int, default=1)
    parser.add_argument('--evidence-role', choices=['developer', 'user'], default='developer',
                        help='Role for synthetic evidence; user keeps task data below system instructions')
    args = parser.parse_args()
    if args.repetitions < 1 or args.workers < 1:
        parser.error('Workers and repetitions must be positive')
    if args.output.exists() and any(args.output.iterdir()):
        parser.error('Use a new output directory to preserve previous evidence')
    baseline = json.loads(args.baseline.read_text())
    current = load_current_prompts()
    # Keep the date context identical too; changing date is not part of the treatment.
    for mode in current:
        current[mode] = current[mode].rsplit('Current date:', 1)[0] + 'Current date:' + baseline[mode].rsplit('Current date:', 1)[1]
    cases = json.loads(Path(__file__).with_name('response_style_cases.json').read_text())
    if args.cases:
        unknown = set(args.cases) - {case['id'] for case in cases}
        if unknown:
            parser.error('Unknown cases: ' + ', '.join(sorted(unknown)))
        cases = [case for case in cases if case['id'] in args.cases]
    key = os.environ.get('AWS_BEARER_TOKEN_BEDROCK')
    if not key:
        if not args.secret_id:
            parser.error('Provide --secret-id or AWS_BEARER_TOKEN_BEDROCK')
        key = boto3.client('secretsmanager', region_name=args.region).get_secret_value(SecretId=args.secret_id)['SecretString']
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'prompts.json').write_text(json.dumps({'before': baseline, 'after': current}, ensure_ascii=False, indent=2))
    url = f'https://bedrock-runtime.{args.region}.amazonaws.com/openai/v1/responses'

    def run(model, case, mode, variant, repetition):
        instructions = (baseline if variant == 'before' else current)[mode]
        payload = {
            'model': model, 'instructions': instructions,
            'input': [{'role': args.evidence_role, 'content': 'Test context (fixed evidence, not a request to execute tools):\n' + case['context']}] + case['messages'],
            'max_output_tokens': 4096,
            'stream': False,
        }
        started = time.monotonic()
        result = {'model': model, 'case': case['id'], 'mode': mode, 'variant': variant, 'repetition': repetition,
                  'evidence_role': args.evidence_role,
                  'context': case['context'], 'messages': case['messages'], 'criteria': case['criteria']}
        try:
            with httpx.Client(timeout=httpx.Timeout(100, connect=15)) as client:
                response = client.post(url, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, json=payload)
            if response.status_code != 200:
                result['error'] = 'HTTP ' + str(response.status_code)
            else:
                data = response.json()
                result.update(status=data.get('status'), usage=data.get('usage'), response_id=data.get('id'),
                    text='\n'.join(part.get('text', '') for item in data.get('output', []) if item.get('type') == 'message' for part in item.get('content', []) if part.get('type') == 'output_text'))
                if not result['text']:
                    result['error'] = 'No output text'
                elif result['status'] != 'completed':
                    result['error'] = 'Response did not complete'
        except Exception as error:
            result['error'] = type(error).__name__
        result['seconds'] = round(time.monotonic() - started, 2)
        return result

    jobs = [(model, case, mode, variant, repetition) for model in args.models for case in cases for mode in ('normal', 'concise') for variant in ('before', 'after') for repetition in range(1, args.repetitions + 1)]
    errors = 0
    with (args.output / 'results.jsonl').open('w') as output, concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(run, *job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            errors += bool(result.get('error'))
            output.write(json.dumps(result, ensure_ascii=False) + '\n')
            output.flush()
            print(result['model'], result['case'], result['mode'], result['variant'], result.get('error', 'ok'), result['seconds'], flush=True)
    if errors:
        raise SystemExit(f'{errors} request(s) failed; see results.jsonl')


if __name__ == '__main__':
    main()
