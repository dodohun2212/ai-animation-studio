# Python to TypeScript Migration Plan

## 원칙

- Python을 줄 단위로 번역하지 않고 사용자 동작, 검증, 저장 데이터와 오류 처리를 TypeScript 구조에 맞게 이전한다.
- `app/`, `tests/`, `prompts/`는 전체 이전과 검증이 끝날 때까지 수정·삭제하지 않는다.
- 사용자에게 보이는 작은 기능 하나씩 Frontend와 Backend를 함께 구현하고 통합 검증 뒤에만 완료 처리한다.
- Preview는 유료 요청을 보내지 않으며 모든 Provider는 예산·승인·중복 방지 Gate 뒤에 둔다.


## 현재 인수인계 상태 (2026-08-23)

### 최신 검증 완료 범위

- 장편의 전체 local fake 흐름: outline → Episode script → Asset mapping → 이미지 검토 → 영상 검토 → Episode FFmpeg 병합 → Continuity Memory까지 이전·통합 검증 완료.
- 장편 보강: Story Bible CRUD/검색/복제/관계 감사/basic·world/style link, Episode Scene 6 연속성 reference, timeline 추가·복제·archive, 자동 장면 Asset 매칭 미리보기·재실행 완료.
- 단기·장기 프로젝트의 recoverable archive와 Asset Library Character Folder reference set(자식 순서·대표 이미지) 완료.
- Asset Library의 version 추가·relink·file health audit·소유 파일 명시적 삭제 및 이에 따른 프로젝트/Episode mapping 재검토 무효화 완료(스물아홉 번째 이전 기능).
- Python `reference_migration.py`의 legacy project Reference → Asset Library 멱등 이전을 명시적 실행 버튼으로 완료(서른 번째 이전 기능).
- Asset Library Folder 삭제(`delete_folder`)의 `remove_child_indexes`/`delete_manual_files` 옵션 parity 완료(서른한 번째 이전 기능).
- 단기 프로젝트 상세의 워크플로 상태 기반 "이어서 진행하기" 자동 재개 완료(서른두 번째 이전 기능).
- 실제 OpenAI Story 생성 adapter와 전용 예산 게이트 완료(서른세 번째 이전 기능). 사용자가 실제 키를 등록·연결해야만 켜지며, 이번 세션에서는 실제 키·실제 네트워크 호출 없이 골격만 구현·검증했다.
- 실제 OpenAI 이미지 생성 adapter(6장면 최초 생성 경로) 완료(서른네 번째 이전 기능). Reference 이미지 편집(`images.edit`)과 장면 재생성(`image-review.service.ts`) 경로는 다음 범위로 남겼다.
- 실제 Runway 영상 생성 adapter(제출/상태조회/다운로드) 완료(서른다섯 번째 이전 기능) — **adapter 함수만이며, 아직 로컬 fake 영상 워크플로에 연결하지 않았다.** 사용자와 상의해 이번 세션 범위를 의도적으로 이렇게 좁혔다: Runway는 영상 하나에 수 분이 걸리는 비동기 작업이라, "한 요청 안에서 6장면을 즉시 처리"하는 현재 `local-video-workflow.service.ts` 구조로는 안전하게 연결할 수 없고, 별도의 배경 작업/진행 상태 재설계가 필요하다.
- 장기 프로젝트 Episode 타임라인에도 상태 기반 "이어서 진행하기"를 적용 완료(서른여섯 번째 이전 기능).
- 단기·장기 프로젝트 상세에 "생성 이미지 모음" 링크 완료(서른일곱 번째 이전 기능) — 기존 Asset Library를 해당 프로젝트 ID로 미리 검색한 상태로 재사용한다.
- 단기 프로젝트 Wizard 대표/서브 캐릭터(Cast) 선택 완료(서른여덟 번째 이전 기능) — 기존에 휴면 상태였던 `character_profile.cast` → `character_cast_metadata` Story prompt 경로를 처음으로 채웠다.
- 단기 프로젝트 Wizard 전체 분위기·장면 참고 Asset 선택 완료(서른아홉 번째 이전 기능) — `atmosphere_asset_metadata`/`scene_reference_asset_metadata` 휴면 placeholder를 채웠고, 겸사겸사 `character_cast_metadata` 렌더링도 Python의 `describe_character_cast`와 동일한 형식(Asset 실제 이름·설명 조회)으로 맞췄다.
- 단기 프로젝트 Wizard 이전 장면 연결(Scene 6 연속성) 완료(마흔 번째 이전 기능) — `lore_context.previous_scene_link` 구조화 저장과 `short_scene_continuity_option` 후보 도출 로직을 옮기고, `previous_scene_context` 프롬프트 변수를 그 링크에서 파생하도록 고쳤다. **이것으로 단기 Wizard parity 작업(Cast·분위기/장면 참고 Asset·이전 장면 연결)이 모두 끝났다.**
- 마지막 전체 검증: Backend 408 통과 + intentional skip 1개, Frontend 531 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check` 통과.
- 테스트와 검증에서 실제 OpenAI/Runway Provider, 외부 network, 실제 FFmpeg binary 호출은 하지 않았다.

### 2026-08-23 실제 브라우저 E2E 검증과 통합 버그 수정

- 위 커밋되지 않은 14~40번째 기능 전체를 실제로 신뢰할 수 있는지 확인하기 위해, Chrome 확장 대신 임시로 설치한 Playwright 헤드리스 브라우저로 로컬 backend(NestJS)와 frontend(Vite) dev 서버를 직접 띄워 장편 파이프라인 전체(장기 프로젝트 생성 → outline 승인 → Episode 대본 생성·승인 → Asset mapping 검토·승인 → 이미지 6장 생성·승인 → 영상 6개 생성·승인 → 최종 병합 시도 → Continuity)를 처음부터 끝까지 클릭했다. 이 과정에서 유닛/통합 테스트(모두 mock 기반)로는 잡히지 않았던 **통합 지점 버그 4개**를 발견해 수정했다(커밋 `aca629f`):
  1. `apps/frontend/vite.config.ts`의 dev proxy에 `/long-projects` 경로가 빠져 있어, 로컬 dev 서버로 띄우면 장편 프로젝트 기능 전체가 backend에 연결되지 않았다.
  2. `episode-asset-mappings.service.ts`의 `begin()`이 `episode.state === "script_approved"`일 때만 동작해, Bible Asset이 없는 흔한 경우의 "text-only 재확인" 2차 호출(이미 `waiting_for_asset_mapping_review`로 전이된 뒤의 호출)이 항상 거부되고 있었다.
  3. `episode-asset-mappings`/`episode-continuity`/`episode-images`/`episode-video-merge`/`episode-videos` 다섯 서비스의 `detail()`이 디스크에 snake_case로 저장된 `episode.script`를 camelCase 변환 없이 그대로 API 응답에 넣어, Frontend의 응답 shape 검증이 항상 실패했다(`CLIENT_MALFORMED_RESPONSE`). 공용 변환 함수 `episode-script-format.ts`의 `toApiEpisodeScript()`를 새로 만들어 다섯 곳 모두 고쳤다.
  4. `LongEpisodeImageGenerationScreen.tsx`의 이미지 검토 자동 로드 `useEffect`가 자기 자신이 설정하는 `reviewState.status`를 의존성 배열에 포함하고 있어, 응답이 오기 전에 effect가 재실행되며 그 cleanup이 진행 중이던 fetch의 결과를 취소해버려 화면이 "Loading image reviews..."에서 영원히 멈추는 버그였다.
- 이 네 버그를 고친 뒤 실제 설치된 FFmpeg이 없는 이 개발 환경에서 최종 병합을 시도하면 스택트레이스 없이 안전한 `LONG_EPISODE_FFMPEG_UNAVAILABLE`(503) 메시지가 표시되는 것까지 확인했다 — 이건 버그가 아니라 이미 문서화된 범위 밖(실제 FFmpeg 환경 검증) 항목이 의도대로 동작한 것이다.
- Story Bible 화면, 단기 프로젝트 Wizard의 Cast/분위기·장면 참고 Asset/이전 장면 연결 세 에디터, 프로젝트 상세의 "생성 이미지 모음" 갤러리 링크도 실제 브라우저로 정상 동작을 확인했다.
- 수정 후 재검증: root typecheck/build 통과, Backend 408 통과(+1 intentional skip), Frontend 531 통과, Shared 25 통과 — 버그 수정 전과 정확히 같은 수치이며 회귀 없음을 확인했다. 실제 Provider·network 호출은 0건이다.
- **커밋/푸시 정책 변경(같은 날)**: `CLAUDE.md`와 `docs/03_TEAM_WORKFLOW.md`를 "기능·수정이 검증을 통과하면 즉시 커밋하고 `origin`에 push, 매번 확인받지 않음"으로 바꿨다(커밋 `72bc2d9`). 이전에는 "사용자가 요청한 경우에만 커밋"이었는데, 이 정책 때문에 14~40번째 기능이 한 번도 커밋되지 않고 쌓였다가 나중에 파이프라인 단계별로 재구성해야 했던 것이 이번 변경의 배경이다.

### 다음 권장 작업 순서

1. **(중요, 아키텍처 변경 필요)** `local-video-workflow.service.ts`를 "몇 분짜리 실제 작업을 감당하는 구조"로 재설계한 뒤 Runway adapter를 실제로 연결. 현재 구조(한 HTTP 요청 안에서 6장면을 동기적으로 순회)는 실제 Runway task의 제출→polling→다운로드 시간(수 분)과 맞지 않는다. Python처럼 제출은 즉시 응답하고, 진행 상태는 프론트엔드가 주기적으로 poll하는 방식으로 바꿔야 한다. 착수 전 접근 방식을 다시 한 번 사용자와 확인한다. 사용자는 향후 Runway 외 다른 영상 Provider(예: Seedance — 참고로 Runway API 자체도 이미 seedance2 계열 모델을 지원한다) 연동도 고려 중이므로, 이 재설계 시점에 Provider를 하나로 고정하지 않는 구조를 함께 검토한다.
2. 실제 OpenAI 이미지 생성에 Asset Mapping 기반 Reference 이미지 편집(`images.edit`, 승인된 캐릭터/스타일 이미지 전달)과 장면 재생성(`image-review.service.ts`) 경로 추가. 마흔 번째 기능에서 저장하기 시작한 `lore_context.previous_scene_link.image_path`(연결된 이전 프로젝트의 Scene 6 이미지)를 이 작업에서 Scene 1 Image 생성의 continuity Reference로 실제로 소비하는 것도 포함한다 — 지금은 저장만 하고 아직 아무 것도 이 값을 읽지 않는다.
3. 실제 FFmpeg 환경 검증은 Provider adapter 이후 별도 기능으로 진행한다. 테스트에서는 절대 유료 요청이나 실제 바이너리 호출을 하지 않는다.

### 실제 Provider 연동 설계 원칙(서른세 번째 기능부터 적용)

- 실제 adapter는 항상 기존 credential 연결 상태(`설정 화면에서 등록 + 연결`)를 확인해서, 연결된 키가 없으면 **자동으로 기존 local fake 경로로 폴백**한다. 즉 키를 넣기 전까지는 관찰 가능한 동작이 전혀 바뀌지 않는다.
- 모든 테스트는 `fetch`를 mock으로 대체하며, 실제 Provider 도메인으로 나가는 요청은 0건으로 유지한다(각 기능마다 이 사실을 통합 테스트로 고정한다).
- Provider별 예산은 분리된 파일에 저장하고(OpenAI는 `learning_data/api_budget_usage.json`), 요청 전 preflight로 차단하고 성공·실패 모두 추정 비용을 실제 사용량으로 기록한다.
- 실제 요청이 실패하면 프로젝트 상태를 진행 중 단계에 묶어두지 않고 재시도 가능한 이전 단계로 되돌린다.
- 사용자가 실제 키를 넣고 직접 첫 실사용 테스트를 하기 전까지, 이 저장소의 어떤 자동화도 실제 유료 요청을 보내지 않는다.

### 의도적으로 이전하지 않기로 결정한 Python 동작

- Python `upgrade_legacy_root_assets_to_folders`/`repair_legacy_generated_scene_folders`는 Python 자신의 "Folder 개념 도입 이전" 구버전 `assets.json`을 여는 Python 내부 자기 치유(self-heal) 로직이다. TypeScript Asset Library는 처음부터 "최상위 Asset은 직접 주소 지정 가능한 1급 개체"로 설계되었고(버전 관리·relink·소유 파일 삭제·mapping이 모두 최상위 Asset ID를 직접 참조), 모든 Asset을 1-child Folder로 강제 승격하면 이미 구현된 다수 기능(스물아홉·서른한 번째 이전 기능 포함)의 전제가 깨진다. 따라서 이 두 함수는 이전하지 않기로 결정했다. Python에서 만든 실제 구버전 `assets.json` 표본이 나타나면 이 결정을 다시 검토한다.

### 인수인계 실행 규칙

- 새 에이전트는 이 문서의 최신 완료 항목과 위 우선순위에서 이어서 작업한다.
- 현재 worktree에는 **미커밋 변경이 존재한다**. 기존 변경을 덮어쓰거나 reset/checkout으로 버리지 않는다.
- 단독 실행이면 세션 지시에서 Main/Frontend/Backend 역할을 함께 지정해 `main`에서 처리할 수 있다. 병렬 실행이면 역할별 worktree를 사용한다.
- 기능 하나가 끝나면 Main 역할은 전체 검증과 이 문서 갱신을 마친 뒤 다음 기능을 계속 시작한다.

## 8. 현재 TypeScript 구현과 미구현 부분

| 영역 | 구현됨 | 미구현 |
|---|---|---|
| 기반 | strict TypeScript workspace, React/Vite, NestJS, Electron | 배포와 Python 동등성 검증 |
| Shared | 1~6 SceneNumber, 기본 Project/Scene/usage/task, Python과 같은 WorkflowState/전이, 단기 프로젝트 create/list/get, Provider credential 상태, Asset Library와 project Asset mapping/review 계약, 단기 프로젝트 Wizard 설정 및 Story prompt preview/approval 계약과 테스트 | 전체 ProjectContext, Story motion, 장기 프로젝트 DTO |
| Frontend | 단기 프로젝트 생성·목록·재열기, 프로젝트 설정 저장·재열기, OpenAI·Runway credential 관리, Asset Library, project Asset mapping review, Story prompt preview/edit/restore/별도 승인과 안전한 API 오류 UI | Story 6장면·이미지·영상 등 이후 사용자 흐름 |
| Backend | `GET /health`, 단기 프로젝트 create/list/get/settings, Python 호환 JSON 저장·재열기, 로컬 `.env` credential 관리, Asset Library, project Asset mapping 저장·검토·snapshot, Story prompt 렌더·승인 audit 저장 | Story 6장면·workflow/provider/media endpoint |
| Desktop | 격리된 BrowserWindow에서 frontend 로드 | backend 생명주기, file dialog/path open, packaging/recovery |

Shared의 `/projects` route는 NestJS에 구현되었으며 video route는 아직 구현되지 않았다.

### 사용자 계약 결정

- 현재 제품은 로컬 단일 사용자 프로그램이다.
- 현재 프로젝트 계약에서 `userId`를 필수값으로 사용하지 않는다.
- 회원가입·사용자 소유권 모델은 현재 이전 범위에서 제외하고 향후 서버 확장 단계에서 별도로 설계한다.
- 따라서 첫 기능을 이전할 때 기존 `ProjectSummary.userId`는 필수 계약에서 제거하거나 선택값으로 바꾸되, 애플리케이션 코드는 해당 기능 구현 단계에서 수정한다.

## 2026-08-21 Python 기준 기능 조사

### 조사 범위

- [x] `app/` Python 소스 전체, `tests/` 단위·통합 테스트 전체, `prompts/` 템플릿 3개 조사
- [x] `apps/`, `packages/shared/` TypeScript 소스와 테스트 대조
- [x] Tkinter 화면에서 호출 서비스·저장소·adapter까지 추적
- [ ] 실제 사용자 프로젝트 JSON 표본을 통한 모든 과거 버전 필드 검증은 **확인 필요**
- [ ] GUI 옵션별 실제 Provider 결과 품질과 전체 클릭 E2E는 **확인 필요**

### 1. 사용자가 실제로 사용하는 화면과 기능

#### 대시보드와 공통 셸

- [ ] 최근 단기 프로젝트, 진행률·현재 단계, 영상 확인 대기 수 표시
- [ ] 새 단기/장기 프로젝트, 단기 목록, 이미지 검토, 영상 생성, 생성 이미지/영상 모음, Asset Library, 설정·환경 탐색
- [x] OpenAI key와 Runway secret 연결·가림·저장·해제
- [ ] 현재 프로젝트 계속하기, 프로젝트 열기와 archive

#### 단기 프로젝트

- [ ] Wizard 입력: 이름, 주제, 전체 줄거리, 장르, 분위기, 시각 스타일, 색감, 조명, 카메라, 대사 스타일, 회피 요소, 화면 비율, 길이, 추가 지시
- [ ] 대표 Character Asset, 서브 캐릭터와 이야기 역할 선택
- [ ] 전체 분위기 Asset과 장면용 background/object/style/general Reference 및 사용 목적 선택
- [ ] 명시적으로 고른 이전 프로젝트의 승인된 Scene 6을 Story와 Scene 1 연속성 자료로 연결
- [ ] API key 없이도 설정을 프로젝트로 저장·관리
- [x] 정확한 Story prompt 미리보기·편집·복원 후 별도 확인으로 local fake adapter 승인 audit 저장; Preview와 승인 모두 유료 Provider 무호출. 실제 OpenAI 전송과 Story 생성은 다음 단계
- [ ] title/synopsis/ending과 정확히 6 scenes 검증. 각 scene은 description, visual action, 정적 구도, 시작·주요·종료 동작, camera/environment motion, 속도·강도, 표정 변화와 continuity hint를 가짐
- [ ] 자동 Asset 후보 검토와 명시 승인. suggested/ambiguous/invalid/unconfirmed unmatched는 차단하고 text-only도 사용자 확인
- [ ] 승인 mapping으로 이미지 6장 순차 생성; 부분 성공 저장, 완료 scene 보존, 누락 scene만 재개
- [ ] 장면 이미지 승인·재생성·version history·Library 등록; 재생성 scene 승인만 초기화
- [ ] 이미지 6개 승인 후에만 Runway 단계 진입
- [ ] Runway 전송 전 prompts, model, ratio, duration, 최대 호출, 예상 비용/월 예산을 확인·수정; Preview는 무호출
- [ ] 명시 승인 뒤 Scene 1~6 순차 제출; 진행 창은 비모달, 중지는 다음 제출부터 차단
- [ ] 장면 영상 승인·단일/전체 재생성; 이전 파일 history 보존
- [ ] 영상 6개 승인 후 FFmpeg 순서 병합과 최종 Reels MP4 확인

#### Asset Library와 프로젝트 Asset

- [ ] 프로젝트 없이도 전역 Library에서 이미지/폴더 등록·검색·편집
- [ ] character/background/object/style/general reference의 대표 이름, 설명, 태그, 별칭, 상태와 유형별 시각 설명 관리
- [ ] Character 폴더의 front/side/back/사용자 역할 Reference 순서와 대표 이미지 관리
- [ ] SHA-256 중복 차단, version 고정 또는 최신 추종
- [ ] project mapping의 episode/scene scope, usage role, 선택 자식, 자동/수동 출처, 신뢰도·이유와 승인 상태 저장
- [ ] 사용 중 Asset 및 프로젝트 소유 이미지 삭제 차단, 파일 감사와 안전한 relink
- [ ] legacy Reference를 원본 보존하며 Library/mapping으로 멱등 이전

#### 장기 프로젝트

- [ ] 장기 설정, Story Bible, 전체 Episode outline, Episode 목록·대시보드 관리
- [ ] Planner 1회로 outline만 Preview하며 script/image는 자동 생성하지 않음; 명시 승인 필요
- [ ] Bible character/location/prop/secret/foreshadowing CRUD·복제·검색과 Library Asset/Style 연결
- [ ] 선택 Episode 하나만 script 생성·편집·승인하고 revision/history 보존
- [ ] Episode mapping 승인 뒤 이미지 생성·검토·재생성; 부분 성공과 누락 재개
- [ ] 이전 Episode의 승인된 Scene 6을 다음 Episode Scene 1 Reference로 사용
- [ ] 요약·사건·entity 변화·비밀·복선·다음 행동을 Continuity Memory에 저장; 최근 우선, 미래 비밀 제외, context 크기 제한
- [ ] 다음 Episode는 사용자가 준비하며 자동 연쇄 생성하지 않음
- [ ] 장기 영상부터 최종 병합까지 단기와 같은 수준의 UI 통합은 **확인 필요**

### 2. 기능별 입력·출력·오류 처리

| 기능 | 입력 | 출력 | 오류·Gate |
|---|---|---|---|
| 프로젝트 | 안전한 ID, topic, Wizard 설정 | UTF-8 `project.json`, 목록/재열기 | 빈 값, 위험 ID, 손상 JSON, unknown field 거부 |
| Story | 승인 prompt, key, 설정/Asset metadata | 구조화 Story, 6 scenes | 빈 prompt/key, 예산, invalid JSON/scene count, 인증·권한·한도·서버·네트워크 분류 |
| Mapping | scenes, fingerprint/revision, 후보/scope/version | 승인 review와 snapshot | suggested/ambiguous/invalid/unconfirmed, missing pinned version, script 변경 |
| 이미지 | 승인 mapping, prompt, References, size/quality | `scene1.png`~`scene6.png`, 기록 | 예산/호출 한도, invalid payload/size/format, duplicate job, 명시 재개 |
| 이미지 검토 | scene, 승인/regen | 승인과 version history | 잘못된 번호, 파일 누락, fingerprint 변경, regen 한도 |
| Runway Preview | 승인 이미지, motion, aspect/방향 | 편집 prompts와 비용 | Provider 무호출, 혼합 방향·파일 누락·prompt 제한 |
| Runway 생성 | 명시 승인, unique request ID, prompts, secret | task ID, 순차 mp4, audit | key/예산/중복/동시성, bounded poll/timeout, task/file 재사용 |
| 영상 검토 | scene 승인/regen | 6 reviews | 전부 승인 전 merge 차단, force-all과 single retry 동시 사용 차단 |
| FFmpeg | 순서 고정 mp4 6개 | 정규화·concat MP4/last frame | binary/file/stream/duration 누락, subprocess 실패 |
| 장기 | 설정, 승인 prompt, Episode, Bible/Memory | outline/script/images/continuity | Episode limit, key/예산/중복, 승인 전 image 차단, context limit |

### 3. JSON 데이터 구조

#### 단기 `learning_data/projects/<project_id>/project.json`

- [ ] 식별·상태: `project_id`, `topic`, `project_type`, `workflow_state`, `created_at`, `updated_at`, `script_revision`, `mapping_revision`
- [ ] 창작: `character_profile`, `lore_context`, `style_profile`, `references`, `story`, `scenes`
- [ ] 이미지: `image_prompts`, `generated_images`, `image_generation_records`, `generated_image_reviews`, `face_consistency_results`
- [ ] 영상: `motion_prompts`, `generated_video_paths`, `video_generation_records`, `video_reviews`, `final_video_path`
- [ ] 운영: `api_usage`, `warnings`, `errors`
- [ ] 호환: `capcut_clip_paths`; `WAITING_FOR_CAPCUT`/`CAPCUT_CLIPS_READY`와 legacy clips를 현재 상태/경로로 읽음
- [ ] scene 산출물 배열은 최대 6개, 완전 검증 시 scenes는 정확히 6개
- [ ] profile 내부 Wizard 키는 자유 dict이므로 완전한 고정 schema는 **확인 필요**; 생성 fixture로 고정 후 이전

#### 장기와 보조 JSON

- [ ] `long_story/project.json`: title/logline/overview/genre/tone/theme, Episode 수·길이·일정, 시작/중간/결말/story flow, platform/aspect/audience/notes/timestamps
- [ ] `story_bible.json`: `basic`, `world`, `characters`, `locations`, `props`, `secrets`, `foreshadowing`, `summaries`, `updated_at`
- [ ] `episode_outlines.json`; `EpisodeNNN/project.json`, `outline.json`, `script.json`, `images/`; legacy `episodes/episode_NNN/episode.json`/`continuity.json`
- [ ] `generated_image_reviews.json`: scene/path/status/regen count/history/timestamp
- [ ] `reference_assets/references.json`: Reference, scene/episode scope, type, character/face baseline, SHA
- [ ] `asset_mappings.json`: Library 연결, scope/status/version/snapshot/selected children
- [ ] `asset_mapping_review.json` 또는 `mapping_reviews/episode_NNN.json`: fingerprint/revisions/status/confirmations/reviewed scenes
- [ ] `learning_data/asset_library/assets.json`: Asset, versions, Character Reference set, 검색·소유권 metadata
- [ ] `api_jobs.json`, `api_calls.json`, `api_budget_usage.json`, `runway_budget_usage.json`: job/task/attempt/retry/provider ID, 호출·비용
- [ ] project `events.jsonl`, `style_profile/style_profile.json`, `lore/*.json`, character/reference metadata JSON

### 4. 저장 경로

```text
.env
cache/  logs/  images/generated/  images/temp/
videos/runway/  videos/continuity/  videos/final/  videos/temp/
output/reels/  output/shorts/  output/thumbnails/  output/archive/
learning_data/projects/<project_id>/project.json
learning_data/projects/<project_id>/events.jsonl
learning_data/projects/<project_id>/images/sceneN.png
learning_data/projects/<project_id>/images/originals/sceneN_vNNN.png
learning_data/projects/<project_id>/generated_image_reviews.json
learning_data/projects/<project_id>/reference_assets/references.json
learning_data/projects/<project_id>/asset_mappings.json
learning_data/projects/<project_id>/asset_mapping_review.json
learning_data/projects/<project_id>/asset_snapshots/
learning_data/projects/<project_id>/videos/runway/sceneN.mp4
learning_data/projects/<project_id>/videos/runway/history/sceneN_<timestamp>.mp4
learning_data/projects/<project_id>/videos/continuity/sceneN_last.png
learning_data/projects/<project_id>/videos/final/instagram_reel.mp4
learning_data/projects/<project_id>/long_story/...
learning_data/asset_library/assets.json  learning_data/asset_library/manual/...
learning_data/style_profile/style_profile.json  learning_data/lore/...
learning_data/api_calls.json  learning_data/api_jobs.json  learning_data/api_budget_usage.json
```

- [ ] 프로젝트별 생성 경로와 `AppConfig.ensure_directories()` 공통 runtime 경로를 fixture로 구분
- [ ] Windows/OneDrive 잠금에 대한 원자 저장과 제한 재시도 유지
- [ ] archive는 `output/archive`; 실행 중 API job이면 차단

### 5. 외부 연동

- [ ] OpenAI Responses: 기본 `gpt-5.6-luna`, JSON Story/outline/script, SDK retry 0과 앱 bounded retry
- [ ] OpenAI Images: 기본 `gpt-image-2`, PNG medium, aspect별 `1024x1536`/`1536x1024`/`1024x1024`, Reference edit
- [ ] OpenAI 오류를 authentication/quota_or_permission/rate_limit/server/network/invalid_request/empty·invalid response/unknown으로 분류해 한국어 메시지 제공
- [ ] Runway: `gen4_turbo`, 기본 `720:1280`, 5초, 무음, submit→poll→원자 download, UTF-16 prompt 길이
- [ ] Runway 예산은 OpenAI와 분리하고 실패한 Provider 시도도 기록
- [ ] FFmpeg/ffprobe argument 배열, UTF-8 경로, probe, 세로·가로 정규화, 30fps, 6개 순서 concat, last frame
- [ ] 선택적 InsightFace는 모델 없음/backend 실패 시 전체 생성을 중단하지 않음
- [ ] OS로 local path open; CapCut은 legacy JSON 호환 외 현재 workflow에서 미사용

### 6. 캐릭터·Asset·스타일·세계관·메모리

- [ ] 대표 캐릭터 외모·머리·기본 복장·대표 색·고유 소품 identity 유지와 변경 차단
- [ ] 여러 각도 Reference를 한 인물로 묶고 캐릭터 간 얼굴·복장·색·소품 혼합 금지
- [ ] 분위기 Asset은 공통 연출, background/object는 필요한 scene, style은 시각 방향에 적용
- [ ] Story API에는 Asset metadata text, Image API에는 승인되고 scope가 유효한 실제 이미지/manifest 전달
- [ ] exact 이름 우선, casefold/부분 검색, ambiguity, inactive 제외, SHA dedup
- [ ] Style feedback/score 저장과 범위 검증, Lore 중복 이름 차단과 JSON context
- [ ] 단기 memory는 ProjectContext/events, 장기는 Bible + ContinuityMemory + 최근 우선/크기 제한 context

### 7. 기존 테스트가 보장하는 동작

- [x] 상태 전이, JSON round-trip, 손상/위험 ID 거부, 정확히 6장면
- [x] fake OpenAI SDK request/JSON/base64/Reference 순서/size override와 bounded retry
- [x] 호출 전 예산, 성공·실패 비용, 월/일 한도, duplicate request/resource, concurrency, stale lock, audit
- [x] Asset import/search/dedup/version/folder/Character refs/삭제 소유권/relink/migration/snapshot/scope/review invalidation/OneDrive retry
- [x] Wizard와 Asset의 prompt/API 전달 및 편집한 Preview text의 정확한 1회 사용
- [x] 이미지 6장, cache, 부분 실패·누락 재개, scene regen·승인 초기화, key 없이 review
- [x] Runway Preview 무호출, 방향/prompt compaction, 순차 생성, stop, task/file recovery, regen과 6승인 Gate
- [x] FFmpeg argument/probe/normalize/order/last frame/error와 설치 환경 조건부 실제 6 clip 통합 테스트
- [x] 장기 outline-only/Preview 승인/사용자 설정 우선/단일 Episode/revision/Bible/Memory/partial resume/비자동 다음 Episode
- [x] UI helper/static test의 action bar, scroll, prompt edit, UTF-16 counter, 비모달 progress, lazy gallery, 검색/progress
- [x] fake Provider 통합 테스트의 단기 완료·reload와 장기 Episode 사용자 우선 설정
- [ ] 전체 Tkinter 클릭 E2E, 실제 유료 Provider, 모든 Windows 배율 시각 결과는 **확인 필요**

### 9. 기능 의존관계

```text
설정·안전 경로 -> 프로젝트 JSON/상태 -> Asset Library/mapping 승인
-> Story preview/승인/6 scenes -> 이미지 partial recovery/6장 review
-> Runway preview/비용/승인 -> task recovery/6영상 review -> FFmpeg/final MP4

장기 Project/Bible/Outline -> Episode script -> Episode mapping
-> 공통 image/video/review -> ContinuityMemory -> 다음 Episode context
```

### 10. 안전한 기능 이전 순서

1. [x] 단기 프로젝트 생성·목록·재열기와 Python JSON fixture
2. [x] 설정·secret 저장/가림/log redaction; Provider 미연결
3. [x] Asset Library 최소 CRUD·검색·소유권과 legacy index
4. [x] project Asset scope·mapping review/snapshot/fingerprint Gate
5. [x] Story prompt preview/edit/restore/별도 explicit approval audit; local fake adapter, Provider 무호출
6. [x] Story 저장, 6장면 검증·복구
7. [x] image prompt/reference preview와 fake 생성, cache/partial resume
8. [x] image review/regen/version/Library 등록과 6승인 Gate
9. [x] 예산·일일 limit·job lock·duplicate request/input hash·audit
10. [x] Runway preview/edit/cost/confirmation fake 통합 — local fake만. 실제 Runway 연결은 "다음 권장 작업 순서" 1번(아키텍처 재설계) 참고.
11. [x] Runway sequential/stop/task recovery/regen과 6승인 Gate — local fake만, 위와 동일.
12. [x] FFmpeg probe/normalize/order merge/continuity/final MP4 — mock runner로 구조 검증 완료. 실제 설치된 FFmpeg 환경 검증은 "다음 권장 작업 순서" 3번 참고.
13. [x] 장기 Project/Bible CRUD와 outline Preview/approval
14. [x] Episode 공통 pipeline과 ContinuityMemory
15. [ ] Electron 통합, Python 동등 fixture, Windows packaging·회귀 검증 — 아직 착수 전.

이 목록은 2026-08-21 계획 초안 당시 만들어진 뒤 기능이 하나씩 끝날 때마다 갱신되지 않고 있었다. 실제 진행 상황의 기준은 위 "1번째~마흔 번째 이전 기능" 개별 섹션이며, 이 15개 목록은 그것을 요약한 것이다(2026-08-23 최신화).

비용·call guard·job/task 저장·secret redaction은 Provider보다 먼저 구현한다. Preview/explicit approval는 submit 전 통합 테스트로 고정한다. Mapping snapshot/fingerprint 없이 이미지 생성을, file/task reuse와 input hash 중복 차단 없이 실제 Runway 연결을 허용하지 않는다.

## 첫 이전 기능 추천: 단기 프로젝트 생성·목록·재열기

유료 Provider 없이 사용자에게 보이는 첫 완결 흐름이며 이후 기능이 의존하는 ID·경로·JSON·상태 계약을 가장 작게 검증한다. Story, Asset, API key, 삭제·archive는 포함하지 않는다.

### Main 범위와 완료 조건

- [x] Python `ProjectContext` 최소 호환 필드와 `INIT -> READY`를 shared camelCase API로 확정
- [x] Python에 없는 `userId`는 현재 필수 계약에서 제외하기로 결정; 계정 기능은 서버 확장 단계까지 구현하지 않음
- [x] `POST /projects`, `GET /projects`, `GET /projects/:projectId`와 `{ code, message, details? }` fixture 정의
- [x] snake_case 저장 JSON↔camelCase API, unknown field와 legacy state fixture 정의
- [x] root typecheck/test/build와 Python baseline 무변경 확인
- [x] 완료: 앱 재시작 뒤 같은 project의 topic/state/timestamps가 보존되고 빈·중복·위험 ID와 손상 JSON 오류가 표시됨

### Frontend 범위와 완료 조건

- [x] 프로젝트 ID와 영상 주제 최소 폼, submit 상태와 field 오류
- [x] 목록 loading/empty/error/success와 프로젝트 열기 화면
- [x] shared DTO/route만 사용하고 저장 구조를 UI에서 추정하지 않음
- [x] 이벤트 테스트로 필수값, 성공 생성, backend 오류, 목록 갱신, 재열기 검증

### Backend 범위와 완료 조건

- [x] `learning_data/projects/<safe_project_id>/project.json` UTF-8 원자 저장 repository와 create/list/get controller
- [x] path 안전성, required topic, duplicate ID, corrupt JSON, unknown field를 API 오류로 변환
- [x] Python `MemoryManager.list_projects()`와 같이 목록에서 손상 project를 제외하는 정책을 테스트로 고정
- [x] Provider·FFmpeg·외부 프로그램 호출 없음
- [x] repository/controller test로 round-trip, 새 instance reload, empty, duplicate/unsafe/corrupt JSON, atomic write failure와 유료 호출 0회 보장

Backend 완료 근거(2026-08-21): `feature/backend`의 `2bbf81f`에서 shared 계약과 세 endpoint, Python 호환 저장소 및 오류 처리를 구현했다. Backend 통합 시점에 Backend 71개, Shared 10개, 당시 Frontend 1개 테스트와 root typecheck/build를 통과했으며, 이 시점에는 Frontend 사용자 흐름이 남아 있어 Backend 범위만 완료 처리했다.

Frontend 및 통합 완료 근거(2026-08-21): `feature/frontend`의 `48065b0`에서 ID·주제 폼, 목록 상태, 상세 재열기, 안전한 API 오류 처리를 구현했다. Main에서 Backend 71개, Frontend 56개, Shared 10개 테스트와 전체 typecheck/build를 통과했다. 실제 Chrome에서 로컬 NestJS와 Vite를 연결해 `통합검증_20260821_2253` 프로젝트 생성, 목록 반영, 페이지 새로고침 뒤 목록 복원과 상세 재열기까지 확인했으며 Provider·FFmpeg는 호출하지 않았다.

## 두 번째 이전 기능: 로컬 Provider credential 설정

- [x] Shared에 OpenAI·Runway 상태, 저장, 연결 해제·재연결 DTO와 중앙 route 정의
- [x] Backend에 `GET /settings/providers`, credential 저장, session disconnect/reconnect 구현
- [x] Python 기준 `.env` UTF-8 원자 저장, 다른 설정 보존, Runway legacy 이름 정규화
- [x] 원문 credential·절대경로·stack을 API와 로그에 노출하지 않고 고정 마스킹만 반환
- [x] Frontend password 입력, 저장 상태, 마스킹, 연결 해제·재연결과 provider별 오류 UI 구현
- [x] malformed mask/error/provider 응답, 중복 submit, refresh/mutation 경합과 DOM 속성 누출 차단 테스트
- [x] 실제 Provider·네트워크·FFmpeg 호출 없이 새 Backend instance 재로딩 검증

완료 근거(2026-08-22): Backend/shared `8eba07e`, Frontend `881f387`, Nest DI 부팅 수정 `d938db5`를 Main에 통합했다. Main에서 Backend 88개, Frontend 114개, Shared 12개 테스트와 전체 typecheck/build를 통과했다. 실제 Chrome에서 임시 저장 root를 사용하는 로컬 NestJS와 Vite를 연결해 OpenAI·Runway 테스트 credential 저장, 마스킹, OpenAI session 연결 해제·재연결, Backend 재시작 뒤 두 provider의 저장 상태 복원을 확인했다. 실제 API key와 유료 Provider는 사용하지 않았다.

## 세 번째 이전 기능: Asset Library 최소 CRUD·검색·소유권과 legacy index

- [x] Shared에 Asset 공개 DTO, 검색·유형 필터, multipart metadata, 상세·편집·목록 삭제 및 안전한 content route 정의
- [x] `learning_data/asset_library/assets.json` 루트 배열과 전체 known snake_case 필드, 누락 legacy 기본값 및 읽기 시 비수정 호환
- [x] `character`·`style`·`background`·`object`·`general_reference` 목록, casefold 부분 검색, 정확한 유형 필터와 Python 정렬 순서
- [x] 브라우저 이미지 multipart 가져오기, SHA-256 중복 ID 재사용, 수동 소유 이미지 경로와 한글 파일명 UTF-8 보존
- [x] 공개 API에서 절대경로를 제거하고 `learning_data` realpath 내부의 일반 파일만 안전한 content route로 제공
- [x] metadata 편집과 사용 프로젝트가 있는 Asset·Folder·Folder 하위 Asset의 삭제 차단; 현재 DELETE는 index만 제거하고 이미지 bytes는 삭제하지 않음
- [x] UTF-8 원자 index 저장, 고유 temp, Windows/OneDrive 제한 재시도, in-process 및 cross-process 잠금·stale lock 복구·실패 cleanup
- [x] 손상·unknown JSON, unsafe ID/path·symlink 탈출, 잘린 이미지, multipart 제한·unknown part와 고정 ApiError/redaction 검증
- [x] Frontend loading/empty/error/success, 목록 보존, 상세 재열기, 편집, 삭제 확인, 중복 submit 및 stale request/mutation 경합 차단
- [x] Folder·version/Character 다각도 mutation·relink·project mapping/review·physical file 삭제는 다음 단계로 유지
- [x] Provider·외부 네트워크·FFmpeg 호출 없음

완료 근거(2026-08-22): Shared 계약 `0d1a731` 이후 Backend와 Frontend 구현을 Main에서 통합 검증했다. Backend 142개 통과·cross-process worker 1개 의도적 skip, Frontend 201개, Shared 17개 테스트와 전체 typecheck/build 및 `git diff --check`를 통과했다. 실제 임시 `LEARNING_DATA_ROOT`를 사용하는 AppModule HTTP에서 빈 목록, multipart 등록, 상세, image content, 한글 filename raw UTF-8 저장, 새 Backend instance 재열기와 unsafe encoded ID 차단을 확인했다. Chrome과 Vite/NestJS를 연결해 목록, 실제 이미지 로드, 상세, metadata 편집, 새로고침 뒤 재열기 및 삭제 확인창을 검증했다. Chrome 확장의 파일 URL 접근 권한이 꺼져 있어 브라우저 자동 파일 선택은 실행하지 못했지만 동일 multipart endpoint의 실제 HTTP 검증과 Frontend mock event 테스트를 통과했다. 실제 API key·유료 Provider·FFmpeg는 사용하지 않았다.

## 네 번째 이전 기능: 프로젝트 Asset mapping review·snapshot·fingerprint Gate

- [x] Shared에 project mapping/review/snapshot camelCase DTO와 encoded route를 추가했다.
- [x] Backend는 `asset_mappings.json`, `asset_mapping_review.json`, `asset_snapshots/`의 snake_case 호환 저장과 UTF-8 atomic write를 구현했다.
- [x] mapping 확정·제외, revision/fingerprint 무효화, text-only/legacy 확인, 1~6 scene coverage 승인 Gate와 snapshot SHA-256 경로 검증을 테스트로 고정했다.
- [x] Frontend는 Project Detail에서 Mapping Review로 진입하고, 목록·상태/type/scene filter·asset detail·confirm/exclude·snapshot·review begin/approve와 safe error UI를 제공한다.
- [x] Shared 19, Backend 151 (+1 intentional skip), Frontend 229 tests 및 root typecheck/test/build, `git diff --check`를 통과했다.
- [x] OpenAI·Runway·FFmpeg·외부 network 호출은 구현 및 테스트에서 제외했다.
- [ ] Story 6 scenes 생성 및 실제 image-generation Gate 연결은 다음 기능에서 구현·통합 검증한다.

완료 근거(2026-08-22): Shared contract `7f009f1`, Backend `a90962b`, Frontend `35ff9d7`을 main에 fast-forward했다. Mapping은 Python `project_asset_mapping.py`의 project-level mapping/review/snapshot 동작만 이전했으며 auto-match, add/replace, long-story Episode, Story/image generation은 범위 밖으로 유지했다.

## 다섯 번째 이전 기능: 단기 프로젝트 Wizard 설정 저장·재열기

- [x] Python Wizard의 이름·주제 필수 검증과 장르·분위기·대표 캐릭터·세계관·전체 줄거리·길이·추가 지시·스타일 필드를 `ShortProjectSettings` 계약으로 명시했다. 현재 로컬 단일 사용자 계약대로 `userId`는 추가하지 않았다.
- [x] Asset 선택/캐릭터 cast/scene reference는 이미 별도 Asset mapping 기능이 소유하므로 이번 설정 저장 범위에서 중복 변경하지 않았다.
- [x] `GET /projects/:projectId/settings`, `PATCH /projects/:projectId/settings`가 Python `project.json`의 snake_case `style_profile`, `character_profile`, `lore_context`와 camelCase API를 변환한다. 기존 알려진 JSON 필드는 보존하고 `updated_at`만 갱신한다.
- [x] 이름·주제·양수 길이·정확히 6장면과 unknown field를 검증하며, UTF-8 atomic write 실패는 기존 `PROJECT_STORAGE_ERROR`로 처리한다.
- [x] Frontend 프로젝트 상세에서 설정 화면을 열어 저장하고, 새 Backend instance에서도 다시 열리는 흐름을 테스트했다.
- [x] Shared 20개, Backend 158개(+1 intentional skip), Frontend 233개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. Provider·FFmpeg·실제 유료 네트워크 호출은 없었다.
- [x] Story prompt preview/edit/restore와 명시적 fake-provider approval audit은 다음 기능에서 완료했다.

## 여섯 번째 이전 기능: Story prompt 미리보기·편집·복원·명시 승인

- [x] `prompts/story/story_generation.txt`를 UTF-8로 읽어 Python `Template.safe_substitute`의 `$name`, `$$`, 미해결 placeholder 보존 동작으로 local prompt를 렌더하고 SHA-256을 계산한다.
- [x] `POST /projects/:projectId/story/preview`가 원문, SHA-256, 캐릭터 수와 정확히 6이라는 scene count를 반환하며 Provider·네트워크·FFmpeg를 호출하지 않는다.
- [x] Frontend는 Project Detail에서 Story Prompt 화면으로 진입해 원문을 textarea에 표시하고, 수정·복원·빈 값 차단·stale preview 새로고침과 안전한 오류 UI를 제공한다.
- [x] 첫 번째 확인은 전송하지 않고 별도 확인 패널만 열며, 두 번째 명시 확인만 `approved: true`, 원문 SHA-256, 편집한 텍스트를 `POST /projects/:projectId/story/approval`로 보낸다.
- [x] Backend는 approval 시 최신 원문 SHA-256을 다시 검증하고, 정확한 원문/승인 텍스트/수정 여부/승인 시각/SHA-256/캐릭터 수를 기존 `project.json`의 snake_case `lore_context.story_prompt_request` audit으로 UTF-8 atomic 저장한다. 변경된 Wizard 설정으로 preview가 stale하면 `STORY_PROMPT_STALE`(409), 빈·unknown field·승인 누락은 `INVALID_REQUEST`(400)로 처리한다.
- [x] Backend unit, Frontend event/API mock, app module 및 root typecheck/test/build를 통과했다. Backend 162개(+1 intentional skip), Frontend 243개, Shared 21개 테스트이며 실제 유료 Provider·실제 API key·FFmpeg 호출은 0회다.
- [x] local fake adapter는 승인 뒤 `READY -> GENERATING_STORY -> WAITING_FOR_ASSET_MAPPING_REVIEW`로 전이하고, Python `STORY_SCHEMA`와 같은 title/synopsis/ending·정확히 6개 순서 장면·17개 장면 필드를 검증해 snake_case `story`, `scenes`, revision과 Mapping review를 저장한다. 실제 Provider 연결은 다음 단계다.

## 일곱 번째 이전 기능: local fake 이미지 생성·검토·장면 재생성

- [x] 승인된 Asset mapping과 정확히 6개 Story scene을 Gate로 하여 `POST /projects/:projectId/images/generations`가 로컬 fake PNG 6장을 `learning_data/projects/<project_id>/images/sceneN.png`에 저장한다. 실제 OpenAI·Runway·네트워크·FFmpeg 호출은 없으며, 유효한 기존 장면은 보존하고 누락 장면만 재개한다.
- [x] 생성 완료 뒤 `IMAGES_REVIEW`로 전이하고, `GET /projects/:projectId/images/review` 및 장면별 명시 승인 API가 `generated_image_reviews.json`을 UTF-8 atomic 저장한다. 6개가 모두 승인된 경우에만 `WAITING_FOR_VIDEO_CONFIRMATION`으로 전이한다.
- [x] Frontend는 생성 전 별도 확인, 생성 결과, 검토 loading/error/success, 장면별 승인과 6개 승인 완료 상태를 제공한다. 모든 API 응답은 shared DTO와 route만 사용하며 절대 파일 경로를 표시하지 않는다.
- [x] `POST /projects/:projectId/images/review/:sceneNumber/regenerate`는 별도 사용자 확인 뒤에만 local fake 재생성을 수행한다. 이전 바이트는 `images/originals/sceneN_vNNN.png`로 원자 보존하고, 해당 장면만 pending으로 되돌리며 다른 승인 상태는 유지한다. `WAITING_FOR_VIDEO_CONFIRMATION`에서 재생성하면 `IMAGES_REVIEW`로 안전하게 복귀한다.
- [x] 재생성 UI는 첫 클릭에서 요청을 보내지 않고 최종 확인에서만 `{ approved: true }`를 전송한다. 중복 클릭, 안전한 오류 표시, 재시도, 다른 장면 보존을 이벤트 테스트로 고정했다.
- [x] Main 통합에서 Backend 180개 통과(+1 intentional skip), Frontend 278개 통과, Shared 23개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 유료 Provider·실제 API key·FFmpeg 호출은 0회다.
- [x] Python과 같이 생성 시 6개 장면 child Asset과 Folder Asset을 기존 Asset Library `assets.json`에 자동 색인한다. 재시작·재개 시 중복 ID를 만들지 않으며, 장면 승인과 6개 전체 승인에 맞춰 child·Folder 승인 상태를 갱신한다.
- [x] 장면 재생성은 기존 generated-image child Asset 및 Folder Asset ID를 유지하고, 이전 archive와 SHA-256을 기존 version history에 보존한 뒤 새 version을 추가한다. 기존 Asset Library 화면은 같은 목록 API를 사용하므로 새 계약이나 별도 UI 저장 구조를 추가하지 않는다.
- [ ] 실제 이미지 Provider 호출, 비용·예산·중복 job/input hash Gate는 이후 Provider 안전 기능에서 별도 구현한다.

## 여덟 번째 이전 기능: Runway 영상 요청 미리보기·프롬프트 편집·예상 비용

- [x] `POST /projects/:projectId/videos/preview`는 `WAITING_FOR_VIDEO_CONFIRMATION`, 승인된 이미지 6개, 엄격한 6장면 구조를 Gate로 검증하고 실제 Provider·네트워크·FFmpeg 호출 없이 장면별 prompt, `gen4_turbo`, ratio, 5초 duration, 예상 비용을 반환한다.
- [x] Python과 같이 이전 장면의 종료 동작과 continuity hint를 다음 장면 prompt에 반영하며, 기본 비용은 5 credits/sec × $0.01로 장면당 $0.25, 전체 $1.50이다. 이미지 절대 경로는 API·UI에 노출하지 않는다.
- [x] Frontend는 6개 prompt, model/ratio/duration, 장면별·전체 예상 비용을 표시하고 prompt를 로컬에서만 편집한다. UTF-16 code unit 1,000자 제한·emoji 카운터, loading/error/retry와 Preview 무호출/무전송 테스트를 제공한다.
- [x] Main 통합에서 Backend 186개 통과(+1 intentional skip), Frontend 299개 통과, Shared 23개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Runway·OpenAI·FFmpeg 호출은 0회다.
- [ ] 명시적 Runway 전송 승인, budget/call limit, input hash·job lock, 순차 task polling/recovery, 영상 검토·FFmpeg 병합은 이후 기능으로 분리한다.

## 아홉 번째 이전 기능: local fake 영상 전송 승인·예산·중복 방지 Gate

- [x] Frontend는 Preview의 6개 편집 prompt를 유지한 채 첫 확인에서는 전송하지 않고, 두 번째 명시 확인에서만 `approved: true`, confirmation ID, user request ID, 6개 prompt를 전송한다. 실제 Runway 요청이 발생하지 않는 local fake 단계임을 명확히 표시한다.
- [x] Backend는 preview snapshot 기반 confirmation ID stale 검증, UTF-16 1,000자 제한, image bytes·prompt·model·ratio·duration SHA-256 input hash, 동일 request ID 및 동일 input hash 재시작 멱등성을 저장한다.
- [x] 기본 월 예산 $10, 최대 6회 호출, 예상 $1.50 preflight를 안전하게 검증하고, budget/call-limit/request conflict/stale 오류를 안전한 API·UI 오류로 처리한다. `project.json`에는 job·approval·hash·budget audit과 6개 checkpoint만 저장한다.
- [x] 성공은 `GENERATING_VIDEOS` local fake 상태 전이만 수행하며 실제 Provider 제출, poll, 다운로드, 영상 파일 생성, FFmpeg 호출은 없다. Main 통합에서 Backend 189개(+1 intentional skip), Frontend 327개, Shared 23개 테스트와 root typecheck/test/build를 통과했다.
- [ ] 실제 Runway submit/poll/recovery, 영상 파일/검토/재생성, FFmpeg 병합은 이후 기능으로 분리한다.

## 열 번째 이전 기능: local fake 영상 순차 생성·재개·검토

- [x] local fake 영상 job은 저장된 6개 checkpoint를 순서대로 처리하며, 완료된 scene 파일을 보존하고 restart 시 중단 지점부터 재개한다. Stop은 다음 scene 제출을 막고 `INTERRUPTED` 상태를 저장한다.
- [x] 단일·전체 재생성은 명시적으로 선택한 scene만 history에 보존하고 pending으로 초기화하며, 다른 완료 영상·검토 상태는 유지한다. 실제 Runway, 네트워크, subprocess, FFmpeg 호출은 없다.
- [x] `generated_video_reviews.json`은 장면별 승인 상태를 UTF-8 atomic 저장하며, 6개 승인 뒤에만 `VIDEOS_APPROVED`로 전이한다. Frontend는 진행, 중단, 재개, 재생성 확인, 오류, 6개 검토·승인을 제공한다.
- [x] Main 통합에서 Backend 192개 통과(+1 intentional skip), Frontend 363개, Shared 23개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다.
- [ ] 실제 Runway task submit/poll/download, 실제 MP4 품질·duration 확인, FFmpeg probe/normalize/merge/final MP4는 이후 기능으로 분리한다.

## 열한 번째 이전 기능: 로컬 FFmpeg 최종 병합

- [x] `POST /projects/:projectId/videos/merge`는 `VIDEOS_APPROVED`, 정확히 6개 승인 review, 고정된 `scene1.mp4`~`scene6.mp4` 순서를 Gate로 검증한다.
- [x] Backend는 FFmpeg/ffprobe argument array, video stream/duration probe, portrait·landscape 정규화, concat, `videos/final/instagram_reel.mp4` 출력 검증을 주입 가능한 runner로 구현한다. 실패 시 원본 clips를 보존하고 안전한 오류와 `FAILED` 상태를 저장한다.
- [x] Frontend는 명시 확인 뒤에만 병합을 요청하고 loading/error/completed 상태를 표시하며 절대 로컬 경로와 Provider 요청을 노출하지 않는다. 테스트는 모든 runner/fetch를 mock한다.
- [x] Main 통합에서 Backend 197개 통과(+1 intentional skip), Frontend 392개, Shared 23개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 FFmpeg binary·Provider 호출은 테스트에서 0회다.
- [ ] 실제 설치된 FFmpeg의 6개 유효 MP4 통합, final video content/download/open API, continuity last frame은 별도 환경 검증·Desktop 기능으로 남긴다.

## 열두 번째 이전 기능: 장기 프로젝트 생성·목록·재열기·설정·전체 outline Preview/명시 승인

- [x] 별도 long-project DTO와 API route를 shared 계약으로 추가했으며, 단기 `Project`/`ProjectSummary` 계약이나 로컬 단일 사용자 계약에 `userId`를 추가하지 않았다.
- [x] Python 경로와 호환되게 `learning_data/projects/<project_id>/long_story/project.json`, `story_bible.json`, `episode_outlines.json`에 UTF-8 원자 저장하며, 장기 프로젝트만 별도 목록·재열기한다.
- [x] 제목·logline 필수 검증, episode 수와 설정 조회·수정, 새 Backend instance 재로드, 손상 항목/안전하지 않은 ID/API 오류 처리를 테스트로 고정했다.
- [x] 전체 outline은 Preview 후 수정·복원할 수 있으며 첫 확인은 요청을 보내지 않고 두 번째 명시 승인에서만 local fake planner를 실행한다. 승인 뒤 Episode 상태는 `planned`에서 `outline_ready`로만 바뀌며 script·image·video는 생성하지 않는다.
- [x] Frontend는 단기 프로젝트와 분리된 장기 프로젝트 생성·목록·상세·설정·outline 화면, loading/empty/error 상태와 API 응답 검증을 제공한다.
- [x] Main 통합 검증에서 Backend 201개 통과(+1 intentional skip), Frontend 459개 통과, Shared 23개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 OpenAI·Runway·FFmpeg·외부 network 호출은 구현과 테스트 모두 0회다.
- [ ] 다음 범위는 Story Bible의 character/location/prop/secret/foreshadowing CRUD와 선택 Episode의 script 생성·편집·명시 승인이다. 실제 Provider 호출은 포함하지 않는다.

완료 근거(2026-08-23): Backend/shared `93bb555`, Frontend `7f32bb3`을 main에 fast-forward 통합했다. Python의 장기 프로젝트 첫 단계만 이전했으며 Episode script, Asset mapping, 이미지·영상 생성, ContinuityMemory와 실제 Provider/FFmpeg 연동은 범위 밖으로 유지했다.

## 열세 번째 이전 기능: 장기 프로젝트 Story Bible 핵심 CRUD

- [x] `characters`, `locations`, `props`, `secrets`, `foreshadowing` 다섯 컬렉션만 별도 계약과 CRUD route로 이전했다. `basic`과 `world`는 기존 JSON 호환을 위해 읽기 전용으로 보존한다.
- [x] `story_bible.json`의 `character_id` 등 snake_case ID와 연결 필드를 API camelCase로 변환하고, UTF-8 원자 저장·프로젝트/항목 경로 검증·unknown field·중복/미존재/손상 JSON 오류 처리를 고정했다.
- [x] Frontend는 장기 프로젝트 상세에서 Story Bible 화면으로 진입하며, 다섯 탭의 loading/empty/error/success, 생성·수정과 별도 두 단계 삭제 확인을 제공한다. Backend 원문 오류는 표시하지 않는다.
- [x] 새 Backend instance 재열기, 모든 CRUD와 안전 오류, API 응답 검증, mock fetch, Provider·FFmpeg·network 무호출을 테스트로 고정했다.
- [x] Main 통합 검증에서 Backend 208개 통과(+1 intentional skip), Frontend 465개 통과, Shared 24개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
- [ ] Python의 Bible Asset link, 검색·복제 및 advanced relationship editor는 다음 Bible/Asset 통합 단계로 남긴다. 선택 Episode script·이미지·영상·ContinuityMemory도 이 범위에 포함하지 않는다.

완료 근거(2026-08-23): Shared/backend `b775f1e`, Frontend `0b1374a`을 main에서 통합 검증했다.

## 열네 번째 이전 기능: 장편 Episode local fake 대본 생성·편집·승인

- [x] 선택한 `outline_ready` Episode 하나만 local fake 대본으로 생성하며, Python `STORY_SCHEMA`와 같이 title/synopsis/ending 및 정확히 순서가 맞는 6개 장면·17개 장면 필드를 검증한다. Provider·network·FFmpeg 호출은 없다.
- [x] `long_story/EpisodeNN/project.json`, `outline.json`, `script.json`에 UTF-8 원자 저장하고, 생성·사용자 수정·명시 재생성 전 대본을 history에 보존하며 script revision을 증가시킨다.
- [x] 대본은 `script_review`에서만 수정·명시 승인할 수 있고, 승인 후 `script_approved`로 전이한다. Asset mapping, 이미지, 영상, Continuity Memory는 시작하지 않는다.
- [x] Frontend 장편 상세의 Episode별 대본 진입, local 생성, JSON 편집·검증, 재생성, 두 단계 승인, loading/error/success UI와 API 응답 검증을 제공한다.
- [x] Main 통합 검증에서 Backend 210개 통과(+1 intentional skip), Frontend 466개, Shared 24개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
- [ ] 다음 범위는 Story Bible Asset link, 검색·복제·관계 편집 또는 Episode Asset mapping이다. 실제 Provider 연결은 포함하지 않는다.

## 열다섯 번째 이전 기능: 장편 Story Bible Asset Library 연결

- [x] character/location/prop Bible 항목에만 승인·활성 상태의 character/background/object Asset을 연결할 수 있으며, folder·unknown·disabled·unapproved·type mismatch Asset은 차단한다.
- [x] `asset_link`를 Python 호환 snake_case로 저장하고 API에서는 camelCase `assetLink`로 제공한다. pinned version 또는 follow latest와 전체/단일 Episode 범위를 검증하며, 단일 Episode는 프로젝트 범위를 벗어날 수 없다.
- [x] Frontend Story Bible에서 사용 가능한 Asset 선택, version 정책, 전체/단일 Episode 범위 선택, 현재 연결 표시 및 명시 연결 해제를 제공한다.
- [x] Main 통합 검증에서 Backend 212개 통과(+1 intentional skip), Frontend 468개, Shared 24개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
- [ ] 다음 범위는 승인된 Episode 대본과 Bible Asset link를 후보로 사용하는 Episode Asset mapping review다.

## 열여섯 번째 이전 기능: 장편 Episode Asset mapping 검토·승인

- [x] `script_approved` Episode에서만 범위에 맞는 Story Bible character/location/prop Asset link를 후보로 만들고, 후보별 confirm/exclude를 별도 저장한다.
- [x] 대본 revision·fingerprint와 mapping revision을 검증해 대본 변경 뒤의 오래된 후보 또는 승인을 차단하고, 확정 시 `asset_mapping_approved`로 전이한다.
- [x] 후보가 없을 때만 명시적인 text-only 확인을 요구하며, 검토 시작 전의 빈 상태는 후보 없음으로 오인하지 않는다.
- [x] Frontend는 검토 시작, 후보별 확정/제외, 최종 승인 단계를 분리하고 범위·버전·revision 정보를 표시한다.
- [x] Main 통합 검증에서 Backend 215 통과(+1 intentional skip), Frontend 472 통과, Shared 24 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 `asset_mapping_approved` Episode의 local fake 이미지 6장 생성·검토·재생성이다.

## 열일곱 번째 이전 기능: 장편 Episode local fake 이미지 생성·검토·재생성

- [x] `asset_mapping_approved` Episode만 정확한 `{ approved: true }` 명시적 확인으로 local fake PNG 6장을 생성하며, 현재 mapping fingerprint와 6개 대본 장면을 다시 검증한다.
- [x] 이미지는 Episode 전용 `images/sceneN.png`에 원자적으로 저장하고, 유효 PNG·재사용·`generated_image_reviews.json`을 검증한다. API와 UI는 내부 파일 경로를 노출하지 않는다.
- [x] 장면별 명시적 검토 승인이 6개 모두 완료되어야 `waiting_for_video_confirmation`으로 전이한다. 장면 재생성은 별도 확인이 필요하며 기존 파일은 Episode 내부 version archive로 보존하고 해당 장면만 pending으로 되돌린다.
- [x] Frontend는 mapping 승인 뒤에만 별도 생성 확인 화면을 열고, 확인 창 자체는 요청하지 않으며 최종 클릭에서만 `{ approved: true }`를 보낸다. 생성·검토·재생성·영상 전송 대기와 오류 상태를 모두 표시한다.
- [x] Main 통합 검증에서 Backend 219 통과(+1 intentional skip), Frontend 476 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 `waiting_for_video_confirmation` Episode의 local fake 영상 순차 생성·중단/재개·검토·재생성이다.

## 열여덟 번째 이전 기능: 장편 Episode local fake 영상 순차 생성·검토·재생성

- [x] `waiting_for_video_confirmation` Episode의 승인된 이미지 6장만 provider-free preview와 명시적 확인으로 local fake 영상 작업을 시작한다. preview에는 내부 이미지 경로를 노출하지 않는다.
- [x] confirmation ID·입력 hash·사용자 요청 ID를 Episode별 job으로 저장하고, 동일 요청은 멱등 처리하며 stale·충돌 요청을 차단한다.
- [x] 로컬 fake MP4를 Episode 전용 `videos`에 순차 생성하고, 중단·재개 시 완료된 장면을 보존한다. 실제 Runway·network·FFmpeg·subprocess 호출은 없다.
- [x] 장면별 명시적 영상 검토가 6개 모두 완료되어야 `videos_approved`로 전이한다. 개별 재생성은 별도 확인을 요구하고 기존 영상은 Episode 내부 history에 보존하며 다른 장면의 완료·검토 상태를 보존한다.
- [x] Frontend는 local fake 전용 preview·수정 가능한 프롬프트·명시적 제출 확인·진행/중단/재개·재생성·검토 상태를 제공한다.
- [x] Main 통합 검증에서 Backend 222 통과(+1 intentional skip), Frontend 480 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 `videos_approved` Episode의 local FFmpeg-safe 최종 병합과 결과 검증이다.

## 열아홉 번째 이전 기능: 장편 Episode 최종 FFmpeg 병합

- [x] `videos_approved` Episode의 현재 video job, 6개 명시적 검토 승인, 순서가 맞는 유효 scene1~scene6 clip을 모두 검증한 뒤에만 병합할 수 있다.
- [x] Episode 전용 FFmpeg probe·normalize·concat은 shell 없이 argument array로 실행하며, 결과는 `long_story/EpisodeNN/videos/final/instagram_reel.mp4`에 저장한다. API/UI에는 고정 상대 경로 `videos/final/instagram_reel.mp4`만 노출한다.
- [x] 병합 시작은 Frontend의 별도 명시적 확인 뒤에만 요청되며, 확인 창을 열 때는 요청하지 않는다. 오류·재시도·성공 UI와 안전한 오류 메시지를 제공한다.
- [x] probe 불가/clip 무효는 승인 상태를 보존하고, rendering 실패는 승인 clip을 보존한 채 안전한 실패 상태를 저장한다. mock runner 테스트는 실제 FFmpeg·Provider·network 호출 없이 순서와 오류 보존을 검증한다.
- [x] Main 통합 검증에서 Backend 227 통과(+1 intentional skip), Frontend 483 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg binary 호출은 0건이다.
- [ ] 다음 범위는 Python 장편 기능의 Continuity Memory 및 Episode 간 컨텍스트 갱신이다.

## 스무 번째 이전 기능: 장편 Episode Continuity Memory·다음 회차 컨텍스트

- [x] 이미지 승인 이후의 Episode에서만 사용자가 검토한 요약, 사건, 인물·장소·소품 변화, 갈등, 비밀·복선, 다음 행동과 세계 변화를 별도 `continuity.json`에 UTF-8 원자 저장한다.
- [x] API는 snake_case 저장 형식과 camelCase DTO를 안전하게 변환하고, route Episode 번호만 신뢰한다. 화면 진입은 조회만 하며 저장은 명시적 버튼으로만 실행한다.
- [x] 다음 회차가 있으면 저장 응답에 그 회차를 제공한다. local fake 대본 생성은 이전 회차 기억을 결정적으로 반영하되 최근 3개 회차는 상세 요약/사건/인물 변화/다음 행동, 이전 회차는 압축 요약만 포함하고 아직 공개할 수 없는 비밀 정보는 포함하지 않는다.
- [x] Frontend는 최종 병합 뒤 Continuity Memory 편집·검증·저장 및 다음 Episode 진입을 제공하며, JSON 변경값·오류 응답·자동 저장을 테스트로 고정한다.
- [x] Main 통합 검증에서 Backend 230 통과(+1 intentional skip), Frontend 488 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 Story Bible의 고급 관계(인물·장소·소품·비밀·복선) 일관성 검증과 편집이다.


완료 근거(그룹 커밋, 2026-08-23): 열네~스무 번째 이전 기능(장편 Episode 대본→Continuity Memory 파이프라인)을 `a1ba785` 그룹 커밋으로 통합·검증했다.

## 스물한 번째 이전 기능: Story Bible 고급 관계 일관성 감사

- [x] 기존 Python 호환 관계 필드(character.location/owned items, location.characters, prop.owner/location, secret·foreshadowing character/location)를 변경하지 않는 읽기 전용 감사 API로 검사한다.
- [x] 누락 참조는 collection, item ID, field, missing ID 목록으로 결정적으로 반환하며, 기존의 끊어진 legacy 데이터를 자동 수정하거나 일반 CRUD에서 거부하지 않는다.
- [x] Frontend Story Bible 화면은 감사 실행·새로고침, 정상/로딩/오류 상태와 안전한 누락 참조 목록을 제공하며 어떤 저장 요청도 보내지 않는다.
- [x] Main 통합 검증에서 Backend 233 통과(+1 intentional skip), Frontend 489 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 Python BibleCollectionManager의 Story Bible 항목 검색·복제 동작이다.

## 스물두 번째 이전 기능: Story Bible 검색·복제

- [x] Python `BibleCollectionManager`와 같이 컬렉션별 name/description case-insensitive 검색을 제공하며, 빈 검색어는 저장 순서대로 전체 항목을 반환한다.
- [x] 항목 복제는 deep clone, 새 안전 ID와 복제 이름을 만들고 Asset link와 다른 필드를 보존하며 원본을 바꾸지 않은 채 UTF-8 원자 저장한다.
- [x] Frontend는 명시적 검색, 로딩/빈 결과/오류 재시도와 검색·목록 양쪽의 로컬 복제를 제공하고, 복제 응답으로 Story Bible 표시를 갱신한다.
- [x] Main 통합 검증에서 Backend 236 통과(+1 intentional skip), Frontend 492 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 범위는 이전 Episode의 승인된 Scene 6을 다음 Episode Scene 1의 연속성 reference로 사용하는 동작이다.

완료 근거(그룹 커밋, 2026-08-23): 스물한~스물두 번째 이전 기능(Story Bible 관계 감사·검색/복제)을 `f84ba1e` 그룹 커밋으로 통합·검증했다.

## 스물세 번째 이전 기능: 이전 Episode Scene 6 연속성 reference

- [x] Episode 1은 reference가 없으며, 이후 Episode는 바로 이전 회차가 6장 이미지 승인과 허용 상태를 만족하고 scene 6 PNG가 해당 Episode 경로 안에 유효하게 존재할 때만 reference 가능으로 판정한다.
- [x] local fake 이미지 생성은 reference 가능 시 현재 Episode scene 1에만 안전한 continuity metadata를 기록하며, 경로나 바이너리를 API에 노출하지 않고 나머지 장면 동작을 바꾸지 않는다.
- [x] Frontend 이미지 화면은 이전 Episode scene 6이 scene 1을 안내하는지 읽기 전용으로 표시하며, 없음·실패 상태에서도 내부 경로를 노출하지 않는다.
- [x] Main 통합 검증에서 Backend 239 통과(+1 intentional skip), Frontend 493 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

완료 근거(그룹 커밋, 2026-08-23): 이 기능(스물세 번째)은 `episode-continuity-reference.*`가 장편 Episode 이미지 파이프라인과 의존 관계여서, 열네~스무 번째와 같은 `a1ba785` 그룹 커밋에 이미 포함되어 있다.

## 스물네 번째 이전 기능: 단기·장기 프로젝트 복구 가능 archive

- [x] 단기 topic·장기 title의 정확한 재입력 확인 뒤에만 프로젝트 전체 디렉터리를 같은 볼륨의 숨김 archive 경로로 원자 이동하며, 삭제하지 않는다.
- [x] 생성·렌더링·중단 상태의 실행 중 작업은 archive를 차단하고, unsafe ID·충돌·이동 실패는 원본을 보존한다. archive된 프로젝트는 일반 조회·목록에서 제외된다.
- [x] Frontend는 명시적 입력 확인 dialog, 취소/로딩/오류 재시도, 성공 후 목록 복귀·갱신을 제공하며 dialog 진입·잘못된 확인은 요청을 보내지 않는다.
- [x] Main 통합 검증에서 Backend 250 통과(+1 intentional skip), Frontend 496 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 스물다섯 번째 이전 기능: Story Bible basic/world·전역 Style Asset 연결

- [x] Story Bible의 `basic`/`world` JSON object는 별도 명시적 편집 API로 검증·원자 저장하며, collection item CRUD나 style link로 내용을 우회 변경할 수 없다.
- [x] 전역 Style Asset link는 approved·enabled·non-folder `style` Asset과 버전 정책(pinned/follow latest/snapshot)을 검증하고, 명시적 해제를 지원한다.
- [x] 연결된 Style Asset은 Episode mapping review에 `basic`/`style` 후보로 포함되어 사용자의 명시적 결정을 거치며, UI는 내용 편집·연결·해제와 후보 레이블을 제공한다.
- [x] Main 통합 검증에서 Backend 253 통과(+1 intentional skip), Frontend 499 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 스물여섯 번째 이전 기능: 장편 Episode 타임라인 추가·복제·archive

- [x] draft-only 장편에서 Episode를 append하고, 복제는 outline 내용을 복사하되 새 ID/번호와 planned 상태로 만들며 대본·이미지·승인·history를 초기화한다.
- [x] 기존 TypeScript의 연속 번호·배열 인덱스 호환성을 보존하기 위해 timeline 변경은 모든 Episode가 `planned`/`outline_ready`일 때만 허용하며, archive는 마지막 Episode만 recoverable `episode_archives`로 이동한다.
- [x] Frontend는 검색·상태 필터·선택, 추가·복제, `ARCHIVE EPISODE N` 명시 확인 및 안전한 오류 표시를 제공한다.
- [x] Main 통합 검증에서 Backend 257 통과(+1 intentional skip), Frontend 501 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 스물일곱 번째 이전 기능: Episode 자동 장면 Asset 매칭 미리보기·재실행

- [x] Provider 없이 Bible Asset 후보와 scene별 선택 요약, 고정된 6개 추정 호출을 미리보기로 제공한다.
- [x] 재실행은 후보를 다시 만들고 mapping revision·승인 상태만 기다림으로 되돌리며, 이미지 생성이나 외부 Provider 호출은 절대 실행하지 않는다.
- [x] Frontend는 scene별 요약 새로고침과 별도 재실행 확인을 제공하고, 기존 명시적 mapping 승인 gate를 유지한다.
- [x] Main 통합 검증에서 Backend 258 통과(+1 intentional skip), Frontend 502 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

완료 근거(그룹 커밋, 2026-08-23): 스물네~스물일곱 번째 이전 기능(단기·장기 archive, Story Bible basic/world·전역 Style Asset 연결, Episode 타임라인, 자동 Asset 매칭 재실행)을 `f84ba1e` 그룹 커밋으로 통합·검증했다.

## 스물여덟 번째 이전 기능: Asset Library Character Reference Set

- [x] Character Folder의 기존 child Asset 집합은 바꾸지 않고 Python 저장 순서와 같은 reference 순서만 재정렬하며, 대표 이미지는 child 중 하나로 명시적으로 지정한다.
- [x] Character Folder가 아닌 대상, 중복·누락 child, 대표 이미지 불일치는 차단한다. Folder content 요청은 대표 child의 안전한 content만 해석한다.
- [x] Frontend는 Character Folder detail에서 순서 변경·대표 이미지 선택을 제공하고, 전용 PATCH 응답으로 상태를 갱신한다.
- [x] Main 통합 검증에서 Backend 260 통과(+1 intentional skip), Frontend 503 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 스물아홉 번째 이전 기능: Asset Library version 추가·relink·file health audit·소유 파일 삭제

- [x] Python `add_version`과 같이 기존 Asset에 새 이미지 바이트를 새 immutable version으로 추가하며, 동일 SHA-256 재등록은 차단하고 Folder 자체에는 적용하지 않는다.
- [x] Python `relink_file`과 같이 현재 version의 파일만 교체 바이트로 안전하게 재연결하며 Asset ID·version 개수 등 안정적 정체성은 그대로 유지한다.
- [x] Python `audit_files`와 같이 모든 색인된 비-Folder 파일을 healthy/missing/damaged로 읽기 전용 분류하고 Library metadata는 변경하지 않는다.
- [x] Python `delete_manual_file`과 같이 사용 중이 아닌 manual Asset만 색인과 소유 파일을 함께 삭제하며, 다른 Asset이 같은 바이트를 계속 참조하면 파일은 보존한다. 기존 목록 전용 삭제(`DELETE /assets/:assetId`)는 그대로 유지해 두 삭제 동작을 분리했다.
- [x] Python `_invalidate_dependents`/`_invalidate_owner_state`와 같이 relink는 모든 version policy를, version 추가는 `follow_latest` policy만 대상으로 프로젝트 `asset_mapping_review.json`과 장편 Episode `asset_mapping_review.json`을 재검토 대기로 되돌리고, 승인된 `project.json`/Episode `project.json`의 워크플로 상태도 함께 되돌려 이미지 생성 Gate가 다시 막히게 했다.
- [x] Frontend Asset Library 상세 화면은 버전 기록·새 버전 추가·재연결(명시적 확인)·에셋과 원본 파일 함께 삭제(명시적 확인, 기존 목록 전용 삭제와 분리)와 상단 파일 상태 점검 패널을 제공하며 절대 경로는 노출하지 않는다.
- [x] Main 통합 검증에서 Backend 270 통과(+1 intentional skip), Frontend 509 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 서른 번째 이전 기능: legacy project Reference의 Asset Library 멱등 이전

- [x] Python `LegacyReferenceMigrator.migrate_all()`과 같이 각 프로젝트의 `reference_assets/references.json`을 원본 파일이나 legacy ID를 바꾸지 않고 읽어, 아직 이전되지 않은 항목만 Asset Library에 색인하고 `assignment_source: "migrated"`인 confirmed 프로젝트 Asset Mapping을 새로 만든다. 이미 이전된 legacy ID는 재실행해도 다시 만들지 않는다(멱등).
- [x] 동일 바이트를 가리키는 legacy Reference는 기존 Library Asset에 병합되어 `legacy_asset_ids`에 누적되며 새 파일을 다시 복사하지 않는다. 서로 다른 프로젝트의 동일 이미지는 하나의 Asset을 공유하되 각 프로젝트는 자신만의 Mapping을 받는다.
- [x] 한 프로젝트의 손상된 legacy JSON이나 개별 legacy 항목의 실패(디렉터리를 벗어나는 경로 포함)는 해당 항목만 실패로 집계하고 다른 프로젝트의 이전을 막지 않는다. Provider·network·FFmpeg 호출은 없다.
- [x] `POST /assets/legacy-migration`은 프로젝트 스캔·이전·중복·실패 건수를 반환하며, Mapping이 실제로 추가된 프로젝트에서만 기존 `LocalProjectAssetMappingsRepository.save`의 mapping-review 무효화가 함께 적용된다.
- [x] Frontend Asset Library 화면은 파일 상태 점검과 나란히 명시적 "가져오기 실행" 버튼과 결과 요약을 제공하며, 무언가 실제로 이전된 경우에만 목록을 새로고침한다. 자동 실행은 기존 30여 개 테스트의 순서를 깨뜨리는 위험이 커서 채택하지 않았다.
- [x] Main 통합 검증에서 Backend 278 통과(+1 intentional skip), Frontend 512 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 서른한 번째 이전 기능: Asset Library Folder 삭제의 remove_child_indexes·delete_manual_files parity

- [x] `DELETE /assets/:assetId/folder`를 새로 추가해 Python `delete_folder`와 같이 기본값은 Folder 메타데이터만 삭제하고 하위 Asset은 부모 연결만 해제해 목록에 남긴다. 기존 `DELETE /assets/:assetId`는 여전히 Folder에는 사용할 수 없다(`ASSET_MUTATION_UNSUPPORTED`).
- [x] `removeChildIndexes=true`는 하위 Asset 색인까지 함께 제거하되 파일은 보존하며, `deleteManualFiles=true`는 이를 내포하고(implies) manual 소유 하위 Asset의 실제 파일까지 삭제한다. project 소유 이미지가 하위에 있으면 전체 요청을 차단한다.
- [x] Folder 자신 또는(옵션에 따라) 하위 Asset이 프로젝트에서 사용 중이면 차단하며, 다른 Asset이 같은 바이트를 계속 참조하면 그 파일은 삭제하지 않는다(공유 바이트 보존).
- [x] Frontend Asset Library 상세 화면은 Folder를 열었을 때 기존 "목록에서 삭제"/원본 파일 삭제 버튼 대신 전용 "Folder 삭제" 영역을 보여주고, 두 체크박스(하위 색인 삭제·원본 파일도 삭제)와 명시적 확인 후에만 요청을 보낸다.
- [x] Main 통합 검증에서 Backend 286 통과(+1 intentional skip), Frontend 515 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

완료 근거(그룹 커밋, 2026-08-23): 스물여덟~서른한 번째 이전 기능(Asset Library Character Reference Set·version/relink/audit/삭제·legacy 멱등 이전·Folder 삭제 parity)을 `f2f360b` 그룹 커밋으로 통합·검증했다.

## 서른두 번째 이전 기능: 단기 프로젝트 "이어서 진행하기" 상태 기반 재개

- [x] 프로젝트의 `workflowState`를 고정된 제품 흐름(주제→Story→Asset Mapping→이미지→영상 승인→영상 생성→병합)에 매핑해 다음에 열어야 할 화면 하나를 결정하는 순수 함수를 Frontend에 추가했다. Backend나 저장 데이터의 변경 없이 기존 화면 라우팅만 재사용한다.
- [x] `GENERATING_VIDEOS`/`VIDEOS_READY`/`REVIEWING_VIDEOS`/`INTERRUPTED` 상태로 재개하려면 현재 video job ID가 필요하므로, `Project` 계약에 `currentVideoJobId`(선택 필드)를 추가했다. Backend는 `video_generation_records`에 가장 최근에 추가된 유효한 `job_id`만 반환하며, 기록이 없으면 필드 자체를 생략한다(job ID를 발견하지 못하면 영상 확인 화면으로 안전하게 대체).
- [x] `ProjectDetail` 화면 상단에 "이어서 진행하기 · <다음 단계 이름>" 버튼을 추가했다. `COMPLETED`/`FAILED`/`CANCELLED` 같은 종료 상태에서는 버튼을 표시하지 않는다.
- [x] Main 통합 검증에서 Backend 289 통과(+1 intentional skip), Frontend 516 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

완료 근거(그룹 커밋, 2026-08-23): 서른두 번째 이전 기능(단기 프로젝트 재개)을 `6276564` 그룹 커밋으로 통합·검증했다.

## 서른세 번째 이전 기능: 실제 OpenAI Story 생성 adapter와 전용 예산 게이트

- [x] Python `OpenAIStoryAdapter`/`openai_common.py`를 참고해 순수 `fetch` 기반의 실제 OpenAI Responses API 호출(`openai-story-adapter.ts`)을 구현했다. SDK 의존성을 추가하지 않고, strict `json_schema`(Python `STORY_SCHEMA`와 동일한 6장면 스키마), 모델 `gpt-5.6-luna`, 오류 분류(authentication/quota_or_permission/rate_limit/server/network/invalid_request/safety_policy/empty_response/invalid_response/unknown), Retry-After를 존중하는 지수 백오프 재시도(최대 2회)를 그대로 재현했다.
- [x] Python `BudgetManager`를 참고해 `openai-budget.ts`에 OpenAI 전용 월별 예산 추적기를 구현했다. Runway 예산과 완전히 분리된 `learning_data/api_budget_usage.json`에 저장하며, 요청 전 preflight로 차단하고 성공·실패 모두 추정 비용($0.05/story)을 실제 사용량으로 기록해 실패가 예산 회계를 우회하지 못하게 했다.
- [x] `StoryPromptService`는 `ProviderSettingsService`(연결 상태 확인용 `rawCredentialIfConnected` 신규 메서드 추가)와 `OpenAiBudget`이 둘 다 주입되고 OpenAI가 실제로 연결돼 있을 때만 실제 adapter를 호출하며, 그 외에는 항상 기존 local fake 경로로 폴백한다. 기존 세 곳의 테스트 생성자 호출은 새 인자를 생략해도 그대로 동작해 하위 호환을 유지했다.
- [x] 실제 요청이 예산 초과(`STORY_BUDGET_EXCEEDED`, 409) 또는 Provider 오류(`STORY_PROVIDER_ERROR`, 502, `details.category` 포함)로 실패하면 프로젝트를 `GENERATING_STORY`에 묶어두지 않고 `READY`로 되돌려 재시도 가능하게 했다 — local fake는 실패할 일이 거의 없어 기존에는 이 복구 경로가 없었다.
- [x] 이 기능을 실제 HTTP로 검증하는 과정에서 `ProviderSettingsModule`의 `.env` 저장 경로가 `PROVIDER_SETTINGS_ROOT` 환경 변수로 재정의될 수 없어 테스트 격리가 불가능했던 기존 격차를 발견해 함께 고쳤다(`LEARNING_DATA_ROOT`/`PROJECTS_ROOT`와 같은 패턴). 값을 지정하지 않으면 기존과 동일하게 `process.cwd()`를 사용해 하위 호환을 유지한다.
- [x] Backend 단위 테스트(예산, 실제 adapter 오류 분류·재시도, 서비스 폴백·복구)와 실제 `AppModule`을 부팅해 credential 저장 → Story 승인까지 실제 HTTP로 왕복하는 통합 테스트로 모듈 배선을 고정했다. 모든 테스트는 `fetch`를 mock하며 실제 OpenAI 도메인 호출은 0건이다.
- [x] Frontend `storyPromptApi.ts`에 `STORY_BUDGET_EXCEEDED`/`STORY_PROVIDER_ERROR`용 안전한 한국어 오류 메시지를 추가했다.
- [x] Main 통합 검증에서 Backend 316 통과(+1 intentional skip), Frontend 516 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 서른네 번째 이전 기능: 실제 OpenAI 이미지 생성 adapter(6장면 최초 생성)

- [x] Story adapter와 같은 두 파일을 공유하도록 `openai_common.py`에 대응하는 `providers/openai-common.ts`(오류 분류·Korean 메시지·재시도 유틸)를 추출했다. Story·Image 두 adapter가 이제 이 공용 모듈을 사용하며, `OpenAiBudget`도 `providers/openai-budget.ts`로 옮겨 두 adapter가 같은 예산 파일을 공유한다.
- [x] Python `OpenAIImageAdapter.generate`(Reference 없는 경로)를 참고해 `images/openai-image-adapter.ts`에 순수 `fetch` 기반 실제 OpenAI Images API 호출을 구현했다. 모델 `gpt-image-2`, 크기 `1024x1536`(세로 기본값), quality `medium`, `output_format: png`을 Python 기본값과 동일하게 사용하고, 응답의 `data[0].b64_json`을 디코딩해 PNG bytes로 반환한다.
- [x] `LocalImageGenerationService`는 연결된 OpenAI credential과 예산 tracker가 모두 주입됐을 때만 6장면 각각에 실제 요청(장면당 $0.10 preflight)을 보내고, 그 외에는 항상 기존 local fake 1×1 PNG 경로로 폴백한다. 성공한 장면은 `adapter: "gpt-image-2"`·`image_api_calls: 1`로, 그 외는 기존과 동일하게 `"local-fake-image-adapter"`·`0`으로 기록된다.
- [x] 예산 초과(`IMAGE_BUDGET_EXCEEDED`, 409) 또는 Provider 오류(`IMAGE_PROVIDER_ERROR`, 502, `details.category`)는 기존의 "부분 실패 시 `ASSET_MAPPING_APPROVED`로 복구" 경로를 그대로 재사용해 재시도 가능하게 했다 — 이미 존재하던 복구 로직이라 별도 롤백 코드를 새로 만들 필요는 없었다.
- [x] 실제 HTTP로 credential 저장 → 6장면 생성까지 왕복하는 `AppModule` 통합 테스트로 모듈 배선을 고정했다. 모든 테스트는 `fetch`를 mock하며 실제 OpenAI 도메인 호출은 0건이다.
- [x] Reference 이미지 전달(`images.edit`, Asset Mapping이 선택한 캐릭터/스타일 이미지)과 장면 재생성(`image-review.service.ts`의 regenerate 경로)은 이번 범위에 포함하지 않고 로컬 fake로 유지했다 — 다음 범위로 명시했다.
- [x] Main 통합 검증에서 Backend 328 통과(+1 intentional skip), Frontend 516 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 서른다섯 번째 이전 기능: 실제 Runway 영상 생성 adapter(제출/상태조회/다운로드 함수만)

- [x] 공식 `runwayml` Node SDK의 소스(base URL, 인증/버전 헤더, 요청·응답 스키마)를 실시간으로 확인해 Python `RunwayVideoAdapter`에 대응하는 `videos/runway-video-adapter.ts`를 순수 `fetch` 기반으로 구현했다. Base URL `https://api.dev.runwayml.com`, `Authorization: Bearer`, `X-Runway-Version: 2024-11-06`, 모델 `gen4_turbo`를 Python·공식 SDK와 동일하게 사용한다.
- [x] `createRunwayImageToVideoTask`(POST `/v1/image_to_video`, Reference 이미지를 5MB 이하 data-URI로 인코딩, prompt UTF-16 1000자 제한 검증), `getRunwayTask`(GET `/v1/tasks/{id}`, PENDING/THROTTLED/RUNNING/SUCCEEDED/FAILED/CANCELLED 상태와 output/failure/progress 파싱), `downloadRunwayOutput`(서명된 URL을 인증 헤더 없이 다운로드)을 각각 구현했다. Python과 같이 이 모듈은 polling 주기나 워크플로 상태를 전혀 알지 못하며, 호출자가 언제 상태를 조회할지 전적으로 결정한다.
- [x] OpenAI 두 adapter와 같은 오류 분류·재시도 패턴(401→authentication, 403→permission, 429→rate_limit 재시도, 5xx→server 재시도, 400/404/409/422→invalid_request, 네트워크 실패→network 재시도)을 Runway 전용 카테고리로 재현했다.
- [x] **이번 기능은 사용자와 상의해 "adapter 함수만" 범위로 명시적으로 좁혔다.** Runway 영상 하나는 제출 후 수 분간 polling이 필요한데, 현재 `local-video-workflow.service.ts`의 `run()`은 한 HTTP 요청 안에서 6장면을 동기적으로 순회하는 local-fake 전용 구조라 그대로 실제 Provider에 연결하면 HTTP 요청이 여러 분 동안 블로킹되거나 진행 상태를 프론트엔드에 보여줄 수 없다. 따라서 이번 세션에서는 워크플로 서비스를 전혀 수정하지 않았다.
- [x] Backend 단위 테스트(요청 형식, 6가지 상태 파싱, 오류 분류 전체 조합, 재시도, 실패 사례)로 adapter 자체를 완전히 검증했다. 모든 테스트는 `fetch`를 mock하며 실제 Runway 도메인 호출은 0건이다. 기존 로컬 fake 영상 격리 테스트(`local-video-*.no-provider-calls.test.ts`)는 대상 파일을 건드리지 않아 그대로 통과한다.
- [x] Main 통합 검증에서 Backend 349 통과(+1 intentional skip), Frontend 516 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 권장 범위는 `local-video-workflow.service.ts`를 배경 작업/주기적 진행 상태 조회 구조로 재설계한 뒤 이 adapter를 실제로 연결하는 것이다. 착수 전 접근 방식을 다시 사용자와 확인한다.

완료 근거(그룹 커밋, 2026-08-23): 서른세~서른다섯 번째 이전 기능(실제 OpenAI Story/이미지 adapter, 실제 Runway 영상 adapter)을 `399cb5b` 그룹 커밋으로 통합·검증했다.

## 서른여섯 번째 이전 기능: 장기 프로젝트 Episode "이어서 진행하기" 상태 기반 재개

- [x] 서른두 번째 기능(단기 프로젝트 재개)과 같은 방식으로, `LongEpisodeStatus` 전체 값(`planned`부터 `completed`/`failed`까지)을 고정된 Episode 흐름(대본→Asset Mapping→이미지→영상→병합→Continuity)에 매핑하는 순수 함수를 `LongProjectDetail`에 추가했다. Backend나 저장 데이터 변경 없이 기존 Episode 화면 라우팅만 재사용한다.
- [x] 기존에는 Episode 목록의 각 행에 상태와 무관하게 항상 "Script" 버튼만 있었다(대본이 이미 승인된 Episode를 열어도 대본 화면으로만 이동). 이제는 각 Episode 행이 자신의 현재 단계에 맞는 화면 하나로 바로 이동하는 버튼을 보여준다: 대본 작성/편집, Asset Mapping 검토, 이미지 생성/검토, 영상 생성/검토, 최종 영상 병합, Continuity Memory. `planned` 상태는 버튼을 표시하지 않는다(기존 동작 유지).
- [x] `LongProjectDetail`에 `onOpenMappingReview`/`onOpenImageGeneration`/`onOpenVideoWorkflow`/`onOpenVideoMerge`/`onOpenContinuity` 콜백을 추가하고 `App.tsx`에서 이미 존재하는 해당 화면들로 연결했다 — 새 화면을 만들지 않고 기존에 구현된 6개 Episode 화면의 진입 경로만 정리했다.
- [x] Main 통합 검증에서 Backend 349 통과(+1 intentional skip), Frontend 518 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.

## 서른일곱 번째 이전 기능: 프로젝트 상세의 "생성 이미지 모음" 링크

- [x] Python의 별도 "생성 이미지 모음"/"생성 영상 모음" 대시보드 화면 대신, 이미 존재하는 Asset Library를 재사용했다. 생성된 6장면 이미지는 이미 프로젝트 ID를 태그로 포함해 Asset Library에 자동 색인되어 있고(스물여덟 번째 이전 기능 이전부터), Asset Library 검색은 이미 태그를 대상으로 하므로 새 백엔드나 새 데이터 모델 없이 프론트엔드 라우팅만으로 완성했다 — 중복 UI를 새로 만들지 않기 위한 의도적 설계 결정이다.
- [x] `AssetLibraryScreen`에 `initialQuery` 선택 prop을 추가해 마운트 시 그 값으로 검색창을 채우고 즉시 검색하도록 했다. `App.tsx`의 `assets` 화면 상태에 `initialQuery`를 추가하고, 단기 `ProjectDetail`과 장기 `LongProjectDetail`에 "생성 이미지 모음" 버튼을 추가해 각각 프로젝트 ID로 미리 채워진 Asset Library를 연다.
- [x] Main 통합 검증에서 Backend 349 통과(+1 intentional skip), Frontend 522 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 권장 범위는 단기 Wizard의 초기 입력/Asset 선택 흐름을 Python UI와 맞추는 작업이다.

완료 근거(그룹 커밋, 2026-08-23): 서른여섯~서른일곱 번째 이전 기능(장기 Episode 재개, 생성 이미지 모음 링크)은 단기 재개와 같은 `6276564` 그룹 커밋에 이미 포함되어 있었다.

## 서른여덟 번째 이전 기능: 단기 프로젝트 Wizard 대표/서브 캐릭터(Cast) 선택

- [x] Python Wizard의 대표 Character Asset·서브 캐릭터와 이야기 역할 선택(`character_profile.cast`)을 이전했다. `story-prompt.service.ts`의 `promptVariables()`에는 이미 `character_profile.cast`를 읽어 `character_cast_metadata` placeholder로 넣는 로직이 존재했지만 이를 채우는 사용자 화면이 없었다 — 이번 기능으로 그 휴면 경로를 처음 채웠다.
- [x] Shared 계약에 `ShortProjectCastMember`(`assetId`/`castRole`/`storyRole`), `GetShortProjectCastResponse`, `UpdateShortProjectCastRequest`, `UpdateShortProjectCastResponse`와 `projectCast` 라우트를 추가했다.
- [x] Backend: `project-cast.ts`에 순수 파싱/검증 함수(`parseShortProjectCast` — cast 배열만 허용, 최대 크기, 중복 assetId 거부)를 추가하고, `ProjectsService`에 `getProjectCast`/`updateProjectCast`를 추가했다. `LocalAssetsRepository`가 주입된 경우에만 각 assetId가 실존하는 non-folder character 타입 Asset인지 검증하고(주입되지 않으면 검증을 건너뛴다 — 기존 `ProjectsService` 생성자 호출부와의 하위 호환), `ProjectsModule`이 `AssetsModule`을 import하도록 배선했다. `GET`/`PUT /projects/:projectId/settings/cast` 컨트롤러 라우트를 추가했다.
- [x] Frontend: `projectsApi.ts`에 `getProjectCast`/`updateProjectCast`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 별도 저장 상태를 갖는 `CastEditor` 하위 컴포넌트를 추가했다 — 기존 설정 폼의 저장 상태와 완전히 분리되어, 캐릭터 검색이나 배역 수정이 메인 설정 폼의 저장 여부에 의존하지 않는다. character 타입으로 필터링된 Asset 검색, 추가/제거, 배역·이야기 역할 텍스트를 blur 시 저장한다.
- [x] 새 테스트: Backend `project-cast.test.ts`(순수 함수 12개), `projects.service.test.ts`에 cast get/save/Asset 검증/재시작 후 유지 6개 추가, `project-cast.app-module.integration.test.ts`(실제 `NestFactory.create(AppModule)` 부팅으로 존재하지 않는/character가 아닌 Asset 거부, 재시작 후 유지, 그리고 저장한 cast가 실제로 Story preview의 `character_cast_metadata`에 반영되는지까지 end-to-end로 고정) 2개. Frontend `ShortProjectSettingsScreen.test.tsx`를 URL 기반 `stubFetchByRoute` 헬퍼로 재작성하고 cast 표시·검색·추가·제거·로드 실패 표시를 검증하는 테스트 5개.
- [x] Main 통합 검증에서 Backend 368 통과(+1 intentional skip), Frontend 525 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 권장 범위는 같은 Wizard parity 작업의 나머지 조각들이다: 전체 분위기 Asset 선택, 장면용 background/object/style/general Reference와 사용 목적 선택, 이전 프로젝트 승인 Scene 6과의 연속성 연결.

## 서른아홉 번째 이전 기능: 단기 프로젝트 Wizard 전체 분위기·장면 참고 Asset 선택

- [x] Python Wizard의 전체 분위기(style/general_reference/background) Asset 선택(`lore_context.atmosphere_asset_ids`)과 장면용 background/object/style/general Reference와 사용 목적 선택(`lore_context.scene_reference_assets`)을 이전했다. Python은 두 목록을 서로 배타적으로 취급한다(한 Asset은 분위기 또는 장면 참고 중 하나의 용도로만 선택 가능) — 이 제약을 그대로 옮겼다.
- [x] `story-prompt.service.ts`의 `promptVariables()`에도 서른여덟 번째 기능 이전과 마찬가지로 `atmosphere_asset_metadata`/`scene_reference_asset_metadata`가 항상 빈 문자열인 휴면 placeholder가 있었다 — 이번 기능으로 처음 채웠다. 이 참에 `character_cast_metadata`도 Python `describe_character_cast`와 동일한 형식(Asset의 실제 이름·설명을 조회해 "이름/구분/이야기 역할/설명" 한국어 블록으로 렌더링)으로 맞췄다 — 기존에는 assetId를 포함한 원시 JSON을 그대로 프롬프트에 넣고 있었다. `story-asset-metadata.ts`에 `describeCharacterCast`/`describeAtmosphereAssets`/`describeSceneReferenceAssets`를 추가하고 `promptVariables()`를 비동기로 바꿔 `LocalAssetsRepository`를 통해 실제 Asset 이름·설명을 조회하도록 했다(`StoryPromptService` 생성자에 6번째 선택 인자로 주입, `story.module.ts` 배선).
- [x] Shared 계약에 `ShortProjectSceneReferenceAsset`(`assetId`/`purpose`), `GetShortProjectAssetReferencesResponse`, `UpdateShortProjectAssetReferencesRequest/Response`와 `projectAssetReferences` 라우트를 추가했다.
- [x] Backend: `project-asset-references.ts`에 순수 파싱/검증 함수(`parseShortProjectAssetReferences` — 두 배열만 허용, 각각 최대 크기, 중복 assetId 거부, 분위기·장면 참고 간 중복 assetId 거부)를 추가하고, `ProjectsService`에 `getProjectAssetReferences`/`updateProjectAssetReferences`를 추가했다. `LocalAssetsRepository`가 주입된 경우에만 분위기 Asset은 non-folder style/general_reference/background 타입인지, 장면 참고 Asset은 non-folder background/object/style/general_reference 타입인지 검증한다(서른여덟 번째 기능의 cast 검증과 동일한 하위 호환 패턴). `GET`/`PUT /projects/:projectId/settings/asset-references` 컨트롤러 라우트를 추가했다.
- [x] Frontend: `projectsApi.ts`에 `getProjectAssetReferences`/`updateProjectAssetReferences`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 `AssetReferenceEditor` 하위 컴포넌트를 추가했다 — `CastEditor`와 마찬가지로 메인 설정 폼과 독립된 저장 상태를 가지며, 분위기·장면 참고 두 목록을 하나의 PUT으로 함께 저장한다(배타성 검증이 둘을 같이 봐야 하기 때문). `listAssets`가 단일 assetType만 필터링하므로 Python의 `available_atmosphere_assets`/장면 참고 선택창처럼 태그 없이 검색한 뒤 허용된 타입 집합으로 클라이언트에서 필터링한다. 장면 참고 Asset은 검색 결과 행에 "사용 목적" 입력칸이 있고 비어 있으면 추가 버튼이 비활성화된다.
- [x] 새 테스트: Backend `project-asset-references.test.ts`(순수 함수 13개), `projects.service.test.ts`에 asset reference get/save/Asset 타입 검증/재시작 후 유지 6개 추가, `project-cast.app-module.integration.test.ts`에 실제 `NestFactory.create(AppModule)` 부팅 통합 테스트 1개 추가(존재하지 않는/배타성 위반 Asset 거부, 재시작 후 유지, 저장한 분위기·장면 참고 Asset이 실제로 Story preview의 두 placeholder에 반영되는지까지 end-to-end로 고정). Frontend `ShortProjectSettingsScreen.test.tsx`에 분위기 Asset 검색·추가·제거, 장면 참고 Asset 목적 입력·추가·제거, 로드 실패 표시를 검증하는 테스트 3개 추가.
- [x] Main 통합 검증에서 Backend 388 통과(+1 intentional skip), Frontend 528 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 다음 권장 범위는 같은 Wizard parity 작업의 마지막 조각이다: 명시적으로 고른 이전 프로젝트의 승인된 Scene 6을 Story와 Scene 1 연속성 자료로 연결하는 화면(Backend `lore_context.previous_scene_context` 경로는 이미 존재하며 `short_scene_continuity_option`으로 어떤 프로젝트가 후보인지 결정하는 Python 로직만 아직 옮기지 않았다).

## 마흔 번째 이전 기능: 단기 프로젝트 Wizard 이전 장면 연결(Scene 6 연속성)로 Wizard parity 완료

- [x] Python Wizard의 "이전 장면 연결"을 이전했다. 이 기능으로 단기 Wizard parity 작업(대표/서브 캐릭터 Cast, 전체 분위기·장면 참고 Asset, 이전 장면 연결)이 모두 완료된다. Python `short_scene_continuity_option`과 동일하게: 후보는 현재 프로젝트를 제외한 다른 단기 프로젝트 중 workflow state가 영상 승인 단계 이상(`WAITING_FOR_VIDEO_CONFIRMATION`부터 `COMPLETED`까지)이고, scene과 generated_images가 각각 6개 이상이며, Scene 6 이미지 파일이 그 프로젝트 자신의 디렉터리 안에 실제로 존재하는 경우로 제한한다. 서버가 후보 목록과 실제로 연결될 텍스트(story_context)를 항상 다시 계산한다 — 클라이언트는 오직 projectId만 보내고, 그 외 어떤 파생 텍스트도 신뢰하지 않는다(Cast·Asset Reference 기능과 같은 신뢰 경계 원칙).
- [x] `story-prompt.service.ts`의 `promptVariables()`가 기존에는 `lore_context.previous_scene_context`를 문자열 그대로 읽고 있었는데, 이는 Python 구조와 어긋난다 — Python은 `lore_context.previous_scene_link`라는 구조화된 dict를 저장하고, 실제 프롬프트 문자열은 그 안의 `story_context`에서 매번 파생시킨다(`user_selected_short_scene_link`로 opt-in 여부를 확인). `project-continuity.ts`의 `previousSceneContext()`로 이 파생 로직을 그대로 옮기고 `promptVariables()`의 직접 필드 읽기를 대체했다.
- [x] Shared 계약에 `ShortProjectContinuityOption`(`projectId`/`projectName`/`label` — 파생된 story_context나 이미지 경로는 API로 노출하지 않는다, Python UI도 후보 목록에는 label만 보여준다), `ListShortProjectContinuityOptionsResponse`, `GetShortProjectContinuityResponse`, `SetShortProjectContinuityRequest/Response`와 `projectContinuityOptions`/`projectContinuity` 라우트를 추가했다.
- [x] Backend: `project-continuity.ts`에 `listContinuityOptions`(다른 모든 프로젝트를 훑어 자격을 재계산), `resolveContinuityCandidate`(쓰기 경로 전용 — 특정 projectId 하나를 다시 검증), `toShortProjectContinuityLink`/`previousSceneContext`(저장된 링크의 tolerant 읽기), `applyContinuityCandidate`(스냅샷 쓰기)를 추가했다. `LocalProjectRepository`에 `projectDirectory(projectId)` 공개 메서드를 추가해 경로 안전성 검사(다른 프로젝트의 Scene 6 이미지 경로가 그 프로젝트 자신의 디렉터리 밖을 가리키지 않는지)에 재사용했다. `ProjectsService`에 `listProjectContinuityOptions`/`getProjectContinuity`/`updateProjectContinuity`를 추가하고, `GET /projects/:projectId/settings/continuity-options`, `GET`/`PUT /projects/:projectId/settings/continuity` 컨트롤러 라우트를 추가했다(`PUT`은 `{ projectId: string | null }` — `null`은 연결 해제).
- [x] Frontend: `projectsApi.ts`에 `listProjectContinuityOptions`/`getProjectContinuity`/`setProjectContinuity`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 `ContinuityEditor` 하위 컴포넌트를 추가했다 — 현재 링크 상태는 마운트 시 불러오고, 후보 목록은 Python처럼 "이전 프로젝트 선택" 버튼을 눌렀을 때만 조회한다(항상 백그라운드로 미리 불러오지 않음). 연결/해제 모두 같은 PUT을 통해 저장 상태를 공유한다.
- [x] 새 테스트: Backend `project-continuity.test.ts`(순수 함수·후보 도출 로직 15개 — workflow state 미달, scene/이미지 개수 부족, 파일 없음, 경로 탈출, label 파생 우선순위 등 각 배제 조건을 실제 파일시스템으로 검증), `projects.service.test.ts`에 continuity 목록/연결/해제/거부 5개 추가, `project-cast.app-module.integration.test.ts`에 실제 `NestFactory.create(AppModule)` 부팅 통합 테스트 1개 추가(후보 목록 조회 → 연결 → Story preview의 `previous_scene_context`에 반영 확인 → 해제까지 end-to-end). Frontend `ShortProjectSettingsScreen.test.tsx`에 후보 조회·연결·해제·로드 실패 표시를 검증하는 테스트 3개 추가.
- [x] Main 통합 검증에서 Backend 408 통과(+1 intentional skip), Frontend 531 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
- [ ] 이것으로 단기 Wizard parity 작업이 모두 끝났다. 다음 권장 범위는 이 문서 상단 "다음 권장 작업 순서"의 나머지 항목(Runway 실제 연동을 위한 영상 워크플로 재설계, 실제 OpenAI 이미지 Reference 편집/재생성)이다.

완료 근거(그룹 커밋, 2026-08-23): 서른여덟~마흔 번째 이전 기능의 프런트엔드 화면은 `3b1df7f` 그룹 커밋으로 통합·검증했다. 해당 백엔드 라우트(`project-cast.ts`/`project-asset-references.ts`/`project-continuity.ts`와 `projects.service.ts`/`story-prompt.service.ts` 배선)는 Story Bible·archive·실제 OpenAI Story adapter와 공용 파일을 공유해 이미 `f84ba1e` 그룹 커밋에 포함되어 있었다. 이것으로 27개 이전 기능(열네~마흔 번째)이 6개의 파이프라인 단계별 그룹 커밋(`a1ba785`, `f84ba1e`, `f2f360b`, `6276564`, `399cb5b`, `3b1df7f`)으로 모두 정리·커밋되었다.

## 공통 완료 조건

- Python 동작·데이터 규칙, shared 계약, Frontend 흐름, Backend 로직·저장이 모두 구현되어야 한다.
- 오류·경계 테스트와 유료 Provider를 호출하지 않는 통합 테스트가 통과해야 한다.
- main에서 관련 typecheck, test, build를 통과한 뒤에만 체크리스트를 완료로 바꾼다.
- UI 또는 Backend 한쪽만 구현된 기능은 완료로 표시하지 않는다.
