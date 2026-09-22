# Guide manifest

Write UTF-8 JSON. The builder extracts all code from Git; author explanations, ranges, and symbol mappings, not copied code. Paths are repository-relative, lines are one-based, and ranges include both ends.

## Required shape

```json
{
  "url": "https://github.com/owner/repository/pull/123",
  "title": "검색 결과 개수 제한",
  "language": "ko",
  "overview": "요청 조건이 검색 결과로 돌아오는 과정을 읽습니다.",
  "head": "<full PR head commit hash>",
  "base": "<full PR base commit hash>",
  "steps": [
    {
      "id": "result",
      "group": "실행",
      "title": "응답 목록 제한",
      "file": "app/search.py",
      "heading": "전체 건수는 두고 목록만 줄입니다.",
      "why": "클라이언트에 넘기는 목록의 길이를 제한합니다. 전체 검색 건수는 유지합니다.",
      "notes": [
        {"title": "목록 자르기", "start": 27, "end": 29, "text": "limit은 반환 목록 수에만 적용됩니다."}
      ],
      "check": "전체 건수와 반환 목록 수가 구분되나요?",
      "next": "실패했을 때의 응답 처리로 이어집니다."
    }
  ],
  "definitions": {
    "SearchResult": {
      "name": "SearchResult",
      "path": "app/dto.py",
      "start": 10,
      "end": 13,
      "description": "전체 건수와 현재 반환할 목록을 담습니다."
    }
  },
  "pythonSymbols": {
    "app/search.py": {"SearchResult": "SearchResult"}
  }
}
```

The example paths and ranges illustrate the schema; replace them with observed code. Both hashes must already exist locally. The builder computes `merge-base(base, head)` and shows its diff against head. `language` is `ko` (default) or `en` for controls. Author explanations in the requested language separately. `date` is optional; default is today's date. Use the original guide's snapshot/date when preserving an existing guide.

Every changed file must occur in at least one step. There is no fixed number of steps or groups. For a renamed file, use its new path as the step's `file`; the builder records its old path. `notes` can be empty for binary, metadata-only, pure rename, or empty-file changes.

## Line notes and source references

Notes require `title,start,end,text`. `side` defaults to `right`, or `left` for a deleted file. Set `side: "left"` to explain removed lines within a modified file. Note ranges must be present in the initially visible diff, including context rows. A note cannot cross a hidden gap.

The order of `steps` and each step's `notes` is the mobile code-reading order; notes are not sorted by line number. Write them in the order a reader should follow. Mobile **Next code / Prev code** visits each note, then continues across steps. A step with no notes remains one file-change stop. Step hashes (`#step-id`) open the first note of that step; individual notes do not have separate hashes. No extra manifest fields are needed for mobile layout, wrapping, or expanded reading.

For helpful code outside the diff, add a definition or an optional step `reference`:

```json
{
  "path": "app/client.py",
  "start": 71,
  "end": 74,
  "label": "참고 · 기존 검색 메서드",
  "text": "이 메서드가 검색 API를 호출합니다.",
  "side": "right"
}
```

The builder supplies reference `code` automatically. `right` reads head; `left` reads merge base. For a renamed file's left reference/definition, supply the old path.

## Connections between steps

For a new guide, add `transition` to every step except the final one. Keep the reason for moving to the next step in the existing `next` text. A transition describes the connection between adjacent reading steps, not between each line note.

This fragment extends the public example's `serialize` step:

```json
{
  "next": "The response receives WebSocket.send as its callback. Follow that callback to state handling.",
  "transition": {
    "to": "response-state",
    "basis": "source",
    "evidence": [
      {
        "path": "starlette/websockets.py",
        "side": "right",
        "start": 207,
        "end": 209,
        "text": "The response receives the current WebSocket send method."
      },
      {
        "path": "starlette/responses.py",
        "side": "right",
        "start": 150,
        "end": 158,
        "text": "The base Response calls that argument with a start message."
      }
    ]
  }
}
```

Replace example ranges with code observed at your own pinned snapshot. The full Starlette manifests include the destination branch and a callback/queue connection with explicit uncertainty.

| `basis` | Meaning and requirements |
| --- | --- |
| `source` | You explain the connection using at least one source citation. Displayed as **Source cited**, not as a verified call graph. |
| `inferred` | Require a nonempty `uncertainty` explaining what remains unverified. Evidence is optional; include the parts you could trace. |
| `reading` | Explain in `next` why the reader moves between topics, such as documentation to implementation or implementation to tests. Evidence is optional. |

`to` must equal the immediately following step's ID. Reordering steps requires updating their connections. The final step cannot have a transition; its `next` remains the closing text. `uncertainty` is permitted only with `inferred`, so qualifications cannot be silently hidden under another label.

Each evidence item requires `path,side,start,end,text`. Explicit `side: "right"` reads head; `"left"` reads merge base, with the old path for renamed/deleted files. Citations may include unchanged files and hidden context outside the diff. The builder extracts text directly from Git and checks the range. Do not supply `code`, `rows`, URLs, or other fields; neither transition objects nor evidence items accept unknown fields. Directories, submodules, binary files, and non-UTF-8 evidence are rejected. Small, coherent excerpts make the relationship easier to inspect.

The generated **Up next** card shows the classification, any uncertainty, and expandable code excerpts with line numbers, syntax colors, and pinned source links. Excerpts work offline; opening external source links is optional. Syntax colors are presentation, not semantic analysis. The collapsed connection summary counts `source`, `inferred`, `reading`, and `missing` across `steps.length - 1` connections. It does not measure the completeness or correctness of the program's execution path. The CLI reports these counts under `transitions`; partially authored connections produce `warnings` identifying the missing source/target steps.

Older manifests without any transitions still build and keep their `next` explanations without badges. They are not treated as source-backed. When some transitions are present, missing connections are visible as **Connection evidence not authored** and counted in the summary. New authoring should resolve these gaps, using explicit inference when appropriate. Structure or source errors fail the build, while missing optional metadata remains a warning for compatibility.

## Definition links


`definitions` maps a unique ID to `name,path,start,end,description` and optional `side`. The source defaults to head. Include decorators when relevant. Use a complete function/type definition or clearly label an intentional excerpt in `description`.

There are two ways to attach clickable names to head code:

1. **Python:** `pythonSymbols` maps each source path to `{localIdentifier: definitionId}`. Python's tokenizer links names, skipping comments and string literals. Map aliases using the imported name in that file. Add maps for definition files too, so related types are clickable within the popup. Only use a file-wide mapping if that name resolves consistently throughout the file; shadowed or ambiguous names need explicit occurrences.
2. **Any language:** `links` lists explicit verified occurrences:

```json
[
  {"path": "src/search.ts", "line": 28, "text": "SearchResult", "definition": "SearchResult"},
  {"path": "src/search.ts", "line": 40, "text": "client.fetch", "column": 15, "definition": "SearchClient.fetch"}
]
```

`column` is a zero-based Unicode code-point offset, not a byte offset. Omit it only when `text` occurs exactly once on the line. The builder converts browser offsets, validates text, and rejects overlaps or unknown definition IDs. Do not duplicate an occurrence already supplied by `pythonSymbols`. These are authored source links, not general language-server resolution. Deleted lines are not linked automatically; use a left-side note or reference for them.

## Existing review evidence

Optional `recap` is an array of concise strings describing observed validation and limits. Optional `finding` has `title,body,fix,url` and an optional `label` such as `기존 리뷰 메모 · pending`. Include one only when grounded in actual review evidence; never insert a fabricated finding, publication state, or test result merely to fill a panel. Without a finding, the guide still includes each step's independent `check` question.

## Regeneration and checks

Pass an unused output path for a new artifact, or `--overwrite` for an intentional update. The script's final JSON reports the actual output path, pinned head, file/step/definition counts, HTML size, unavailable previews, and source verification. Resolve any error before delivering. Keep the JSON manifest as the editable source of the guide; no credentials or session cookies belong in it.

Updating the skill does not alter previously generated HTML. Rebuild from its manifest with the updated builder to get the new renderer; preserve the pinned commits and snapshot date unless the user requests a refreshed PR snapshot.

## Source attribution

When distributing code that requires a notice, add optional `attribution: {"title": "Source project and license", "text": "Complete required notice", "url": "https://..."}`. The notice stays inside the standalone HTML and can be opened below each step. See the repository’s public example manifests for a complete example.
