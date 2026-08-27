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
최근 라운드를 읽는다. 두 파일 모두 맨 위가 최신이므로
위에서부터 필요한 만큼만 읽으면 된다.
현재 worktree와 Git 상태를 확인하고,
이번 세션에 지정된 역할과 worktree 범위 안에서 작업한다.
```

`docs/06_DECISIONS.md`는 코드가 지금의 모양인 이유 — 특히 **근거를 대고 접은 길** — 을 담는다. 이걸 안 읽고 시작하면 이미 폐기된 접근을 다시 제안하게 된다.

협업 우편함은 커밋되지 않으므로 저장소를 클론한 사람에게는 없을 수 있다. 그래서 **우편함의 라운드 번호는 근거의 출처 표시일 뿐이고, 근거 자체는 주석 안이나 `docs/06_DECISIONS.md`에 있어야 한다.** 우편함이 없어도 이유가 전달되어야 한다.

문서에 없는 결정을 추측하지 않는다. 장기 요구사항과 검증 결과는 대화에만 남기지 않고 현재 문서 또는 마이그레이션 계획에 반영한다.
