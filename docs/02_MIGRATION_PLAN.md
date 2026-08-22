# Python to TypeScript Migration Plan

## 원칙

- Python을 줄 단위로 번역하지 않고 사용자 동작, 검증, 저장 데이터와 오류 처리를 TypeScript 구조에 맞게 이전한다.
- `app/`, `tests/`, `prompts/`는 전체 이전과 검증이 끝날 때까지 수정·삭제하지 않는다.
- 사용자에게 보이는 작은 기능 하나씩 Frontend와 Backend를 함께 구현하고 통합 검증 뒤에만 완료 처리한다.
- Preview는 유료 요청을 보내지 않으며 모든 Provider는 예산·승인·중복 방지 Gate 뒤에 둔다.

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
4. [ ] project Asset scope·mapping review/snapshot/fingerprint Gate
5. [x] Story prompt preview/edit/restore/별도 explicit approval audit; local fake adapter, Provider 무호출
6. [ ] Story 저장, 6장면 검증·복구
7. [ ] image prompt/reference preview와 fake 생성, cache/partial resume
8. [ ] image review/regen/version/Library 등록과 6승인 Gate
9. [ ] 예산·일일 limit·job lock·duplicate request/input hash·audit
10. [ ] Runway preview/edit/cost/confirmation fake 통합
11. [ ] Runway sequential/stop/task recovery/regen과 6승인 Gate
12. [ ] FFmpeg probe/normalize/order merge/continuity/final MP4
13. [ ] 장기 Project/Bible CRUD와 outline Preview/approval
14. [ ] Episode 공통 pipeline과 ContinuityMemory
15. [ ] Electron 통합, Python 동등 fixture, Windows packaging·회귀 검증

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

## 공통 완료 조건

- Python 동작·데이터 규칙, shared 계약, Frontend 흐름, Backend 로직·저장이 모두 구현되어야 한다.
- 오류·경계 테스트와 유료 Provider를 호출하지 않는 통합 테스트가 통과해야 한다.
- main에서 관련 typecheck, test, build를 통과한 뒤에만 체크리스트를 완료로 바꾼다.
- UI 또는 Backend 한쪽만 구현된 기능은 완료로 표시하지 않는다.
