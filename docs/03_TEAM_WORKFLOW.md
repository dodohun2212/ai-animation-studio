# Agent Team Workflow

## 역할

문서에는 특정 모델이나 도구 이름을 고정하지 않는다. 각 세션을 시작할 때 사용자가 현재 에이전트와 역할을 지정한다.

### Main — Lead Agent

- 작업 범위와 완료 조건 정의(마이그레이션 완료 후에는 Python 기준 분석 대신 실사용 피드백·UI 감사 등에서 나온 개선 과제 분석)
- 공유 타입과 내부 API 계약 관리
- Frontend/Backend 작업 지시와 충돌 조정
- 변경 통합, 전체 typecheck/test/build, 마이그레이션 상태 갱신
- 검증과 문서 갱신 뒤 다음 기능을 자동으로 시작

### Frontend — UI Agent

- `apps/frontend` 화면과 사용자 상호작용
- 로딩, 오류, 명시적 승인, 검토와 진행 상태
- `packages/shared` 계약 사용 및 API 응답 검증
- Backend 동작을 임의로 가정하지 않음

### Backend — Workflow Agent

- `apps/backend` 워크플로, API, 저장과 복구
- fake/provider adapter, 비용·승인 gate, 중복 요청 차단
- 중지·재개·archive와 FFmpeg·로컬 파일 처리

## 단독 실행과 병렬 실행

- 역할과 worktree는 **세션 시작 지시문**에서 정한다.
- 단독 실행 시 현재 Lead Agent가 Main, Frontend, Backend 역할을 함께 맡아 `main`에서 작업할 수 있다.
- 병렬 실행 시 역할별 작업을 `main`, `feature/frontend`, `feature/backend`에 나누되, 역할과 worktree를 세션 시작 시 명시한다.
- 단독/병렬 어느 경우에도 기능 하나를 완료하면 전체 검증, `docs/02_MIGRATION_PLAN.md` 갱신, 커밋·푸시까지 마친 뒤 다음 기능으로 계속 진행한다. 미커밋 변경을 다음 기능으로 넘기지 않는다.
- 특정 모델·도구·에이전트 이름을 이 문서에 추가하지 않는다.

## 작업 반복 단위

```text
Lead Agent가 작업 분석(Python 기준 또는 개선 과제)
→ 완료 조건과 공통 계약 확정
→ 역할별 구현·테스트
→ Lead Agent가 통합
→ main에서 전체 검증
→ Migration Plan 갱신
→ 다음 항목 자동 시작
```

작업 전체를 한 번에 하지 않는다. 통합 가능한 작은 사용자 기능·개선 하나씩 반복한다.

## Git 규칙

- `main`: 통합과 전체 검증의 기준 worktree
- `feature/frontend`, `feature/backend`: 병렬 실행 시 선택적으로 사용
- 작업 시작 전 현재 worktree와 Git 상태를 확인한다.
- 다른 에이전트의 변경을 덮어쓰지 않는다.
- 커밋 전에 관련 테스트를 실행한다.
- `main`에는 통합 검증을 통과한 변경만 유지한다.
- 기능·수정 하나가 검증을 통과하면 바로 커밋하고 `origin`에 푸시한다. 사용자가 다르게 요청하지 않는 한 매번 확인을 구하지 않는다. 검증 실패로 되돌릴 일이 생기면 새 커밋으로 고치고, 되돌릴 수 없는 명령(강제 push, reset --hard 등)은 여전히 사용자 승인 없이 쓰지 않는다.

## 로컬 개발 서버 포트

`npm run dev:backend`와 `npm run dev:desktop`은 서로 다른 백엔드 프로세스를 각자의 기본 포트로 띄운다. 둘을 섞어서 접속 포트를 착각하지 않는다.

| 실행 방식 | 백엔드 포트 | 비고 |
| --- | --- | --- |
| `npm run dev:backend` (+ `npm run dev:frontend`) | `3000` (`process.env.PORT` 기본값, `apps/backend/src/main.ts`) | Vite 프론트엔드(`5173`)가 `/projects`, `/settings` 등을 `127.0.0.1:3000`으로 프록시한다(`apps/frontend/vite.config.ts`). 개발 중 별도 창에서 프론트/백엔드를 각각 띄울 때 쓴다. |
| `npm run dev:desktop` (Electron) | `4317` (`DEFAULT_BACKEND_PORT`, `apps/desktop/src/main.ts`) | Electron이 백엔드 번들을 직접 fork해서 이 포트로 띄우고 같은 origin에서 프론트엔드 정적 파일을 서빙한다. `dev:backend`를 따로 켤 필요가 없다. |

두 방식을 동시에 쓰지 않는다 — 예를 들어 `dev:backend`만 켜놓고 `4317`로 접속을 시도하면 아무것도 응답하지 않는다.

### `dev:desktop`은 백엔드 번들을 먼저 다시 만든다

Electron은 `dev:backend`처럼 소스를 watch하지 않고 **미리 번들된 `apps/backend/dist-bundle/main.cjs`를 fork**한다. 그 번들을 만드는 것은 `npm run package --workspace @ai-animation-studio/backend` 뿐이라, 예전에는 `dev:desktop`이 **마지막으로 패키징한 날의 백엔드**를 띄웠다.

실제로 그랬다: 번들이 6일 묵어 있었고, 그 안에는 실사용 사이클을 막았던 검사(`scriptRevision must match …`)가 **고친 뒤에도 그대로** 들어 있었다. 그 상태로 데스크톱 셸을 켜면 **고쳐진 코드가 안 도는데 화면은 아무 말도 하지 않는다** — 백엔드를 고치고 셸에서 확인하는 사람이 "왜 그대로지" 를 디버깅하게 된다.

그래서 루트의 `dev:desktop`이 번들부터 다시 만든다. 몇 초 더 걸리는 값으로 **셸이 항상 지금 소스를 띄운다.**

```
npm run dev:desktop  =  백엔드 package(빌드+번들)  →  desktop build  →  electron
```

브라우저 쪽(`dev:backend` + `dev:frontend`)은 원래부터 소스를 watch하므로 이 문제가 없다.

### 설치 프로그램도 같은 함정에 빠져 있었다

`dev:desktop`은 위처럼 고쳐졌는데 **패키징은 그대로였다**. `package`와 `package:installer`는 `electron-builder`만 실행했고, electron-builder는 `apps/backend/dist-bundle`과 `apps/frontend/dist`를 **그대로 복사**한다 — 즉 그 순간 트리에 놓여 있던 것이 사용자 손에 가는 설치본에 들어갔다. 개발자는 재시작으로 알아채지만, **설치본 안에서는 이걸 볼 방법이 없다**. 첫 증상은 며칠 전에 고친 버그가 남의 컴퓨터에서 되살아난 모습이다.

```
npm run package[:installer]  =  build:release  →  electron-builder
build:release                =  shared build  →  백엔드 package(빌드+번들)  →  frontend build  →  desktop build
```

`apps/desktop/src/packaging-inputs.test.ts`가 이 규칙을 지킨다: **설치 프로그램이 복사하는 것 중 깨끗한 체크아웃에 없는 것(= `.gitignore`가 막는 빌드 산출물)은 먼저 도는 빌드에 이름이 있어야 한다.** `extraResources`에 새 산출물을 더하고 빌드를 안 붙이면 거기서 실패한다.

## 세션 시작 규칙

새 세션은 이전 대화를 기억하지 못한다. 시작 시 다음을 수행한다.

```text
AGENTS.md, AI_GUIDELINES.md,
docs/01_CURRENT_PRODUCT_SPEC.md,
docs/02_MIGRATION_PLAN.md,
docs/03_TEAM_WORKFLOW.md,
docs/06_DECISIONS.md를 읽고,
공유/API 변경이면 docs/04_INTERNAL_API_CONTRACT.md도 읽는다.
협업 우편함이 있으면 .claude-bridge/from-cli.md 와 from-cowork.md 의
최근 라운드를 읽는다. 두 파일 모두 맨 위에 새 라운드를 얹는다.
현재 worktree와 Git 상태를 확인하고,
이번 세션에 지정된 역할과 worktree 범위 안에서 작업한다.
```

`docs/06_DECISIONS.md`는 코드가 지금의 모양인 이유 — 특히 **근거를 대고 접은 길** — 을 담는다. 이걸 안 읽고 시작하면 이미 폐기된 접근을 다시 제안하게 된다.

### 우편함 라운드 번호와 "맨 위"

- 새 라운드 번호는 **두 파일을 통틀어 가장 큰 번호 + 1** 로 매긴다. 각자 자기 파일만 보고 세면
  같은 번호가 둘 생긴다.
- **"맨 위 하나만 읽으면 된다"는 보장이 아니다.** 상대가 한 번에 둘 이상 올릴 수 있고, 그러면
  아래쪽 것이 더 새로울 수도 있다. 실제로 그렇게 올라와 🔴 결함 보고 하나를 통째로 놓칠 뻔했다.
  **마지막으로 처리한 라운드를 만날 때까지 아래로 읽는다.**
- 파일 크기로 변경을 감지할 때도 같다 — 크기가 늘었다는 것은 "새 라운드가 **하나** 왔다"가 아니다.

협업 우편함은 커밋되지 않으므로 저장소를 클론한 사람에게는 없을 수 있다. 그래서 **우편함의 라운드 번호는 근거의 출처 표시일 뿐이고, 근거 자체는 주석 안이나 `docs/06_DECISIONS.md`에 있어야 한다.** 우편함이 없어도 이유가 전달되어야 한다.

문서에 없는 결정을 추측하지 않는다. 장기 요구사항과 검증 결과는 대화에만 남기지 않고 현재 문서 또는 마이그레이션 계획에 반영한다.
