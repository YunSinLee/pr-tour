#!/usr/bin/env python3
"""Regenerate the public examples from their pinned Git objects."""

import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, help='Existing Starlette clone with the pinned commits')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'examples/starlette-2041.en.json').read_text(encoding='utf-8'))
    repo = args.repo.resolve() if args.repo else ROOT / '.cache/starlette'
    if not args.repo:
        if not (repo / '.git').exists():
            repo.mkdir(parents=True, exist_ok=True)
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        commits_present = all(subprocess.run(['git', 'cat-file', '-e', f'{manifest[key]}^{{commit}}'],
                                            cwd=repo, capture_output=True).returncode == 0
                              for key in ('head', 'base'))
        if not commits_present:
            subprocess.run(['git', 'fetch', '--quiet', '--depth=256',
                            'https://github.com/Kludex/starlette.git', manifest['base'], manifest['head']],
                           cwd=repo, check=True)
    for language in ('en', 'ko'):
        subprocess.run(['python3', str(ROOT / 'skills/pr-tour/scripts/build_guide.py'),
                        '--repo', str(repo), '--manifest', str(ROOT / f'examples/starlette-2041.{language}.json'),
                        '--output', str(ROOT / f'docs/demo.{language}.html'), '--overwrite'], check=True)


if __name__ == '__main__':
    main()
