# Python to TypeScript Migration Plan

## 원칙

- Python을 줄 단위로 번역하지 않고 사용자 동작, 검증, 저장 데이터와 오류 처리를 TypeScript 구조에 맞게 이전한다.
- `app/`, `tests/`, `prompts/`는 전체 이전과 검증이 끝날 때까지 수정·삭제하지 않는다.
- 사용자에게 보이는 작은 기능 하나씩 Frontend와 Backend를 함께 구현하고 통합 검증 뒤에만 완료 처리한다.
- Preview는 유료 요청을 보내지 않으며 모든 Provider는 예산·승인·중복 방지 Gate 뒤에 둔다.


## 상태: 마이그레이션 완료 (2026-08-24), 현재는 기능 개선·다듬기 단계

Python → TypeScript 이전 자체는 끝났다 — 상위 15개 체크리스트(8절)와 44개 개별 기능 전부 구현·검증·커밋 완료. 이후 사용자가 실제 패키징된 앱을 써보고 "Python 원본보다 다운그레이드된 것 같다"고 지적해 UI/UX 격차 감사를 진행했고("2026-08-24 UI/UX 완성도 및 레거시 데이터 편입" 이하), 1~3순위(핵심 기능 막힘·UX 문제·폴리싱, 총 10개 항목) 전부 완료했다. 이어서 별도의 UI 스타일 리디자인(Phase 0~2, "2026-08-24 UI 셸 리디자인" 이하)으로 `apps/frontend/src/components/*.tsx` 26개 화면 전체와 App.tsx에 violet/gold 다크 테마 시각 언어를 일관 적용하는 것까지 완료했다 — 이건 3순위 폴리싱의 연장선이며 새로운 우선순위 항목은 아니다. 남은 4순위(패키징된 exe 실사용 테스트·DPI 확인·NSIS 설치 프로그램·실제 유료 Provider E2E)는 사용자가 먼저 직접 써보고 안정성을 확인한 뒤 순서대로 진행하기로 했다(패키징·배포는 사용자 승인 후).

**지금부터의 작업은 "Python 기능 이전"이 아니라 "이미 이전된 프로그램의 개선·다듬기"다.** AGENTS.md의 "Feature discipline"(예전 "Migration discipline")은 이 단계에도 그대로 적용된다 — 작업 하나씩, 완료 조건 먼저 정의, 검증 후에만 문서 갱신.

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

1. ~~**(중요, 아키텍처 변경 필요)** `local-video-workflow.service.ts`를 "몇 분짜리 실제 작업을 감당하는 구조"로 재설계한 뒤 Runway adapter를 실제로 연결.~~ **완료** — "마흔한 번째 이전 기능" 참고. 단기·장편 양쪽 모두 제출→폴링 기반 상태 기계로 재설계하고 실제 Runway를 연결했다.
2. ~~실제 OpenAI 이미지 생성에 Asset Mapping 기반 Reference 이미지 편집(`images.edit`, 승인된 캐릭터/스타일 이미지 전달)과 장면 재생성(`image-review.service.ts`) 경로 추가.~~ **완료** — "마흔두 번째 이전 기능" 참고.
3. ~~실제 FFmpeg 환경 검증은 Provider adapter 이후 별도 기능으로 진행한다. 테스트에서는 절대 유료 요청이나 실제 바이너리 호출을 하지 않는다.~~ **완료** — "마흔세 번째 이전 기능" 참고.
4. ~~Electron 통합·Windows 패키징~~ **완료** — "마흔네 번째 이전 기능" 참고.
5. ~~실제 사용자 프로젝트 JSON 표본을 통한 과거 버전 필드 검증~~ **완료** — 이 과정에서 `image-review.service.ts`의 저장 경로 신뢰 버그를 발견·수정했다(커밋 `2726741`).

### 2026-08-24 UI/UX 완성도 및 레거시 데이터 편입 — 다음 작업 목록

사용자가 실제 패키징된 앱을 직접 실행해보고 "Python 원본보다 다운그레이드된 것 같다"고 지적했다. 지금까지 검증은 "Backend 로직·데이터가 Python과 같은가"에 집중했고, `app/ui.py`(약 16,000줄)를 화면 단위로 대조한 적이 없었다. 서브에이전트로 Python UI 전체와 `apps/frontend/src/components/*.tsx` 51개 파일을 화면별로 대조한 결과와, 이어서 직접 확인한 레거시 영상 job 연결 문제를 합쳐 아래 우선순위로 정리한다. **AGENTS.md의 "Preserve observable behavior" 원칙에 따라, 이 목록은 선택적 업그레이드가 아니라 마이그레이션 완료 조건의 일부로 취급한다.**

#### 1순위 — 핵심 도구 기능이 막혀 있음 (실사용자 데이터에 실제 영향)

1. ~~**이미지 검토 화면(`ImageGenerationScreen.tsx`)에 실제 이미지 미리보기 추가.**~~ **완료(2026-08-24)** — 새 엔드포인트 `GET /projects/:projectId/images/:sceneNumber/content`(Asset content 스트리밍과 동일 패턴, job과 무관하게 project+scene만으로 동작)를 추가하고 `<img>`를 review 목록에 연결했다. `review.updatedAt`을 쿼리 캐시버스터로 써서 재생성 직후 새 이미지가 바로 보인다. 실제 backend+frontend dev 서버로 시딩한 프로젝트를 열어 썸네일이 실제로 뜨는 것을 스크린샷으로 확인했다.
2. ~~**영상 검토 화면(`VideoWorkflowScreen.tsx`)에 실제 영상 미리보기 추가.**~~ **완료(2026-08-24)** — 동일 패턴으로 `GET /projects/:projectId/videos/:sceneNumber/content`를 추가했다. **의도적으로 jobId를 요구하지 않게 설계**했다 — 3번 항목(레거시 job 편입)이 해결되기 전에도 이 엔드포인트 자체는 project+scene 경로만으로 항상 동작한다. `<video controls>`를 review 목록에 연결, 동일하게 `updatedAt` 캐시버스터 적용. 실제 dev 서버로 검증 완료.
3. ~~**레거시(Python) 영상 데이터를 새 job 시스템으로 편입.**~~ **완료(2026-08-24)** — 재조사 결과 실제로 막혀 있던 건 `project_5f11f561bf62`(REVIEWING_VIDEOS, 6개 전부 succeeded) 하나였다. `project_0ee811d6dcea`/`project_8b96c3cc1f71`은 `video_generation_records`가 아예 없는 "아직 제출 전" 상태라 정상적인 새 제출 흐름으로 처리되며 이 문제와 무관했다. 해법: `latestVideoJobId()`(`project.mapper.ts`)가 어떤 레코드도 `job_id` 문자열을 갖지 않지만 최소 하나가 유효한 장면 레코드 모양이면 합성 jobId `"legacy"`(`videos/legacy-job.ts`)를 `currentVideoJobId`로 노출하도록 했다. `local-video-workflow.service.ts`의 `records()`는 이제 `normalizeRecord()`로 원본 레코드를 정규화한다 — Python 레코드는 `job_id`/`execution_mode`가 아예 없고 `runway_task_id` 대신 `task_id`라는 다른 이름을 썼는데, `job_id`가 없는 레코드는 `execution_mode: "local_fake_no_provider"`로 기본값을 둬서 **재생성 시 Python이 저장한 적 없는 필드(model, duration_seconds)를 추측해 실제 Runway를 잘못 호출하는 일을 원천 차단**했다 — 재생성하면 로컬 가짜로 안전하게 대체된다. jobId `"legacy"` 요청은 `job_id`가 없는 레코드들만 매칭한다. 실제 정식 파일은 항상 `imagePath`/`file()` 같은 정식 경로로만 읽으므로(레거시 절대경로 문자열은 애초에 신뢰하지 않음) 파일 자체는 문제없이 열린다. 실제 막혀있던 프로젝트를 실제 backend+frontend로 열어 "이어서 진행하기" 버튼이 뜨고, 실제 생성됐던 영상 6개가 검토 화면에서 재생되는 것까지 스크린샷으로 확인했다. 장편(Episode) 쪽은 실제 데이터(`long_8b96f5818f9c`)의 모든 Episode가 `planned` 상태로 영상 레코드가 전혀 없어 동일 문제의 실증 사례가 없었으므로 이번 범위에서 제외하고 남은 항목으로 문서화한다.
4. ~~**프로젝트 생성 마법사 복원.**~~ **완료(2026-08-24)** — Python `_build_short_project_wizard`(약 3,000줄)를 그대로 복제하지 않고, 사용자와 상의해 "기능은 다 들어가고 쓰기는 더 쉬운" 방향으로 설계했다: 이미 존재하던 `ShortProjectSettingsScreen`(설정 폼 + `CastEditor` + `AssetReferenceEditor` + `ContinuityEditor`, 기능적으로는 Python 마법사와 이미 동등했다)를 프로젝트 생성 직후 자동으로 여는 것으로 바꿨다(`App.tsx`의 `handleCreated`가 `detail` 대신 `settings`로 이동, `justCreated` 플래그 추가). 여러 단계 모달 대신 **한 화면에서 이어서 채우는 연속 흐름**으로 단순화했고, `justCreated`일 때만 안내 배너("전부 선택 사항이며 나중에 다시 와서 바꿀 수도 있습니다")와 "설정 완료 · 계속 진행하기" 버튼을 보여준다(이 버튼은 기존 `onBack`을 그대로 재사용 — 프로젝트 상세로 가면 이미 있는 "이어서 진행하기" 안내가 다음 단계를 알려주므로 중복 로직을 만들지 않았다). Cast/Asset Reference 검색 결과가 없을 수 있는 첫 사용 상황을 위해 "Asset Library에서 먼저 등록해 주세요" 안내 문구를 추가했다. 새 Backend 코드는 없음 — 이미 있던 API를 다시 연결한 것뿐이다. 신규 프런트엔드 테스트 4개(`App.test.tsx` 갱신 1개 + `ShortProjectSettingsScreen.test.tsx` 신규 2개), 실제 backend+frontend dev 서버로 생성→설정→"계속 진행하기"→상세 화면 전체 흐름을 스크린샷으로 확인했다. Frontend 537 통과.

#### 2순위 — 눈에 띄게 UX가 나쁨

5. ~~**화면 전반에 지속적인 네비게이션 추가.**~~ **완료(2026-08-24)** — `App.tsx`에 `NavBar` 컴포넌트를 추가해 모든 화면 상단에 항상 단기/장기 프로젝트·Asset Library·API 설정 4개 링크를 띄운다. 기존에 `list`/`longList` 화면에만 각자 다르게 있던 중복 링크를 이걸로 대체했다(교차 이동만 가능하던 "단기 프로젝트로" 버튼도 통합됨). Python의 좌측 nav rail과 똑같이 만들지 않고 상단 바 형태로 더 단순하게 구현했다 — 화면 깊이와 무관하게 항상 한 클릭 거리라는 핵심 속성만 유지했다.
6. ~~**병합 완료 후 결과 영상을 앱 안에서 재생하거나 탐색기로 열기.**~~ **완료(2026-08-24)** — 새 엔드포인트 `GET /projects/:projectId/videos/final/content`(`:sceneNumber/content` 라우트보다 먼저 등록해 "final"이 장면 번호로 잘못 해석되지 않게 함)를 추가하고 `<video controls>`와 "탐색기에서 열기" 버튼(`window.electronAPI.openProjectPath`, `hasElectronBridge()`로 브라우저 dev 모드에서는 숨김)을 연결했다. 구현 중 발견한 추가 버그도 같이 고쳤다: `ProjectDetail.tsx`의 `resumeTarget()`이 `COMPLETED` 상태에 대해 `null`을 반환해, 병합이 끝난 프로젝트를 나중에 다시 열면 결과를 볼 방법이 전혀 없었다 — "최종 영상 결과 보기" 버튼을 추가하고, `VideoMergeScreen.tsx`가 마운트 시 프로젝트 상태를 먼저 확인해 이미 완료된 경우 재병합 없이 기존 결과를 바로 보여주도록 했다. 실제 패키징된 실행 파일(`--user-data-dir`로 격리한 시나리오)에서 영상 재생 UI와 탐색기 열기 버튼이 실제로 동작하는 것을 스크린샷으로 확인했다.
7. ~~**장편(Episode) 화면들을 하나의 작업공간으로 묶기.**~~ **완료(2026-08-24)** — 각 화면을 재구성하는 대신(위험이 크고 개별 화면 24개를 전부 다시 손대야 함), `App.tsx`에 두 번째 단계 nav인 `LongWorkspaceNav`를 추가했다. 장편 프로젝트 관련 화면 어디서든 상단에 프로젝트 개요·설정·Outline·Story Bible 탭이 뜨고, Episode 화면 안에서는 그 옆에 `· Episode N` 표시와 함께 대본·Asset Mapping·이미지·영상·병합·Continuity 탭이 추가로 뜬다 — 현재 화면은 강조 표시된다. 각 화면 컴포넌트는 전혀 건드리지 않고 `App.tsx`에만 추가한 순수 네비게이션 레이어라 위험이 낮다. 기존 개별 "뒤로" 버튼은 그대로 둬서 단계별 흐름도 유지된다. 실제 dev 서버로 프로젝트 개요 → Outline → Story Bible → (아웃라인 승인 후) Episode 1 대본까지 전부 형제 단계 직접 이동이 실제로 되는 것을 스크린샷 4장으로 확인했다.

#### 3순위 — 폴리싱

8. ~~**토스트 알림, 스켈레톤 로딩, 스피너 등 공통 피드백 컴포넌트 도입.**~~ **완료(2026-08-24)** — 전체 토스트 알림 시스템(전역 큐·자동 dismiss)은 만들지 않기로 했다: 지금 있는 인라인 성공/오류 메시지가 자동으로 사라지는 토스트보다 오히려 더 안정적으로 보이고(놓칠 위험 없음, 테스트하기 쉬움) 접근성도 낫다고 판단했다. 대신 실제로 반복되던 "불러오는 중..." 고정 텍스트를 새 `Spinner` 컴포넌트(작은 회전 아이콘 + 기존과 동일한 텍스트)로 교체했다 — 화면 20개, 총 26곳 전부 적용해서 앱 전역에서 일관되게 만들었다. 텍스트 내용은 그대로 유지했기 때문에 기존 텍스트 매칭 테스트가 전부 수정 없이 통과했다.
9. ~~**대시보드 시각적 개선.**~~ **완료(2026-08-24)** — Python의 애니메이션 hero/포스터까지는 재현하지 않고, 실질적으로 유용한 부분만 골랐다: 새 `WorkflowProgressBar` 컴포넌트가 프로젝트의 `workflowState`를 고정 파이프라인 순서 위의 위치로 환산해 얇은 진행률 바로 보여준다(실패/취소는 빨간색으로 구분). 단기 프로젝트 목록과 상세 화면에 추가했다 — 장기 프로젝트는 목록 응답에 `outlineStatus`(2가지 값)만 있어 의미 있는 진행률을 만들 근거가 부족해서 이번 범위에서 제외했다. 썸네일은 목록 화면에서 프로젝트당 별도 네트워크 요청이 필요해 복잡도 대비 실익이 낮다고 판단해 하지 않았다.
10. ~~**Asset Library 스타일링 일관성.**~~ **완료(2026-08-24)** — `AssetLibraryScreen.tsx` 전체(폼 입력·버튼·라벨·목록·상세 패널)에 나머지 화면과 같은 Tailwind 스타일(다크 테마, `rounded-lg`/`rounded-full`, violet 강조, `text-rose-400` 오류색 등)을 적용했다. 오류 메시지 색상도 이 파일만 쓰던 `text-red-300`에서 앱 전역 관례인 `text-rose-400`으로 통일했다. 텍스트 콘텐츠와 `data-testid`는 그대로 둬서 기존 39개 테스트가 전부 수정 없이 통과했다.

실제 backend+frontend dev 서버로 대시보드(여러 workflow 상태의 진행률 바)와 Asset Library 화면 스크린샷을 찍어 확인했다. Frontend 547 통과(+6: `Spinner.test.tsx`, `WorkflowProgressBar.test.tsx`).

**제외 결정(2026-08-24): 얼굴 일관성 검사(InsightFace)를 이전 범위에서 뺐다.** Python 소스(`app/services/face_consistency.py`, `app/ui.py`)를 직접 확인한 결과, 이 기능은 (1) 자동이 아니라 이미지 검토 화면에서 장면을 골라 버튼을 직접 눌러야만 실행되는 수동 기능이었고, (2) 필요한 `insightface`/`onnxruntime`/`opencv-python` 패키지가 `requirements.txt`에 전부 주석 처리된 채 "라이선스 검토 후 별도 설치" 안내만 있어 기본 설치로는 절대 동작하지 않았다. 즉 별도로 무거운 ML 패키지를 수동 설치하지 않은 이상 실사용에서 의미 있게 작동한 적이 없는 기능이었다 — 사용자 확인 후 재현하지 않기로 결정했다.

### 2026-08-24 UI 셸 리디자인 (Phase 0)

Cowork 디자인 세션에서 `apps/frontend` 비주얼 개편을 진행하고(파일 직접 반영 + 브라우저 시각 검증), Main이 최종 검증·커밋했다(`865a307`).

- `App.tsx`: 상단 `NavBar`를 좌측 `Sidebar`(아이콘 네비 + 장/단기 파이프라인 스테퍼)로 교체, 배경 그라데이션/그리드 패턴 추가, 단기 프로젝트 목록 화면에 히어로 이미지 2장(`hero-ring.png`, `hero-landscape.png`) 추가, 헤더 타이틀 그라데이션 텍스트 적용. 화면 라우팅·각 화면으로의 props 전달은 변경 없음.
- `WorkflowProgressBar.tsx`: `progressPercent()`를 `export`로 변경(다른 컴포넌트 재사용용)하고 트랙 색상·glow 효과만 조정 — 로직 변경 없음.
- `ProjectList.tsx`: 프로젝트 카드를 큐브 아이콘 썸네일·상태 배지·진행률 바+퍼센트·화살표 버튼으로 리디자인. 접근성 구조(카드당 버튼 1개, id/topic/workflowState/updatedAt 텍스트 노드, "새 프로젝트" 버튼 접근성 이름)는 그대로 유지해 기존 테스트가 수정 없이 통과했다.
- `Spinner.tsx`: 테두리 색상·glow 효과만 조정(요청 목록엔 없었으나 함께 반영된 사소한 시각적 변경).
- 범위 밖으로 확인된 항목(추가 논의 예정): 프로젝트 카드 즐겨찾기 아이콘, 그리드/리스트 뷰 전환 토글, 사이드바 프로모 카드 드롭다운 화살표.
- Main 검증: 프런트엔드 typecheck/test(547 통과)/build 통과, 루트 전체 typecheck 통과, `git diff --check` 통과(개행문자 경고만 있음). 사용되지 않는 `hero-ribbon.png`(어디서도 import되지 않음)와 시각 검증 중 생성된 `apps/backend/learning_data/projects/design-preview-1/`은 이번 커밋에서 의도적으로 제외했다.
- 후속 확인(2026-08-25): 사용자 확인 결과 `hero-ribbon.png`는 실제로 미사용이라 삭제(never git-tracked라 커밋 기록은 없음). Sidebar의 "PRISM FORGE" 브랜드마크는 의도한 정식 브랜드명이라 유지 — 메인 헤딩 "AI Animation Studio" 문구 교체(리브랜딩)는 이번 범위에서 제외하고 별도로 처리하기로 했다.

### 2026-08-25 UI 스타일 리디자인 (Phase 1 — 4개 화면)

Cowork 디자인 세션이 `apps/frontend` 4개 화면을 Phase 0 사이드바 리디자인과 같은 카드/그라데이션 시각 언어로 확장하고(파일 직접 반영 + 브라우저 시각 검증), Main이 최종 검증·커밋했다(`6bbb379`).

- `CreateProjectForm.tsx`: 폼 전체를 카드(`rounded-2xl`, `bg-slate-900/70`)로 감싸고 입력 필드에 포커스 링, 생성 버튼에 그라데이션 적용. 필드 구성·라벨·검증 로직은 변경 없음.
- `StoryPromptScreen.tsx`: 미리보기·textarea·승인 확인 패널을 카드로 통합, 버튼을 그라데이션/아웃라인으로 스타일링. 2단계 승인 확인 흐름, textarea 값, 모든 `data-testid`는 변경 없음.
- `MappingReviewScreen.tsx`: 원래 스타일이 거의 없던 화면 전체에 검토 상태 카드, 체크박스, 필터 셀렉트, 매핑 카드(상태별 색상 텍스트, 확인/제외/스냅샷 버튼 색상 아웃라인)를 새로 입혔다. 이 파일만 쓰던 `text-red-300`도 앱 전역 관례인 `text-rose-400`으로 통일했다(Asset Library 스타일링 통일 작업과 동일한 정리). 모든 role/label/`data-testid`, PATCH·POST 호출 로직은 변경 없음.
- `ProjectDetail.tsx`: "이어서 진행하기" 버튼을 그라데이션 CTA로, 나머지 액션 버튼을 pill 그룹으로, 상세 정보를 `dl` 그리드 카드로 재구성. `resumeTarget()` 함수 자체와 버튼 텍스트·조건부 노출 로직, dt/dd 텍스트 구성은 변경 없음.
- Main 검증: 프런트엔드 typecheck/test(547 통과, 4개 파일 diff를 직접 대조해 접근성 구조·로직 보존 확인)/build 통과, 루트 전체 typecheck 통과, `git diff --check` 통과(개행문자 경고만 있음). `apps/backend/learning_data/`(시각 검증 중 생성된 로컬 테스트 프로젝트 데이터)는 이번에도 커밋에서 제외했다.

### 2026-08-24~25 UI 스타일 리디자인 (Phase 2 — 나머지 22개 화면, 배치 2~8)

Phase 1(4개 화면)과 같은 Cowork 디자인 세션이 이어서 `apps/frontend/src/components/*.tsx`의 나머지 화면 22개 전부를 같은 카드/그라데이션 시각 언어로 확장했다(파일 직접 반영 + 브라우저 시각 검증). 로컬 CLI 세션이 배치마다 diff 검토·typecheck·test·build를 거쳐 커밋·push했다. 매 배치 회귀 0건.

**적용한 화면(배치 순서, 확인된 커밋만 표기 — 배치 2~4는 이 문서 갱신 시점에 정확한 해시를 확인하지 못했으니 `git log --oneline -- <파일명>`으로 보완할 것)**:

- 배치 2: `ProviderSettingsScreen.tsx` + `ProviderCredentialCard.tsx`, `LongProjectList.tsx`, `VideoMergeScreen.tsx`
- 배치 3: `ArchiveProjectDialog.tsx`, `CreateLongProjectForm.tsx`, `VideoPromptPreviewScreen.tsx`
- 배치 4: `LongProjectDetail.tsx`, `LongProjectSettingsScreen.tsx`, `LongEpisodeVideoMergeScreen.tsx`
- 배치 5(`e88ac1a`): `ShortProjectSettingsScreen.tsx`(설정 폼 + `CastEditor`/`ContinuityEditor`/`AssetReferenceEditor` 3개 서브 에디터), `LongProjectOutlineScreen.tsx`
- 배치 6(`4b71391`): `LongStoryBibleScreen.tsx`(5탭 컬렉션 전환·CRUD·삭제 확인까지 포함한 가장 복잡한 화면 중 하나 — 글로벌 스타일 Asset 옵션 라벨의 모지바케 문자 "쨌"을 앱 전역 관례인 "·"로 정규화, 테스트에서 해당 텍스트를 검사하지 않는다는 것을 먼저 확인 후 수정), `ImageGenerationScreen.tsx`
- 배치 7(`caace80`): `VideoWorkflowScreen.tsx`, `AssetLibraryScreen.tsx`(383줄·938줄 테스트 파일, 이번 리디자인 중 가장 상호작용이 밀집된 화면)
- 배치 8(`70966ce`): `LongEpisodeScriptScreen.tsx`, `LongEpisodeMappingReviewScreen.tsx`, `LongEpisodeImageGenerationScreen.tsx`, `LongEpisodeVideoWorkflowScreen.tsx`, `LongEpisodeContinuityScreen.tsx`

**공통 원칙(Phase 1과 동일, 전 배치 일관 적용)**: aria-label·`role`·`data-testid`·`data-status`·`data-error-code` 등 접근성/테스트 훅, 버튼·라벨의 정확한 문구, 조건부 렌더링·`disabled` 조건, 콜백 시그니처와 API 호출 shape는 절대 바꾸지 않는다 — `className`과 순수 레이아웃용 래퍼 `<div>`/`<span>` 추가만 허용. 이 원칙 덕분에 8개 배치 전부 테스트 수정 없이 그린으로 통과했다.

**재사용한 디자인 토큰(파일마다 로컬 상수로 재선언, 공용 모듈화는 하지 않음)**:
- `fieldClassName`(라벨+입력 세로 배치): `rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 ... focus:ring-2 focus:ring-violet-500/30`
- `primaryButton`(그라데이션 pill): `bg-gradient-to-r from-violet-500 to-fuchsia-500 ... shadow-[0_0_16px_rgba(139,92,246,0.35)]`
- `outlineButton` / `dangerOutlineButton`(rose) / `smallOutlineButton`·`smallAddButton`(emerald)·`smallRemoveButton`(rose)·`smallAmberButton`: 밀도 높은 인라인 행용 축소 버전
- `cardSection`: `rounded-2xl border border-white/10 bg-slate-900/70 p-5`
- `SectionHeading`: 그라데이션 점(`bg-gradient-to-br from-violet-300 to-pink-300`) + 제목 텍스트 헬퍼 컴포넌트
- 확인(confirm) 대화상자: `role="alertdialog"` + `rounded-xl border border-amber-400/40 bg-slate-900/70 p-4`

**발견한 특수 제약**: `VideoWorkflowScreen.test.tsx`(그리고 이미 알려진 `VideoMergeScreen.test.tsx`/`VideoPromptPreviewScreen.test.tsx`)에는 컴포넌트 소스 코드(`.tsx` 파일 원문)를 `node:fs/promises`로 직접 읽어 `localStorage`/`sessionStorage`/`indexedDB`/`console\s*\.`/`api\.openai\.com`/`runwayml\.com`/`\bffmpeg\b`/`child_process`/`spawn\(` 정규식을 검사하는 테스트가 있다. 스타일링만 하는 작업이라도 이 파일들은 원본 텍스트 노드를 한 글자도 바꾸지 않도록 별도로 대조해야 한다("Runway"라는 단어 자체는 허용되며, 도메인 `runwayml.com`과 단어 경계의 `ffmpeg`만 금지). 반대로 `LongEpisodeVideoWorkflowScreen.test.tsx`에는 이런 소스 스캔 테스트가 없다.

**중요한 발견(배치 8): 장편(Episode) 파이프라인은 실제 Provider 없이도 끝까지 라이브로 검증 가능하다.** 배치 6·7 시점에는 `ImageGenerationScreen.tsx`/`VideoWorkflowScreen.tsx`(단기 프로젝트용)가 실제 OpenAI/Runway 연결 없이는 `AssetMappingApproved` 이후 상태에 도달할 수 없다고 보고 `.test.tsx` 전체 대조로만 검증했었다. 그런데 장편 Episode 쪽 화면(`LongEpisodeScriptScreen`의 "Local 대본 생성", `LongEpisodeImageGenerationScreen`의 "로컬 fake 이미지 어댑터", `LongEpisodeVideoWorkflowScreen`의 "로컬 fake 영상 워크플로")은 전부 로컬 결정론적 어댑터만 쓰므로, 테스트 프로젝트(`design-preview-long-1`)의 Episode 1을 아웃라인 승인 → Local 대본 생성·승인 → Asset mapping 텍스트 전용 검토·승인 → 로컬 이미지 6장 생성·전체 승인 → 로컬 영상 6개 생성·전체 승인 → Continuity 저장까지 브라우저로 실제로 끝까지 클릭해서 5개 화면 전부 실제 데이터 렌더링과 콘솔 에러 없음을 확인했다. 다음에 유사한 화면을 검증할 때는 먼저 "로컬 fake" 문구가 있는지 확인하고, 있다면 실제 Provider 연결 여부와 무관하게 라이브 E2E 클릭 검증을 우선 시도할 것.

**검증 수치(배치 5~8, 매번 동일)**: typecheck 전체 워크스페이스 통과, test는 backend 460 통과(+1 skip)·desktop 8 통과·frontend 547 통과·shared 25 통과, build는 shared/backend/frontend/desktop 전부 성공. `apps/backend/learning_data/`(시각 검증 중 생성된 로컬 테스트 프로젝트 데이터)는 매 배치 커밋에서 의도적으로 제외했다.

#### 4순위 — 구현이 아닌 검증/마무리

11. 패키징된 실행 파일로 생성→검토→병합 전체 흐름을 실제로 끝까지 돌려보기(지금까지는 화면 로딩까지만 확인).
12. Windows 화면 배율(DPI) 대응 확인 — Python 때부터 미확인 상태로 남아있던 항목.
13. NSIS 설치 프로그램 실제 빌드·설치, 앱 아이콘, 코드 서명.
14. 실제 유료 Provider로 전체 클릭 E2E — 사용자가 실제 비용을 지불할 준비가 됐을 때만 진행.

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
- 기능·수정 하나가 검증을 통과하면 바로 커밋·push하는 정책이라(`docs/03_TEAM_WORKFLOW.md`) 보통 worktree는 깨끗하다. 그래도 작업 시작 전 `git status`로 확인하고, 미커밋 변경을 발견하면 덮어쓰거나 reset/checkout으로 버리지 않는다.
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
- [x] 실제 사용자 프로젝트 JSON 표본을 통한 과거 버전 필드 검증 — 2026-08-23에 완료. `learning_data/projects/`에 실제로 남아있는, 마이그레이션 착수(8/21) 이전인 2026-07-28~08-02에 Python이 생성한 실제 프로젝트 8개(IMAGES_REVIEW/WAITING_FOR_CAPCUT(legacy)/VIDEOS_APPROVED/REVIEWING_VIDEOS 등 다양한 workflow_state 포함)를 실제로 실행 중인 Backend에 붙여 `GET /projects`, `/projects/:id`, `/settings`, `/settings/cast`, `/images/review`로 읽었다. `WAITING_FOR_CAPCUT`(legacy) → `WAITING_FOR_VIDEO_CONFIRMATION` 상태 변환은 정상 동작을 확인했다. 이 과정에서 실제 버그 하나를 발견해 수정했다: `image-review.service.ts`의 `assertReviewable()`가 `generated_images`에 저장된 절대경로 문자열을 현재 계산한 경로와 완전히 일치해야만 통과시켰는데, (1) 프로젝트 폴더가 다른 PC/드라이브(`C:\Users\lg\OneDrive - koreatech.ac.kr\...`)에서 생성된 뒤 지금 위치로 옮겨진 경우, (2) Python의 더 오래된 재생성 아카이브 경로(`images/generated/<project_id>/sceneN-regen-NNN.png`)가 남아있는 경우 모두 실제 이미지 파일은 정상인데도 검토 화면 진입 자체가 막혔다(8개 중 4개 실사용 프로젝트가 이 버그로 막혀 있었다). `regenerate()`는 애초에 이 저장된 값을 파일 I/O에 전혀 쓰지 않고 항상 현재 머신의 정식 경로(`imagePath()`)로만 읽고 쓰고 있었으므로, `assertReviewable()`도 동일하게 정식 경로만 신뢰하도록 맞췄다 — 배열 길이(6개)만 완전성 신호로 남기고 저장된 경로 문자열 자체는 더 이상 파일 위치 판단에 쓰지 않는다. "저장된 경로가 프로젝트 폴더 밖을 가리켜도 그 경로를 실제로 읽거나 덮어쓰지 않는다"는 보안 성질은 그대로 유지되며, 이를 직접 검증하는 테스트로 갱신했다. 수정 후 8개 실제 프로젝트 중 IMAGES_REVIEW 단계인 4개 전부 정상적으로 검토 가능해졌다(나머지 4개는 이미지 검토 단계를 지난 상태라 `IMAGE_REVIEW_NOT_ALLOWED`가 정상 응답). 신규 테스트 1개 추가(`image-review.service.test.ts`, 총 12개), 기존 테스트 2개는 더 정확한 시나리오로 갱신. Backend 449 통과(+1 intentional skip).
- GUI 옵션별 실제 Provider 결과 품질과 전체 클릭 E2E는 **확인 필요**

### 1. 사용자가 실제로 사용하는 화면과 기능

#### 대시보드와 공통 셸

- [x] 최근 단기 프로젝트, 진행률·현재 단계, 영상 확인 대기 수 표시
- [x] 새 단기/장기 프로젝트, 단기 목록, 이미지 검토, 영상 생성, 생성 이미지/영상 모음, Asset Library, 설정·환경 탐색
- [x] OpenAI key와 Runway secret 연결·가림·저장·해제
- [x] 현재 프로젝트 계속하기, 프로젝트 열기와 archive

#### 단기 프로젝트

- [x] Wizard 입력: 이름, 주제, 전체 줄거리, 장르, 분위기, 시각 스타일, 색감, 조명, 카메라, 대사 스타일, 회피 요소, 화면 비율, 길이, 추가 지시
- [x] 대표 Character Asset, 서브 캐릭터와 이야기 역할 선택
- [x] 전체 분위기 Asset과 장면용 background/object/style/general Reference 및 사용 목적 선택
- [x] 명시적으로 고른 이전 프로젝트의 승인된 마지막 장면을 Story와 Scene 1 연속성 자료로 연결
- [x] API key 없이도 설정을 프로젝트로 저장·관리
- [x] 정확한 Story prompt 미리보기·편집·복원 후 별도 확인으로 local fake adapter 승인 audit 저장; Preview와 승인 모두 유료 Provider 무호출. 실제 OpenAI 전송과 Story 생성은 다음 단계
- [x] title/synopsis/ending과 설정한 장면 수만큼의 scenes 검증. 각 scene은 description, visual action, 정적 구도, 시작·주요·종료 동작, camera/environment motion, 속도·강도, 표정 변화와 continuity hint를 가짐
- [x] 자동 Asset 후보 검토와 명시 승인. suggested/ambiguous/invalid/unconfirmed unmatched는 차단하고 text-only도 사용자 확인
- [x] 승인 mapping으로 이미지를 장면 수만큼 순차 생성; 부분 성공 저장, 완료 scene 보존, 누락 scene만 재개
- [x] 장면 이미지 승인·재생성·version history·Library 등록; 재생성 scene 승인만 초기화
- [x] 모든 장면 이미지 승인 후에만 Runway 단계 진입
- [x] Runway 전송 전 prompts, model, ratio, duration, 최대 호출, 예상 비용/월 예산을 확인·수정; Preview는 무호출
- [x] 명시 승인 뒤 첫 장면부터 마지막 장면까지 순차 제출; 진행 창은 비모달, 중지는 다음 제출부터 차단
- [x] 장면 영상 승인·단일/전체 재생성; 이전 파일 history 보존
- [x] 모든 장면 영상 승인 후 FFmpeg 순서 병합과 최종 Reels MP4 확인

#### Asset Library와 프로젝트 Asset

- [x] 프로젝트 없이도 전역 Library에서 이미지/폴더 등록·검색·편집
- [x] character/background/object/style/general reference의 대표 이름, 설명, 태그, 별칭, 상태와 유형별 시각 설명 관리
- [x] Character 폴더의 front/side/back/사용자 역할 Reference 순서와 대표 이미지 관리
- [x] SHA-256 중복 차단, version 고정 또는 최신 추종
- [x] project mapping의 episode/scene scope, usage role, 선택 자식, 자동/수동 출처, 신뢰도·이유와 승인 상태 저장
- [x] 사용 중 Asset 및 프로젝트 소유 이미지 삭제 차단, 파일 감사와 안전한 relink
- [x] legacy Reference를 원본 보존하며 Library/mapping으로 멱등 이전

#### 장기 프로젝트

- [x] 장기 설정, Story Bible, 전체 Episode outline, Episode 목록·대시보드 관리
- [x] Planner 1회로 outline만 Preview하며 script/image는 자동 생성하지 않음; 명시 승인 필요
- [x] Bible character/location/prop/secret/foreshadowing CRUD·복제·검색과 Library Asset/Style 연결
- [x] 선택 Episode 하나만 script 생성·편집·승인하고 revision/history 보존
- [x] Episode mapping 승인 뒤 이미지 생성·검토·재생성; 부분 성공과 누락 재개
- [x] 이전 Episode의 승인된 마지막 장면을 다음 Episode Scene 1 Reference로 사용
- [x] 요약·사건·entity 변화·비밀·복선·다음 행동을 Continuity Memory에 저장; 최근 우선, 미래 비밀 제외, context 크기 제한
- [x] 다음 Episode는 사용자가 준비하며 자동 연쇄 생성하지 않음
- 장기 영상부터 최종 병합까지 단기와 같은 수준의 UI 통합은 **확인 필요**

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

- [x] 식별·상태: `project_id`, `topic`, `project_type`, `workflow_state`, `created_at`, `updated_at`, `script_revision`, `mapping_revision`
- [x] 창작: `character_profile`, `lore_context`, `style_profile`, `references`, `story`, `scenes`
- [x] 이미지: `image_prompts`, `generated_images`, `image_generation_records`, `generated_image_reviews`, `face_consistency_results`(InsightFace 미이전으로 범위 제외 — 84행 참조)
- [x] 영상: `motion_prompts`, `generated_video_paths`, `video_generation_records`, `video_reviews`, `final_video_path`
- [x] 운영: `api_usage`, `warnings`, `errors`
- [x] 호환: `capcut_clip_paths`; `WAITING_FOR_CAPCUT`/`CAPCUT_CLIPS_READY`와 legacy clips를 현재 상태/경로로 읽음
- [x] scene 산출물 배열은 `MAX_SCENE_COUNT`(12) 이하, 완전 검증 시 scenes는 프로젝트의 `scene_count`와 일치
- profile 내부 Wizard 키는 자유 dict이므로 완전한 고정 schema는 **확인 필요**; 생성 fixture로 고정 후 이전

#### 장기와 보조 JSON

- [x] `long_story/project.json`: title/logline/overview/genre/tone/theme, Episode 수·길이·일정, 시작/중간/결말/story flow, platform/aspect/audience/notes/timestamps
- [x] `story_bible.json`: `basic`, `world`, `characters`, `locations`, `props`, `secrets`, `foreshadowing`, `summaries`, `updated_at`
- [x] `episode_outlines.json`; `EpisodeNNN/project.json`, `outline.json`, `script.json`, `images/`; legacy `episodes/episode_NNN/episode.json`/`continuity.json`
- [x] `generated_image_reviews.json`: scene/path/status/regen count/history/timestamp
- [x] `reference_assets/references.json`: Reference, scene/episode scope, type, character/face baseline, SHA
- [x] `asset_mappings.json`: Library 연결, scope/status/version/snapshot/selected children
- [x] `asset_mapping_review.json` 또는 `mapping_reviews/episode_NNN.json`: fingerprint/revisions/status/confirmations/reviewed scenes
- [x] `learning_data/asset_library/assets.json`: Asset, versions, Character Reference set, 검색·소유권 metadata
- [x] `api_jobs.json`, `api_calls.json`, `api_budget_usage.json`, `runway_budget_usage.json`: job/task/attempt/retry/provider ID, 호출·비용
- [x] project `events.jsonl`, `style_profile/style_profile.json`, `lore/*.json`, character/reference metadata JSON

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

- [x] 프로젝트별 생성 경로와 `AppConfig.ensure_directories()` 공통 runtime 경로를 fixture로 구분
- [x] Windows/OneDrive 잠금에 대한 원자 저장과 제한 재시도 유지
- [x] archive는 `output/archive`; 실행 중 API job이면 차단

### 5. 외부 연동

- [x] OpenAI Responses: 기본 `gpt-5.6-luna`, JSON Story/outline/script, SDK retry 0과 앱 bounded retry
- [x] OpenAI Images: 기본 `gpt-image-2`, PNG medium, aspect별 `1024x1536`/`1536x1024`/`1024x1024`, Reference edit
- [x] OpenAI 오류를 authentication/quota_or_permission/rate_limit/server/network/invalid_request/empty·invalid response/unknown으로 분류해 한국어 메시지 제공
- [x] Runway: `gen4_turbo`, 기본 `720:1280`, 5초, 무음, submit→poll→원자 download, UTF-16 prompt 길이
- [x] Runway 예산은 OpenAI와 분리하고 실패한 Provider 시도도 기록
- [x] FFmpeg/ffprobe argument 배열, UTF-8 경로, probe, 세로·가로 정규화, 30fps, 장면 수만큼 순서 concat, last frame
- ~~선택적 InsightFace는 모델 없음/backend 실패 시 전체 생성을 중단하지 않음~~ (범위 제외 — 2026-08-24 사용자 확인 후 이전하지 않기로 결정, 84행 참조)
- [x] OS로 local path open; CapCut은 legacy JSON 호환 외 현재 workflow에서 미사용

### 6. 캐릭터·Asset·스타일·세계관·메모리

- [x] 대표 캐릭터 외모·머리·기본 복장·대표 색·고유 소품 identity 유지와 변경 차단
- [x] 여러 각도 Reference를 한 인물로 묶고 캐릭터 간 얼굴·복장·색·소품 혼합 금지
- [x] 분위기 Asset은 공통 연출, background/object는 필요한 scene, style은 시각 방향에 적용
- [x] Story API에는 Asset metadata text, Image API에는 승인되고 scope가 유효한 실제 이미지/manifest 전달
- [x] exact 이름 우선, casefold/부분 검색, ambiguity, inactive 제외, SHA dedup
- [x] Style feedback/score 저장과 범위 검증, Lore 중복 이름 차단과 JSON context
- [x] 단기 memory는 ProjectContext/events, 장기는 Bible + ContinuityMemory + 최근 우선/크기 제한 context

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
- 전체 Tkinter 클릭 E2E, 실제 유료 Provider, 모든 Windows 배율 시각 결과는 **확인 필요**

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
12. [x] FFmpeg probe/normalize/order merge/continuity/final MP4 — mock runner로 구조 검증 완료. 실제 설치된 FFmpeg 환경 검증은 "마흔세 번째 이전 기능"에서 완료.
13. [x] 장기 Project/Bible CRUD와 outline Preview/approval
14. [x] Episode 공통 pipeline과 ContinuityMemory
15. [x] Electron 통합, Windows packaging — "마흔네 번째 이전 기능"에서 완료(Backend 생명주기, 동일 origin 서빙, 프로젝트 폴더 열기, `electron-builder` 패키징을 실제 패키징된 실행 파일로 검증). NSIS 설치 프로그램 실제 빌드·설치와 코드 서명은 남은 범위로 문서화.

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
> Story 6 scenes 생성 및 실제 image-generation Gate 연결은 다음 기능에서 구현·통합 검증한다.

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
> 실제 이미지 Provider 호출, 비용·예산·중복 job/input hash Gate는 이후 Provider 안전 기능에서 별도 구현한다.

## 여덟 번째 이전 기능: Runway 영상 요청 미리보기·프롬프트 편집·예상 비용

- [x] `POST /projects/:projectId/videos/preview`는 `WAITING_FOR_VIDEO_CONFIRMATION`, 승인된 이미지 6개, 엄격한 6장면 구조를 Gate로 검증하고 실제 Provider·네트워크·FFmpeg 호출 없이 장면별 prompt, `gen4_turbo`, ratio, 5초 duration, 예상 비용을 반환한다.
- [x] Python과 같이 이전 장면의 종료 동작과 continuity hint를 다음 장면 prompt에 반영하며, 기본 비용은 5 credits/sec × $0.01로 장면당 $0.25, 전체 $1.50이다. 이미지 절대 경로는 API·UI에 노출하지 않는다.
- [x] Frontend는 6개 prompt, model/ratio/duration, 장면별·전체 예상 비용을 표시하고 prompt를 로컬에서만 편집한다. UTF-16 code unit 1,000자 제한·emoji 카운터, loading/error/retry와 Preview 무호출/무전송 테스트를 제공한다.
- [x] Main 통합에서 Backend 186개 통과(+1 intentional skip), Frontend 299개 통과, Shared 23개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Runway·OpenAI·FFmpeg 호출은 0회다.
> 명시적 Runway 전송 승인, budget/call limit, input hash·job lock, 순차 task polling/recovery, 영상 검토·FFmpeg 병합은 이후 기능으로 분리한다.

## 아홉 번째 이전 기능: local fake 영상 전송 승인·예산·중복 방지 Gate

- [x] Frontend는 Preview의 6개 편집 prompt를 유지한 채 첫 확인에서는 전송하지 않고, 두 번째 명시 확인에서만 `approved: true`, confirmation ID, user request ID, 6개 prompt를 전송한다. 실제 Runway 요청이 발생하지 않는 local fake 단계임을 명확히 표시한다.
- [x] Backend는 preview snapshot 기반 confirmation ID stale 검증, UTF-16 1,000자 제한, image bytes·prompt·model·ratio·duration SHA-256 input hash, 동일 request ID 및 동일 input hash 재시작 멱등성을 저장한다.
- [x] 기본 월 예산 $10, 최대 6회 호출, 예상 $1.50 preflight를 안전하게 검증하고, budget/call-limit/request conflict/stale 오류를 안전한 API·UI 오류로 처리한다. `project.json`에는 job·approval·hash·budget audit과 6개 checkpoint만 저장한다.
- [x] 성공은 `GENERATING_VIDEOS` local fake 상태 전이만 수행하며 실제 Provider 제출, poll, 다운로드, 영상 파일 생성, FFmpeg 호출은 없다. Main 통합에서 Backend 189개(+1 intentional skip), Frontend 327개, Shared 23개 테스트와 root typecheck/test/build를 통과했다.
> 실제 Runway submit/poll/recovery, 영상 파일/검토/재생성, FFmpeg 병합은 이후 기능으로 분리한다.

## 열 번째 이전 기능: local fake 영상 순차 생성·재개·검토

- [x] local fake 영상 job은 저장된 6개 checkpoint를 순서대로 처리하며, 완료된 scene 파일을 보존하고 restart 시 중단 지점부터 재개한다. Stop은 다음 scene 제출을 막고 `INTERRUPTED` 상태를 저장한다.
- [x] 단일·전체 재생성은 명시적으로 선택한 scene만 history에 보존하고 pending으로 초기화하며, 다른 완료 영상·검토 상태는 유지한다. 실제 Runway, 네트워크, subprocess, FFmpeg 호출은 없다.
- [x] `generated_video_reviews.json`은 장면별 승인 상태를 UTF-8 atomic 저장하며, 6개 승인 뒤에만 `VIDEOS_APPROVED`로 전이한다. Frontend는 진행, 중단, 재개, 재생성 확인, 오류, 6개 검토·승인을 제공한다.
- [x] Main 통합에서 Backend 192개 통과(+1 intentional skip), Frontend 363개, Shared 23개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다.
> 실제 Runway task submit/poll/download, 실제 MP4 품질·duration 확인, FFmpeg probe/normalize/merge/final MP4는 이후 기능으로 분리한다.

## 열한 번째 이전 기능: 로컬 FFmpeg 최종 병합

- [x] `POST /projects/:projectId/videos/merge`는 `VIDEOS_APPROVED`, 정확히 6개 승인 review, 고정된 `scene1.mp4`~`scene6.mp4` 순서를 Gate로 검증한다.
- [x] Backend는 FFmpeg/ffprobe argument array, video stream/duration probe, portrait·landscape 정규화, concat, `videos/final/instagram_reel.mp4` 출력 검증을 주입 가능한 runner로 구현한다. 실패 시 원본 clips를 보존하고 안전한 오류와 `FAILED` 상태를 저장한다.
- [x] Frontend는 명시 확인 뒤에만 병합을 요청하고 loading/error/completed 상태를 표시하며 절대 로컬 경로와 Provider 요청을 노출하지 않는다. 테스트는 모든 runner/fetch를 mock한다.
- [x] Main 통합에서 Backend 197개 통과(+1 intentional skip), Frontend 392개, Shared 23개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 FFmpeg binary·Provider 호출은 테스트에서 0회다.
> 실제 설치된 FFmpeg의 6개 유효 MP4 통합, final video content/download/open API, continuity last frame은 별도 환경 검증·Desktop 기능으로 남긴다.

## 열두 번째 이전 기능: 장기 프로젝트 생성·목록·재열기·설정·전체 outline Preview/명시 승인

- [x] 별도 long-project DTO와 API route를 shared 계약으로 추가했으며, 단기 `Project`/`ProjectSummary` 계약이나 로컬 단일 사용자 계약에 `userId`를 추가하지 않았다.
- [x] Python 경로와 호환되게 `learning_data/projects/<project_id>/long_story/project.json`, `story_bible.json`, `episode_outlines.json`에 UTF-8 원자 저장하며, 장기 프로젝트만 별도 목록·재열기한다.
- [x] 제목·logline 필수 검증, episode 수와 설정 조회·수정, 새 Backend instance 재로드, 손상 항목/안전하지 않은 ID/API 오류 처리를 테스트로 고정했다.
- [x] 전체 outline은 Preview 후 수정·복원할 수 있으며 첫 확인은 요청을 보내지 않고 두 번째 명시 승인에서만 local fake planner를 실행한다. 승인 뒤 Episode 상태는 `planned`에서 `outline_ready`로만 바뀌며 script·image·video는 생성하지 않는다.
- [x] Frontend는 단기 프로젝트와 분리된 장기 프로젝트 생성·목록·상세·설정·outline 화면, loading/empty/error 상태와 API 응답 검증을 제공한다.
- [x] Main 통합 검증에서 Backend 201개 통과(+1 intentional skip), Frontend 459개 통과, Shared 23개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 OpenAI·Runway·FFmpeg·외부 network 호출은 구현과 테스트 모두 0회다.
> 다음 범위는 Story Bible의 character/location/prop/secret/foreshadowing CRUD와 선택 Episode의 script 생성·편집·명시 승인이다. 실제 Provider 호출은 포함하지 않는다.

완료 근거(2026-08-23): Backend/shared `93bb555`, Frontend `7f32bb3`을 main에 fast-forward 통합했다. Python의 장기 프로젝트 첫 단계만 이전했으며 Episode script, Asset mapping, 이미지·영상 생성, ContinuityMemory와 실제 Provider/FFmpeg 연동은 범위 밖으로 유지했다.

## 열세 번째 이전 기능: 장기 프로젝트 Story Bible 핵심 CRUD

- [x] `characters`, `locations`, `props`, `secrets`, `foreshadowing` 다섯 컬렉션만 별도 계약과 CRUD route로 이전했다. `basic`과 `world`는 기존 JSON 호환을 위해 읽기 전용으로 보존한다.
- [x] `story_bible.json`의 `character_id` 등 snake_case ID와 연결 필드를 API camelCase로 변환하고, UTF-8 원자 저장·프로젝트/항목 경로 검증·unknown field·중복/미존재/손상 JSON 오류 처리를 고정했다.
- [x] Frontend는 장기 프로젝트 상세에서 Story Bible 화면으로 진입하며, 다섯 탭의 loading/empty/error/success, 생성·수정과 별도 두 단계 삭제 확인을 제공한다. Backend 원문 오류는 표시하지 않는다.
- [x] 새 Backend instance 재열기, 모든 CRUD와 안전 오류, API 응답 검증, mock fetch, Provider·FFmpeg·network 무호출을 테스트로 고정했다.
- [x] Main 통합 검증에서 Backend 208개 통과(+1 intentional skip), Frontend 465개 통과, Shared 24개 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
> Python의 Bible Asset link, 검색·복제 및 advanced relationship editor는 다음 Bible/Asset 통합 단계로 남긴다. 선택 Episode script·이미지·영상·ContinuityMemory도 이 범위에 포함하지 않는다.

완료 근거(2026-08-23): Shared/backend `b775f1e`, Frontend `0b1374a`을 main에서 통합 검증했다.

## 열네 번째 이전 기능: 장편 Episode local fake 대본 생성·편집·승인

- [x] 선택한 `outline_ready` Episode 하나만 local fake 대본으로 생성하며, Python `STORY_SCHEMA`와 같이 title/synopsis/ending 및 정확히 순서가 맞는 6개 장면·17개 장면 필드를 검증한다. Provider·network·FFmpeg 호출은 없다.
- [x] `long_story/EpisodeNN/project.json`, `outline.json`, `script.json`에 UTF-8 원자 저장하고, 생성·사용자 수정·명시 재생성 전 대본을 history에 보존하며 script revision을 증가시킨다.
- [x] 대본은 `script_review`에서만 수정·명시 승인할 수 있고, 승인 후 `script_approved`로 전이한다. Asset mapping, 이미지, 영상, Continuity Memory는 시작하지 않는다.
- [x] Frontend 장편 상세의 Episode별 대본 진입, local 생성, JSON 편집·검증, 재생성, 두 단계 승인, loading/error/success UI와 API 응답 검증을 제공한다.
- [x] Main 통합 검증에서 Backend 210개 통과(+1 intentional skip), Frontend 466개, Shared 24개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
> 다음 범위는 Story Bible Asset link, 검색·복제·관계 편집 또는 Episode Asset mapping이다. 실제 Provider 연결은 포함하지 않는다.

> 🚨 **미해결 격차(2026-08-26, Cowork가 실사용 브라우저 검증 중 발견, CLI가 문서 이력으로 확정)**: 이 "local fake" 범위가 그 뒤로 한 번도 다시 다뤄지지 않았다. "서른세 번째 이전 기능(실제 OpenAI Story 생성 adapter)"은 본문에 `StoryPromptService`만 나오는 **단기 전용**이고, `EpisodeScriptsService`는 이후 어떤 항목에도 등장하지 않는다 — 대조로 "마흔한 번째(실제 Runway 영상)"는 제목에 "단기·장편 동시"라고 명시했고 장기 이미지(`episode-images.service.ts`)도 실제로 `callOpenAiImageApi`/`callOpenAiImageEditApi`를 쓰고 있다(다만 이건 언제 연결됐는지 명시한 항목이 따로 없는 별개의 작은 문서 누락). 즉 매핑(원래 Provider 불필요)·이미지·영상은 전부 실제 Provider에 연결됐는데 **대본만 남았다** — 의도적으로 미룬다는 결정이 사용자와 논의되거나 기록된 적이 없다. `EpisodeScriptsService`는 지금도 생성자가 `projectsRoot` 하나뿐이라 Provider에 물리적으로 닿을 수 없고, 그 결과 모든 장기 프로젝트의 이미지·영상 프롬프트와 내레이션 문장이 템플릿 placeholder 텍스트("Scene N narration for Episode X.") 위에 얹혀 있다. 실제 adapter 연결은 서른세~서른다섯 번째 항목급 작업(신규 OpenAI adapter, 전용 예산 게이트, 파이썬 `build_context()`—이전 Episode 연속성+승인된 Asset mapping 컨텍스트 조립—포팅, 생성자·호출부 배선)이라 사용자와 우선순위를 다시 맞춘 뒤 별도 항목으로 착수한다.

## 열다섯 번째 이전 기능: 장편 Story Bible Asset Library 연결

- [x] character/location/prop Bible 항목에만 승인·활성 상태의 character/background/object Asset을 연결할 수 있으며, folder·unknown·disabled·unapproved·type mismatch Asset은 차단한다.
- [x] `asset_link`를 Python 호환 snake_case로 저장하고 API에서는 camelCase `assetLink`로 제공한다. pinned version 또는 follow latest와 전체/단일 Episode 범위를 검증하며, 단일 Episode는 프로젝트 범위를 벗어날 수 없다.
- [x] Frontend Story Bible에서 사용 가능한 Asset 선택, version 정책, 전체/단일 Episode 범위 선택, 현재 연결 표시 및 명시 연결 해제를 제공한다.
- [x] Main 통합 검증에서 Backend 212개 통과(+1 intentional skip), Frontend 468개, Shared 24개 테스트와 root typecheck/test/build, `git diff --check`를 통과했다. 실제 유료 Provider 호출은 0회다.
> 다음 범위는 승인된 Episode 대본과 Bible Asset link를 후보로 사용하는 Episode Asset mapping review다.

## 열여섯 번째 이전 기능: 장편 Episode Asset mapping 검토·승인

- [x] `script_approved` Episode에서만 범위에 맞는 Story Bible character/location/prop Asset link를 후보로 만들고, 후보별 confirm/exclude를 별도 저장한다.
- [x] 대본 revision·fingerprint와 mapping revision을 검증해 대본 변경 뒤의 오래된 후보 또는 승인을 차단하고, 확정 시 `asset_mapping_approved`로 전이한다.
- [x] 후보가 없을 때만 명시적인 text-only 확인을 요구하며, 검토 시작 전의 빈 상태는 후보 없음으로 오인하지 않는다.
- [x] Frontend는 검토 시작, 후보별 확정/제외, 최종 승인 단계를 분리하고 범위·버전·revision 정보를 표시한다.
- [x] Main 통합 검증에서 Backend 215 통과(+1 intentional skip), Frontend 472 통과, Shared 24 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 `asset_mapping_approved` Episode의 local fake 이미지 6장 생성·검토·재생성이다.

## 열일곱 번째 이전 기능: 장편 Episode local fake 이미지 생성·검토·재생성

- [x] `asset_mapping_approved` Episode만 정확한 `{ approved: true }` 명시적 확인으로 local fake PNG 6장을 생성하며, 현재 mapping fingerprint와 6개 대본 장면을 다시 검증한다.
- [x] 이미지는 Episode 전용 `images/sceneN.png`에 원자적으로 저장하고, 유효 PNG·재사용·`generated_image_reviews.json`을 검증한다. API와 UI는 내부 파일 경로를 노출하지 않는다.
- [x] 장면별 명시적 검토 승인이 6개 모두 완료되어야 `waiting_for_video_confirmation`으로 전이한다. 장면 재생성은 별도 확인이 필요하며 기존 파일은 Episode 내부 version archive로 보존하고 해당 장면만 pending으로 되돌린다.
- [x] Frontend는 mapping 승인 뒤에만 별도 생성 확인 화면을 열고, 확인 창 자체는 요청하지 않으며 최종 클릭에서만 `{ approved: true }`를 보낸다. 생성·검토·재생성·영상 전송 대기와 오류 상태를 모두 표시한다.
- [x] Main 통합 검증에서 Backend 219 통과(+1 intentional skip), Frontend 476 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 `waiting_for_video_confirmation` Episode의 local fake 영상 순차 생성·중단/재개·검토·재생성이다.

## 열여덟 번째 이전 기능: 장편 Episode local fake 영상 순차 생성·검토·재생성

- [x] `waiting_for_video_confirmation` Episode의 승인된 이미지 6장만 provider-free preview와 명시적 확인으로 local fake 영상 작업을 시작한다. preview에는 내부 이미지 경로를 노출하지 않는다.
- [x] confirmation ID·입력 hash·사용자 요청 ID를 Episode별 job으로 저장하고, 동일 요청은 멱등 처리하며 stale·충돌 요청을 차단한다.
- [x] 로컬 fake MP4를 Episode 전용 `videos`에 순차 생성하고, 중단·재개 시 완료된 장면을 보존한다. 실제 Runway·network·FFmpeg·subprocess 호출은 없다.
- [x] 장면별 명시적 영상 검토가 6개 모두 완료되어야 `videos_approved`로 전이한다. 개별 재생성은 별도 확인을 요구하고 기존 영상은 Episode 내부 history에 보존하며 다른 장면의 완료·검토 상태를 보존한다.
- [x] Frontend는 local fake 전용 preview·수정 가능한 프롬프트·명시적 제출 확인·진행/중단/재개·재생성·검토 상태를 제공한다.
- [x] Main 통합 검증에서 Backend 222 통과(+1 intentional skip), Frontend 480 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 `videos_approved` Episode의 local FFmpeg-safe 최종 병합과 결과 검증이다.

## 열아홉 번째 이전 기능: 장편 Episode 최종 FFmpeg 병합

- [x] `videos_approved` Episode의 현재 video job, 6개 명시적 검토 승인, 순서가 맞는 유효 scene1~scene6 clip을 모두 검증한 뒤에만 병합할 수 있다.
- [x] Episode 전용 FFmpeg probe·normalize·concat은 shell 없이 argument array로 실행하며, 결과는 `long_story/EpisodeNN/videos/final/instagram_reel.mp4`에 저장한다. API/UI에는 고정 상대 경로 `videos/final/instagram_reel.mp4`만 노출한다.
- [x] 병합 시작은 Frontend의 별도 명시적 확인 뒤에만 요청되며, 확인 창을 열 때는 요청하지 않는다. 오류·재시도·성공 UI와 안전한 오류 메시지를 제공한다.
- [x] probe 불가/clip 무효는 승인 상태를 보존하고, rendering 실패는 승인 clip을 보존한 채 안전한 실패 상태를 저장한다. mock runner 테스트는 실제 FFmpeg·Provider·network 호출 없이 순서와 오류 보존을 검증한다.
- [x] Main 통합 검증에서 Backend 227 통과(+1 intentional skip), Frontend 483 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg binary 호출은 0건이다.
> 다음 범위는 Python 장편 기능의 Continuity Memory 및 Episode 간 컨텍스트 갱신이다.

## 스무 번째 이전 기능: 장편 Episode Continuity Memory·다음 회차 컨텍스트

- [x] 이미지 승인 이후의 Episode에서만 사용자가 검토한 요약, 사건, 인물·장소·소품 변화, 갈등, 비밀·복선, 다음 행동과 세계 변화를 별도 `continuity.json`에 UTF-8 원자 저장한다.
- [x] API는 snake_case 저장 형식과 camelCase DTO를 안전하게 변환하고, route Episode 번호만 신뢰한다. 화면 진입은 조회만 하며 저장은 명시적 버튼으로만 실행한다.
- [x] 다음 회차가 있으면 저장 응답에 그 회차를 제공한다. local fake 대본 생성은 이전 회차 기억을 결정적으로 반영하되 최근 3개 회차는 상세 요약/사건/인물 변화/다음 행동, 이전 회차는 압축 요약만 포함하고 아직 공개할 수 없는 비밀 정보는 포함하지 않는다.
- [x] Frontend는 최종 병합 뒤 Continuity Memory 편집·검증·저장 및 다음 Episode 진입을 제공하며, JSON 변경값·오류 응답·자동 저장을 테스트로 고정한다.
- [x] Main 통합 검증에서 Backend 230 통과(+1 intentional skip), Frontend 488 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 Story Bible의 고급 관계(인물·장소·소품·비밀·복선) 일관성 검증과 편집이다.


완료 근거(그룹 커밋, 2026-08-23): 열네~스무 번째 이전 기능(장편 Episode 대본→Continuity Memory 파이프라인)을 `a1ba785` 그룹 커밋으로 통합·검증했다.

## 스물한 번째 이전 기능: Story Bible 고급 관계 일관성 감사

- [x] 기존 Python 호환 관계 필드(character.location/owned items, location.characters, prop.owner/location, secret·foreshadowing character/location)를 변경하지 않는 읽기 전용 감사 API로 검사한다.
- [x] 누락 참조는 collection, item ID, field, missing ID 목록으로 결정적으로 반환하며, 기존의 끊어진 legacy 데이터를 자동 수정하거나 일반 CRUD에서 거부하지 않는다.
- [x] Frontend Story Bible 화면은 감사 실행·새로고침, 정상/로딩/오류 상태와 안전한 누락 참조 목록을 제공하며 어떤 저장 요청도 보내지 않는다.
- [x] Main 통합 검증에서 Backend 233 통과(+1 intentional skip), Frontend 489 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 Python BibleCollectionManager의 Story Bible 항목 검색·복제 동작이다.

## 스물두 번째 이전 기능: Story Bible 검색·복제

- [x] Python `BibleCollectionManager`와 같이 컬렉션별 name/description case-insensitive 검색을 제공하며, 빈 검색어는 저장 순서대로 전체 항목을 반환한다.
- [x] 항목 복제는 deep clone, 새 안전 ID와 복제 이름을 만들고 Asset link와 다른 필드를 보존하며 원본을 바꾸지 않은 채 UTF-8 원자 저장한다.
- [x] Frontend는 명시적 검색, 로딩/빈 결과/오류 재시도와 검색·목록 양쪽의 로컬 복제를 제공하고, 복제 응답으로 Story Bible 표시를 갱신한다.
- [x] Main 통합 검증에서 Backend 236 통과(+1 intentional skip), Frontend 492 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 범위는 이전 Episode의 승인된 Scene 6을 다음 Episode Scene 1의 연속성 reference로 사용하는 동작이다.

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
> 다음 권장 범위는 `local-video-workflow.service.ts`를 배경 작업/주기적 진행 상태 조회 구조로 재설계한 뒤 이 adapter를 실제로 연결하는 것이다. 착수 전 접근 방식을 다시 사용자와 확인한다.

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
> 다음 권장 범위는 단기 Wizard의 초기 입력/Asset 선택 흐름을 Python UI와 맞추는 작업이다.

완료 근거(그룹 커밋, 2026-08-23): 서른여섯~서른일곱 번째 이전 기능(장기 Episode 재개, 생성 이미지 모음 링크)은 단기 재개와 같은 `6276564` 그룹 커밋에 이미 포함되어 있었다.

## 서른여덟 번째 이전 기능: 단기 프로젝트 Wizard 대표/서브 캐릭터(Cast) 선택

- [x] Python Wizard의 대표 Character Asset·서브 캐릭터와 이야기 역할 선택(`character_profile.cast`)을 이전했다. `story-prompt.service.ts`의 `promptVariables()`에는 이미 `character_profile.cast`를 읽어 `character_cast_metadata` placeholder로 넣는 로직이 존재했지만 이를 채우는 사용자 화면이 없었다 — 이번 기능으로 그 휴면 경로를 처음 채웠다.
- [x] Shared 계약에 `ShortProjectCastMember`(`assetId`/`castRole`/`storyRole`), `GetShortProjectCastResponse`, `UpdateShortProjectCastRequest`, `UpdateShortProjectCastResponse`와 `projectCast` 라우트를 추가했다.
- [x] Backend: `project-cast.ts`에 순수 파싱/검증 함수(`parseShortProjectCast` — cast 배열만 허용, 최대 크기, 중복 assetId 거부)를 추가하고, `ProjectsService`에 `getProjectCast`/`updateProjectCast`를 추가했다. `LocalAssetsRepository`가 주입된 경우에만 각 assetId가 실존하는 non-folder character 타입 Asset인지 검증하고(주입되지 않으면 검증을 건너뛴다 — 기존 `ProjectsService` 생성자 호출부와의 하위 호환), `ProjectsModule`이 `AssetsModule`을 import하도록 배선했다. `GET`/`PUT /projects/:projectId/settings/cast` 컨트롤러 라우트를 추가했다.
- [x] Frontend: `projectsApi.ts`에 `getProjectCast`/`updateProjectCast`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 별도 저장 상태를 갖는 `CastEditor` 하위 컴포넌트를 추가했다 — 기존 설정 폼의 저장 상태와 완전히 분리되어, 캐릭터 검색이나 배역 수정이 메인 설정 폼의 저장 여부에 의존하지 않는다. character 타입으로 필터링된 Asset 검색, 추가/제거, 배역·이야기 역할 텍스트를 blur 시 저장한다.
- [x] 새 테스트: Backend `project-cast.test.ts`(순수 함수 12개), `projects.service.test.ts`에 cast get/save/Asset 검증/재시작 후 유지 6개 추가, `project-cast.app-module.integration.test.ts`(실제 `NestFactory.create(AppModule)` 부팅으로 존재하지 않는/character가 아닌 Asset 거부, 재시작 후 유지, 그리고 저장한 cast가 실제로 Story preview의 `character_cast_metadata`에 반영되는지까지 end-to-end로 고정) 2개. Frontend `ShortProjectSettingsScreen.test.tsx`를 URL 기반 `stubFetchByRoute` 헬퍼로 재작성하고 cast 표시·검색·추가·제거·로드 실패 표시를 검증하는 테스트 5개.
- [x] Main 통합 검증에서 Backend 368 통과(+1 intentional skip), Frontend 525 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 권장 범위는 같은 Wizard parity 작업의 나머지 조각들이다: 전체 분위기 Asset 선택, 장면용 background/object/style/general Reference와 사용 목적 선택, 이전 프로젝트 승인 Scene 6과의 연속성 연결.

## 서른아홉 번째 이전 기능: 단기 프로젝트 Wizard 전체 분위기·장면 참고 Asset 선택

- [x] Python Wizard의 전체 분위기(style/general_reference/background) Asset 선택(`lore_context.atmosphere_asset_ids`)과 장면용 background/object/style/general Reference와 사용 목적 선택(`lore_context.scene_reference_assets`)을 이전했다. Python은 두 목록을 서로 배타적으로 취급한다(한 Asset은 분위기 또는 장면 참고 중 하나의 용도로만 선택 가능) — 이 제약을 그대로 옮겼다.
- [x] `story-prompt.service.ts`의 `promptVariables()`에도 서른여덟 번째 기능 이전과 마찬가지로 `atmosphere_asset_metadata`/`scene_reference_asset_metadata`가 항상 빈 문자열인 휴면 placeholder가 있었다 — 이번 기능으로 처음 채웠다. 이 참에 `character_cast_metadata`도 Python `describe_character_cast`와 동일한 형식(Asset의 실제 이름·설명을 조회해 "이름/구분/이야기 역할/설명" 한국어 블록으로 렌더링)으로 맞췄다 — 기존에는 assetId를 포함한 원시 JSON을 그대로 프롬프트에 넣고 있었다. `story-asset-metadata.ts`에 `describeCharacterCast`/`describeAtmosphereAssets`/`describeSceneReferenceAssets`를 추가하고 `promptVariables()`를 비동기로 바꿔 `LocalAssetsRepository`를 통해 실제 Asset 이름·설명을 조회하도록 했다(`StoryPromptService` 생성자에 6번째 선택 인자로 주입, `story.module.ts` 배선).
- [x] Shared 계약에 `ShortProjectSceneReferenceAsset`(`assetId`/`purpose`), `GetShortProjectAssetReferencesResponse`, `UpdateShortProjectAssetReferencesRequest/Response`와 `projectAssetReferences` 라우트를 추가했다.
- [x] Backend: `project-asset-references.ts`에 순수 파싱/검증 함수(`parseShortProjectAssetReferences` — 두 배열만 허용, 각각 최대 크기, 중복 assetId 거부, 분위기·장면 참고 간 중복 assetId 거부)를 추가하고, `ProjectsService`에 `getProjectAssetReferences`/`updateProjectAssetReferences`를 추가했다. `LocalAssetsRepository`가 주입된 경우에만 분위기 Asset은 non-folder style/general_reference/background 타입인지, 장면 참고 Asset은 non-folder background/object/style/general_reference 타입인지 검증한다(서른여덟 번째 기능의 cast 검증과 동일한 하위 호환 패턴). `GET`/`PUT /projects/:projectId/settings/asset-references` 컨트롤러 라우트를 추가했다.
- [x] Frontend: `projectsApi.ts`에 `getProjectAssetReferences`/`updateProjectAssetReferences`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 `AssetReferenceEditor` 하위 컴포넌트를 추가했다 — `CastEditor`와 마찬가지로 메인 설정 폼과 독립된 저장 상태를 가지며, 분위기·장면 참고 두 목록을 하나의 PUT으로 함께 저장한다(배타성 검증이 둘을 같이 봐야 하기 때문). `listAssets`가 단일 assetType만 필터링하므로 Python의 `available_atmosphere_assets`/장면 참고 선택창처럼 태그 없이 검색한 뒤 허용된 타입 집합으로 클라이언트에서 필터링한다. 장면 참고 Asset은 검색 결과 행에 "사용 목적" 입력칸이 있고 비어 있으면 추가 버튼이 비활성화된다.
- [x] 새 테스트: Backend `project-asset-references.test.ts`(순수 함수 13개), `projects.service.test.ts`에 asset reference get/save/Asset 타입 검증/재시작 후 유지 6개 추가, `project-cast.app-module.integration.test.ts`에 실제 `NestFactory.create(AppModule)` 부팅 통합 테스트 1개 추가(존재하지 않는/배타성 위반 Asset 거부, 재시작 후 유지, 저장한 분위기·장면 참고 Asset이 실제로 Story preview의 두 placeholder에 반영되는지까지 end-to-end로 고정). Frontend `ShortProjectSettingsScreen.test.tsx`에 분위기 Asset 검색·추가·제거, 장면 참고 Asset 목적 입력·추가·제거, 로드 실패 표시를 검증하는 테스트 3개 추가.
- [x] Main 통합 검증에서 Backend 388 통과(+1 intentional skip), Frontend 528 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 다음 권장 범위는 같은 Wizard parity 작업의 마지막 조각이다: 명시적으로 고른 이전 프로젝트의 승인된 Scene 6을 Story와 Scene 1 연속성 자료로 연결하는 화면(Backend `lore_context.previous_scene_context` 경로는 이미 존재하며 `short_scene_continuity_option`으로 어떤 프로젝트가 후보인지 결정하는 Python 로직만 아직 옮기지 않았다).

## 마흔 번째 이전 기능: 단기 프로젝트 Wizard 이전 장면 연결(Scene 6 연속성)로 Wizard parity 완료

- [x] Python Wizard의 "이전 장면 연결"을 이전했다. 이 기능으로 단기 Wizard parity 작업(대표/서브 캐릭터 Cast, 전체 분위기·장면 참고 Asset, 이전 장면 연결)이 모두 완료된다. Python `short_scene_continuity_option`과 동일하게: 후보는 현재 프로젝트를 제외한 다른 단기 프로젝트 중 workflow state가 영상 승인 단계 이상(`WAITING_FOR_VIDEO_CONFIRMATION`부터 `COMPLETED`까지)이고, scene과 generated_images가 각각 6개 이상이며, Scene 6 이미지 파일이 그 프로젝트 자신의 디렉터리 안에 실제로 존재하는 경우로 제한한다. 서버가 후보 목록과 실제로 연결될 텍스트(story_context)를 항상 다시 계산한다 — 클라이언트는 오직 projectId만 보내고, 그 외 어떤 파생 텍스트도 신뢰하지 않는다(Cast·Asset Reference 기능과 같은 신뢰 경계 원칙).
- [x] `story-prompt.service.ts`의 `promptVariables()`가 기존에는 `lore_context.previous_scene_context`를 문자열 그대로 읽고 있었는데, 이는 Python 구조와 어긋난다 — Python은 `lore_context.previous_scene_link`라는 구조화된 dict를 저장하고, 실제 프롬프트 문자열은 그 안의 `story_context`에서 매번 파생시킨다(`user_selected_short_scene_link`로 opt-in 여부를 확인). `project-continuity.ts`의 `previousSceneContext()`로 이 파생 로직을 그대로 옮기고 `promptVariables()`의 직접 필드 읽기를 대체했다.
- [x] Shared 계약에 `ShortProjectContinuityOption`(`projectId`/`projectName`/`label` — 파생된 story_context나 이미지 경로는 API로 노출하지 않는다, Python UI도 후보 목록에는 label만 보여준다), `ListShortProjectContinuityOptionsResponse`, `GetShortProjectContinuityResponse`, `SetShortProjectContinuityRequest/Response`와 `projectContinuityOptions`/`projectContinuity` 라우트를 추가했다.
- [x] Backend: `project-continuity.ts`에 `listContinuityOptions`(다른 모든 프로젝트를 훑어 자격을 재계산), `resolveContinuityCandidate`(쓰기 경로 전용 — 특정 projectId 하나를 다시 검증), `toShortProjectContinuityLink`/`previousSceneContext`(저장된 링크의 tolerant 읽기), `applyContinuityCandidate`(스냅샷 쓰기)를 추가했다. `LocalProjectRepository`에 `projectDirectory(projectId)` 공개 메서드를 추가해 경로 안전성 검사(다른 프로젝트의 Scene 6 이미지 경로가 그 프로젝트 자신의 디렉터리 밖을 가리키지 않는지)에 재사용했다. `ProjectsService`에 `listProjectContinuityOptions`/`getProjectContinuity`/`updateProjectContinuity`를 추가하고, `GET /projects/:projectId/settings/continuity-options`, `GET`/`PUT /projects/:projectId/settings/continuity` 컨트롤러 라우트를 추가했다(`PUT`은 `{ projectId: string | null }` — `null`은 연결 해제).
- [x] Frontend: `projectsApi.ts`에 `listProjectContinuityOptions`/`getProjectContinuity`/`setProjectContinuity`와 타입 가드를 추가하고, `ShortProjectSettingsScreen.tsx`에 `ContinuityEditor` 하위 컴포넌트를 추가했다 — 현재 링크 상태는 마운트 시 불러오고, 후보 목록은 Python처럼 "이전 프로젝트 선택" 버튼을 눌렀을 때만 조회한다(항상 백그라운드로 미리 불러오지 않음). 연결/해제 모두 같은 PUT을 통해 저장 상태를 공유한다.
- [x] 새 테스트: Backend `project-continuity.test.ts`(순수 함수·후보 도출 로직 15개 — workflow state 미달, scene/이미지 개수 부족, 파일 없음, 경로 탈출, label 파생 우선순위 등 각 배제 조건을 실제 파일시스템으로 검증), `projects.service.test.ts`에 continuity 목록/연결/해제/거부 5개 추가, `project-cast.app-module.integration.test.ts`에 실제 `NestFactory.create(AppModule)` 부팅 통합 테스트 1개 추가(후보 목록 조회 → 연결 → Story preview의 `previous_scene_context`에 반영 확인 → 해제까지 end-to-end). Frontend `ShortProjectSettingsScreen.test.tsx`에 후보 조회·연결·해제·로드 실패 표시를 검증하는 테스트 3개 추가.
- [x] Main 통합 검증에서 Backend 408 통과(+1 intentional skip), Frontend 531 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Provider·network·FFmpeg 호출은 0건이다.
> 이것으로 단기 Wizard parity 작업이 모두 끝났다. 다음 권장 범위는 이 문서 상단 "다음 권장 작업 순서"의 나머지 항목(Runway 실제 연동을 위한 영상 워크플로 재설계, 실제 OpenAI 이미지 Reference 편집/재생성)이다.

완료 근거(그룹 커밋, 2026-08-23): 서른여덟~마흔 번째 이전 기능의 프런트엔드 화면은 `3b1df7f` 그룹 커밋으로 통합·검증했다. 해당 백엔드 라우트(`project-cast.ts`/`project-asset-references.ts`/`project-continuity.ts`와 `projects.service.ts`/`story-prompt.service.ts` 배선)는 Story Bible·archive·실제 OpenAI Story adapter와 공용 파일을 공유해 이미 `f84ba1e` 그룹 커밋에 포함되어 있었다. 이것으로 27개 이전 기능(열네~마흔 번째)이 6개의 파이프라인 단계별 그룹 커밋(`a1ba785`, `f84ba1e`, `f2f360b`, `6276564`, `399cb5b`, `3b1df7f`)으로 모두 정리·커밋되었다.

## 마흔한 번째 이전 기능: 실제 Runway 영상 생성 연결(단기·장편 동시)

- [x] "다음 권장 작업 순서" 1번 항목을 완료했다: `local-video-workflow.service.ts`(단기)와 `episode-videos.service.ts`(장편) 모두, 한 요청 안에서 6장면을 동기 순회하던 기존 구조 대신 "한 장면 제출 → 폴링 때마다 최대 한 번만 확인 → 완료 시 다음 장면 자동 제출"하는 상태 기계로 재설계했다. 사용자와 상의해 확정한 안정성 요구사항 4가지를 반영했다: (1) 백엔드 자체 타이머가 화면 polling 없이도 계속 진행시키고(재시작 시 다음 polling에서 자동 복구), (2) Runway가 명시적으로 FAILED/CANCELLED라고 답하거나 15분(`RUNWAY_TASK_TIMEOUT_SECONDS`) 타임아웃일 때만 그 장면을 실패 처리하며, 우리 쪽 확인 요청 자체가 실패한 경우(`check-error`)는 상태를 건드리지 않고 다음 기회에 재시도, (3) 위 타임아웃으로 무한 대기를 막고, (4) 같은 job에 대한 동시 advance 호출은 in-memory 잠금으로 직렬화해 이중 제출을 막는다. 실패한 장면은 다음 장면으로 건너뛰지 않고 파이프라인을 그 자리에서 멈추며, 기존 재생성(regenerate) 흐름을 그대로 재사용해 사용자가 명시적으로 재시도할 수 있다.
- [x] 이 상태 기계의 핵심 로직(`apps/backend/src/videos/runway-workflow-support.ts`)은 persistence에 전혀 의존하지 않는 순수 함수로 만들어 단기·장편 양쪽 서비스가 공유한다. Runway 연결 여부는 기존 OpenAI Story/Image adapter와 동일한 패턴(`ProviderSettingsService.rawCredentialIfConnected("runway")` + budget 존재 여부)으로 판단하며, 미연결 시 기존 local fake 경로가 한 글자도 바뀌지 않고 그대로 실행된다.
- [x] `RunwayBudget`(`apps/backend/src/providers/runway-budget.ts`)을 `OpenAiBudget`과 같은 형태로 신설해 `learning_data/runway_budget_usage.json`에 별도 기록한다(OpenAI 예산과 절대 합산하지 않음). 단기·장편 영상 생성이 이 예산 하나를 공유한다(OpenAI budget이 Story/Image에 공통인 것과 동일한 선례). 예산 초과는 제출 전에 차단되며, 초과 시 해당 장면을 즉시 `failed`로 표시해 사용자에게 원인을 보여준다(예외를 삼키지 않음).
- [x] 타입은 이번에 일부러 느슨하게 풀지 않았다: `VideoPromptPreview`/`LongEpisodeVideoPreview`의 `model`/`ratio`/`durationSeconds` 리터럴 타입을 그대로 유지해 컴파일러가 계속 오타·잘못된 값을 잡아주게 했다. 향후 Runway 외 다른 영상 Provider를 실제로 붙일 때는 이 타입을 discriminated union으로 확장하기로 했다(무제한 `string`으로 풀지 않음).
- [x] `episode-video-merge.service.ts`의 자체 `execution_mode` 검증에 `"runway"`를 허용하도록 넓혔다 — 안 하면 실제로 생성된 장편 영상은 병합 단계에서 막힌다. 병합 로직 자체(이미 다운로드된 mp4 파일을 합치는 것)는 변경하지 않았다.
- [x] Frontend `VideoWorkflowScreen.tsx`/`LongEpisodeVideoWorkflowScreen.tsx`에 `status === "failed"`일 때만 보이는 실패 장면 재시도 블록을 추가했다 — 기존 재생성 확인 흐름과 API 함수를 그대로 재사용하고, Runway의 원문 실패 메시지는 노출하지 않는다.
- [x] 기존에 파일 내용을 정적으로 훑어 "openai/runway/fetch가 전혀 없어야 한다"고 검증하던 테스트 2개(`episode-videos.service.ts`, `episode-video-merge.service.ts`)를 갱신했다 — 전자는 미연결 시 fetch 0회를 직접 검증하는 동작 테스트로 교체했고(파일이 이제 의도적으로 Runway를 참조하므로), 후자는 "runway" 문자열 자체가 아니라 실제 provider 도메인/adapter import만 금지하도록 정규식을 좁혔다.
- [x] 신규 테스트: `runway-budget.test.ts`, `runway-workflow-support.test.ts`(제출/throttle/still-running/성공/실패/check-error/timeout/예산초과 전부 mocked fetch로 검증), `local-video-workflow.runway.test.ts`(전체 흐름, 실패 후 재생성, 화면 polling 없이도 백엔드 타이머만으로 진행, 동시 호출 이중 제출 방지, 크래시 후 새 인스턴스로 재개), `local-video-workflow.no-provider-calls.test.ts`, `episode-videos.runway.test.ts`, 두 프런트 화면의 실패 장면 재시도 테스트. 기존 local fake 테스트는 전부 한 글자도 안 바뀐 채 그대로 통과한다(신규 코드는 `providerSettings`/`budget` 미주입 시 항상 기존 분기로 빠짐).
- [x] Main 통합 검증에서 Backend 432 통과(+1 intentional skip), Frontend 533 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 Runway·OpenAI·network·FFmpeg 호출은 0건이다.
> 다음 범위는 "다음 권장 작업 순서" 2번(실제 OpenAI 이미지 Reference 편집·재생성)과 3번(실제 FFmpeg 환경 검증), 그리고 4번(Electron 통합·Windows 패키징)이다.

## 마흔두 번째 이전 기능: 실제 OpenAI 이미지 Reference 편집·재생성

- [x] "다음 권장 작업 순서" 2번 항목을 완료했다: Python `OpenAIImageAdapter.generate_for_size`의 Reference 경로(`client.images.edit(model, image=files, prompt, size, quality, output_format)`)를 참고해 `openai-image-adapter.ts`에 `callOpenAiImageEditApi()`를 추가했다 — SDK 없이 순수 `fetch` + `FormData`로 `multipart/form-data` 요청을 만들고, Reference 이미지마다 `image[]` part 하나씩 붙인다. 기존 `callOpenAiImageApi()`(Reference 없는 경로)와 동일한 오류 분류·재시도 패턴을 공유한다.
- [x] 신규 공용 헬퍼 `image-reference-selection.ts`의 `collectReferenceImages()`가 한 장면의 실제 Reference 이미지 바이트를 모은다: 그 장면 범위(`scopeIncludes`)에 포함되는 confirmed·enabled Asset Mapping 전부(버전 정책에 따라 snapshot/pinned_version/follow_latest 파일을 실제로 해석)와, Scene 1에 한해서만 마흔 번째 기능에서 저장하기 시작했던 `lore_context.previous_scene_link.image_path`(연결된 이전 프로젝트의 승인된 Scene 6 이미지)를 추가한다 — 지금까지 아무도 읽지 않던 이 값을 처음으로 실제 소비했다. Python의 `MAX_REFERENCE_IMAGES`(16장) 한도를 그대로 지킨다. 클라이언트가 보낸 어떤 경로도 신뢰하지 않고, 전부 이미 검증된 저장 데이터(Asset Library 버전 해석 또는 이미 안전성 검사를 거친 continuity 링크)에서만 파일을 연다.
- [x] `local-image-generation.service.ts`(최초 6장면 생성)와 `image-review.service.ts`(장면 재생성)에 이 선택 로직을 동일하게 연결했다. 두 서비스 모두, 해당 장면에 Reference가 하나라도 있으면 `images.edit`(Reference 있음)을 쓰고 없으면 기존 `images.generate`를 쓰며 — Python의 "Reference 있으면 edit, 없으면 generate" 분기를 그대로 재현했다. 실행 기록의 `adapter` 필드는 Reference 사용 시 `"gpt-image-2:edit"`, 아닐 때는 기존과 동일한 `"gpt-image-2"`로 구분해 저장한다.
- [x] `image-review.service.ts`는 기존에 재생성을 100% local fake로만 처리했다 — 이번에 `ProviderSettingsService`/`OpenAiBudget`(둘 다 선택적 trailing 생성자 인자, 기존 테스트 생성자 호출과 하위 호환)을 주입받아 다른 실제 Provider 연동과 동일한 원칙을 적용했다: 실제 요청이 예산 초과나 Provider 오류로 실패하면 기존 이미지 파일을 절대 archive하거나 덮어쓰지 않고 그대로 둔다(바이트를 먼저 확보한 뒤에만 파일을 건드림). 새 오류 코드 `IMAGE_REVIEW_BUDGET_EXCEEDED`/`IMAGE_REVIEW_PROVIDER_ERROR`를 추가하고, Frontend `imageReviewApi.ts`에 고정된 한국어 안전 메시지를 매핑했다(원문 노출 안 함, 기존 `IMAGE_BUDGET_EXCEEDED`/`IMAGE_PROVIDER_ERROR` 패턴과 동일).
- [x] `images.module.ts`에서 `ImageReviewService`도 `LocalProjectAssetMappingsRepository`/`ProviderSettingsService`/`OpenAiBudget`을 주입받도록 배선을 확장했다(이전에는 두 서비스 중 이미지 생성 쪽만 실제 Provider를 알고 있었다).
- [x] 신규 테스트: `openai-image-adapter.test.ts`에 `callOpenAiImageEditApi` 6개(요청 shape·multipart part 개수·Reference 없음 거부·모델override·오류분류·재시도), `local-image-generation.service.test.ts`에 confirmed mapping의 Reference가 6장면 모두에 전송되는지·Scene 1에만 continuity 이미지가 추가로 붙는지(2장 vs 1장)·Reference 없을 때 여전히 `images.generate`로 폴백하는지 3개, `image-review.service.test.ts`에 Reference 기반 재생성·미연결 시 fetch 0회·예산초과 시 기존 이미지 보존·Provider 오류 시 기존 이미지 보존과 실패 예산 기록 4개. 기존 provider-free/로컬 fake 테스트는 전부 한 글자도 안 바뀐 채 그대로 통과한다.
- [x] Main 통합 검증에서 Backend 445 통과(+1 intentional skip), Frontend 533 통과, Shared 25 통과, root typecheck/test/build 및 `git diff --check`를 통과했다. 실제 OpenAI·network·FFmpeg 호출은 0건이다.
> 다음 범위는 "다음 권장 작업 순서" 3번(실제 FFmpeg 환경 검증)과 4번(Electron 통합·Windows 패키징)이다.

## 마흔세 번째 이전 기능: 실제 FFmpeg 환경 검증

- [x] "다음 권장 작업 순서" 3번 항목을 완료했다: `ffmpeg-merge.service.ts`는 지금까지 mock `MediaCommandRunner`로만 구조를 검증했고, 이 머신에 FFmpeg가 설치돼 있는지·정확히 이 명령줄 조합(`ffprobe -show_streams -show_format -of json`, `-f lavfi -i anullsrc` 무음 트랙 추가, `scale/pad/fps=30/format=yuv420p` 필터, `-f concat -safe 0` 무손실 concat)이 실제 바이너리에서도 그대로 동작하는지는 검증된 적이 없었다. `winget install --id Gyan.FFmpeg`로 FFmpeg 9.0(full build, libx264/libx265/aac 포함)을 설치했다.
- [x] 합성 테스트 클립 6개(`ffmpeg -f lavfi -i testsrc ... -f lavfi -i sine ...`, 각 1초)를 만들어 서비스 코드와 동일한 인자 배열을 실제 바이너리로 수동 재현했다: (1) `probe()`와 동일한 `ffprobe` 호출 → JSON에 `codec_type: "video"` 스트림과 양수 `duration`이 정상적으로 나옴을 확인, (2) `merge()`의 정규화 단계와 동일한 `ffmpeg` 호출 6회 → 6개 모두 목표 해상도(세로 1080×1920)로 정규화되고 무음 오디오 트랙이 정상적으로 붙음을 확인, (3) 동일한 이스케이프 규칙(`'` → `''`)으로 `concat.txt`를 만들고 `-f concat -safe 0 -c copy`로 합친 뒤 서비스와 동일하게 크기·이름 검증 → 6초 길이의 유효한 최종 MP4가 만들어짐을 확인. 세 단계 모두 서비스 코드가 성공으로 판단하는 조건(`hasVideo && duration > 0`, `stat.size > 0`)을 실제로 만족했다.
- [x] 이 검증은 저장소 원칙("테스트에서는 절대 유료 요청이나 실제 바이너리 호출을 하지 않는다")에 따라 자동화 테스트로 추가하지 않았다 — 스크래치 디렉터리에서 수동으로 한 번 실행하고 결과만 여기에 기록하는 일회성 환경 검증이다. 기존 mock 기반 단위 테스트는 변경하지 않았다.
- [x] 환경 관찰: `winget install`은 시스템 PATH를 갱신하지만, 이미 실행 중인 셸 프로세스(그리고 그 프로세스가 새로 띄우는 자식 프로세스)는 자신이 시작될 때 읽어온 PATH를 그대로 들고 있어 재시작 전까지 새 경로를 보지 못한다 — Windows 환경변수 상속 방식 때문이며 이 저장소 코드의 결함이 아니다. 실제 Nest 백엔드 프로세스가 새 터미널/IDE 세션에서 새로 시작되면(설치 이후 아무 때나) `spawn("ffmpeg", ...)`/`spawn("ffprobe", ...)`가 문제없이 PATH에서 해석된다. 참고용으로 확인한 절대 경로: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\`.
> 다음 범위는 "다음 권장 작업 순서" 4번(Electron 통합·Windows 패키징)이다.

## 마흔네 번째 이전 기능: Electron 통합·Windows 패키징

- [x] "다음 권장 작업 순서" 4번 항목을 완료했다. 기존 `apps/desktop/src/main.ts`는 격리된 `BrowserWindow`에서 frontend 정적 파일을 `loadFile`로 열기만 했고 Backend를 전혀 실행하지 않았다 — Backend가 없으면 frontend의 상대 경로 fetch(`/projects` 등)가 `file://` 아래에서 전부 깨지고, 실제로 아무 기능도 동작하지 않는 빈 껍데기였다. 이번에 Backend 생명주기, frontend와 동일 origin 서빙, 프로젝트 폴더 열기, Windows 패키징 네 가지를 모두 실제로 연결하고 실제 패키징된 실행 파일로 검증했다.
- [x] **Backend 동일 origin 서빙**: `apps/backend/src/static-frontend.ts`의 `serveFrontend(app, directory)`가 `FRONTEND_STATIC_DIR` 환경변수가 설정된 경우에만 Nest의 Express 인스턴스에 `express.static(directory)`를 등록한다 — dev 환경(Vite dev server + 프록시)은 전혀 건드리지 않고, Electron이 Backend를 직접 띄울 때만 활성화된다. Nest 라우팅보다 먼저 등록해도 정적 파일과 매칭되지 않는 경로는 그대로 기존 API 컨트롤러로 통과한다는 것을 `static-frontend.app-module.integration.test.ts`(실제 `AppModule` + `/`, `/health`, `/projects` 동시 검증)로 확인했다.
- [x] **Backend 생명주기**: `apps/desktop/src/backend-process.ts`의 `BackendProcessManager`가 Electron `utilityProcess.fork`로 Backend를 띄우고, `/health`를 폴링해 준비 완료를 확인하며(단순 프로세스 spawn만으로는 완전히 부팅됐다고 보지 않음), 예상치 못하게 종료되면 최대 3회까지만 자동 재시작하고(무한 재시도 금지 원칙 적용) 그 이상은 포기해 사용자에게 오류를 보여준다. 앱 종료 시 `before-quit`에서 Backend 프로세스를 확실히 정리한다. fork·health-check·대기 함수를 전부 의존성 주입으로 분리해 실제 Electron/네트워크 없이 `node --test`로 순수 로직만 검증한다(`backend-process.test.ts`, 8개 케이스: 준비 완료 감지, 타임아웃, 바운드된 재시작, 의도적 stop 후 재시작 금지).
- [x] **프로젝트 폴더 열기(file dialog/path open)**: Python `open_local_path()`가 여러 화면에서 결과 폴더를 탐색기로 열던 것과 동일한 편의 기능을 CommonJS preload(`apps/desktop/src/preload.cjs`, contextBridge)로 노출했다 — Electron의 context-isolated preload 로더는 CommonJS만 지원하고 이 패키지의 `"type": "module"` 설정과 무관하게 동작해야 해서, 다른 소스와 달리 TypeScript로 컴파일하지 않고 순수 `.cjs`로 작성해 빌드 시 그대로 복사한다. `window.electronAPI.openProjectPath(projectId, relativePath?)` → `ipcMain` 핸들러가 `apps/desktop/src/project-path.ts`의 `resolveProjectPath()`로 프로젝트 ID 허용 문자(`apps/backend/src/projects/project-id.ts`의 `\p{L}\p{N}_-` 허용목록과 동일)와 경로 탈출(`..`) 여부를 검증한 뒤에만 `shell.openPath()`를 호출한다 — 렌더러가 손상되더라도 프로젝트 자신의 폴더 밖은 절대 열 수 없다(`project-path.test.ts` 4개 케이스로 탈출 시도 차단 확인).
- [x] **Windows 패키징**: `apps/backend`에 `npm run package` 스크립트를 추가해 `esbuild`로 `dist/main.js`와 그 의존성(`@nestjs/*`, `express`, `rxjs`, `reflect-metadata`, workspace `@ai-animation-studio/shared` 전부 포함)을 `node_modules` 없이 실행 가능한 단일 파일 `dist-bundle/main.cjs`(약 3.2MB)로 번들링한다. NestJS가 선택적으로 동적 `require`하는 `class-transformer`/`class-validator`/`@nestjs/microservices`/`@nestjs/websockets`(전부 이 프로젝트에서 사용하지 않음)는 esbuild `--external`로 제외해 번들 실패 없이 넘어가도록 했다. `apps/desktop`은 `electron-builder`(devDependency, `electronVersion`을 설치된 Electron 버전에 고정)로 `extraResources`에 이 Backend 번들과 Frontend `dist`를 그대로 넣어 패키징한다 — workspace 심볼릭 링크나 hoisted `node_modules`를 그대로 복사하려던 시도는 심볼릭 링크가 최종 사용자 PC에서 깨질 위험이 있어 포기하고, 단일 파일 번들로 그 문제 자체를 없앴다. `apps/desktop/src/main.ts`는 `app.isPackaged` 여부로 Backend 번들 경로·frontend 정적 경로·데이터 루트(`app.getPath("userData")/learning_data`, 패키징 전에는 저장소 `learning_data`)를 분기한다.
- [x] **실제 패키징된 실행 파일로 검증**: `electron-builder --dir`로 실제 `release/win-unpacked/AI Animation Studio.exe`를 빌드하고(리소스 폴더에 `backend/main.cjs`, `frontend/index.html` 확인), Playwright의 `_electron` 런처로 이 실행 파일을 그대로 실행해 확인했다 — Backend가 패키지 리소스에서 기동해 `/health`를 통과하고, frontend가 같은 origin(`http://127.0.0.1:4317/`)에서 정상 로드되며, `window.electronAPI.openProjectPath`가 존재하고 실제 프로젝트 폴더를 탐색기로 여는 것까지 확인했다. NSIS 설치 프로그램 자체(`package:installer` 스크립트, `electron-winstaller`의 7z 관련 postinstall 스크립트가 이 저장소의 allow-scripts 정책으로 기본 차단됨)는 이번 세션에서 실제로 빌드·설치까지는 실행하지 않았다 — `win-unpacked` 내용이 NSIS가 그대로 감싸는 것과 동일하므로 핵심 동작은 검증되었지만, 설치 프로그램 실행 자체(시스템 전역 설치, 바로가기 생성)는 사용자 동의 없이 자동으로 수행하지 않는 것이 안전하다고 판단했다.
- [x] 신규 테스트: `static-frontend.test.ts`(2), `static-frontend.app-module.integration.test.ts`(1), `backend-process.test.ts`(8, node:test), `project-path.test.ts`(4, node:test). 기존 Backend/Frontend/Shared 테스트는 전부 한 글자도 안 바뀐 채 그대로 통과한다.
- [x] Main 통합 검증에서 Backend 448 통과(+1 intentional skip), Desktop 8 통과(node:test), Frontend 533 통과, Shared 25 통과, root typecheck/build 전부 통과, `git diff --check` 통과. 실제 OpenAI·Runway·network·유료 호출은 0건이다.
- [ ] 남은 범위: NSIS 설치 프로그램 실제 빌드·설치 검증(7z postinstall 스크립트 승인 필요), 앱 아이콘 지정(현재 Electron 기본 아이콘), 코드 서명. 이것으로 "다음 권장 작업 순서" 1~4번 중 핵심 동작은 모두 검증됐지만, 이 세 조각 자체는 아직 실행하지 않았다 — 사용자와 합의한 배포 순서(자체 테스트 → NSIS 패키징 → 서버 배포)대로, 패키징 착수는 사용자 요청을 기다린다.

## 마흔다섯 번째 이전 기능: 프로젝트 설정 저장 에러 표시 위치 수정 + 대표 캐릭터 이미지 선택

실사용 중 "설정 저장 버튼이 안 먹힌다"는 리포트를 받아 Main이 먼저 백엔드 프로세스·API를 직접 재현 진단했다(`npm run dev:backend`의 실제 기본 포트는 3000이며 4317은 `npm run dev:desktop`(Electron) 전용이라는 혼동이 있었음 — 코드 결함 아님). `curl`로 `PATCH /projects/:id/settings`가 정상 응답하는 것까지 확인한 뒤 진짜 원인을 특정했다: 에러 메시지(`role="alert"`)가 폼 최상단에만 떠서, 필드가 많아 스크롤해야 보이는 "설정 저장" 버튼 근처에서는 실패해도 아무 피드백이 안 보였다.

- [x] `ShortProjectSettingsScreen.tsx`, `LongProjectSettingsScreen.tsx`: 초기 로딩 실패(폼 자체가 없는 경우)는 기존처럼 상단에, 폼이 떠 있는 상태의 저장 실패는 저장 버튼 바로 위에도 표시하도록 `state.error && !state.settings`(상단)/`state.error`(폼 내부, 버튼 위)로 조건을 분리했다 — 폼이 있을 때는 상단이 렌더링되지 않으므로 `role="alert"` 중복 없음.
- [x] `ShortProjectSettingsScreen.tsx`: "대표 캐릭터" 입력 아래에 `이미지에서 캐릭터 선택` 버튼을 추가해 Asset Library의 character 타입 에셋을 썸네일 그리드로 보여주고 클릭 시 이름을 채운다. 기존 자유 텍스트 입력은 유지(하위 호환), 저장 스키마·백엔드 변경 없음.
- [x] 신규 테스트 2개(`ShortProjectSettingsScreen.test.tsx`). Frontend 548 통과, Backend 460 통과(+1 skip, 무관한 실시간 타이머 테스트 1건 최초 실행 시 플레이키했으나 단독 재실행 시 통과 확인), Desktop 8, Shared 25, root typecheck/build 통과.

## 마흔여섯 번째 이전 기능: Asset Library 버튼 라벨/구조 개선 + 개발 서버 포트 문서화

- [x] `AssetLibraryScreen.tsx`: "파일 상태 점검"과 "레거시 참고자료 가져오기"를 `관리 도구` 접이식 섹션 하나로 묶고 기본은 접어둠(검색 후 목록이 바로 보이도록). 레거시 마이그레이션 버튼을 `가져오기 실행` → `일괄 이전 실행`으로 개명(새 에셋 등록 폼의 `가져오기`와 혼동 방지), 새 에셋 등록 폼 제목을 `이미지 가져오기` → `새 에셋 등록`으로 변경. outline/danger/작은 버튼에 배경 채움을 줘서 카드 컨테이너와 구분.
- [x] `AssetLibraryScreen.test.tsx`: 버튼 문구 변경분 반영 + `asset-maintenance-toggle` 클릭 단계 추가. Frontend 548 통과(해당 파일 39개), root typecheck/build 통과.
- [x] `docs/03_TEAM_WORKFLOW.md`에 "로컬 개발 서버 포트" 표 추가(`dev:backend`=3000, `dev:desktop` 내부 fork=4317) — 위 마흔다섯 번째 항목 진단에서 드러난 혼동을 재발 방지하기 위한 문서 전용 변경.

## 마흔일곱 번째 이전 기능: 프로젝트 설정 화면 실시간 대본 프롬프트 미리보기

기존 "대본 프롬프트 미리보기/승인"(저장된 프로젝트 기준, `StoryPromptService.preview`/`original()`)의 렌더링 로직을 그대로 재사용해, 저장하지 않은 입력값으로도 프롬프트를 계산하는 새 경로를 추가했다 — 저장 스키마 변경 없음, 기존 승인(approve) 흐름 변경 없음.

- [x] `packages/shared/src/api.ts`: `CreateStoryPromptDraftPreviewRequest/Response` 타입, `API_ROUTES.storyPromptDraftPreview(projectId)` 추가(`POST /projects/:projectId/story/draft-preview`).
- [x] `apps/backend/src/story/story-prompt.service.ts`: `draftPreview(projectId, request)`가 저장된 프로젝트를 불러온 뒤 기존 `parseShortProjectSettings`(검증)와 `applyShortProjectSettings`(불변 적용, `{...stored, ...}`로 새 객체 반환)로 메모리상에서만 설정을 반영하고 기존 `original()` 렌더 로직으로 프롬프트를 계산한다. 디스크에 저장하지 않는다 — 테스트로 저장 프로젝트가 그대로 남는 것과 잘못된 입력이 거부되는 것을 확인.
- [x] `apps/frontend/src/components/ShortProjectSettingsScreen.tsx`: 설정 폼 옆(데스크톱 2컬럼, 좁은 화면은 아래로)에 미리보기 패널 추가. 기본은 닫힘(열기 전에는 새 API를 호출하지 않아 기존 13개 테스트의 fetch 시퀀스에 영향 없음), 열면 입력 후 0.5초 디바운스로 자동 갱신. 프로젝트 이름/주제가 비어 있으면 에러 없이 "채우면 표시됩니다" 안내만 노출.
- [x] Main 리뷰에서 발견해 수정: 최초 구현은 실제 API 에러(네트워크 단절, 서버 오류 등)도 같은 "채우면 표시됩니다" 안내로 뭉뚱그려 실제 에러가 안 보이는 결함이 있었다 — 오늘 세션에서 진단·수정한 "저장 에러가 안 보이는" 문제(마흔다섯 번째 항목)와 같은 패턴이 새 기능에 재도입된 것. 로딩/에러/빈 상태/성공 4가지를 명확히 분리하도록 렌더링 조건을 수정하고, 실제 에러 시 `role="alert"`로 안내 문구가 아닌 진짜 에러 메시지가 뜨는 것을 확인하는 테스트를 추가했다(`story-prompt-draft-preview-error`).
- [x] 신규 테스트: `project-contract.test.ts` 1줄, `story-prompt.service.test.ts` 2개, `ShortProjectSettingsScreen.test.tsx` 2개(리뷰 중 추가한 에러 케이스 포함). Backend 462 통과(+1 skip), Frontend 550 통과, Shared 25 통과, Desktop 8 통과, root typecheck/build 통과. 유료 Provider 호출 없음(`draftPreview`는 항상 로컬 템플릿 렌더링만 수행).

## 공통 완료 조건

- Python 동작·데이터 규칙, shared 계약, Frontend 흐름, Backend 로직·저장이 모두 구현되어야 한다.
- 오류·경계 테스트와 유료 Provider를 호출하지 않는 통합 테스트가 통과해야 한다.
- main에서 관련 typecheck, test, build를 통과한 뒤에만 체크리스트를 완료로 바꾼다.
- UI 또는 Backend 한쪽만 구현된 기능은 완료로 표시하지 않는다.

## 마흔여덟 번째 이전 기능: 장면 수(scene count)를 6 고정에서 가변으로 (1단계: 기반 작업)

지금까지 "장면은 항상 6개, 클립은 항상 5초"라는 전제가 `packages/shared/src/domain.ts`의 `SceneNumber` 타입, `apps/backend/src/videos/local-video-submission.service.ts`/`local-video-workflow.service.ts`의 `SCENES=[1..6]` 하드코딩, 프론트 3개 화면(`ImageGenerationScreen`, `VideoWorkflowScreen`, `MappingReviewScreen`)의 `assertExactlySixScenes` 사용 등 최소 20개 파일에 걸쳐 박혀 있음을 확인했다. 사용자가 향후 Runway 외 다른 영상 AI로 교체할 계획이 있어, "장면 수" 자체보다 "공급자별 지원 클립 길이"를 축으로 설계하기로 했다 — 이 항목은 그 초석이 되는 1단계(설정/타입 계층)만 다룬다. 영상 생성 상태 머신(2단계), 공급자별 클립 길이 선택 UI(3단계), 화면별 6개 고정 그리드(4단계)는 후속 배치로 이어질 예정이며, 이 배치 하나로는 사용자가 실제로 6이 아닌 장면 수를 만들어낼 방법이 없다(설정 화면에 아직 장면 수 입력 UI가 없음) — 그래서 위험 없이 먼저 착수했다.

- [x] `packages/shared/src/domain.ts`: `MIN_SCENE_COUNT=2`, `MAX_SCENE_COUNT=12` 상수 추가(순수 추가, 기존 `SceneNumber`/`assertExactlySixScenes`는 이번 배치에서 손대지 않음 — 그 타입을 쓰는 20개 파일과 한 배치로 묶이지 않으면 typecheck가 깨지므로 2/4단계에서 함께 처리 예정).
- [x] `packages/shared/src/api.ts`: 숏 프로젝트 전용 타입 5곳(`ShortProjectSettings.sceneCount`, `StoryPromptPreview.sceneCount`, `VideoPromptPreview.durationSeconds`, `VideoGenerationPreviewResponse.sceneCount`/`durationSecondsPerScene`)을 리터럴(`6`/`5`)에서 `number`로 완화. 리터럴을 넓히는 변경이라 기존 호출부는 그대로 컴파일된다(하위 호환). Long Episode 쪽 동일 패턴(`GetLongEpisodeVideoPreviewResponse` 등)은 이번 항목과 무관한 별도 워크플로우라 의도적으로 손대지 않음.
- [x] `apps/backend/src/projects/project-settings.ts`: `sceneCount !== 6` 하드코딩을 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 범위 검증으로 교체. `toShortProjectSettings`/`applyShortProjectSettings`가 실제 저장된 `lore_context.scene_count`를 읽고 쓰도록 변경(레거시 프로젝트는 6으로 폴백).
- [x] `apps/backend/src/story/story-prompt.service.ts`: 대본 프롬프트 템플릿 변수 `scene_count`와 `preview()` 응답의 `sceneCount`가 하드코딩된 `"6"`/`6` 대신 프로젝트에 실제 저장된 값을 반영하도록 수정.
- [x] 신규/수정 테스트: `project-settings.test.ts`(범위 검증 테스트 추가·6 고정 테스트 교체), `story-prompt.service.test.ts`(장면 수 4인 프로젝트에서 미리보기가 4를 반영하는지 확인하는 테스트 추가).
- [x] Main 검증: 리터럴→`number` 완화가 다른 곳의 좁은 타입 가정을 깨뜨리는지가 이 배치의 유일한 실질적 리스크였는데, root typecheck 전체(Backend/Desktop/Frontend/Shared)가 컴파일 에러 없이 통과해 그런 곳이 없음을 확인했다. Backend 464 통과(+1 skip, 신규 2건 포함), Frontend 550, Shared 25, Desktop 8(node:test) 통과, root build 통과. 유료 Provider 호출 없음. 남은 2~4단계(영상 생성 상태 머신, 공급자별 클립 길이 선택 UI, 화면별 6 고정 그리드)는 계획대로 후속 배치에서 진행.

## 마흔아홉 번째 이전 기능: 장면 수(scene count)를 6 고정에서 가변으로 (2단계: Backend 파이프라인 전체)

마흔여덟 번째 항목(1단계, 설정/타입 계층)에 이어, 실제 콘텐츠 생성 파이프라인 전체 — 대본 생성 → Asset Mapping 검토 → 이미지 생성 → 이미지 검토 → 영상 미리보기 → 영상 제출 → 영상 워크플로우(재생성/승인) → 최종 영상 병합 — 을 6 고정에서 프로젝트별 실제 장면 수(2~12, `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT`)로 전환했다. 최초 범위 지시("영상 서비스 파일 2개")보다 훨씬 넓어졌다는 점을 조사 중간에 먼저 보고했고("6 고정"이 최소 9개 계층에 독립적으로 박혀 있음을 코드 직접 확인으로 파악), 사용자가 전체 확장 범위로 지금 바로 진행할 것을 명시적으로 승인해(무인 상태로 계속 진행) 아래 전체를 완료했다.

- [x] `packages/shared/src/domain.ts`: `SceneNumber`를 `1|2|3|4|5|6` 리터럴 유니온에서 `number`로 넓혔다(`SCENE_NUMBERS=[1..6]` 런타임 배열 자체는 그대로 유지 — 아직 6 고정을 가정하는 프론트 3개 화면이 이 배열을 순회하므로, 그 화면들을 손보는 4단계 전까지는 배열을 넓히면 안 된다). 어디에도 이 리터럴 유니온에 대한 완전성 패턴 매칭이 없어 타입만 넓히는 것은 하위 호환이다. 신규 유틸 `sceneNumbersFor(sceneCount)`(1..count 순차 배열) 추가.
- [x] 공통 패턴: 각 서비스 파일에 `scenesFor(project) = sceneNumbersFor(toShortProjectSettings(project).sceneCount)` 형태의 로컬 헬퍼를 두어(파일마다 기존 로컬 헬퍼 관례를 따르기 위해 의도적으로 각자 둠, 공유 유틸로 묶지 않음), 하드코딩된 `SCENES=[1..6]`/`MAX_PROVIDER_CALLS`/`!== 6` 비교를 모두 대체했다. 요청 바디에서 들어온 원시 장면 번호는 항상 "그 엔티티(작업/프로젝트)의 실제 장면 목록에 포함되는가"까지 검증하도록 통일했다 — 전역 `1~MAX_SCENE_COUNT` 범위 검사만으로는, 예를 들어 6장면 프로젝트에 "7번 장면 승인" 요청이 통과해 유령 레코드가 생기는 데이터 손상을 막지 못하기 때문이다(아래 자가 발견 버그 참고).
  - `apps/backend/src/story/openai-story-adapter.ts`, `story-generation.service.ts`: OpenAI 응답 JSON 스키마의 `minItems`/`maxItems`, 로컬 대본 생성기의 장면 배열 길이·검증(`validateStory`)이 모두 프로젝트의 실제 장면 수를 따른다(기본값 6인 선택적 매개변수로, 기존 15개 이상 호출부는 수정 없이 그대로 컴파일·동작).
  - `apps/backend/src/mappings/mappings.service.ts`, `mapping-storage.ts`: Asset Mapping 범위 검증(`scopeFromRequest`)이 프로젝트를 먼저 조회해 실제 장면 수를 받고, `mappingsScenes()`(정확히 N개 순서대로)·`approveReview()`의 커버리지 검사·`beginReview()`의 `reviewedScenes` 검증을 모두 동적으로 바꿨다. 원본 저장 파싱의 전역 장면 번호 범위 검사(`mapping-storage.ts`의 `scene()`)도 `MAX_SCENE_COUNT`로 넓혔다.
  - `apps/backend/src/images/local-image-generation.service.ts`, `image-review.service.ts`: 이미지 생성·검토의 장면 목록·완료 검사·`approve()`/`regenerate()`의 장면 소속 검증을 동적으로 바꿨다.
  - `apps/backend/src/videos/video-preview.service.ts`, `local-video-submission.service.ts`, `local-video-workflow.service.ts`, `videos.controller.ts`, `video-merge.service.ts`: 영상 미리보기 대상 장면 수, 제출 시 최대 Provider 호출 수, 워크플로우의 장면 번호 파싱 범위·진행률·재생성·승인 로직, 그리고 컨트롤러의 "전체 재생성" 엔드포인트(기존에 `[1,2,3,4,5,6]`을 그대로 하드코딩해 6장면이 아닌 작업에서는 배열 범위를 벗어난 인덱스에 쓰기가 발생할 수 있었던 잠재 결함 — 테스트 커버리지가 없어 발견되지 않고 있었음)와 최종 병합 서비스(승인된 리뷰 개수·클립 목록)까지 전부 프로젝트/작업의 실제 장면 수를 따르도록 고쳤다. 이를 위해 `LocalVideoWorkflowService`에 `jobSceneNumbers(projectId, jobId)` 공개 메서드를 추가했다.
- [x] **자가 발견 버그**: `local-video-workflow.service.ts`의 장면 번호 파싱을 전역 `1~MAX_SCENE_COUNT` 범위 검사로 일반화하면서, `approveReview()`가 "이 작업에 실제로 존재하는 장면인가"는 더 이상 확인하지 않게 되어 6장면 작업에 "7번 장면 승인"이 통과해 유령 리뷰 레코드가 쌓이는 회귀가 생길 뻔했다 — 수정 중 직접 발견해 작업의 실제 장면 목록 확인 가드를 추가했고, 같은 패턴을 `image-review.service.ts`의 `approve()`/`regenerate()`에도 문제가 발생하기 전에 선제적으로 적용했다.
- [x] **가장 중요한 자가 발견 버그**: `apps/backend/src/projects/project-storage.schema.ts`의 `project.json` 파서가 `image_prompts`/`motion_prompts`/`generated_images`/`generated_video_paths`/`capcut_clip_paths` 5개 배열 필드 전부에 대해 "6개 초과 시 거부"라는 하드코딩 상한을 갖고 있었다 — 이걸 못 고쳤다면, 위 파이프라인 수정이 전부 맞아도 실제로 7개 이상 장면을 가진 프로젝트를 저장했다가 다시 불러오는 순간(`projects.findById()`는 모든 서비스가 호출하는 공통 경로) 예외가 터져 이번 배치 전체가 무의미해질 뻔했다. `MAX_SCENE_COUNT`(12) 기준으로 교체했다.
- [x] 신규/수정 테스트: `project-storage.schema.test.ts`(6 고정 거부 테스트를 "12개는 통과, 13개는 거부"로 교체 — 정확한 텍스트를 검사하는 테스트가 없어 다른 파일들의 에러 메시지는 그대로 동적으로 바꿀 수 있었음). 그 외 손댄 파일들의 기존 테스트는 전부 `createStoredProject` 기본값(장면 수 미설정 → 6으로 폴백)을 쓰고 있어 수정 없이 그대로 통과할 것으로 예상되며(로컬에서 코드 직접 대조로 확인, 이 세션에는 `npm test` 실행 환경이 없어 CLI 세션의 검증이 필요), 신규 6→N 장면 종단 테스트는 이번 배치에 추가하지 않았다(다음 단계에서 UI가 실제로 6이 아닌 값을 만들 수 있게 된 뒤 종단 테스트를 추가하는 편이 더 의미 있다고 판단).
- [x] **CLI 검증 완료**: `npm run typecheck && npm run test && npm run build`를 root에서 실행. 예상대로 `SceneNumber`를 `number`로 넓힌 것이 typecheck에서 실제로 걸렸다 — 아래 3건을 Main이 직접 찾아 수정한 뒤 전부 통과했다.
  - `packages/shared/src/domain.ts`의 `isSceneNumber()`가 `SCENE_NUMBERS.includes(value as SceneNumber)`를 그대로 쓰고 있어 컴파일 에러(`.includes`는 여전히 리터럴 유니온 `1|2|3|4|5|6`을 기대). 이 함수는 저장소 내부 어디에서도 `@ai-animation-studio/shared`를 통해 import되지 않는 미사용 export였음을 확인한 뒤, 의미를 "특정 프로젝트의 실제 장면 수와 무관하게, 어떤 프로젝트에서든 있을 법한 장면 번호인가"로 재정의해 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 범위 검사로 바꿨다.
  - **범위 밖 collateral**: `SceneNumber`는 아직 손대지 않기로 한 Long Episode 워크플로우(`apps/backend/src/long-projects/episode-images.service.ts`/`episode-video-merge.service.ts`/`episode-videos.service.ts`, `apps/frontend/src/api/longProjectsApi.ts`, `packages/shared/src/api.ts`의 Long Episode 응답 타입들)에서도 같은 이름으로 재사용되고 있었다 — 타입 이름을 공유한 것 자체가 이번 배치 이전부터의 기존 구조라 "Long Episode는 손대지 않는다"는 원칙만으로는 collateral을 막을 수 없었다. 3가지 패턴으로 나타났고 전부 순수 타입 수정, 런타임 동작 변경 없음:
    1. Long Episode 3개 backend 서비스의 로컬 `SCENES.includes(value as SceneNumber)` — 로컬 `SCENES`가 여전히 리터럴 6개 배열이라 위와 동일한 문제. `value as (typeof SCENES)[number]`로 캐스트 대상만 바꿔 기존 고정 6 검증 로직은 그대로 유지.
    2. `longProjectsApi.ts`의 Episode 승인/재생성 함수 4개가 자체적으로 `sceneNumber: 1 | 2 | 3 | 4 | 5 | 6`을 선언하고 있었는데, 그 값의 출처(Long Episode 응답 타입의 `sceneNumber` 필드)가 이번에 `SceneNumber`(=`number`)로 넓혀지며 호출부에서 타입 불일치. 이 4개 함수가 호출하는 `API_ROUTES.longEpisode*` 헬퍼는 이미 `SceneNumber`를 쓰고 있어 애초에 리터럴로 좁힐 이유가 없었으므로, 파라미터 타입을 `SceneNumber`로 맞췄다(런타임 검증은 Long Episode backend가 여전히 고정 6 기준으로 수행 — 위 1번).
    3. `packages/shared/src/api.ts`의 `LongEpisodeAutomaticReferenceSummary.selectedAssetIdsByScene: Record<SceneNumber, string[]>` — `SceneNumber`가 리터럴 유니온일 때는 6개 프로퍼티를 가진 매핑 타입이라 인덱싱 결과가 항상 `string[]`이었는데, `number`로 넓어지며 인덱스 시그니처 취급이 되어 `string[] | undefined`로 바뀌어 `LongEpisodeMappingReviewScreen.tsx`에서 컴파일 에러. 이 필드는 진짜 고정 6 구조(같은 인터페이스의 `estimatedImageApiCalls: 6`도 리터럴)라 `Record<1 | 2 | 3 | 4 | 5 | 6, string[]>`로 되돌려 shared `SceneNumber`와 독립시켰다.
  - 위 수정 후 재검증: Backend 465 통과(+1 skip), Frontend 550 통과, Shared 25 통과, Desktop 8(node:test) 통과, root typecheck/build 전부 통과. `git diff --check` 통과. 유료 Provider 호출 없음.
  - **주의**: 이 검증 이후 3단계 배치가 파일을 직접 저장소에 반영하면서 이 checklist와 `isSceneNumber()`/`selectedAssetIdsByScene` 수정이 실수로 되돌아간 것을 Main이 3단계 리뷰 중 재발견해 다시 적용했다(아래 쉰 번째 항목 참고) — 코드 자체는 두 번째 리뷰에서 다시 통과 확인.
- [x] 3단계 완료 — "쉰 번째 이전 기능" 참고.

## 쉰 번째 이전 기능: 장면 수(scene count)를 6 고정에서 가변으로 (3단계: Frontend 설정 화면 + 클립 길이)

마흔아홉 번째 항목(2단계, Backend 파이프라인)에 이어, "지금 바로 3단계 진행" 승인을 받아 설정 화면에 실제로 6이 아닌 장면 수를 만들 수 있는 UI를 추가했다. 마흔여덟 번째 항목에서 예고했던 계획(공급자별 클립 길이 선택 UI를 `ProviderSettingsScreen.tsx`에 추가)은 구현 중 재검토해 **의도적으로 변경**했다 — 이유는 아래 참고.

- [x] **설계 변경(계획 대비)**: 클립 길이를 전역 공급자 설정(`ProviderSettingsScreen.tsx`/`ProviderSettingsService`)이 아니라 **프로젝트별 필드**(`ShortProjectSettings.clipDurationSeconds`)로 두었다. "총 영상 길이 = 장면 수 × 클립 길이"는 애초에 프로젝트 단위 속성이고, 전역 설정에 두면 자격 증명 중심의 `ProviderSettingsService`(메모리/env 파일 기반)와 순수 함수 모듈인 `project-settings.ts` 사이에 불필요한 교차 의존성이 생겨 회피했다.
- [x] `packages/shared/src/domain.ts`: `RUNWAY_CLIP_DURATIONS = [5, 10] as const` 추가 — Runway Gen-4 Turbo가 지원하는 유일한 두 클립 길이(`docs.aimlapi.com`/`help.runwayml.com` 문서 확인, 이전 세션에서 조사 완료). Runway가 현재 유일한 지원 영상 공급자라 아직 공급자별로 나누지 않았고, 두 번째 공급자가 추가되면 그때 공급자별 목록으로 바꿀 예정.
- [x] `packages/shared/src/api.ts`: `ShortProjectSettings.durationSeconds`를 **서버 파생·읽기 전용** 필드로 재정의(`sceneCount * clipDurationSeconds`, 클라이언트가 보낸 값은 무시). `clipDurationSeconds: number` 필드 추가. 클라이언트가 실제로 보낼 수 있는 요청 바디 형태로 `ShortProjectSettingsInput = Omit<ShortProjectSettings, "durationSeconds">`를 신설하고, `UpdateProjectSettingsRequest.settings`/`CreateStoryPromptDraftPreviewRequest.settings`를 이 타입으로 좁혔다.
- [x] `apps/backend/src/projects/project-settings.ts`: `parseShortProjectSettings`가 `durationSeconds`를 입력으로 받으면 "지원하지 않는 필드"로 거부하고(`SETTINGS_KEYS`에서 제외), `sceneCount`/`clipDurationSeconds`(둘 다 `RUNWAY_CLIP_DURATIONS` 중 하나인지 검증)만 받아 `durationSeconds`를 서버에서 계산해 반환한다. `toShortProjectSettings`/`applyShortProjectSettings`도 `lore_context.clip_duration_seconds`(신규 필드)를 읽고 쓰도록 수정 — 기존 `lore_context.duration_seconds`는 항상 파생값이지만 디버깅 투명성을 위해 계속 함께 기록한다.
- [x] `apps/frontend/src/components/ShortProjectSettingsScreen.tsx`: "영상 길이(초)" 입력을 제거하고 "장면 수"(`MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 범위의 편집 가능한 숫자 입력)와 "클립 길이(초)"(`RUNWAY_CLIP_DURATIONS` 기반 드롭다운)로 교체했다. 읽기 전용이던 "장면 수: 정확히 N개" 문구는 "예상 총 영상 길이: N초 (장면 수 × 클립 길이)" 계산 표시로 바꿨다. 저장(`submit()`)과 실시간 대본 프롬프트 미리보기(`draft-preview` 호출) 양쪽 모두 이제 `durationSeconds`를 요청 바디에서 제외한다(서버가 거부하는 필드이므로).
- [x] `apps/frontend/src/api/storyPromptApi.ts`: `createStoryPromptDraftPreview`의 파라미터 타입을 `ShortProjectSettingsInput`으로 좁혔다.
- [x] **자가 발견 버그 2건(런타임 응답 검증 하드코딩)**: 프론트엔드 응답 파서 2곳이 여전히 "장면 수는 반드시 정확히 6"을 가정하고 있어, 2단계까지 완료된 지금도 프론트가 실제로 6이 아닌 장면 수의 정상 응답을 "형식이 잘못됨" 에러로 잘못 거부할 뻔한 결함을 발견해 수정했다 — 이 배치가 아니었다면 방금 추가한 장면 수 입력 UI 자체가 저장 즉시 깨졌을 것이다.
  - `apps/frontend/src/api/projectsApi.ts`의 `isShortProjectSettings()`: `value.sceneCount !== 6` 하드 비교를 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 범위 검증으로, `clipDurationSeconds`가 `RUNWAY_CLIP_DURATIONS` 중 하나인지 검증하도록 확장.
  - `apps/frontend/src/api/storyPromptApi.ts`의 `isPreview()`: `value.sceneCount === 6` 하드 비교를 동일한 범위 검증으로 교체.
- [x] `packages/shared/src/project-contract.test.ts`: 계약 테스트 픽스처에 `clipDurationSeconds` 추가, `durationSeconds`는 파생 응답 쪽(`GetProjectSettingsResponse`)에서만 별도로 채우도록 분리(요청 타입 `ShortProjectSettingsInput`에는 더 이상 존재하지 않는 필드라 요청 객체 리터럴에는 포함할 수 없음).
- [x] 신규/수정 테스트: `project-settings.test.ts`(clipDurationSeconds 유효성 검증·`durationSeconds = sceneCount * clipDurationSeconds` 파생 검증 케이스 추가), `story-prompt.service.test.ts`(draft 픽스처를 `clipDurationSeconds` 포함 형태로 수정), `ShortProjectSettingsScreen.test.tsx`(장면 수/클립 길이 입력을 바꾸면 계산된 총 길이 표시가 갱신되고, 저장 요청 바디에 `durationSeconds`가 없이 `sceneCount`/`clipDurationSeconds`가 담기는 것을 확인하는 테스트 추가).
- [x] **CLI 검증 완료**: `npm run typecheck && npm run test && npm run build`를 root에서 실행. 이 배치 리뷰 중 두 종류의 문제를 Main이 발견해 수정한 뒤 전부 통과했다.
  - **이 배치 자체의 기반 스냅샷 문제**: `packages/shared/src/domain.ts`의 `isSceneNumber()`(마흔아홉 번째 항목에서 이미 고쳤던 것)와 `packages/shared/src/api.ts`의 `selectedAssetIdsByScene: Record<1|2|3|4|5|6, string[]>`(동일)가 이번 배치가 파일을 직접 반영하는 과정에서 예전 스냅샷 기준으로 다시 원래 상태(`SceneNumber` 사용)로 되돌아가 있었다 — 리뷰 중 재발견해 다시 적용했다. 이 문서의 마흔아홉 번째 항목 체크박스도 같은 이유로 되돌아가 있어 함께 복구했다.
  - **typecheck 에러**: `apps/frontend/src/api/projectsApi.test.ts`의 `ShortProjectSettings` 픽스처가 `clipDurationSeconds`를 빠뜨려 `ShortProjectSettingsInput`(Omit 타입) 요구 속성 누락 컴파일 에러 — 필드 추가로 해결. 프로덕션 코드의 실제 호출부(`ShortProjectSettingsScreen.tsx`의 `submit()`/draft-preview 요청)는 둘 다 `durationSeconds`를 명시적으로 destructure해 제외하고 있음을 확인해, 보고하신 "구조적 타이핑 loophole"이 실제 프로덕션 경로에는 없다는 것도 함께 확인했다.
  - **테스트 실패(타입에는 안 걸리지만 런타임에서 걸리는 케이스)**: 이번 배치가 손대지 않은 3개 파일의 오래된 픽스처가 여전히 `durationSeconds`를 요청 바디에 넣고 있어 `parseShortProjectSettings`의 "지원하지 않는 필드" 거부에 걸렸다 — `apps/frontend/src/App.test.tsx`(설정 GET 응답 픽스처에 `clipDurationSeconds` 누락, 별개로 `isShortProjectSettings` 실패), `apps/backend/src/projects/projects.service.test.ts`/`projects.controller.test.ts`(PATCH 요청 바디에 `durationSeconds` 그대로 남아있어 거부). 셋 다 `durationSeconds` 제거·`clipDurationSeconds` 추가로 수정.
  - 위 수정 후 재검증: Backend 466 통과(+1 skip), Frontend 551 통과, Shared 25 통과, Desktop 8(node:test) 통과, root typecheck/build 전부 통과. `git diff --check` 통과. 유료 Provider 호출 없음.
- [x] 4단계 완료 — "쉰한 번째 이전 기능" 참고.

## 쉰한 번째 이전 기능: 장면 수(scene count)를 6 고정에서 가변으로 (4단계: 남은 화면 전환 + 자가 발견 확장)

쉰 번째 항목(3단계, 설정 화면)에 이어 "지금 바로 4단계 진행" 승인을 받아, 계획에 남아있던 화면들의 고정 `SCENE_NUMBERS`/`assertExactlySixScenes` 의존을 전환했다. 조사 중 같은 클래스의 버그가 계획에 명시되지 않은 파일 여러 곳에도 남아있는 것을 발견해(3단계에서 `VideoMergeScreen.tsx`를 계획 외로 포함시켰던 것과 같은 이유로) 함께 처리했다.

- [x] `packages/shared/src/domain.ts`: 더 이상 아무도 쓰지 않는 `SCENE_NUMBERS`(`[1..6]` 고정 배열)와 `assertExactlySixScenes()`를 전체 저장소 grep으로 호출부 0건 확인 후 삭제. `SceneNumber` 타입의 stale 문서 주석도 함께 정리.
- [x] `packages/shared/src/api.ts`: `GenerationProgressResponse`에 `sceneNumbers: SceneNumber[]` 필드 신규 추가(작업에 속한 전체 장면 번호 1..N) — 프론트가 작업의 실제 장면 수를 알 방법이 기존에는 없었다(`completedSceneNumbers`/`failedSceneNumbers`/`currentSceneNumber`만으로는 작업 초반에 전체 개수를 알 수 없음). `RegenerateVideoResponse`는 이 타입을 extend하므로 자동으로 포함.
- [x] `apps/backend/src/videos/local-video-workflow.service.ts`: `progress()`가 위 신규 필드를 이미 갖고 있던 작업 레코드 목록에서 채우도록 수정. 관련 백엔드 테스트 전부 `toMatchObject`/부분 매칭이라 수정 불필요함을 확인.
- [x] `apps/frontend/src/api/videoWorkflowApi.ts`: 신규 `sceneNumbers` 필드 검증(`isJobSceneNumbers`) 추가. **자가 발견 버그 2건**: 로컬 `isSceneNumber`가 `value <= 6` 하드 상한이라 7~12번 장면의 정상 응답을 거부하고 있었고, `isVideoReviewList`가 정확히 길이 6을 요구해 6이 아닌 장면 수 프로젝트의 정상 리뷰 응답을 전부 "형식 오류"로 거부하고 있었다 — 둘 다 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 기반 동적 검증으로 교체.
- [x] `apps/frontend/src/components/ImageGenerationScreen.tsx`/`VideoWorkflowScreen.tsx`: 로컬 고정 `SCENE_NUMBERS=[1..6]` 제거, 각각 `sceneNumbersFor(project.scenes.length)`/`progress.sceneNumbers`로 그리드를 렌더링. 화면 내 "6장"/"6개" 하드코딩 문구(안내 문구, 확인 패널, 완료 배너 등 7곳)를 실제 장면 수로 교체.
- [x] `apps/frontend/src/components/MappingReviewScreen.tsx`: 특정 프로젝트에 종속되지 않는 필터 드롭다운의 `SCENE_NUMBERS`를 `sceneNumbersFor(MAX_SCENE_COUNT)`(지원 범위 전체)로 확장.
- [x] `apps/frontend/src/components/VideoPromptPreviewScreen.tsx`: 확인 패널의 "위 6개 프롬프트가..." 문구를 실제 프롬프트 개수(`previews.length`)로 교체. **자가 발견 버그 4건(런타임 응답 검증 하드코딩)**: 이 화면이 의존하는 두 API 레이어에 3단계 때와 같은 클래스의 결함이 남아있었다 — `videoPreviewApi.ts`의 `isSceneNumber`(`<= 6` 상한), `isGetVideoPromptPreviewResponse`(정확히 길이 6 요구), `videoSubmissionApi.ts`의 `isStartVideoGenerationResponse`(정확히 길이 6 요구), 그리고 안전 에러 메시지 2곳(`VIDEO_PREVIEW_NOT_ALLOWED`/`VIDEO_SUBMISSION_NOT_ALLOWED`의 "이미지 6장" 고정 문구). 전부 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 기반 동적 검증·문구로 교체 — 고치지 않았다면 이 화면 자체는 장면 수를 동적으로 표시해도, 6이 아닌 장면 수 프로젝트의 정상 백엔드 응답을 API 레이어가 전부 "형식 오류"로 거부해 화면이 실질적으로 동작하지 않았을 것이다.
- [x] **계획 외 확장 1 — `VideoMergeScreen.tsx`/`videoMergeApi.ts`**: grep으로 같은 클래스의 하드코딩(안내 문구 2곳의 "6개", `VIDEO_MERGE_NOT_ALLOWED`의 고정 메시지)을 추가로 발견해 프로젝트의 실제 장면 수 기반으로 교체.
- [x] **계획 외 확장 2 — `apps/frontend/src/api/assetsApi.ts`**: 독립 서브에이전트의 전체 저장소 스윕에서 로컬 `isSceneNumber`의 `value <= 6` 하드 상한을 추가로 발견(Asset의 `sourceSceneNumber` 검증에 사용되어 7장면 이상 프로젝트의 정상 Asset을 전부 거부하던 결함) — `MAX_SCENE_COUNT`로 교체.
- [x] **계획 외 확장 3 — `apps/frontend/src/components/StoryPromptScreen.tsx`**: 같은 스윕에서 발견. 대본 승인 직후 "생성된 장면" 패널이 `approved.scenes.length === 6`일 때만 렌더링되어 6이 아닌 장면 수 프로젝트에서는 패널 자체가 아예 나타나지 않던 결함, 그리고 안내 문구가 "6개 장면이 생성되었습니다"로 고정돼 있던 것을 수정 — 조건을 `scenes.length > 0`으로, 문구를 실제 개수로 교체.
- [x] **계획 외 확장 4 — `packages/shared/src/api.ts`의 `assertVideoGenerationApproval()`**: 같은 스윕에서 발견. 정확히 6개 프롬프트·"1부터 6까지 순서"를 하드코딩하고 있었다(현재 저장소 어디서도 호출되지 않는 미사용 export이지만, 여전히 공개 API 표면이라 방치하면 향후 호출 시 잘못된 값을 던짐) — `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 기반 동적 검증으로 교체.
- [x] **계획 외 확장 5 — `apps/backend/src/projects/project-continuity.ts`**: 같은 스윕이 문서 주석에서 발견한 단서("Scene 6")를 Main이 직접 코드까지 추적해 확인한 실질 버그. 숏 프로젝트 간 이어가기(continuity) 기능이 "연결할 이전 프로젝트의 마지막 장면 이미지"를 항상 **배열 인덱스 5(=6번째 장면)로 고정**해 가져오고 있었다 — 이전 프로젝트가 6이 아닌 장면 수(2~12)를 가질 수 있게 된 지금, 6장면이 아닌 프로젝트는 이어가기 후보 목록에서 조용히 제외되거나(장면·이미지 배열 길이가 6 미만이면 무조건 탈락) 6장면보다 많은 프로젝트는 실제 마지막 장면이 아닌 엉뚱한 6번째 장면 이미지가 연결되는 결함이었다. 후보 판정·이미지 인덱스·라벨(`"... · Scene 6"`)·저장되는 `scene_number` 필드를 모두 프로젝트의 실제 마지막 장면(`scenes.length`)을 따르도록 수정했고, 이 값을 새로 전달하기 위해 내부 `ContinuityCandidate`에 `sceneNumber` 필드를 추가했다. 이 함수를 직접 호출하는 기존 테스트(`projects.service.test.ts`의 6장면 케이스)는 결과가 동일해 그대로 통과할 것으로 예상되며, 4장면 케이스를 검증하는 신규 테스트를 추가했다. `apps/backend/src/images/image-reference-selection.ts`의 관련 문서 주석("approved Scene 6 image")도 함께 정리(로직 자체는 이미 인덱스에 의존하지 않아 수정 불필요, 주석만 갱신).
- [x] 신규/수정 테스트: `videoWorkflowApi.test.ts`(6장면 고정 전제였던 테스트 교체, 10장면까지 허용하는 신규 테스트 추가), `VideoWorkflowScreen.test.tsx`(4장면 종단 테스트 2건 추가), `assetsApi.test.ts`(`sourceSceneNumber: 7` 거부 테스트를 "13은 거부/7은 허용"으로 교체), `StoryPromptScreen.test.tsx`(4장면 생성 패널 테스트 추가), `VideoPromptPreviewScreen.test.tsx`(4개 프롬프트 문구 테스트·안전 메시지 문구 갱신 추가), `videoPreviewApi.test.ts`/`videoSubmissionApi.test.ts`(6장면 고정 전제였던 거부 테스트를 "적으면 허용/순서에 빈틈 있으면 거부/12장면까지 허용"으로 교체), `VideoMergeScreen.test.tsx`(기본 픽스처에 6장면 채움 + 4장면 테스트 추가), `projects.service.test.ts`(4장면 continuity 링크 테스트 추가).
- [x] **삭제 필요(이 세션은 파일 삭제 권한이 없어 CLI에 요청)**: `packages/shared/src/domain.test.ts`가 이번에 삭제한 `assertExactlySixScenes`를 import·테스트하고 있어 그대로 두면 typecheck가 깨진다. CLI가 이 파일을 삭제해야 한다.
- [x] **CLI 검증 완료**: `packages/shared/src/domain.test.ts`를 삭제(요청대로)한 뒤 `npm run typecheck && npm run test && npm run build`를 root에서 실행. 두 곳에서 실제 회귀를 발견해 수정했다.
  - `packages/shared/src/api.test.ts`의 "rejects incomplete prompts" 테스트가 프롬프트를 6개에서 5개로 줄여 거부되길 기대했는데, `assertVideoGenerationApproval()`이 이제 2~12개를 허용하므로 5개는 더 이상 불완전하지 않아 테스트가 실패했다 — 테스트 자체가 6 고정 시절 가정이었으므로, "장면 번호 순서에 빈틈"·"2 미만"·"12 초과" 3가지 실제 무효 케이스로 교체하고 "4개도 정상 허용" 테스트를 추가했다.
  - `apps/frontend/src/App.test.tsx`의 영상 워크플로우 진행 상황 픽스처 2곳이 신규 필수 필드 `sceneNumbers`를 빠뜨려 `isJobSceneNumbers` 검증에 걸려 "서버 응답을 확인할 수 없습니다" 에러로 실패 — 우려하신 대로 실제로 놓친 픽스처였다. 둘 다 `sceneNumbers: [1,2,3,4,5,6]` 추가로 해결. 전체 저장소에서 `completedSceneNumbers`를 참조하는 다른 파일도 확인했고, Long Episode 쪽(`LongEpisodeVideoProgress`)은 별개 타입이라 영향 없음을 확인했다.
  - `project-continuity.ts`의 경로 탈출 방지(`resolvedPath.startsWith(projectDir + path.sep)`)와 파일 존재 확인(`fsPromises.stat` + try/catch)은 장면 수와 무관하게 모든 후보에 대해 조건 없이 그대로 실행되는 것을 코드로 직접 재확인 — 이번 변경은 인덱스 계산과 하한 비교(6→`MIN_SCENE_COUNT`)만 바꿨을 뿐 안전장치 자체는 전혀 손대지 않았다.
  - 위 수정 후 재검증: Backend 467 통과(+1 skip), Frontend 564 통과, Shared 24 통과(도메인 테스트 삭제로 순감, api.test.ts 신규 테스트로 일부 상쇄), Desktop 8(node:test) 통과, root typecheck/build 전부 통과. `git diff --check` 통과. 유료 Provider 호출 없음.
- [x] Long Episode 워크플로우는 이번 배치에서도 계속 범위 밖(서브에이전트 스윕으로 재확인).

## 다섯 번째 자가 발견 배치: 4단계 스윕에서 놓친 Asset Library의 6 고정 잔재 (.claude-bridge 협업 중 발견)

Cowork↔CLI 브리지 협업 중 캐릭터 폴더 계약 확장 작업을 하다가, 4단계 스윕(`apps/backend/src/assets/`는 스윕 대상에서 빠져 있었음)이 놓친 실제 회귀 2건을 발견해 수정했다.

- [x] **`apps/backend/src/assets/assets.repository.ts`의 `indexGeneratedProjectImages()`**: 로컬 `SCENES=[1..6]` 고정 배열로 `scene1.png`~`scene6.png`를 읽어 Asset Library에 색인하고 있었다 — `local-image-generation.service.ts`가 이미지 생성을 전부 마친 뒤 호출하는 마지막 단계라, 6장면 미만 프로젝트는 존재하지 않는 `scene5.png`/`scene6.png`를 읽으려다 `assetStorageError()`가 터져 **이미지 생성 자체가 마지막 단계에서 항상 실패**했고, 6장면 초과 프로젝트는 7번째 이후 장면 이미지가 Asset Library에 전혀 색인되지 않았다. 루프 상한을 인자로 받는 `descriptions.length`(실제 호출부가 이미 프로젝트의 정확한 장면 수만큼 채워 넘기고 있음) 기준으로 교체하고 죽은 `SCENES` 상수를 제거했다. 신규 테스트(`assets.repository.test.ts`, 4장면 케이스) 추가, 기존 테스트(`image-review.service.test.ts`)의 빈 `descriptions: []` 호출이 이 버그를 우연히 가려온 것도 발견해 실제 6개 설명 배열을 넘기도록 고쳤다.
- [x] **`apps/backend/src/assets/asset-storage.ts`의 `parseAssetIndex()`**: `source_scene_number` 검증이 `<= 6` 하드코딩 — 위 버그를 고쳐도 7장면 이상 프로젝트에서 생성된 Asset 레코드는 저장 후 다시 불러오는 순간 파싱 자체가 거부되어 결국 막혀 있었다. `MAX_SCENE_COUNT`로 교체. 신규 테스트(`asset-storage.test.ts`, 12는 허용·13은 거부) 추가.
- [x] 재검증: Backend 472 통과(+1 skip, 신규 5건 포함: 위 2건 + 캐릭터 폴더 계약 관련 3건), Frontend 564 통과, Shared 25 통과, Desktop 8(node:test) 통과, root typecheck/build 전부 통과. 유료 Provider 호출 없음.
- [x] 같은 스윕에서 캐릭터 폴더 생성/연결 계약(`CreateAssetFolderRequest/Response`, `SetAssetParentFolderRequest/Response`)과 그 백엔드 구현(`assets.repository.ts`의 `createFolder()`/`setParentFolder()`, `POST /assets/folders`, `PATCH /assets/:assetId/parent-folder`)도 함께 완료했다 — Cowork의 계약 변경 요청에 대한 응답으로, `.claude-bridge/from-cli.md`에 상세 보고.

## 쉰두 번째 이전 기능: 장기 프로젝트(Long Episode) 장면 수를 6 고정에서 가변으로

마흔여덟~쉰한 번째 항목이 숏 프로젝트 파이프라인의 장면 수를 6 고정에서 가변(2~12, `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT`)으로 전환했을 때, Long Episode(장기 프로젝트) 워크플로우는 의도적으로 범위 밖에 두었다(쉰한 번째 항목 마지막 줄 참고). `.claude-bridge` Cowork↔CLI 브리지 협업 중 Cowork가 설계를 제안하고("추천대로 가자") 사용자가 승인해, Long Episode도 같은 전환을 진행했다.

- [x] **설계**: 숏 프로젝트가 이미 쓰는 패턴을 그대로 재사용 — 장면 수는 **프로젝트 설정**(Episode별이 아님), 범위는 동일한 `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT`. `LongProjectSettings.episodeDurationSeconds`를 클라이언트 입력에서 **서버 파생**(`sceneCount * clipDurationSeconds`)으로 바꾸고, `LongProjectSettingsInput = Omit<LongProjectSettings, "episodeDurationSeconds">` 신설 — `ShortProjectSettingsInput`과 완전히 같은 모양. 기존 저장값(30/60초만 있던 시절)은 무손실 마이그레이션: 30→(6장면,5초), 60→(6장면,10초), 값 없으면 (6,5).
- [x] `packages/shared/src/api.ts`: `LongProjectSettings`에 `sceneCount`/`clipDurationSeconds` 추가, `episodeDurationSeconds` 파생값·읽기 전용 문서화. `LongEpisodeContinuityReference.sourceSceneNumber`를 리터럴 `6`에서 `SceneNumber`로("이전 에피소드의 마지막 장면" — 숫자가 아니라 의미가 바뀜). `LongEpisodeAutomaticReferenceSummary.estimatedImageApiCalls`를 리터럴 `6`에서 `number`로, `selectedAssetIdsByScene`을 `Record<1..6,...>`에서 `Partial<Record<SceneNumber,...>>`로. `LongEpisodeVideoProgress`에 `sceneNumbers: SceneNumber[]` 신규 추가(쉰한 번째 항목에서 `GenerationProgressResponse`에 추가했던 것과 동일한 이유 — 프론트가 작업 초반에 전체 장면 개수를 알 방법이 없었음).
- [x] `apps/backend/src/long-projects/long-projects.service.ts`: `settings()`(클라이언트 입력 엄격 검증)와 `coerceSceneCountAndClipDuration()`(기존 저장 데이터 관대한 보정, 값 없으면 6/5)을 분리 — 숏 프로젝트의 `project-settings.ts`와 동일 구조.
  - **자가 발견 회귀**: 이전 배치("에피소드 길이는 30/60초만 허용")가 `parseStored()`(디스크에서 기존 프로젝트를 읽는 공통 경로)를 클라이언트 입력용 엄격 검증기에 그대로 통과시키고 있어, 저장된 값이 정확히 30/60이 아닌 기존 프로젝트는 로드 자체가 실패했을 뻔했다 — 픽스처가 전부 30이라 테스트로 걸리지 않았던 것을 이번 재설계 중 직접 발견해 함께 고쳤다.
- [x] Long Episode 백엔드 서비스 6개 전체를 `SCENES=[1..6]` 하드코딩에서 Episode 자신에 스냅샷된 `scene_count`(없으면 6 폴백) 기반으로 전환 — `episode-scripts.service.ts`, `episode-images.service.ts`, `episode-videos.service.ts`, `episode-video-merge.service.ts`, `episode-asset-mappings.service.ts`, `episode-continuity-reference.service.ts`. shared의 `sceneNumbersFor()`/`isSceneNumber()`(숏 프로젝트가 이미 쓰던 헬퍼) 재사용.
  - **자가 발견 버그 1**: `episode-continuity-reference.service.ts`의 `sourceSceneNumber`가 항상 하드코딩 `6`을 반환하고, 참조 이미지 경로도 항상 `scene6.png`를 읽고 있었다 — 이전 에피소드 자신의 실제 `scene_count`를 읽어 "이전 에피소드의 마지막 장면"이 되도록 수정(4장면 스냅샷 후 프로젝트 설정을 8장면으로 바꾼 뒤 검증하는 신규 테스트 추가).
  - **자가 발견 버그 2**: `episode-videos.service.ts`의 `durationSecondsPerScene()`이 "에피소드 총 길이 ≥45초면 10초/씬"으로 판단하고 있었는데, 이건 6장면 고정 전제의 계산(30=6×5, 60=6×10)이라 장면 수가 가변이면 깨진다(예: 10장면×5초=50초인데 45초 기준으로는 잘못 10초/씬으로 읽힘) — 총 길이를 에피소드 자신의 `scene_count`로 나누도록 수정, `episode-video-merge.service.ts`의 병합 클립 길이(자막 타이밍용, 현재 내레이션·자막 없어 사실상 비활성이지만)도 같은 방식으로 맞춤.
- [x] `apps/frontend/src/api/longProjectsApi.ts`의 응답 검증기 6곳(`isSceneNumber`/`isLongEpisodeScript`/`isAutomaticReferenceSummary`/`isGetEpisodeVideoPreviewResponse`/`isStartEpisodeVideoResponse`/`isGetLongEpisodeContinuityReferenceResponse`)이 여전히 고정 6·리터럴 `1~6` 범위를 가정하고 있어, 백엔드가 이미 6이 아닌 장면 수로 응답해도 프론트가 "형식이 잘못됨"으로 거부하던 것을 동적 범위 검증으로 교체.
  - **자가 발견 버그**: `isGetEpisodeVideoPreviewResponse`가 `durationSecondsPerScene === 5`만 허용하고 있었다 — 이전 배치에서 계약이 `5 | 10`으로 넓어졌는데(장기 영상 클립 길이 지원) 이 검증기만 갱신이 안 돼 있어, 클립 길이 10초짜리 장기 프로젝트는 장면 수와 무관하게 미리보기 자체가 항상 거부되고 있었다.
- [x] `apps/frontend/src/components/LongEpisodeImageGenerationScreen.tsx`: 로컬 `SCENES=[1..6]` 제거, 리뷰 목록(로드됐으면)·Episode 자신의 script(그 전)에서 실제 장면 목록을 읽도록 전환. 연속성 문구도 하드코딩 "6번 장면" 대신 실제 `sourceSceneNumber`를 반영.
- [x] 신규/수정 테스트: `episode-scripts.service.test.ts`(9장면 생성·편집 종단 테스트), `episode-continuity-reference.service.test.ts`(4장면 스냅샷 후 프로젝트 설정 변경 시나리오), `LongEpisodeImageGenerationScreen.test.tsx`(연속성 문구 갱신, 비용 예상 테스트의 `episode("asset_mapping_approved")` 픽스처에 script 필드 누락 발견해 추가 — 상태 머신상 그 상태에는 대본 승인이 항상 먼저 끝나 있어 script가 없을 수 없음을 확인 후 수정), `CreateLongProjectForm.test.tsx`(장면 수 입력 클램프 테스트).
- [x] **CLI 검증 완료**: 각 배치마다 `npm run typecheck`(shared 재빌드 후 전체)·`npm run test`(root)·`npm run build`·AppModule DI 부팅 확인을 실행, 전부 통과 후 커밋·푸시. 최종 상태: Backend 593 통과(+1 skip), Frontend 734 통과, root build 통과. 유료 Provider 호출 없음.
  - 커밋: `341f7b6`(계약 + 설정 계층 + 최소 프론트 컴파일 유지), `198a2cc`(백엔드 서비스 6개 전환 + 자가 발견 버그 2건), `827373a`(`longProjectsApi.ts` 검증기 6곳 + durationSecondsPerScene 버그), `592efe9`(`LongEpisodeImageGenerationScreen` 상수 제거 + 픽스처 수정, 4개 실패 전부 해결).

## 여섯 번째 자가 발견 배치: 쉰두 번째 항목 뒤 전체 저장소 재스윕에서 놓친 잔재

쉰두 번째 항목을 마친 뒤 `=== 6`/`!== 6`/`<= 6`/`[1..6]` 패턴으로 저장소 전체를 다시 grep해, 이전 스윕들(마흔여덟~쉰한 번째, 다섯 번째 자가 발견 배치)이 놓친 잔재를 추가로 발견했다.

- [x] **`apps/frontend/src/api/imageGenerationApi.ts`/`imageReviewApi.ts`/`mappingsApi.ts`**: 로컬 `isSceneNumber()`/`isSceneNumberArray()`가 여전히 `>= 1 && <= 6`을 하드코딩 — 6 초과 장면 수(쉰 번째 항목에서 이미 지원)로 설정된 숏 프로젝트는 이미지 생성·이미지 검토·Asset Mapping 응답이 전부 프론트에서 "형식 오류"로 거부되고 있었다. shared의 `isSceneNumber()`에 위임하도록 통일.
- [x] **`apps/frontend/src/components/LongEpisodeScriptScreen.tsx`**: `isScript()`가 정확히 6장면을 요구해, 6이 아닌 장면 수의 Episode는 대본을 편집해도 저장이 항상 거부되고 있었다 — `MIN_SCENE_COUNT`~`MAX_SCENE_COUNT` 범위 검증으로 교체.
- [x] **`apps/frontend/src/components/LongEpisodeVideoWorkflowScreen.tsx`**: 영상 생성 진행 중 그리드가 여전히 로컬 `SCENES=[1..6]`을 순회 — 쉰두 번째 항목에서 이 화면을 위해 계약에 추가한 `LongEpisodeVideoProgress.sceneNumbers`를 쓰도록 교체(픽스처 3곳에 신규 필드 추가).
- [x] `mappingsApi.test.ts`의 "9번 장면 거부" 테스트가 옛 고정 6 가정이라 실패 — "13은 거부·9는 허용"으로 교체.
- [x] 재검증: Backend 593 통과(+1 skip), Frontend 735 통과(신규 1건), root typecheck/build 전부 통과. 유료 Provider 호출 없음.
- [x] 커밋: `aa2783b`.

## 쉰세 번째 이전 기능: 장기 프로젝트(Long Episode) 내레이션·자막

숏 프로젝트는 이미 내레이션 TTS·자막 기능이 있는데 장기 프로젝트에는 없었다. 사용자에게 "3번(장면 수 가변화)까지 끝났고 4번(음성·자막)은 시작도 안 했다"고 보고하니 **"프로그램 목적에 맞아야 하니까 넣어야지"** 로 진행 승인이 났다. Cowork가 설계를 제안(`.claude-bridge` Round 80)했고, 그중 하나(`LongEpisodeScene.narration`을 선택 필드로 할지 필수+빈 문자열 폴백으로 할지)를 CLI가 판단해 진행했다.

- [x] **가장 중요한 설계 결정**: `LongEpisodeStatus`에 새 상태를 추가하지 않는다. 숏 프로젝트의 내레이션도 `WorkflowState`에 없는 사이드 채널 기능이라("내레이션 문장을 가진 장면이 하나라도 있으면" 버튼이 뜸), 장기도 같게 — 진입 조건은 상태가 아니라 "이 장면에 내레이션 문장이 있는가"뿐이다.
- [x] `packages/shared/src/api.ts`: `LongProjectSettings`에 `narrationEnabled`/`subtitlesEnabled` 추가 — `ShortProjectSettings`의 동명 필드와 의미·기본값·구버전 폴백(subtitlesEnabled 없으면 narrationEnabled 값으로) 전부 동일. `LongEpisodeScene`에 `narration?: string`(**선택 필드로 결정** — 이미 저장된 모든 Episode 대본에 이 필드가 없고, 장기 대본 생성이 아직 local-fake뿐이라 필수+폴백으로 만들 실익이 없음). 내레이션 리뷰/생성/재생성/콘텐츠 라우트·응답 타입 4세트를 숏 프로젝트 계약과 완전히 같은 모양으로 신설.
- [x] `apps/backend/src/long-projects/long-projects.service.ts`: 두 신규 필드의 클라이언트 입력 검증과, 기존 저장 데이터의 관대한 보정(`coerceNarrationSettings()` — 숏 프로젝트의 `toShortProjectSettings`와 동일한 폴백 규칙)을 분리.
- [x] `apps/backend/src/long-projects/episode-scripts.service.ts`: `narration`을 선택 필드로 파싱·저장(있으면 17번째 키, 없으면 기존 16개 그대로 — 다른 필드처럼 필수로 만들면 기존 저장 대본이 전부 깨짐). `generated()`(로컬 페이크 생성)가 매 장면에 템플릿 문장을 채운다 — 장기 대본 생성은 아직 실제 Provider를 안 부르므로(생성자에 `projectsRoot` 하나뿐) 내레이션도 당분간 템플릿일 뿐, "AI가 썼다"고 주장하지 않는다.
  - **자가 발견 버그**: `episode-script-format.ts`의 `toApiEpisodeScript()`(이미지·영상·병합·매핑 등 다른 Episode 서비스들이 전부 이걸로 자기 응답의 `script` 필드를 만듦)가 자체 `snakeKeys`/`camelKeys` 배열을 따로 갖고 있어서 `narration`을 조용히 빠뜨리고 있었다 — `episode-scripts.service.ts` 자신의 응답에는 내레이션이 나오는데 다른 화면들의 응답에서는 사라지는 결함이었다. 함께 고치고 전용 테스트(`episode-script-format.test.ts`)를 새로 추가해 직접 검증했다.
- [x] 신규 `apps/backend/src/long-projects/episode-narration.service.ts` + `episode-narration.controller.ts`: 숏 프로젝트 내레이션 모듈의 OpenAI TTS adapter(`callOpenAiTtsApi`)·오디오 길이 측정기(`probeAudioDurationSeconds`)를 그대로 재사용(복제 안 함). `LongEpisodeStatus`로 막지 않는다 — 유일한 상태 성격의 게이트는 "Episode에 대본이 아직 없음"(`LONG_EPISODE_NARRATION_NOT_ALLOWED`)뿐이고, 그 외에는 숏 프로젝트와 동일하게 장면별 내레이션 텍스트 유무로만 판단한다. `long-projects.module.ts`에 배선.
- [x] `apps/backend/src/long-projects/episode-video-merge.service.ts`: 이전 배치에서 "장기는 내레이션·자막이 없어 항상 무음"이라고 적혀 있던 하드코딩(`narrationAudioPath: null, subtitleText: null`)을 실제 오디오 믹싱·자막 번인으로 교체 — 숏 프로젝트의 `video-merge.service.ts`와 **정확히 같은 게이팅**(오디오는 narrationEnabled+파일 유효성, 자막은 subtitlesEnabled+장면 내레이션 텍스트 존재, 둘은 서로 독립).
- [x] 신규/수정 테스트: `episode-narration.service.test.ts`(전체 흐름 9건 — 대본 없을 때 거부, 생성·재사용, 빈 내레이션 장면 skip, narrationEnabled 꺼짐 거부, 재생성, 콘텐츠 제공, provider-free 확인), `episode-script-format.test.ts`(신규, narration 통과 확인), `episode-scripts.service.test.ts`(템플릿 생성·편집 round-trip), `episode-video-merge.service.test.ts`(오디오 믹싱·자막 번인·subtitlesEnabled 독립성 3건 추가), `long-projects.service.test.ts`(narrationEnabled/subtitlesEnabled 검증·레거시 폴백 3건 추가). 기존 14개 파일의 설정 픽스처에 두 신규 필수 필드 추가.
- [x] **CLI 검증 완료**: `npm run typecheck`(shared 재빌드 후 전체)·`npm run test`(root)·`npm run build`·AppModule DI 부팅 확인 전부 통과. Backend 612 통과(+1 skip, 신규 19건), Frontend 736 통과. 유료 Provider 호출 없음.
- [x] 커밋: `15caa8b`. 프론트(내레이션 리뷰 화면 신규, 대본 화면 narration 필드 편집 허용, 설정 화면 토글 2개, 영상 병합 화면 4분기 문구 등)는 계약이 랜딩된 뒤 Cowork가 이어서 보낼 예정 — `.claude-bridge`에 상세 보고.
- [x] **Cowork 발견 버그(계약 랜딩 직후) — Asset Mapping 지문에 narration이 섞여 있었다**: `episode-asset-mappings.service.ts`와 `episode-images.service.ts`(자체 사본) 둘 다의 `scriptFingerprint`가 장면 객체 전체를 해싱해 narration도 포함하고 있었다 — narration은 이미지/영상 프롬프트 빌더(`imagePromptFor`/`promptFor`, 둘 다 이름으로 지정한 필드만 선택하고 narration은 절대 안 읽음, 코드로 확인)가 전혀 안 쓰는 필드라 Asset Mapping의 입력이 아닌데, 있으면 승인된 리뷰가 무효화될 뻔했다. 두 파일 다 narration을 제외하고 해싱하도록 동일하게 수정(두 사본이 다르게 고쳐지면 한쪽에서는 "최신"이고 다른 쪽에서는 "stale"인 모순이 생기므로 반드시 같이). 현재 API로는 스크립트가 `script_review` 상태에서만 편집 가능하고 Asset Mapping은 그 이후 상태에서만 시작돼 실제로 도달 불가능한 경로지만(이후 narration 편집 기능이 생기면 바로 재발할 것이라 선제 수정), Cowork가 계약 랜딩 전 결정을 요청해 즉시 처리했다. 신규 테스트 2건(내레이션 변경은 무효화 안 됨·시각 필드 변경은 무효화됨 대조, 두 서비스의 사본이 서로 일치함을 별도 확인).
- [x] 재검증: Backend 614 통과(+1 skip, 신규 2건), Frontend 736 통과, root typecheck/build 전부 통과. 유료 Provider 호출 없음.
- [x] 커밋: `ecddfe4`.
- [x] **Cowork 프론트 전체 완료(B-6)**: `sceneFields.ts`(`longOptional` 신설로 narration을 선택 필드로), `LongEpisodeScriptScreen.tsx`(narration 편집 가능), `longProjectsApi.ts`(리뷰/생성/재생성/콘텐츠 클라이언트 함수·에러 메시지·설정 검증), 신규 `LongEpisodeNarrationReviewScreen.tsx`(숏 프로젝트 화면 이식 — stale 배지는 의도적으로 뺌: 장기는 이미지·영상도 이 축이 없어서 유일한 배지가 되면 없는 시스템이 있는 것처럼 보임. "문장 고치는 법" 안내는 에피소드 상태에 따라 갈림: `script_review`면 대본 화면으로, 승인 후면 "여기서는 읽고 음성만"), `LongProjectSettingsScreen.tsx`(토글 2개), `LongProjectDetail.tsx`(대본 있고 음성·자막 중 하나라도 켜졌을 때만 진입 링크), `LongEpisodeVideoMergeScreen.tsx`(4분기 병합 안내 문구). 진입은 에피소드 탭바가 아니라 상세 화면의 별도 링크로(숏 프로젝트도 파이프라인 단계가 아닌 사이드 채널이라 동일하게 맞춤).
  - **CLI가 고친 것**: `LongEpisodeScriptScreen.test.tsx`의 기존 테스트 하나가 "장기는 narration 그룹이 안 뜬다"고 단언하고 있었다 — 이 기능이 생기기 전에 쓰인 문장이라 이제 틀렸다. 그룹이 뜨고 올바른 비용 안내 문구를 담고 있는지 확인하도록 교체.
  - **판단 요청 처리**: `WorkflowGuideScreen.tsx`의 "대본 AI가 만든 장면별 내레이션 문장" 문구는 그대로 뒀다 — 이 화면은 `projectId`를 아예 안 받고 실제 프로젝트 데이터를 전혀 안 읽는, provider 비용 구조를 설명하는 독립 시뮬레이터라 "완전히 AI가 붙었을 때의 의도된 모양"을 설명하는 것이지 특정 프로젝트 타입의 현재 상태를 주장하는 게 아니다.
  - 재검증: Backend 614 통과(+1 skip), Frontend 752 통과(신규 batch + 기존 1건 수정), root typecheck/build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `47b4b10`.
- [x] 이것으로 4번(음성·자막) 작업이 계약·백엔드·프론트 전부 완료됐다.

## 쉰네 번째 이전 기능: 장기 프로젝트 텍스트 생성(개요·Episode 대본)을 실제 OpenAI에 연결

Cowork가 실사용 브라우저 검증 중 발견(Round 83→84 정정): 장기 프로젝트의 개요(outline)와 Episode 대본이 **둘 다** local fake였다 — "열네 번째 이전 기능"이 명시했던 대본만이 아니라, 승인 절차까지 갖춘 개요도 실제로는 어디에도 전송되지 않고 있었다. 사용자가 "이 작업을 먼저 하라"고 승인해 착수. 파이썬 원본(`app/long_story/service.py`의 `generate_project_outline`/`render_project_outline_prompt`/`generate_episode_script`/`build_context`, `app/long_story/context_builder.py`, `app/adapters/openai_episode_planner_adapter.py`)을 직접 대조해 포팅한다. 범위가 커서 두 단계로 나눈다.

- [x] **1단계 — 개요 생성**: `packages/shared`에 `LONG_OUTLINE_ESTIMATED_COST_USD`, `CreateLongProjectOutlinePreviewResponse.budget`, `LONG_OUTLINE_BUDGET_EXCEEDED`/`LONG_OUTLINE_PROVIDER_ERROR` 추가. 신규 `openai-episode-planner-adapter.ts`(`OpenAIEpisodePlannerAdapter.generate_outline`의 직접 포팅, 기존 `openai-story-adapter.ts`와 같은 fetch 기반 패턴·같은 모델 재사용). `long-projects.service.ts`의 `renderOutlinePrompt()`가 기존 한 줄짜리 placeholder 프롬프트를 파이썬의 `render_project_outline_prompt()`(Story Bible + 전체 프로젝트 설정, 한국어 라벨 섹션) 그대로로 교체. `approve()`가 연결돼 있으면 실제 adapter를 호출해 — 사용자가 이미 입력한 필드는 절대 덮어쓰지 않고 빈 필드만 채우고, Episode 번호가 1~episodeCount 연속인지 검증(파이썬과 동일) — 미연결 시엔 기존 local fake 템플릿 생성으로 그대로 폴백한다. `long-projects.no-provider-calls.test.ts`를 정적 grep에서 "미연결 시 fetch 0회" 동작 테스트로 교체(이제 이 파일이 정말로 provider adapter를 import하므로 기존 가드가 구조적으로 항상 걸림).
- [x] 신규/수정 테스트: `openai-episode-planner-adapter.test.ts`(11건), `long-projects.openai.test.ts`(5건 — 실제 연결·미연결 폴백·예산초과·provider 오류·Episode 번호 불연속 거부), `longProjectsApi.ts`의 `isPreviewResponse()`가 신규 `budget` 필드를 검증 안 하던 것 발견해 함께 수정(+테스트 1건).
- [x] 재검증: Backend 637 통과(+1 skip, 신규 24건), Frontend 754 통과(신규 1건), root typecheck/build, AppModule DI 부팅 전부 통과. 유료 Provider 호출 없음.
- [x] 커밋: `a92bba8`.
- [x] **2단계 — Episode 대본 생성**: `episode-context-builder.ts`(`StoryContextBuilder`의 포팅, 1단계와 함께 이미 작성·테스트 완료 — 7건 통과, 최근 3화 전문/이전 요약, 비밀 공개 회차 분기, 미해결 복선만, 18,000자 상한 축출 순서까지 파이썬과 동일)를 `episode-scripts.service.ts`에 실제로 연결. 신규 adapter 없이 파이썬처럼 `story_adapter.generate()`를 재사용 — 기존 `openai-story-adapter.ts`의 `callOpenAiStoryApi()`를 그대로 호출한다(스키마·검증이 이미 narration 필드까지 포함해 Long Episode 장면 형태와 완전히 동일). `generate()`가 연결 여부로 분기(1단계 개요 생성과 같은 패턴): 연결 시 `buildContext()`로 Episode Context를 조립하고 5개 섹션 프롬프트(작업 목표/설정 우선순위/Episode 제작 Context/Asset 적용 규칙/출력 요구사항 — 파이썬 원본 프롬프트를 장면 수·클립 길이 가변화에 맞춰 일반화하고 narration 요구사항 추가)를 렌더링해 실제 호출, 예산 소진/응답 파싱 실패는 각각 `LONG_EPISODE_SCRIPT_BUDGET_EXCEEDED`/`LONG_EPISODE_SCRIPT_PROVIDER_ERROR`로 매핑; 미연결 시 기존 local fake 생성 로직 그대로 폴백. `episode-scripts.service.test.ts`의 "provider를 import하지 않는다" 정적 grep 단언(이제 구조적으로 항상 실패)을 미연결 시 fetch 0회 동작 테스트로 교체.
- [x] 신규 테스트: `episode-scripts.openai.test.ts`(7건 — 실제 연결 호출·프롬프트 5개 섹션·narration 포함, Story Bible 내용이 프롬프트에 반영되는지, 미연결 시 로컬 폴백, 예산초과 차단, provider 오류 분류·실패 예산 기록, 응답 장면 수 불일치 거부, 프로젝트별 장면 수 스키마 반영).
- [x] 재검증: root typecheck, Backend 645 통과, Frontend 754 통과, root build, AppModule DI 부팅 전부 통과. 유료 Provider 호출 없음.
- [x] 커밋: `0ad3e32`.

## 실사용 1차 발견 버그 수정 (Round 91, 8번·1번)

사용자가 개발 빌드로 처음 실제 사용해봤고 13건을 보고했다(`.claude-bridge` Round 91). Cowork가 코드로 1차 원인 분석해 그중 백엔드 소관 2건을 우선순위대로 넘겼다 — 사용자와 합의된 순서는 8번(치명적 차단) → 7번(정책 결정) → 1번(단순 수정) → 나머지(Cowork 소관).

- [x] **8번 — 키를 연결해도 "요청을 처리하지 못했습니다"(`CLIENT_UNKNOWN_ERROR`)만 뜨는 문제**: `long-projects.service.ts`(개요 승인)·`episode-scripts.service.ts`(Episode 대본)·`episode-images.service.ts`·`episode-narration.service.ts`·`images/image-review.service.ts`·`narration/narration-review.service.ts` 여섯 서비스 모두 `catch (error) { ... instanceof OpenAiAdapterError ... ; throw error; }` 형태로, OpenAI 어댑터가 던진 에러가 아니면 원본을 그대로 rethrow하고 있었다. NestJS 기본 예외 필터가 이런 raw 에러를 `code` 필드 없는 500으로 응답하면, 프론트는 해당 화면의 안전한 provider-error 문구가 아니라 가장 일반적인 `CLIENT_UNKNOWN_ERROR` 폴백만 보여줄 수 있다 — 이미 오래 쓰인 Runway 영상 경로(`runway-workflow-support.ts`)는 이 문제를 이미 피하고 있었다(`OpenAiAdapterError`가 아니면 `"unknown"` 카테고리로 처리). 실제 재현은 브라우저가 끊겨 있어 코드 분석만으로 판단했다 — 여섯 곳 모두 각자의 `xxxProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown)`으로 폴백하도록 통일.
- [x] **7번 — 미연결 시 조용히 local-fake로 넘어가는 문제(정책 결정, 구현은 다음 라운드로)**: Cowork 제안(미연결 시 명시적 거부 에러, 폴백은 테스트 전용으로 유지)에 동의한다. 다만 현재 구조상 프로덕션과 테스트가 정확히 같은 조건(`apiKey && this.budget` truthy 여부)으로 이 분기를 타므로, 안전하게 분리하려면 각 서비스에 명시적 플래그를 추가하고 로컬 폴백에 의존하는 기존 테스트들(Cowork 추정 750개 이상)을 갱신해야 한다 — 범위가 큰 별도 작업으로 다음 라운드에서 진행한다.
- [x] **1번 — 폴더 안 캐릭터 이미지의 "역할"·개별 설명을 저장할 수 없는 문제**: `assets.repository.ts`의 `update()`가 `asset.is_folder || asset.parent_folder_id`면 무조건 거부했는데, 역할 드롭다운·개별 설명 저장 UI는 정의상 폴더 자식(`parent_folder_id` 있음)에만 뜬다 — 즉 이 두 컨트롤은 성공률 0%였다. 폴더 자체(`is_folder`)는 그대로 거부하고, 폴더 자식은 `role`/`description` 두 필드만 허용하도록(그 외 필드가 섞이면 여전히 거부) 좁혀서 열었다. 신규 테스트 1건 추가(자식 role/description 허용, 자식의 다른 필드·폴더 자체는 여전히 거부).
- [x] 검증: root typecheck, Backend 647 통과(+1 skip, 신규 1건), Frontend typecheck 통과(Cowork 진행 중인 프론트 변경분 포함, 이번 커밋 대상 아님), root build 전부 통과. 유료 Provider 호출 없음.
  - **알아둘 것 — 무관한 사전 존재 실패 2건**: `images.app-module.integration.test.ts`("requires explicit approval and writes six local PNGs without a provider")와 `videos.app-module.integration.test.ts`("serves a generated scene's mp4 ... independent of jobId")가 이번 세션 내내 재현 가능하게 실패한다(타임아웃). 이번 라운드가 건드린 파일과 무관하고, `git stash`로 이번 커밋 이전 상태에서 동일하게 재현돼 사전 존재 문제로 확인했다 — local-fake 워크플로우를 직접 부르는 단위 테스트(`local-video-workflow.service.test.ts` 등)는 통과하므로 로직 자체보다는 전체 앱(`NestFactory.create(AppModule)`)을 실제 HTTP로 띄우는 이 두 통합 테스트 특유의 문제로 보인다(원인 미확정 — 이 실행 환경의 타이밍/리소스 특성일 가능성). 별도로 조사가 필요하다.
- [x] 커밋: `7a7db21`.

## Round 92 사용자 결정 5건 — 백엔드 소관 2건(#9·#13)

Cowork가 결정 문서 5갈래(#3·5/#6/#9/#12/#13)에 대한 사용자 선택을 전달했다(`.claude-bridge` Round 92). #3·5·6·12는 프론트 단독(라벨·화면 로직만, 계약 변경 없음) — Cowork 소관. 백엔드 소관은 #9(계약 필드 제거)·#13(신규 계약+엔드포인트) 두 건.

- [x] **#9 — `LongProjectSettings.platform`("YouTube Shorts" | "YouTube") 필드 완전 제거**: 어디서도 실제로 읽히지 않는(프롬프트에도, 생성 로직에도 안 쓰이는) 순수 미사용 설정 필드였다. `packages/shared/src/api.ts`에서 제거, `long-projects.service.ts`의 `settingKeys`·`Stored`·`settings()`·`toSettings()`·`setStored()`에서 전부 제거. `episode-scripts.service.ts`의 Episode 대본 프롬프트 컨텍스트(`buildContext()`의 `projectOverview`)에서도 같이 제거(대본 생성 프롬프트에 실제로 들어가고 있었음).
  - **하위 호환**: `parseStored()`의 `known` 키 집합에는 `"platform"`을 그대로 남겨뒀다 — 지금 디스크에 있는 모든 project.json이 이 필드를 갖고 있어서, 빼면 기존 장기 프로젝트가 전부 로드 실패했을 것이다(Cowork가 미리 짚어준 위험). 읽을 때는 조용히 버리고, 새로 쓸 때는 더 이상 내보내지 않는다. 새 클라이언트 요청이 `platform`을 보내면(구버전 캐시 등) `settingKeys`에 없는 키라 그대로 거부된다 — 저장된 데이터의 관대한 읽기와 새 요청의 엄격한 검증을 분리하는 이 파일의 기존 패턴 그대로.
  - 테스트: `long-projects.service.test.ts`에 신규 회귀 테스트 1건(레거시 `platform` 필드가 있는 저장 파일이 여전히 로드되고, 재저장 시 필드가 사라짐을 확인). 기존 18개 테스트 파일의 fixture에서 `platform:` 리터럴 제거(전부 동일한 문자열이라 일괄 치환).
  - **프론트 쪽 남은 일**: `apps/frontend/src/api/testUtils.ts`·`components/CreateLongProjectForm.tsx`·`components/LongProjectSettingsScreen.tsx` 3개 파일이 여전히 `platform`을 참조해 frontend build가 실패한다(확인함, 에러 8줄을 `.claude-bridge` 보고에 그대로 붙였다) — Cowork가 라벨 작업과 같이 처리하기로 함.
  - 검증(백엔드만): root typecheck(shared 재빌드 후, backend+desktop 통과, frontend는 위 3파일 때문에 예상대로 실패)·Backend 648 통과(+1 skip, 신규 1건)·`npm run build --workspace @ai-animation-studio/backend` 통과. 유료 Provider 호출 없음.
  - 커밋: `e05a741`.
- [x] **#13 — 회차별(Episode) 개요 필드 편집 계약+엔드포인트 신설**: 사용자가 원하는 흐름의 앞부분(설정+화수 → 개요 승인 → AI가 화수만큼 쪼개 각 화 배정, 사용자가 채운 칸은 안 덮어씀)은 이미 동작 중이었다(Cowork 확인) — 없던 건 그 결과를 나중에 고치는 수단. `PATCH /long-projects/:id/episodes/:n/outline` 신설(`UpdateLongEpisodeOutlineRequest.outline: Record<string, string>` — `UpdateSceneRequest.scene`과 같은 느슨한 whitelist-map 형태, 서버가 필드명을 검증).
  - **판단 1 — 편집 허용 상태**: `EpisodeTimelineService`가 `add`/`duplicate`/`archive`에 이미 쓰고 있던 `draftStates`("planned" | "outline_ready" — 대본 생성이 개요를 프롬프트 입력으로 소비하기 전) 그대로 재사용. 다만 그 셋과 다르게 **프로젝트 전체가 아니라 그 Episode 자신의 상태만** 본다 — add/duplicate/archive는 번호를 재배치해서 전체가 draft여야 하지만, 개요 필드 편집은 번호도 다른 Episode도 안 건드리므로 Episode 1의 대본이 이미 진행 중이어도 Episode 5의 요약은 계속 고칠 수 있어야 한다는 판단.
  - **판단 2 — staleness 영향**: 없음(설계상). 편집은 그 Episode의 대본이 아직 없을 때만 허용되므로 애초에 stale해질 대상이 없다.
  - `LongProjectsService`가 아니라 `EpisodeTimelineService`(`episode_outlines.json` 읽기/쓰기를 이미 소유)에 구현 — 기존 `files()`/`publish()`/`toOutline()` 헬퍼 재사용.
  - 테스트 4건 신규(`episode-timeline.service.test.ts`): planned 상태에서 편집·outline_ready 상태에서 편집+디스크 반영 확인·"Episode 1 대본 시작 후에도 Episode 2는 편집 가능"(판단 1의 핵심 대조 테스트)·존재하지 않는 Episode 번호/모르는 필드/빈 값 거부.
  - 검증: root typecheck(shared 재빌드 후, backend+desktop 통과, frontend는 #9와 같은 이유로 실패 — 이번 계약 추가 자체는 새 프론트 에러를 만들지 않음, 확인함)·Backend 652 통과(+1 skip, 신규 4건)·`npm run build --workspace @ai-animation-studio/backend` 통과. 유료 Provider 호출 없음.
  - 커밋: `8f61f43`.
- [x] **CLI 계약 랜딩 완료 보고**: 계약 반영 끝났으니 Cowork가 화면을 붙이면 된다 — `.claude-bridge`에 상세 보고.

