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
| Shared | 1~6 SceneNumber, 기본 Project/Scene/usage/task, Python과 같은 WorkflowState/전이, Runway preview/approval/progress 계약과 테스트 | 전체 ProjectContext, Wizard/Story motion, Asset/Mapping/Review, 장기 프로젝트 DTO |
| Frontend | 제품명과 `INIT` placeholder 및 테스트 1개 | 실제 화면·입력·검토·진행·오류 UI와 API 연결 전부 |
| Backend | `GET /health`와 단위 테스트 | 프로젝트 저장과 workflow/provider/media endpoint 전부 |
| Desktop | 격리된 BrowserWindow에서 frontend 로드 | backend 생명주기, file dialog/path open, packaging/recovery |

Shared의 `/projects` 및 video route는 아직 NestJS 구현이 아니다.

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
- [ ] OpenAI key와 Runway secret 연결·가림·저장·해제
- [ ] 현재 프로젝트 계속하기, 프로젝트 열기와 archive

#### 단기 프로젝트

- [ ] Wizard 입력: 이름, 주제, 전체 줄거리, 장르, 분위기, 시각 스타일, 색감, 조명, 카메라, 대사 스타일, 회피 요소, 화면 비율, 길이, 추가 지시
- [ ] 대표 Character Asset, 서브 캐릭터와 이야기 역할 선택
- [ ] 전체 분위기 Asset과 장면용 background/object/style/general Reference 및 사용 목적 선택
- [ ] 명시적으로 고른 이전 프로젝트의 승인된 Scene 6을 Story와 Scene 1 연속성 자료로 연결
- [ ] API key 없이도 설정을 프로젝트로 저장·관리
- [ ] 정확한 Story prompt 미리보기·복사·편집·복원 후 별도 확인으로 OpenAI 전송; Preview는 무호출
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

1. [ ] 단기 프로젝트 생성·목록·재열기와 Python JSON fixture
2. [ ] 설정·secret 저장/가림/log redaction; Provider 미연결
3. [ ] Asset Library 최소 CRUD·검색·소유권과 legacy index
4. [ ] project Asset scope·mapping review/snapshot/fingerprint Gate
5. [ ] Story schema/prompt preview/edit/restore/explicit submit; fake adapter
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

- [ ] Python `ProjectContext` 최소 호환 필드와 `INIT -> READY`를 shared camelCase API로 확정
- [x] Python에 없는 `userId`는 현재 필수 계약에서 제외하기로 결정; 계정 기능은 서버 확장 단계까지 구현하지 않음
- [ ] `POST /projects`, `GET /projects`, `GET /projects/:projectId`와 `{ code, message, details? }` fixture 정의
- [ ] snake_case 저장 JSON↔camelCase API, unknown field와 legacy state fixture 정의
- [ ] root typecheck/test/build와 Python baseline 무변경 확인
- [ ] 완료: 앱 재시작 뒤 같은 project의 topic/state/timestamps가 보존되고 빈·중복·위험 ID와 손상 JSON 오류가 표시됨

### Frontend 범위와 완료 조건

- [ ] 이름/ID와 영상 주제 최소 폼, submit 상태와 field 오류
- [ ] 목록 loading/empty/error/success와 프로젝트 열기 화면
- [ ] shared DTO/route만 사용하고 저장 구조를 UI에서 추정하지 않음
- [ ] 이벤트 테스트로 필수값, 성공 생성, backend 오류, 목록 갱신, 재열기 검증

### Backend 범위와 완료 조건

- [ ] `learning_data/projects/<safe_project_id>/project.json` UTF-8 원자 저장 repository와 create/list/get controller
- [ ] path 안전성, required topic, duplicate ID, corrupt JSON, unknown field를 API 오류로 변환
- [ ] 목록에서 손상 project를 정상 데이터처럼 무시하지 않도록 정책을 테스트로 고정
- [ ] Provider·FFmpeg·외부 프로그램 호출 없음
- [ ] repository/controller test로 round-trip, 새 instance reload, empty, duplicate/unsafe/corrupt JSON, atomic write failure와 유료 호출 0회 보장

## 공통 완료 조건

- Python 동작·데이터 규칙, shared 계약, Frontend 흐름, Backend 로직·저장이 모두 구현되어야 한다.
- 오류·경계 테스트와 유료 Provider를 호출하지 않는 통합 테스트가 통과해야 한다.
- main에서 관련 typecheck, test, build를 통과한 뒤에만 체크리스트를 완료로 바꾼다.
- UI 또는 Backend 한쪽만 구현된 기능은 완료로 표시하지 않는다.
