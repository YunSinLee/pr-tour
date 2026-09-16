# PR Tour

**PR의 코드 흐름을 안내하는 가이드.**

[English](README.md)

GitHub PR을 독립 실행형 HTML 가이드로 만드는 에이전트 스킬입니다. 읽는 순서, 실제 diff, 설명을 한 화면에 두고 필요한 함수·타입의 정의를 바로 열어볼 수 있습니다.

![읽기 순서, 강조된 diff, 설명을 함께 보여주는 Starlette PR 가이드](docs/preview.png)

## 예제 보기

[Starlette PR #2041](https://github.com/Kludex/starlette/pull/2041)의 WebSocket 연결 거절 응답을 따라갑니다.

- **[한국어 데모 바로 보기](https://yunsinlee.github.io/pr-tour/demo.ko.html)** · **[English demo](https://yunsinlee.github.io/pr-tour/demo.en.html)** — 설치 없이 브라우저에서 열어보세요.
- [한국어 HTML 다운로드](https://github.com/YunSinLee/pr-tour/raw/refs/heads/main/docs/demo.ko.html) · [English HTML 다운로드](https://github.com/YunSinLee/pr-tour/raw/refs/heads/main/docs/demo.en.html) — 저장하면 오프라인에서도 읽을 수 있습니다.
- [한국어 manifest](examples/starlette-2041.ko.json) · [English manifest](examples/starlette-2041.en.json)

변경 파일 5개, 읽기 단계 8개, 정의 미리보기 13개를 담았습니다. 두 예제는 같은 커밋을 기준으로 만들었습니다. 완성된 HTML은 서버와 인터넷 없이 읽을 수 있습니다.

## 설치

Codex, Claude Code 등 지원하는 에이전트를 선택해 설치할 수 있습니다.

```sh
npx skills add YunSinLee/pr-tour --skill pr-tour
```

Codex를 지정하려면:

```sh
npx skills add YunSinLee/pr-tour --skill pr-tour --agent codex
```

현재 설치 도구에는 Node.js 22.20 이상이 필요합니다. 스킬 실행은 Python과 Git을 사용합니다. 직접 설치하려면 `skills/pr-tour/` 폴더를 에이전트의 스킬 경로에 복사해도 됩니다. Codex의 사용자 스킬 경로는 `~/.agents/skills/`입니다.

Claude Code의 플러그인 방식으로 설치하려면:

```text
/plugin marketplace add YunSinLee/pr-tour
/plugin install pr-tour@pr-tour
```

설치 후 `/pr-tour:pr-tour`를 호출하거나 PR의 HTML 가이드를 만들어달라고 요청하세요. 이 저장소의 설치 경로와 외부 서비스가 운영하는 추천 레지스트리 등록은 별개입니다.

## 사용

해당 저장소에서 Codex에 요청합니다.

```text
$pr-tour로 이 PR을 코드 흐름대로 따라 읽는 HTML 가이드를 만들어줘.
한국어로 설명하고, 함수·타입 정의와 생략 코드 펼치기를 포함해줘.
나중에 수정할 수 있도록 manifest도 남겨줘.
https://github.com/Kludex/starlette/pull/2041
```

에이전트가 실제 코드를 읽어 순서와 설명을 작성하고, 빌더가 원본을 검증해 HTML을 만듭니다. Python 스크립트에 PR 주소만 넣어서 설명까지 자동 생성하는 구조는 아닙니다.

기본적으로 스킬은 HTML과 manifest를 고유한 `/tmp/pr-tour-<suffix>/` 폴더에 함께 저장해 현재 작업 폴더에 산출물이 쌓이지 않도록 합니다. `/tmp`가 없는 환경에서는 시스템 임시 폴더를 사용합니다. 생성 후 가이드를 열고 두 파일의 링크를 전달합니다. 임시 파일은 시스템에서 정리할 수 있으니, 오래 보관하려면 원하는 저장 경로를 지정하세요. 기존 가이드를 수정할 때는 같은 경로를 재사용합니다.

예: `HTML과 manifest는 ~/Documents/pr-tours/starlette-2041/에 저장해줘.`

## 제공하는 기능

- 파일 목록 대신 코드 흐름에 따른 읽기 순서. 같은 파일을 여러 단계에서 다시 방문할 수 있습니다.
- 기본 배치는 **설명 → 코드**입니다. 상단 **화면 배치**에서 **코드 → 설명**으로 바꿀 수 있고, 브라우저 저장소를 사용할 수 있으면 선택을 기억합니다. 좁은 화면에서도 선택한 순서대로 위아래에 표시합니다.
- 실제 추가·삭제 코드와 변경 전·후 줄 번호, 설명에 연결된 줄 강조.
- 생략 구간의 앞·뒤 20줄 펼치기와 전체 파일 보기.
- 선택한 함수·타입 정의 미리보기, 관련 정의 탐색, 뒤로 가기.
- 코드·설명·스타일·스크립트를 담은 HTML 한 파일.
- 한국어·영어 UI 생성. 설명문은 요청한 언어로 따로 작성합니다.

## 요구 사항과 검증 범위

생성에는 스킬을 지원하는 에이전트, Python 3.9 이상, Git, 저장소 접근 권한이 필요합니다. 권장 GitHub 작업 흐름에서는 로그인된 `gh` CLI도 사용합니다. 새 Python 문법의 토큰 분석에는 그 문법을 지원하는 인터프리터가 필요할 수 있습니다.

읽기에는 JavaScript를 지원하는 최신 브라우저만 있으면 됩니다.

빌더는 원본 코드 복원, 줄 범위, 변경 파일 포함 여부, 정의 링크 위치를 검사합니다. 설명의 의미와 심볼 연결의 정확성은 별도로 확인해야 합니다. 모든 파일이 포함돼도 모든 중요한 동작을 설명했다는 뜻은 아닙니다. 바이너리·UTF-8이 아닌 파일·서브모듈은 미리보기 제한을 표시합니다.

HTML에는 저장소 코드가 포함됩니다. 공개할 때는 공유 가능한 예제를 선택하세요. 동봉된 예제는 공개 Starlette 코드를 사용하며 출처와 라이선스를 포함합니다.

## 개발과 기여

[manifest 형식](skills/pr-tour/references/manifest.md)에 따라 설명을 작성한 뒤 실행합니다.

```sh
python3 skills/pr-tour/scripts/build_guide.py \
  --repo /path/to/repository \
  --manifest /path/to/guide.json \
  --output /path/to/guide.html
```

UI 언어는 manifest의 `language`를 `ko` 또는 `en`으로 지정하거나 `--language en`으로 바꿉니다. 기존 결과물을 갱신할 때만 `--overwrite`를 사용합니다.

```sh
python3 -m unittest discover -s tests -v
python3 scripts/rebuild_examples.py
```

첫 명령은 외부 Python 패키지 없이 회귀 테스트를 실행합니다. 두 번째 명령은 고정된 공개 Starlette 커밋을 `.cache/starlette`로 가져와 예제 두 개를 재생성합니다. 이미 커밋이 있는 저장소를 사용하려면 `--repo /path/to/starlette`를 지정하세요. Starlette의 제품 테스트를 실행하는 명령은 아닙니다.

읽기 편의성, 원본 연결의 정확성, UI 번역에 대한 기여를 환영합니다. 재현 가능한 공개 예제나 작은 테스트 사례와 확인 결과를 함께 남겨주세요.

## 라이선스

스킬·빌더·뷰어·직접 작성한 설명은 [MIT](LICENSE)입니다. 예제에 포함한 Starlette 코드는 원래의 [BSD-3-Clause 라이선스](examples/STARLETTE-LICENSE.md)를 따릅니다. Starlette의 공식 추천이나 보증을 의미하지 않습니다.
