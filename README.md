# PR Tour

**A guided tour of your pull request.**

[한국어](README.ko.md)

An agent skill that turns a GitHub PR into a standalone HTML reading guide. Follow the execution flow, read the real diff, and open the definitions you need without losing your place.

![An eight-step Starlette PR walkthrough with reading order, highlighted diff, and explanations](docs/preview.png)

## Try the example

The example follows [Starlette PR #2041](https://github.com/Kludex/starlette/pull/2041): sending an HTTP denial response before accepting a WebSocket connection.

- **[Try the English demo](https://yunsinlee.github.io/pr-tour/demo.en.html)** · **[한국어 데모](https://yunsinlee.github.io/pr-tour/demo.ko.html)** — open directly in your browser.
- [Download English HTML](https://github.com/YunSinLee/pr-tour/raw/refs/heads/main/docs/demo.en.html) · [Download 한국어 HTML](https://github.com/YunSinLee/pr-tour/raw/refs/heads/main/docs/demo.ko.html) — save a copy to read offline.
- [English source manifest](examples/starlette-2041.en.json) · [한국어 source manifest](examples/starlette-2041.ko.json)

Five changed files, eight reading steps, thirteen definition previews. Both examples use the same pinned commits. The generated HTML needs no server or network connection; GitHub links are optional.

## Install

### Codex, Claude Code, and other compatible agents

Use the [skills CLI](https://github.com/vercel-labs/skills) to choose an agent and install the skill:

```sh
npx skills add YunSinLee/pr-tour --skill pr-tour
```

To target Codex explicitly:

```sh
npx skills add YunSinLee/pr-tour --skill pr-tour --agent codex
```

The current skills CLI requires Node.js 22.20 or newer. The skill itself uses Python and Git. You can also copy `skills/pr-tour/` into a skill directory supported by your agent, such as `~/.agents/skills/` for Codex.

### Claude Code plugin marketplace

```text
/plugin marketplace add YunSinLee/pr-tour
/plugin install pr-tour@pr-tour
```

Invoke `/pr-tour:pr-tour`, or ask Claude Code to make an HTML walkthrough of a PR.

This repository provides an installable skill and a Claude Code marketplace. Inclusion in any third-party curated registry is a separate process.

## Use it

In Codex, inside the relevant repository:

```text
Use $pr-tour to create an English HTML walkthrough of
https://github.com/Kludex/starlette/pull/2041.
Explain the execution flow, include definition previews, and keep the manifest.
```

Or ask in Korean:

```text
$pr-tour로 이 PR을 코드 흐름대로 따라 읽는 HTML 가이드를 만들어줘.
한국어로 설명하고, 함수·타입 정의와 생략 코드 펼치기를 포함해줘.
```

The agent reads the pinned source, authors the reading order and explanations, then runs the bundled builder. The Python script alone does not generate explanations from a PR URL.

By default, the skill keeps the HTML and its manifest together in a unique `/tmp/pr-tour-<suffix>/` directory, keeping generated files out of your working directory. On platforms without `/tmp`, it uses the system temporary directory. It opens the guide and returns links to both files. Temporary files may be cleared by the system; request an output path to keep them somewhere permanent. Updating an existing guide reuses its current paths.

For example: `Save the guide and manifest in ~/Documents/pr-tours/starlette-2041/.`

## What the guide does

- Arranges changes by code flow. A file can appear in more than one step.
- Shows the explanation before the code by default. Use **Layout** to switch the two panes; the browser remembers your choice when local storage is available. Narrow screens stack the panes in the same order.
- Shows actual additions, deletions, old/new line numbers, and focused line notes.
- Colors keywords, strings, comments, and function names in diffs and definition previews. Syntax highlighting works offline for common languages; unsupported file types remain plain text.
- Expands unchanged context from either end, or displays the complete file.
- Opens selected function and type definitions, including related definitions and a back button.
- Keeps explanations, source, styles, and scripts in one HTML file.
- Generates Korean or English controls. Authored explanations keep their own language.

## Requirements and limits

To make a guide: an agent that supports skills, Python 3.9+, Git, and access to the repository. The preferred GitHub workflow also uses the authenticated `gh` CLI. Python tokenization may require a newer interpreter for newer source syntax.

To read a guide: a modern browser with JavaScript enabled. No Python, agent, or account is required.

The builder checks source reconstruction, line ranges, file coverage, and definition-link offsets. Explanations and symbol meanings still need review. Definition links are authored mappings, not an IDE language server. Every changed file must appear, but the builder cannot prove that every important behavior has been explained. Binary, non-UTF-8, and submodule changes show an explicit preview limitation.

Generated guides include repository source code. Choose an example you can share before publishing its HTML. The bundled example uses public Starlette code and includes its license notice.

## Build and contribute

Read the [manifest format](skills/pr-tour/references/manifest.md), then run:

```sh
python3 skills/pr-tour/scripts/build_guide.py \
  --repo /path/to/repository \
  --manifest /path/to/guide.json \
  --output /path/to/guide.html
```

Set `"language": "en"` or `"language": "ko"` in the manifest, or pass `--language en`. Existing files are protected unless you pass `--overwrite`.

Run the builder regression suite without third-party Python packages:

```sh
python3 -m unittest discover -s tests -v
```

Run syntax-rendering regression tests with Node.js 20+ (no package installation):

```sh
node --test tests/test_syntax.cjs
```

Run browser regression tests for definition previews in both demos (Node.js 20+):

```sh
npm ci
npx playwright install chromium webkit
npm run test:dialog
PR_TOUR_BROWSER=webkit npm run test:dialog
```

Regenerate both public examples from the pinned Starlette commits:

```sh
python3 scripts/rebuild_examples.py
```

The first run fetches the public Git snapshots into `.cache/starlette`. To use an existing clone that already contains both commits, pass `--repo /path/to/starlette`. This rebuilds the walkthrough, not the upstream test suite.

Contributions are welcome for reading usability, source-link correctness, and additional UI translations. Include a small public or synthetic reproduction and the relevant checks.

## License

[MIT](LICENSE) for this skill, builder, renderer, and authored explanations. Starlette source embedded in the examples retains its [BSD-3-Clause license](examples/STARLETTE-LICENSE.md). This is an independent example, not an endorsement by Starlette.

The bundled highlight.js library retains its [BSD-3-Clause license](skills/pr-tour/assets/vendor/highlightjs/LICENSE), which is also embedded in generated guides.
