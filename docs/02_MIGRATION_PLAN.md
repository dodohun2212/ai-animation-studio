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
- [x] **자가 발견 회귀 — `apps/frontend/src/api/longProjectsApi.ts`의 `isLongProjectSettings()`가 `platform` 필드를 여전히 강제**: #9로 백엔드가 `platform`을 응답에서 아예 안 보내게 된 뒤, 이 프론트 자체 응답 검증기(`PLATFORMS.has(value.platform)`)가 모든 장기 프로젝트 설정 응답을 `CLIENT_MALFORMED_RESPONSE`로 거부하고 있었다. Cowork의 Round 93~94 화면 작업(`ShortProjectSettingsScreen`/#9 라벨/#2)을 검증하던 중 프론트 테스트 37개(`App.test.tsx`·`longProjectsApi.test.ts`·`CreateLongProjectForm.test.tsx`·`LongProjectDetail.test.tsx`·`LongProjectOutlineScreen.test.tsx`·`LongProjectSettingsScreen.test.tsx`·`LongStoryBibleScreen.test.tsx`·`LongEpisodeNarrationReviewScreen.test.tsx`·`LongEpisodeVideoMergeScreen.test.tsx`)가 이걸로 실패하는 걸 발견했다. UI/디자인 판단이 필요 없는 순수 응답 검증기라(Round 81과 같은 범주) CLI가 직접 고쳤다 — `platform` 체크 한 줄 제거로 37개 전부 해결.
  - 검증: frontend typecheck·build 통과, 프론트 테스트 764개 중 760개 통과(남은 4개는 이 수정과 무관, Cowork의 다른 진행 중 작업 관련 — `.claude-bridge`에 보고).
  - 커밋: `50d3ff3`.
- [x] **Cowork 프론트 배치(Round 93~98) 완료**: #3·5(A — 캐릭터 목록 대표/서브 구분, 프롬프트가 이미 쓰던 판정 규칙 재사용), #6(간소화 — Asset Mapping 검토 문구가 실제 역할대로), #9 나머지 절반(라벨 로그라인→한 줄 줄거리·타겟 시청자→누가 볼 영상인가), #12(A — Story Bible→등장인물·설정집, 화면 간 교차 안내), #13 화면 1차(`LongEpisodeOutlineScreen` 신설, 라우팅은 의도적으로 다음 배치로 미룸), #2(사용자 승인 — 폴더 안에서 바로 새 이미지 등록). Round 91 #10·#11 뒷정리(복제 버튼 문구, 보관 힌트)도 같은 배치의 `LongProjectDetail.tsx`에 같이 들어왔다.
  - **도중 사고 2건, 둘 다 복구**: (1) Cowork가 `CreateLongProjectForm.test.tsx`를 컨테이너 마운트 갱신 타이밍 문제로 스테일 사본으로 덮어씀 — CLI가 `git checkout --`로 커밋 상태 복구, Cowork가 의도한 두 줄만 재적용해 해결. (2) `LongProjectDetail.tsx` diff가 신고된 "한 줄"보다 훨씬 컸던 것 — 확인 결과 오염이 아니라 Round 91 #10 작업이 같은 배치에 같이 포함된 것으로 판단(코드 일관성·대응 테스트 존재로 확인), 되돌리지 않고 그대로 진행.
  - 검증: root 아님(프론트 전용 배치라 frontend typecheck·test·build만) — typecheck 통과, 테스트 772개 전부 통과, build 통과.
  - 커밋: `4abf806`.
- [x] **#13 라우팅 배선 + #12 마지막 한 줄**: `App.tsx`에 `Screen`·`LONG_PROJECT_SCREEN_NAMES`·Episode 탭 라우팅 추가, `LongProjectDetail`에 `onOpenEpisodeOutline` prop. `episodeResumeTarget()`이 `planned` 상태에 링크가 없던 것도 같이 고쳐 개요 화면으로 이어하기 되게 함, `outline_ready`엔 대본 이어하기 옆에 별도 "회차 설정" 링크(서버 `draftStates` 편집 창을 벗어나면 사라짐). `LongProjectDetail.tsx`의 마지막 "Story Bible" 문자열도 "등장인물·설정집"으로. 신규 테스트 3건.
  - 검증: frontend typecheck·테스트 775개 전부 통과(+3 신규)·build 통과.
  - 커밋: `3275e0e`.
- [x] **#6(Asset Mapping 검토 간소화)**: 화면 첫 문단이 "자동으로 연결해 둔"이라고 주장하고 있었는데 이 저장소엔 자동 매칭이 없다(Round 92 확인) — 실제로는 연결하는 순간 이미 확정(`mappings.service.ts:64`)인데, 이 문장 때문에 버튼이 "AI 추천을 승인하는 자리"로 읽혔다(실사용자가 실제로 이 지점에서 헷갈림). 문구를 정직하게 재작성(연결=즉시 확정, 버튼은 빠진 장면 검사+다음 단계 전이 두 가지만), 버튼 이름을 하는 일 그대로(`최종 승인`→`연결 다 했음 · 다음 단계로`, `검토 시작`→`지금 대본 기준으로 다시 맞추기`), 이미 확정된 행에서 아무 일도 안 하던 `확인` 버튼 제거(`제외`는 유지), 기술 정보(Revision·Fingerprint 등)를 지우지 않고 `<details>`로 접음, 체크박스 두 개 한국어화. 백엔드 미변경.
  - 자가 발견 stale 테스트: 기존 "prevents a duplicate PATCH..." 테스트가 확정 버튼이 사라지는 새 동작과 충돌(같은 버튼 노드가 다시 활성화되길 기다림) — CLI가 발견·보고, Cowork가 테스트 목적(중복 PATCH 방지)은 유지한 채 마지막 대기 어서션만 "버튼이 사라짐 + 같은 행 다른 버튼 잠금 해제"로 교체.
  - 검증: frontend typecheck·테스트 776개 전부 통과(+1 신규)·build 통과.
  - 커밋: `caf22c8`.
- [x] **UI 전수 감사(사용자 요청: "쓸모없는·헷갈리는 버튼 정리, UI 보기 쉽게")**: 화면 33개, 45건 발견. 큰 항목(영어 용어 전면 한글화, Story Bible/Continuity 원시 JSON 편집창 제거, ProjectDetail 중복 버튼, 프로젝트 ID 직접 입력, 회차 보관 영문 타이핑)은 사용자 승인 받고 진행. 핵심:
  - **돈 관련 거짓 안내(🔴)**: `VideoPromptPreviewScreen`이 상단 배너("실제 유료 요청 안 함")와 확인 패널("실제 유료 요청 전송됨")이 서로 반대로 말하고 있었다 — 조건을 정확히 말하도록 재작성(화면 여는 것만으론 무료, 확인까지 마쳐야 과금).
  - **확인 없는 유료 버튼(🔴)**: `LongEpisodeVideoWorkflowScreen`의 `다시 시작`이 같은 화면 다른 유료 버튼과 달리 확인 패널 없이 바로 과금 요청을 보냈다 — 같은 확인 단계 추가.
  - **데이터 유실 함정**: `StoryPromptScreen`/`VideoPromptPreviewScreen`의 `새로고침`이 편집 중인 내용을 말없이 덮어씀 — `처음 내용으로 되돌리기`로 개명(편집 대상이 있는 화면만).
  - 하드코딩 `6`(`LongEpisodeImageGenerationScreen`) 재발 — `sceneNumbers.length`로.
  - `LongProjectList`/`LongProjectOutlineScreen`/`LongEpisodeVideoWorkflowScreen`에서 내부 enum(`outlineStatus`/`workflowState`/`episode.status`)이 화면에 그대로 샘 — 이미 있던 라벨 헬퍼로 교체.
  - `ImageGenerationScreen`/`VideoWorkflowScreen`의 영구 비활성 죽은 버튼 제거.
  - 영어 내부 용어 20파일 일괄 한글화(Asset Mapping→참고 이미지 연결 등, `data-testid`는 안 건드림).
  - `LongStoryBibleScreen`의 JSON 텍스트박스 두 개를 이름/내용 행 편집기(`PlainRecordEditor`)로 — 문자열이 아닌 값이 섞여 있으면 표를 안 그리고 JSON만 남겨 데이터 손실 방지, 원본 JSON은 `고급 편집` 안에 보존.
  - `LongEpisodeContinuityScreen`은 표로 안 바꿈 — `characterChanges`/`itemChanges`에 고정 키 스키마가 있는지 CLI에 문의, **백엔드 검증기·프롬프트 빌더 어디에도 개별 키를 읽는 코드가 없음을 확인**(전체를 `JSON.stringify`해서 프롬프트에 통째로 넣음) — 스키마를 지어내지 않기로 한 판단이 맞았다고 CLI가 답변. JSON 유지, 라벨·안내만 개선.
  - **자가 발견 — 버튼 이름 충돌**: `PlainRecordEditor`를 두 번 쓰면서 "항목 추가" 버튼이 화면에 3개(접근성 이름 동일) 생김 — CLI가 발견·보고, Cowork가 테스트가 아니라 화면 쪽을 고쳐(구역별 이름으로) 근본 해결.
  - 검증 라운드마다 stale 테스트 다수 발견·수정(라벨 변경에 따른 원문/enum 조회, DOM 순서 의존, 새 라벨과 충돌하는 부정 조회 패턴 등) — 전부 "검사하려던 성질"은 유지한 채 검사 방법만 교체.
  - 검증: frontend typecheck·테스트 775개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `a019342`.
- [x] **이미지 보관함 실사용 개선 + 워크플로우 그림화 + API 설정 용도 설명(사용자 실사용 피드백, 5라운드)**: `AssetLibraryScreen`이 최상위 목록에 폴더·폴더 밖 이미지·프로젝트 생성 이미지를 세 그룹으로 분리(폴더 자식은 폴더 안에서만), 프로젝트 생성물은 "프로젝트"로 표시하고 유형 필터에서 캐릭터/배경과 분리(새 `AssetType` 안 만들고 기존 `source_project_id` 구분 재사용), 상세 패널 5개 섹션을 `<details>`로 접고, 목록 선택·생성 폼 둘 다 서로 배타적으로 동작(같은 항목 재클릭 시 닫힘 포함). `WorkflowGuideScreen`에 `PipelineDiagram`(단계 가로 박스) + 단기/장기 탭 신설(장기 파이프라인이 화면에 아예 없었음), `LONG_OUTLINE_ESTIMATED_COST_USD`를 shared에서 재사용. `ProviderSettingsScreen`에 각 Provider가 실제로 뭘 하는지·끊으면 뭐가 막히는지 명시.
  - **자가 발견 — 접근성 결함**: 그룹 헤더·안내 문구를 `<li>`로 렌더하면서 `role="presentation"` 없이 넣어서 `getAllByRole("listitem")`이 헤더까지 항목으로 셈 — 인덱스 기반 기존 테스트 2건이 깨짐(CLI 발견·보고). Cowork가 테스트를 헤더-스킵으로 고치지 않고 `role="presentation"`으로 접근성 트리 자체를 바로잡아 근본 해결 — 스크린리더에도 헤더가 항목으로 안 읽히게 됨.
  - 검증: frontend typecheck·테스트 775개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `b9fe096`.
- [x] **장기 프로젝트 단계 이름 정리(실사용 피드백)**: 같은 단어가 서로 다른 화면에서 다른 뜻으로 쓰이던 것들을 분리 — "프로젝트 개요"→"작품 한눈에 보기"(vs "스토리 개요"), "설정"→"작품 기본 설정"(vs "등장인물·설정집"/"회차 설정"), "스토리 개요"→"회차 나누기(AI)"(동작 이름으로), "회차 설정"→"이 회차 내용", 탭 "Continuity"→"이어쓰기 메모"(화면 제목과 통일), "Episode {n}"→"{n}화". 장면 단위 이름도 구분: 대본/이미지/영상→장면 대본/장면 이미지/장면 영상, 병합→최종 영상 합치기. 화면 제목·탭 라벨이 서로 다른 이름을 쓰던 것도 통일(`LongProjectOutlineScreen`/`LongEpisodeOutlineScreen`/`LongProjectDetail`).
  - 검증: frontend typecheck·테스트 775개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `91b6701`.
- [x] **참고 이미지 연결 화면 자기모순 수정 + 프로젝트 상세 중복 제거 + 이미지 보관함 폴더 편집기 통합(실사용 피드백)**: `MappingReviewScreen`이 빈 목록("연결 없음")과 승인 차단 오류("확인 필요한 매핑 남음")를 동시에 보여주던 자기모순 수정(백엔드 코드 하나가 세 상황을 가리키던 것을 화면이 상황별로 판별), 연결 0개일 때 4단계를 1클릭으로 축소. `ProjectDetail`의 버튼 줄에서 진행 막대와 중복되던 항목 제거 + 내레이션 링크가 음성·자막 둘 다 꺼져 있으면 숨겨지도록(`getProjectSettings` 신규 호출, 실패 시 안전 폴백). `AssetLibraryScreen`의 폴더 편집 폼 중복(전체 특징 카드 + 접힌 옛 폼) 제거, 등록 폼에 역할 선택 추가.
  - **자가 발견 — CLI가 잡은 테스트 결함 3건**: 새 `getProjectSettings` fetch가 (1) 자기 자신의 신규 테스트에서 `ShortProjectSettings` 전체 필드를 안 채운 최소 목업이 응답 검증기를 못 통과해 안전 폴백만 계속 테스트하고 있던 것, (2)(3) 기존 아카이브 테스트 2건이 URL이 아니라 **호출 순서**로만 응답을 내주는 mock(`mockResolvedValueOnce` 체인)을 써서 새 fetch가 큐를 밀어낸 것 — 셋 다 원인을 정확히 짚어 보고, Cowork가 컴포넌트가 아니라 테스트 쪽(목업 필드 채움, URL 라우팅 방식으로 전환)을 고쳐 해결.
  - **자가 발견 — 이름 충돌 재발(3번째)**: "개별 특징"으로 라벨을 통일하면서 등록 폼과 자식 행의 같은 이름이 같은 접근성 구역 안에서 겹침(Round 112 "항목 추가"에 이은 같은 패턴) — Cowork가 등록 폼 쪽만 "새 이미지의 개별 특징"으로 좁혀 해결, 팀 규칙으로 명문화("이름 통일 전 그 구역 안 기존 이름부터 확인").
  - 검증: frontend typecheck·테스트 775개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `4fef345`.
- [x] **🔴 백엔드 — 폴더 자체의 displayName/description/tags 수정이 전면 차단돼 있었음(Cowork 실사용 중 발견)**: `assets.repository.ts`의 `update()`가 `is_folder`면 필드를 보지도 않고 무조건 거부하고 있었다 — 사용자가 직접 요청해 화면까지 다 만든 "폴더 전체 특징" 칸(Round 116/120)이 저장 자체가 안 되는 상태였고, 원래 있던 이름·설명·태그 편집도 폴더에서는 한 번도 성공한 적이 없었다. 자식 에셋에 이미 있던 화이트리스트 패턴(`role`/`description`만 허용)과 같은 방식으로, 폴더는 `displayName`/`description`/`tags`만 허용하는 화이트리스트로 좁혀 열었다(타입·버전·캐릭터 참조 연결 등 폴더에 의미 없는 필드는 계속 차단).
  - 기존 테스트 2건이 "폴더는 전부 거부"를 전제하고 있어 갱신: 하나는 "양쪽 다 거부" 프로브 필드를 `displayName`(이제 폴더에 허용됨)에서 양쪽 화이트리스트 밖인 `notes`로 교체, 다른 하나는 폴더 자신의 `description` 저장이 성공하는지·허용 필드와 비허용 필드를 섞으면 여전히 거부되는지로 뒤집음.
  - 검증: root typecheck, Backend 649 통과(+1 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문 있음), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `9833ec8`.
- [x] **캐릭터 선택을 폴더로만 제한(단기·장기 양쪽, 실사용 피드백)**: 단기 `대표 캐릭터` 피커가 폴더·낱장·자식 이미지를 구분 없이 한 목록에 섞어 보여줘서 캐릭터 하나가 6개 항목으로 보이던 것을 `asset.isFolder` 필터로 폴더만 남김(등장 캐릭터 목록이 이미 쓰던 규칙과 통일). 폴더는 자기 이미지가 없어 항상 회색 타일이던 것을 `thumbnailAssetId` 자식의 이미지로 대체 표시. 장기 프로젝트의 `LongStoryBibleScreen` 링크 선택기는 반대로 폴더를 아예 제외하고 있던 것을 등장인물=폴더만, 장소·소품=폴더+낱장 허용으로 정정, 폴더 선택 시 의미 없는 `버전 정책` 필드 숨김.
  - **CLI 판단 요청 처리 — `approved` 게이트를 폴더에 적용할지**: 폴더는 어떤 쓰기 경로로도 `approved`가 true가 될 수 없어(생성·수정 둘 다 항상 false, Round 125의 화이트리스트도 미포함) 기존 `enabled && approved` 규칙을 그대로 적용하면 폴더가 하나도 안 보인다. 백엔드 전체를 확인한 결과 `asset.approved`는 목록/검색 필터링에도, 매핑·프롬프트 빌더 어디에도 안 쓰이는 **순수 화면 표시용 플래그**임을 확인 — 백엔드 스키마 변경 없이 프론트에서 `enabled && !parentFolderId && (isFolder || approved)`로 폴더만 예외 처리하는 것으로 충분하다고 답변. Character Reference Set에 자식을 담는 행위 자체가 이미 사용자의 의도적 선별이라 승인 게이트를 우회하는 게 아니라고 판단.
  - 검증: frontend typecheck·테스트 776개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `2b965d5`.
- [x] **프로젝트 설정 화면(단기)에 하단 종료 버튼 상시 노출(실사용 피드백)**: 하단 마무리 버튼이 `justCreated`(방금 생성)일 때만 렌더돼, 나중에 설정을 다시 열면 등장 캐릭터·참고 Asset·이전 장면 연결 세 섹션 아래로 아무것도 없이 페이지가 끝났다 — 나가려면 스크롤을 거슬러 맨 위로 가야 했다. 하단 바를 항상 렌더링하도록 바꾸고, 재방문 시엔 `설정 마치고 프로젝트로`(신규, 맨 위 `프로젝트로 돌아가기`와 접근명을 의도적으로 다르게 — Round 112·119와 같은 이름 충돌 재발 방지) 버튼을 둠. 세 섹션은 클릭마다 저장되고 맨 위 폼만 명시 제출이 필요하다는 안내도 버튼 옆에 추가(각 에디터의 저장 호출을 직접 확인 후 작성). 장기 프로젝트 설정 화면은 이미 제출 버튼이 페이지 마지막 요소라 그대로 둠.
  - 검증: frontend typecheck·테스트 776개 전부 통과(첫 실행에서 무관한 `SceneEditScreen` 1건이 flaky로 나왔다가 재실행·단독 실행 모두 통과해 flaky로 판단)·build 통과. 백엔드·계약 미변경.
  - 커밋: `ee42b56`.
- [x] **🔴 백엔드 — 등장 캐릭터 저장이 100% 실패하고 있었음(실사용 중 발견)**: `updateProjectCast()`가 폴더 Asset을 전부 거부하는데, 캐릭터 검색 화면은 처음부터 폴더만 내놓는 설계(낱장 이미지는 캐릭터가 아니라 그림 한 장이라는 근거 주석 있음)라 두 조건이 정확히 배타적이었다 — `추가`를 누르면 무조건 `INVALID_REQUEST`. `describeCharacterCast()`(대본 프롬프트 빌더)가 이미 폴더 자식들을 순회해 "하위 이미지별 개별 특징" 블록을 만들고 있어 하위 지원은 이미 있었음을 확인, `is_folder` 배제만 제거(`asset_type !== "character"` 검사는 유지). 같은 라운드에서 보고된 "매핑도 폴더를 거부한다"는 두 번째 신고는 **현재 코드를 다시 확인한 결과 사실이 아니었다** — `mappings.service.ts`의 `create()`는 이미 `follow_latest` 정책·`selectedChildAssetIds`까지 갖춰 폴더 매핑을 완전히 지원 중이었다(허위 경보로 회신, 이번 세션에 반복된 마운트 사본 오래됨 문제로 추정).
  - 신규 테스트 1건(폴더 캐릭터 Asset이 cast로 저장됨).
  - 검증: root typecheck, Backend 650 통과(무관한 사전 존재 실패 2건 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `6bd7034`.
- [x] **실사용 중 막힌 곳 4건 해소**: 대본 승인 후 장면 텍스트 없이 끝나던 `StoryPromptScreen`에 실제 대본 전문 + 다음 단계 버튼 추가(승인 응답에 이미 있던 `project.scenes`를 그동안 버리고 있었음). 승인된 프로젝트를 재방문하면 재승인 시도가 항상 에러나던 것을 확인 — 백엔드에 승인 후 `Ready` 상태로 되돌리는 경로가 전혀 없음을 확인하고(재생성 기능 자체가 없음), 이미 대본이 있으면 프롬프트·승인 UI를 아예 미렌더하도록 방어(제품 판단 필요 항목으로 별도 보고). `MappingReviewScreen`의 `연결 다 했음 · 다음 단계로`가 다음 화면으로 이동하는 prop 자체가 없어 죽은 버튼이었던 것 수정, 이미 승인된 상태에서도 출구가 있도록 버튼 분리. "참고 이미지"라는 같은 이름이 설정 프롬프트 placeholder용과 실제 이미지 매핑용 두 경로를 가리키던 혼동을 화면 상단 설명 박스로 해소.
  - 검증: frontend typecheck·테스트 781개 전부 통과(+5 신규)·build 통과. 백엔드·계약 미변경(백엔드 폴더 수정과 별도 커밋).
  - 커밋: `658734e`.
- [x] **"서버 응답을 해석하지 못했습니다" 오류 문구가 서버 다운까지 뭉뚱그리던 문제(실사용 피드백)**: `projectsApi.ts`/`providerSettingsApi.ts`의 `requestJson()`이 백엔드의 `{ code, message }` 형태가 아닌 응답을 전부 "서버 응답을 해석하지 못했습니다"(`CLIENT_MALFORMED_RESPONSE`)로 뭉뚱그리고 있었다 — 실제로는 백엔드가 재시작 중이거나 꺼져 있어 5xx로 형태 없는 응답이 온 경우와, 서버는 응답했는데 그 형태가 잘못된 경우가 전혀 다른 상황인데 같은 문구로 안내됐다. 5xx + 백엔드 에러 형태 아님 → 신규 `CLIENT_SERVER_UNAVAILABLE`("서버가 재시작 중이거나 꺼져 있을 수 있습니다")로 분리, 4xx와 200-형태 불일치는 기존 `CLIENT_MALFORMED_RESPONSE` 유지. `projectsApi.ts`는 200-형태 불일치 시 URL+본문을 `console.warn`으로 남기도록 개선(화면엔 안 띄움, 여러 엔드포인트가 같은 문구를 공유해 URL 없이는 재현 못 찾는 문제 대응).
  - **CLI 검증에서 잡은 결함 2건, Cowork가 다음 라운드에 수정**: (1) `providerSettingsApi.ts`도 같은 분기를 이미 갖고 있었는데 짝 테스트(`providerSettingsApi.test.ts`)가 옛 기대값 그대로 남아 실패 — `projectsApi.test.ts`와 같은 flip 누락. (2) `providerSettingsApi.ts`에 추가된 `console.warn`이 이 파일을 콘솔 사용 금지 대상으로 명시한 기존 가드 테스트(`providerSettings.no-storage-no-console.test.ts` — credential 마스킹 상태가 로그로 새는 것을 막기 위한 의도적 제약)와 충돌. 세 가지 선택지를 제시했고 Cowork가 "로깅 제거"를 선택(가드 대상에서 파일을 빼는 대신) — `providerSettingsApi.ts`는 credential 상태를 다루므로 진단 편의보다 노출 위험을 우선한 판단. `projectsApi.ts` 쪽 로깅은 credential을 안 다루므로 그대로 유지, 두 모듈이 다른 결론을 갖는 것이 의도적임을 주석으로 남김.
  - 검증: frontend typecheck 통과, 테스트 784개 전부 통과(+3 신규: 5xx/4xx 경계 각각)·build 통과. 백엔드·계약 미변경.
  - 커밋: `27587c4`.
- [x] **대본 재생성 엔드포인트 신설 + 🔴 백엔드 — `Scene.script`/`generatedImagePath`가 응답에 한 번도 채워진 적이 없었음**: 사용자 결정("이미지 만들기 전까지만 다시 뽑기 허용", `.claude-bridge` Round 127)에 따라 `POST /projects/:id/story/regenerate` 신설. `workflow_state`를 `Ready`로 되돌리고 `scenes`/`story`/`image_prompts`/`motion_prompts`를 비운 뒤 기존 `story/preview`→`story/approval` 경로를 그대로 다시 태우는 형태(Cowork 제안 그대로) — 새 계약 필드는 만들지 않음(Cowork 판단대로 `Scene.generatedImagePath` 유무로 프런트가 이미지 존재를 판정). 허용 조건은 서버가 직접 검사(클라이언트 판단 신뢰 안 함): `workflow_state`가 `WaitingForAssetMappingReview`/`AssetMappingApproved`(대본은 있고 이미지 생성 전) 구간이어야 하고, `scenes.length > 0`(대본 존재), `generated_images.length === 0`(이미지 0개) 셋 다 만족해야 함.
  - **작업 중 발견 — 이 전제 조건 자체가 원래 작동할 수 없는 상태였다**: `Scene.generatedImagePath`/`script`/`motionPrompt`는 domain.ts에 "computed, mapped fields"로 문서화돼 있는데, `project.mapper.ts`의 `toApiProject()`가 실제로는 저장된 scene 객체를 가공 없이 그대로 통과시키기만 해서(`stored.scenes as unknown as Scene[]`) 셋 다 응답에 한 번도 채워진 적이 없었다. Cowork가 이미 `ImageGenerationScreen.tsx`에 이 사실을 주석으로 남겨뒀었고(생성 진행 폴링이 항상 대기로만 보이는 원인), `StoryPromptScreen.tsx`도 같은 이유로 `scene.script`가 항상 비어 있어 Round 109에서 막 추가한 "대본 전문 표시" 기능이 실제로는 매번 빈 화면 문구만 보여주고 있었다 — 이번 재생성 기능의 이미지-0개 판정도 이 버그 때문에 항상 참(이미지가 실제로 몇 개든 재생성이 항상 허용됨)이 될 뻔했다. `toApiProject()`에 `description`→`script`, `generated_images`/`generated_video_paths`/`motion_prompts` 배열 → 각 필드 매핑을 추가해 실제로 채워지도록 수정(그 외 사용처 없는 `imagePrompt`/`imageReview`/`videoReview`는 손대지 않음 — 프런트 어디서도 안 읽음, 확인함).
  - 신규 테스트: `project.mapper.test.ts` 1건(description→script, 배열 인덱스 정렬 매핑, 부재 시 생략까지 확인), `story-prompt.service.test.ts` 3건(정상 재생성 후 재승인까지 왕복 확인, 이미지 있음/대본 없음/요청 형식 오류 거부, 상태 구간 밖(생성 중/이미지 생성 중) 거부).
  - 검증: root typecheck(shared 재빌드 후, backend+desktop+frontend 전부 통과), Backend 654 통과(+4 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - **주의**: 검증 중 `apps/frontend/src/components/ImageGenerationScreen.tsx`/`.test.tsx`에 Cowork의 별개 작업(생성 진행률 표시 UI)이 디스크에 올라와 있던 것을 발견 — 이번 커밋 범위에 포함하지 않고 그대로 둠(`.claude-bridge`에 보고).
  - 커밋: `859d96f`.
- [x] **🔴🔴 백엔드 — 실제 사용자 프로젝트가 `GENERATING_IMAGES`에 갇혀 있었다(실사용 중 발견, `.claude-bridge` Round 129)**: 사용자가 이미지 생성을 시작한 뒤 서버가 중간에 내려가면서, 6장 중 3장(실제 유료 호출, 약 $0.30)은 이미 만들어져 디스크에 있는데 프로젝트가 `GENERATING_IMAGES`에 영구히 갇힌 실제 사례를 Cowork가 발견해 보고. 원인: 이 상태를 벗어나는 코드가 `local-image-generation.service.ts`의 `generate()` 자체가 던지는 JS 예외를 잡는 catch 블록 하나뿐이라, 프로세스가 예외 없이 그냥 죽으면(서버 종료 등) 되돌릴 방법이 앱 어디에도 없었음 — `GENERATING_STORY`/`GENERATING_VIDEOS`/`RENDERING`도 각자의 진행 루프 하나에만 복구를 의존하는 같은 구조라 동일한 위험이 있음을 확인.
  - **해결**: 이 앱은 설치당 로컬 프로세스 1개로만 동작(클러스터·다중 인스턴스 없음)하므로, 새 프로세스가 뜨는 시점에 이 네 "생성 중" 상태 중 하나에 있는 프로젝트는 무조건 고아 상태라는 판정이 항상 안전하다(Cowork의 두 제안 중 시간 임계값이 필요 없는 2번 채택). `OrphanedGenerationRecoveryService`(`OnApplicationBootstrap`) 신설 — 서버 시작마다 각 프로젝트를 검사해 그 생성 루프가 원래 시작했던 상태로 되돌림: `GENERATING_STORY`→`READY`(기존 `StoryPromptService`의 실패 시 복구와 동일), `GENERATING_IMAGES`→`ASSET_MAPPING_APPROVED`(재클릭 시 이미 만들어진 장면은 `generate()`가 이미 무료로 재사용함, 신규 코드 불필요), `GENERATING_VIDEOS`→`INTERRUPTED`(기존 "이어서 생성"/`restart()` 재개 흐름을 그대로 재사용 — 새 UI 불필요), `RENDERING`→`VIDEOS_APPROVED`(로컬 병합은 저장된 진행분이 없고 Provider 비용도 없어 재시도만 허용하면 됨). 이미 만들어진 파일·기록은 그대로 두고, `project.warnings`에 한국어 안내를 추가해 `ProjectDetail`의 기존 경고 배너로 노출(사용자에게 무슨 일이 있었는지 화면에서 바로 보임).
  - **의도적으로 범위에서 뺀 것**: 장기 프로젝트(Long Episode)의 회차별 생성 루프도 같은 단일 프로세스 위험을 가질 가능성이 높지만, 이번 라운드는 짧은 프로젝트 쪽만 조사·수정했다 — 별도 확인이 필요함을 보고에 남김.
  - 신규 테스트 3건(`orphaned-generation-recovery.service.test.ts`): 네 상태 전부 정확히 되돌아가고 이미 만들어진 결과물은 그대로인지, 해당 없는 프로젝트는 안 건드리는지, 재실행해도 멱등인지.
  - **검증 중 걸림돌**: 새 파일의 주석에 "ffmpeg"이라는 단어가 있어서 이 디렉터리(`apps/backend/src/projects/`) 전체에 Provider/프로세스 도구 언급을 금지하는 기존 가드 테스트(`projects.no-provider-calls.test.ts` — 주석도 grep 대상)에 걸림. 단어를 우회해서 서술하는 쪽으로 수정(이번 세션에 Cowork가 credential 가드에서 겪은 것과 동일한 패턴).
  - 검증: root typecheck 전부 통과, Backend 657 통과(+3 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `a6f258d`.
- [x] **대본 재생성 UI 연결**: `storyPromptApi.ts`에 `regenerateStoryPrompt()` 추가(`{ approved: true }` 명시 opt-in), `StoryPromptScreen`이 이미 대본이 있는 화면을 이미지 0개(재생성 확인 패널 + 설정 먼저 고치기 링크)/1장 이상(버튼 없이 이유 설명)로 분기. 서버의 조건 검사를 프런트가 중복하지 않고 서버 응답을 그대로 신뢰하는 구조. 성공 후 설정이 바뀌었을 수 있어 미리보기를 다시 부름.
  - 검증: frontend typecheck 통과, 테스트 787개 중 786개 통과(신규 3건 포함). 남은 1개(`ImageGenerationScreen.test.tsx`)는 이번 라운드와 무관 — 이전 라운드(Round 128)에서 이미 커밋돼 있던 수정(`workflowStateLabel` 한국어 라벨 검증)이 되돌아간 회귀, `.claude-bridge`에 이미 두 차례 보고함. `apps/frontend/src/components/ImageGenerationScreen.tsx`/`.test.tsx`는 이번 커밋 범위에서 계속 제외.
  - 커밋: `dd030c5`.
- [x] **이미지 생성 실시간 진행 표시(사용자 요청) + 이전 라운드 회귀 복구**: `ImageGenerationScreen`이 생성 요청이 도는 동안 3초마다 폴링해 `N/6장 완료` + 진행 막대 + 경과 시간을 보여주고, 장면 줄 문구를 생성 중엔 `대기` 대신 `만드는 중`으로 바꿈(Round 132의 `generatedImagePath` 매핑 수정 덕에 폴링이 실제로 값을 받게 됨). Round 128에서 이 파일을 마운트의 낡은 사본 기반으로 편집하면서 같은 파일에 이미 커밋돼 있던 3줄(`workflowStateLabel` 한국어 라벨 검증, Round 91)이 옛 형태로 되돌아간 회귀를 CLI가 두 라운드 연속 보고 → Cowork가 원래대로 복구.
  - **팀 절차 변경(Cowork 쪽)**: 이번 세션 다섯 번째 같은 사고(마운트 낡은 사본) 이후, "편집할 파일은 매번 편집 직전에 무조건 재스테이징"으로 규칙을 좁은 예외 없이 확정 — 크기 비교로는 이번처럼 3줄짜리 회귀를 못 걸러낸다는 것을 근거로 듦.
  - 검증: root typecheck 전부 통과, frontend 테스트 788개 전부 통과(+3 신규: 진행 중 표시 1건 등), root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `491b4d7`.
- [x] **🔴 참고 이미지 연결 기능이 앱에 아예 없었음(실사용 중 발견, `.claude-bridge` Round 133)**: 사용자가 대표 캐릭터 이미지가 그림에 전달 안 된 것 같다고 신고 → Cowork가 조사해서 `mappingsApi.ts`에 `POST /projects/:id/assets/mappings`를 부르는 코드 자체가 프런트 어디에도 없었음을 확인(참고 이미지 연결 검토 화면은 기존 연결을 확인·제외만 가능, 만드는 수단이 없었음) — Cowork가 `createProjectAssetMapping()` + `MappingReviewScreen`에 검색·연결 섹션을 신설.
  - **백엔드 쪽 나머지 절반 — `imagePromptFor()`가 매핑된 에셋의 텍스트 설명을 프롬프트에 전혀 안 넣고 있었음**: `collectReferenceImages()`가 확정된 매핑의 이미지 바이트는 그림 모델에 보내는데, 그 에셋이 누구인지·어떤 특징인지 텍스트는 프롬프트 어디에도 없었다 — 참고 사진은 가는데 이름도 설명도 안 감. `describeReferenceMappingsForScene()`(`image-reference-selection.ts`) 신설 — `collectReferenceImages`와 완전히 같은 필터(확정+활성+장면범위)로 골라서, 같은 매핑 집합에 대해 이미지와 텍스트가 절대 서로 다른 걸 가리키지 않도록 함. 폴더 매핑은 폴더 자체 설명 + 자식별 개별 특징까지(Story 프롬프트의 `describeCharacterCast`와 같은 모양 — `folderChildDescriptions` export해서 재사용). `imagePromptFor()`에 `referenceNotes` 선택 인자 추가(기본값 "", `styleLine`과 같은 패턴), `local-image-generation.service.ts`(최초 생성)·`image-review.service.ts`(재생성)에서 계산해서 전달.
  - **의도적으로 범위에서 뺀 것**: `scene-staleness.ts`(장면 필드만 보는 순수 동기 함수라 매핑 접근이 없음, 확장하면 위험도 큼)와 장기 프로젝트(Long Episode) 이미지 경로는 이번 라운드에서 안 건드림 — 필요하면 별도 확인.
  - 신규 테스트 4건(`image-reference-selection.test.ts`), 기존 3건 수정(`image-review.service.test.ts` — 실제 매핑이 있는 픽스처라 전송되는 프롬프트에 References 섹션이 새로 포함됨을 반영).
  - 검증: root typecheck 전부 통과, Backend 661 통과(+4 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `0986494`.
- [x] **예상 비용 문구 정정 + 재사용 함정 안내(Round 134)**: 이미지 재생성 확인 패널이 이미 만들어진 장면을 빼지 않고 항상 6장 전체 비용을 표기하던 것을 남은 장면 기준으로 수정(`generatedImagePath` 매핑이 붙어서 가능해짐). 더 중요한 문제도 같이 짚음 — `generate()`가 유효한 기존 이미지를 무료로 건너뛰기 때문에, 참고 이미지를 새로 연결한 뒤 다시 눌러도 이미 있는 장면은 절대 다시 그려지지 않는다(에러도 비용도 없이 조용히 아무 일도 안 일어남). 재사용이 걸리는 장면 수를 패널이 직접 안내하고, 실제로 반영되는 경로는 장면별 재생성(`collectReferenceImages`를 호출하는 유일한 경로)이라고 알려줌 — 일괄 재생성 기능 자체는 이번엔 안 만들고 제품 판단으로 남김.
  - 검증: frontend typecheck·테스트 791개 전부 통과·build 통과. 백엔드·계약 미변경.
  - 커밋: `b655375`.
- [x] **설정에서 고른 캐릭터·분위기·장면 참고 Asset을 참고 이미지로 자동 연결(사용자 결정, Round 135)**: Round 133이 만든 연결 기능이 오히려 중복을 하나 더 늘렸다는 사용자 지적(같은 캐릭터를 설정과 참고 이미지 연결 화면에서 두 번 고름) — 제시된 3안 중 사용자가 "자동 연결"을 선택. `syncAutoMappings()`(`project-asset-mapping-sync.ts`) 신설, `updateProjectCast()`/`updateProjectAssetReferences()` 저장 직후 호출. 기존에 있었지만 아무도 안 만들던 `assignment_source: "auto"` 값을 실제로 사용, `match_reason`을 태그로 써서(`auto_cast`/`auto_atmosphere`/`auto_scene_reference`) 설정 섹션 하나를 저장해도 다른 섹션이 만든 매핑은 안 건드림. 캐스트→`usage_role: "character"`, 분위기→`"atmosphere"`, 장면 참고→사용자가 적은 `purpose` 그대로, 셋 다 모든 장면 범위(셋 다 장면 번호 개념이 없음). `status: "confirmed"`/`user_confirmed: true`로 바로 생성(사용자가 이미 설정에서 이름으로 직접 고른 것이라 재확인은 같은 질문을 두 번 하는 것 — 이번 신고의 핵심). 같은 에셋에 수동(또는 다른 태그의 자동) 매핑이 이미 있으면 새로 안 만듦(`collectReferenceImages`가 중복 제거를 안 해서 같은 그림이 두 번 전송되는 것을 방지).
  - **판단 — 기존 프로젝트 처리**: Cowork가 제시한 두 옵션(부팅 시 일괄 채움 / 다음 설정 저장 때 자연스럽게 채움) 중 후자를 택함 — 침습 범위를 "사용자가 실제로 다시 저장한 것"으로 한정.
  - **build-break 1건 직접 수정**: 검증 중 `MappingReviewScreen.test.tsx`(Cowork의 별개 진행 중 작업, 아직 미보고)의 `assetType: "general"`이 존재하지 않는 값이라 frontend build가 막혀 있던 것을 확인 — 명백한 오타(`general_reference`)라 AGENTS.md 예외대로 그 한 줄만 직접 고침, 나머지 diff는 그대로 두고 커밋하지 않음(`.claude-bridge`에 보고).
  - 신규 테스트 4건(`projects.service.test.ts`): 캐스트 자동 연결 생성·제거, 수동 매핑 있을 때 중복 안 만듦, 분위기+장면참고 자동 연결과 purpose 변경 시 같은 매핑을 갱신(새로 안 만듦).
  - 검증: root typecheck 전부 통과, Backend 665 통과(+4 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과(위 build-break 수정 포함). 유료 Provider 호출 없음.
  - 커밋: `4a25beb`.
- [x] **참고 이미지 연결 화면 버그 2건(Round 138)**: 프로젝트 자신이 만든 장면 이미지 폴더가 참고 후보로 떠서 자기 결과물이 자기 참고 자료로 들어가던 것을 `sourceProjectId === "_asset_library_manual"`만 후보로 남기게 수정(`AssetLibraryScreen`이 이미 쓰던 구분 재사용). 제외한 매핑이 계속 "연결됨"으로 보이던 것(`alreadyLinked`가 상태를 안 보고 assetId만 봄)을 `연결`/`연결됨`/`제외됨` 셋으로 분리하고 되돌리기는 그 행 자신의 `확인` 버튼으로 안내.
  - 검증: frontend typecheck·테스트 793개 전부 통과(+2 신규)·build 통과. 백엔드·계약 미변경.
  - 커밋: `03e6b0a`.
- [x] **🔴 백엔드 — 복구 경고가 내부 상태명을 그대로 노출하고 영원히 안 사라짐(실사용 중 발견, `.claude-bridge` Round 137)**: 고아 상태 회수(Round 129)가 남기는 경고 문구에 `GENERATING_IMAGES`/`ASSET_MAPPING_APPROVED` 같은 `WorkflowState` 값이 그대로 박혀 있어 사용자가 "이건 뭐야"라고 물었다 — `ImageGenerationScreen`의 `현재 상태: READY`를 `준비됨`으로 바꾼 것과 같은 부류의 버그가 이번엔 프런트가 손댈 수 없는 백엔드 완성 문장으로 재발했다. 상태 이름을 아예 안 쓰는 고정 한국어 문장으로 교체(회수 종류별 4개, `orphaned-generation-recovery.service.ts`). 같이 발견된 구조적 문제 2건도 처리: (1) 같은 프로젝트가 반복해서 같은 상태로 죽으면 같은 문장이 계속 쌓이던 것 — 이미 있는 문장이면 다시 안 붙임. (2) 경고가 한번 붙으면 상황이 해결돼도 절대 안 없어지던 것(사용자 프로젝트가 실제로 영상 단계까지 갔는데 "이미지 만들다 멈췄다" 경고가 그대로 있었음) — `toApiProject()`가 매 응답마다 `workflow_state`를 보고, 그 경고가 가리키던 되돌림-전/되돌림-후 상태 구간을 실제로 벗어났으면 조용히 뺀다(`withoutStaleRecoveryWarnings`) — 이 서비스가 안 쓴 다른 경고는 절대 안 건드림, 매 downstream 서비스가 알아서 지우게 만들 필요도 없음.
  - 신규 테스트 8건(`orphaned-generation-recovery.service.test.ts` 5건 — 문구에 대문자 상태명 없음 확인 포함, `project.mapper.test.ts` 1건 — 실제 배선 확인).
  - 검증: root typecheck 전부 통과, Backend 670 통과(+8 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `0e524d9`.
- [x] **자동 연결 문구 정정 + 제외한 연결이 목록에서 안 사라짐(Round 139)**: 자동 연결(`4a25beb`) 적용 즉시 "설정에서 골라도 자동으로 안 올라옵니다"가 거짓말이 돼서 바로 정정 — "저장할 때" 시점을 명시해 기존 프로젝트(다음 저장 때 채워짐)와 신규 프로젝트 둘 다 참인 문장으로 씀, 화면이 "조정하는 곳"이라는 설명도 추가. 제외한 연결이 목록에 계속 존재감 있게 남아 "제외가 안 먹힌 것처럼" 보이던 것 — 기본으로 숨기고 `쓰지 않기로 한 연결 N개는 숨겼습니다 · [보기]` 안내, 상태 필터에서 `제외됨`을 명시 선택하면 그게 우선.
  - **왼쪽 진행 단계 표시가 진행도가 아니라 화면 위치였음(사용자 지적, Round 140)**: `App.tsx`의 `ShortProjectPipeline`이 채운 점을 "지금 보고 있는 화면 앞이면 채움"으로 계산해서, `대본`을 클릭하면 뒤가 전부 꺼지고 `최종 영상 합치기`를 누르면 전부 켜졌다 — 진행도처럼 생겼는데 실제로는 "지금 어디 보고 있나"에 답하고 있었다. 프로젝트 자신의 `workflowState`를 읽어(`getProject`, 화면 전환마다 재조회) 계산하도록 바꾸고, `PIPELINE_REACH`로 18개 상태를 6단계에 매핑(한 단계의 여러 국면은 같은 인덱스로 묶음, `FAILED`/`CANCELLED`/`INIT`은 아무것도 안 켬), "지금 보고 있는 화면"은 점이 아니라 행 배경으로 따로 표시(이동해도 점은 안 바뀜).
  - **검증에서 걸린 두 충돌, 둘 다 확인·수정**: Round 139의 기본 숨김 변경이 "필터 없으면 다 보인다"를 전제하던 기존 테스트, Round 138에서 Cowork 스스로 추가한 테스트(제외 행의 텍스트를 준비 신호로 씀)를 각각 깼다 — 원래 동작으로 되돌리지 않고 새 의도한 동작에 맞게 단언을 갱신. `App.test.tsx`의 `GET /projects/:id` 정확히 2회 단언도 새 사이드바가 화면 전환마다 재조회하면서 깨진 것 — 정확한 총 횟수 대신 "재진입 이후에 최소 한 번 더 불렀는가"로 바꿔 그 보장의 실제 의도(재진입 시 새로 읽는다)만 남기고 무관한 이유로 깨지지 않게 함.
  - 검증: root typecheck 전부 통과, frontend 테스트 795개 전부 통과, root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `6a0a6a4`.
- [x] **🔴 백엔드 — 1번 장면 영상 생성이 Runway에서 거부됐는데 원인을 알 방법이 없었음(실사용 중 발견, 유료 $0.25 손실, `.claude-bridge` Round 143)**: Cowork가 정황 증거로 좁혀서 3건을 보고 — 셋 다 확인 후 수정.
  - **1) 1번 장면 프롬프트에 빈 라벨**: `video-preview.service.ts`의 `promptFor()`가 빈 값 섹션을 걸러내지 않아서, `previous`가 원래 없는 1번 장면마다 `Continuity cue: `(콜론 뒤 공백)가 그대로 전송되고 있었다 — 같은 저장소의 `imagePromptFor()`는 이미 이 걸러내기를 하고 있었는데 영상 쪽만 빠져 있었다. `sections.filter(([, value]) => value)`로 통일. (원인 단정은 못 함 — Runway의 실제 거부 사유는 본문에 있었는데 그동안 버려지고 있었어서, 아래 2번을 고치기 전까지는 확인 불가.)
  - **2) Runway의 거부 사유 본문을 버리고 있었음**: `runway-video-adapter.ts`의 `requestWithRetry()`가 4xx/5xx 응답을 분류만 하고 본문을 한 번도 안 읽어서, 기록에 `"invalid_request"` 한 단어만 남았다. `RunwayAdapterError`에 `detail` 필드 신설(사용자에게 보여주는 `.message`와 분리 — `.message`는 여전히 고정된 안전한 한국어 문구) — 4xx 본문에서 뽑은 원문을 `video_generation_records[].error`에 `"category: detail"` 형태로 남긴다. **화면엔 절대 안 감**: `sceneErrorMessage()`가 알려진 카테고리 문자열과 정확히 일치할 때만 안전 문구를 붙이고, 그 외엔 이미 전부 일반 문구로 폴백하고 있었다(폴링 경로의 Runway 원문 실패 사유도 원래 같은 방식으로 보호돼 있었음) — 같은 안전장치를 제출 실패 경로까지 넓힌 것뿐, 새 위험 없음.
  - **3) data-URI 크기 검사가 원본 바이트를 잰다**: `MAX_DATA_URI_BYTES`(5MB)를 base64 인코딩 전 원본 바이트에 적용하고 있었는데, Runway의 제한은 실제 전송되는 base64 텍스트 기준(원본의 약 4/3배)이라 3.5MB대 PNG가 로컬 검사는 통과하고 원격에서만 거부될 수 있었다. 실제 base64 문자열 길이로 검사하도록 수정.
  - 신규/수정 테스트 7건(`video-preview.service.test.ts` 1건, `runway-video-adapter.test.ts` 3건 — detail 추출 3가지 응답 모양 + base64 크기 경계, `runway-workflow-support.test.ts` 2건, `local-video-workflow.runway.test.ts` 1건 — 기존 단언을 새 detail 포함 형태로 갱신).
  - 검증: root typecheck 전부 통과, Backend 674 통과(+4 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `df280ca`.
- [x] **Runway 크레딧 부족을 "요청 형식 오류"로 안내 + 거부된 제출이 예산을 갉아먹던 문제(Round 144)**: `detail` 필드(`df280ca`) 덕분에 사용자가 재시도 한 번 만에 실제 원인(Runway 크레딧 소진, 정황 추론이었던 빈 Continuity cue는 원인이 아니었음)이 확인됐다 — 그 과정에서 드러난 2건.
  - **1) 크레딧 부족이 `invalid_request`로 뭉개져서 "요청 형식 오류"로 안내되고 있었음**: OpenAI 쪽에 이미 있는 `quota_or_permission` 카테고리를 Runway에도 추가. `refineCategory()`가 `detail` 추출에 이미 읽은 본문을 재사용해(추가 비용 없음, throw 직전에만 동작) `credit`/`quota` 계열 문구가 있으면 `invalid_request`/`permission`을 `quota_or_permission`으로 재분류. 프런트 한국어 문구는 Cowork가 백엔드 카테고리에 맞춰 붙이기로 함.
  - **2) 제출 자체가 거부돼 아무 작업도 안 일어난 경우도 예산에서 전액 차감되고 있었음**: `RunwayBudget.record()`가 성공·실패 구분 없이 항상 `actual_cost_usd = estimated_cost_usd`로 기록하는 게 원래 의도된 보수적 설계인데(생성 도중 실패는 이 판단이 맞음), Runway가 작업 자체를 시작 안 한 4xx 제출 거부는 실제 청구가 0이라 다른 경우다. `record()`에 `actualCostUsd` 선택 인자 추가(기본값은 추정치 그대로라 기존 호출부 전부 무변경), 제출 거부 경로에서만 `0`으로 명시 — 실패 이력은 그대로 남고 월 한도만 안 깎임.
  - **판단 — 사용자 데이터에 이미 들어간 $0.50(실패 2건)**: 손대지 않음. `runway_budget_usage.json`은 실제 사용자 금전 기록이라 코드 변경 김에 임의로 재작성하지 않는 게 맞다고 판단 — 필요하면 사용자가 직접 요청.
  - 신규/수정 테스트 6건(`runway-video-adapter.test.ts` 2건, `runway-workflow-support.test.ts` 3건, `runway-budget.test.ts` 1건).
  - 검증: root typecheck 전부 통과, Backend 678 통과(+4 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `5957da0`.
- [x] **🔴🔴 백엔드 — Runway 영상 제출이 이중으로 나가고 있었음(실사용 중 발견, 유료 이중 청구, `.claude-bridge` Round 145)**: 사용자가 Runway 대시보드 API 로그를 직접 확인해 "같은 초에 POST 2번 → task 1개만 폴링"이 대부분 장면에서(때로는 몇 시간 간격으로) 반복되는 걸 발견 — Runway는 둘 다 과금하는데 우리 기록엔 성공한 task 하나만 남아 있어서 아무도 못 봤던 버그.
  - **조사**: Cowork가 제시한 in-process 경합 후보 3개(`advanceReal`의 `advancing` Set 가드가 뚫리는 경로)를 먼저 검증 — `run()`/`getProgress()`/타이머 틱이 실제 Promise 인터리빙(가짜 타이머 아님)으로 동시에 부딪히는 재현 하네스를 만들어 6장면 전체 흐름 동안 집중 폴링까지 걸어봤지만 가드가 모든 경우에 버텼다 — 가드 자체는 원인이 아님을 확인.
  - **실제 원인**: `requestWithRetry()`가 네트워크 수준 실패(타임아웃·연결 끊김)나 429/5xx를 만나면 **작업 생성 POST까지 그대로 재시도**하고 있었다 — `fetch`가 예외를 던진다는 건 "응답을 못 받았다"는 뜻이지 "Runway가 요청을 못 받았다"는 뜻이 아닌데, 이 구분 없이 재시도하면 Runway 쪽엔 이미 만들어진 진짜 task가 있는 채로 우리가 새 task를 하나 더 만들 수 있다 — 우리는 나중에 받은 응답의 taskId만 기억하니 먼저 만든 쪽은 그대로 버려지고 청구만 남는다. `createRunwayImageToVideoTask()`가 호출자가 뭘 넘기든 `maxRetries: 0`으로 강제하도록 수정 — 작업 생성은 멱등이 아니라서 자동 재시도가 원천적으로 안전하지 않음. `getRunwayTask`/`downloadRunwayOutput`(둘 다 안전한 GET)은 그대로 재시도 유지.
  - **2차 방어선(Cowork 제안 그대로)**: `applyRunwayAdvance`의 "submitted" 분기가 저장 직전에 프로젝트를 다시 읽어, 그 사이 다른 advance가 이미 해당 장면을 "created"에서 벗어나게 했다면(방금 만든 진짜 청구된 task를 잃어버리게 됨) 조용히 덮어쓰지 않고 평문 한국어 경고(원시 task id 없음)만 남기고 기존 기록은 그대로 둔다 — 근본 원인을 못 잡았더라도 다음엔 우리 데이터만으로 보이게.
  - 신규/수정 테스트 5건(`runway-video-adapter.test.ts` 3건 갱신 — 재시도 요청해도 무시됨 확인, `local-video-workflow.runway.test.ts` 1건 신규 — 지연된 fetch 응답으로 경합 재현해 경고·미덮어쓰기 확인).
  - 검증: root typecheck 전부 통과, Backend 679 통과(+1 순증, 무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `c85bd6c`.
- [x] **크레딧 부족 프런트 문구 연결(Round 146)**: `SCENE_ERROR_CATEGORY_MESSAGES`에 `quota_or_permission` 추가, 백엔드 안전 문구와 동일한 문장으로 맞춤. 신규 테스트 1건(Runway 원문이 코드 자리에 와도 일반 폴백으로 떨어지는 것 회귀 방지 포함).
  - 검증: frontend typecheck·테스트 796개 전부 통과(+1 신규)·build 통과. 백엔드·계약 미변경.
  - 커밋: `0f9a443`.
- [x] **🔴🔴 사용자 요청 전수 점검 결과 처리(Round 148) — OpenAI 5곳 같은 이중 과금 버그 + 영상 프롬프트 조용한 절삭 + stale 오탐**: 사용자가 "중복 요청 없나 / 정보 안 빠지나" 재개 전 확인을 요청, Cowork가 전수 조사해 9개 항목 보고 — 그중 최우선 2개(🔴)와 인접한 🟡 1개를 이번 라운드에서 처리.
  - **1) OpenAI 생성 API 5곳에 Runway와 같은 재시도 버그**: `callOpenAiImageApi`/`callOpenAiImageEditApi`/`callOpenAiStoryApi`/`callOpenAiTtsApi`/`callOpenAiEpisodePlannerApi` 전부 네트워크 실패나 429/5xx에 생성 POST 자체를 재시도하고 있었다(기본 2회, 논리적 1회 호출당 최대 3회 실제 과금 가능) — Runway 때와 완전히 같은 결함. 다섯 곳 전부 재시도 루프를 아예 제거(죽은 재시도 분기를 남기지 않기 위해 `maxRetries: 0` 강제가 아니라 루프 자체를 걷어냄) — 단일 시도만, 실패는 그대로 호출자의 provider-error 경로로. 예산 장부가 논리 호출 1건만 세던 과소 집계 문제도 이걸로 같이 해결(재시도 자체가 없어졌으니).
  - **2) 영상 프롬프트가 1,000자 넘으면 4개 섹션(속도·강도 → 환경 움직임 → 표정 변화 → 이전 장면 연결)을 조용히 버리는데 아무 신호가 없었음**: `promptFor()`가 `{ prompt, omittedSections }`를 반환하도록 변경, `VideoPromptPreview`에 `omittedSections?: string[]` 계약 추가(실제로 잘렸을 때만 포함, 비어서 원래 없던 섹션과 구분). 화면 문구는 Cowork가 붙이기로 함.
  - **🟡 인접 발견 — `scene-staleness.ts`가 매핑 있는 프로젝트의 모든 장면을 항상 imageStale로 표시하고 있었음**: Round 133에서 `imagePromptFor()`에 `referenceNotes` 인자를 추가했는데 이 파일만 갱신을 안 해서, 매핑이 하나라도 있으면 재계산한 프롬프트가 실제 기록과 영원히 안 맞았다(꺼지지 않는 오탐). `computeSceneStaleness()`가 선택적 `{ assets, mappings }` 컨텍스트를 받아 같은 블록을 재구성하도록 수정 — `image-review.service.ts`(사용자가 실제로 이 신호를 보고 행동하는 화면)에 연결. `scene-edit.service.ts`/`narration-review.service.ts`/`local-video-workflow.service.ts`는 아직 `LocalAssetsRepository`가 안 꽂혀 있어 기존 동작 그대로(개선 안 됐지만 악화도 아님) — TODO 주석으로 남김, 같은 방식으로 이어서 고칠 것.
  - 신규/수정 테스트 다수(5개 OpenAI 어댑터 각 재시도 테스트를 "무시됨" 형태로 갱신, `scene-edit.service.test.ts` 2건 수정, `image-review.service.test.ts` 2건 신규 — 매핑 있어도 오탐 없음 + 실제 변경 시 정확히 감지).
  - 검증: root typecheck 전부 통과, Backend 679 통과(무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `198e7e2`.
- [x] **Round 148 🟡 남은 항목 중 — Runway stale-snapshot 제출 갭 마저 닫음**: `advancing` Set 가드는 같은 jobId의 동시 진입을 확실히 막지만, 대기하던 호출자가 가드 획득 전에 이미 읽어둔 낡은 프로젝트 스냅샷을 그대로 들고 들어오는 경우는 안 막았다 — Round 145의 2차 방어선(저장 직전 재확인)이 Runway 왕복 이후의 창을 닫았다면, 이건 그 이전의 창이다. `advanceRealCore`가 자기 자신의 첫 동작으로 프로젝트를 다시 읽도록 수정.
  - **의도적으로 이번엔 안 건드린 것(Round 148 🟡 나머지)**: 장기 프로젝트(Long Episode) 영상 경로에 2차 방어선이 아직 없는 것, 2차 방어선 경고에 원시 task id를 안 넣는 것, 고아 task에 대해 `budget.record`가 아예 안 불려서 예산 행조차 안 생기는 것 — 셋 다 별도 판단·설계가 필요해 이번 라운드에서 안 건드림.
  - 검증: root typecheck 전부 통과, Backend 679 통과(무관한 사전 존재 실패 2건은 그대로 — Round 100에 전문), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `d53332d`.
- [x] **`failed-scenes-section` 렌더링 조건이 자기모순이라 죽은 코드였음(Round 149/150/151)**: `progress.status === "failed"`로 감싼 블록 안에 `progress.status === "interrupted"`일 때만 참인 `canRestart`를 쓰고 있었다 — `progress()`가 `Interrupted` 상태에선 실패 장면 수와 무관하게 항상 `"interrupted"`를 보고하므로 이 블록은 절대 렌더링될 수 없었다(Round 149의 "재시도 비활성화 + 안내 문구" 수정 전체가 죽은 코드였고, 부수적으로 실패 사유 문구도 이 상태에선 아예 안 보이고 있었다). 게이트를 `progress.failedSceneNumbers.length > 0`으로(상태 문자열 무관) 바꾸고 헤더 문구를 `canRestart` 기준으로 분기.
  - 검증: root typecheck 전부 통과, frontend 테스트 798개 전부 통과, root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `e352527`.
- [x] **🔴🔴🔴 백엔드 — Runway 이중 제출의 진짜 근본 원인: `nest start --watch` 재시작 구간에서 두 프로세스가 겹침(실사용 중 발견, 실청구 $3.00 vs 장부 $2.00, `.claude-bridge` Round 152)**: 사용자가 Runway 크레딧 실사용량으로 피해 규모를 확정(300크레딧 = task 12개, 대시보드 POST 수와 정확히 일치) — Cowork가 코드 근거까지 짚어 원인 체인을 끝까지 추적해 보고.
  - **원인**: `apps/backend`의 dev 스크립트는 `nest start --watch`라 백엔드 파일을 저장할 때마다 프로세스가 재시작된다. `advancing` Set(인메모리)도, Round 148/145가 추가한 "저장/제출 직전 재조회"도 전부 **같은 프로세스 안에서만** 유효한 방어였다 — 재시작 구간엔 구 프로세스와 신 프로세스가 잠깐 동시에 살아있고, 각자 자기 것만 아는 빈 `advancing` Set과 "created로 보임" 스냅샷을 들고 독립적으로 Runway에 POST할 수 있었다. 게다가 `ProjectsRepository.save()`가 버전 검사 없는 통짜 덮어쓰기라, 구 프로세스가 낡은 스냅샷으로 나중에 저장하면 신 프로세스가 막 저장한 기록(taskId 포함)이 통째로 증발한다(lost update) — 실제 로그에서 확인된 모습과 정확히 일치.
  - **수정 — 프로세스 경계를 넘는 배타 락**: `project-lock.ts` 신설 — `wx` 플래그 원자적 파일 생성 기반의 프로세스 간 배타 락(프로젝트+작업 단위, 60초 지나면 죽은 보유자로 간주해 회수). `local-video-workflow.service.ts`의 `advanceReal`(제출 여부 판단부터 저장까지 전체)을 이걸로 감싸 — 인메모리 Set은 같은 프로세스 내 즉시 반려용으로 그대로 두고, 이 락이 실제 상호배제를 담당. 별도의 저장소 전역 compare-and-swap 계층은 만들지 않음 — 이 락이 제출-저장 구간의 모든 읽기/쓰기를 이미 직렬화하므로 이 버그가 필요로 하는 만큼의 no-lost-update 보장은 동일하게 얻으면서 다른 모든 `save()` 호출부를 건드릴 필요가 없음.
  - **수정 — 제출 전 클레임(2단계 커밋)**: `advanceRunwayScene`에 `beforeSubmit` 훅 신설, Runway POST 직전에 호출자가 `"submitting"` 상태 + 클레임 시각을 먼저 저장(`claimSceneForSubmission`). 이 클레임과 결과 저장 사이(POST 성공 직후 ~ save 직전)에 프로세스가 죽어도, 다음에 이 장면을 보는 누구든 "created"가 아니라 "submitting"을 보게 되어 최소한 흔적은 남는다. 클레임이 `SUBMIT_CLAIM_TIMEOUT_SECONDS`(60초)를 넘도록 안 풀리면 방치된 것으로 보고 **자동 재제출은 하지 않고** `submit_interrupted`로 실패 처리 — Runway가 실제로 task를 만들었는지 알 방법이 없어서 사용자가 대시보드를 직접 확인하게 한다(Cowork 요구사항 D 충족). 이때도 예산 장부엔 추정치를 기록(실패인데 0으로 안 남김) — 이번 사고의 "$2.00 vs $3.00" 과소 집계가 정확히 이 경로(제출은 됐는데 결과를 끝내 못 받은 시도가 장부에 행 자체가 안 생기는 것)였음.
  - **확인 — Runway 멱등키(Cowork 요구사항 E)**: `docs.dev.runwayml.com` 공식 문서를 WebFetch/WebSearch로 확인 — `image_to_video` 작업 생성에 대한 `Idempotency-Key`/`request_id` 방식의 멱등 재시도 메커니즘은 문서화돼 있지 않음(작업 **삭제**의 멱등 처리 언급만 있음). Runway 쪽에서 이 버그 계열을 원천 차단할 방법은 현재 없다고 결론.
  - **의도적으로 이번엔 안 건드린 것**: `OrphanedGenerationRecoveryService`의 Runway 작업 목록 대조 기반 "입양"(요구사항 D의 정교한 버전) — 부팅 시 `GENERATING_VIDEOS → INTERRUPTED` 무조건 전환이 이미 있고 거기에 이번 `submitting` 잔류 클레임의 자동 재제출 금지가 더해져 Cowork가 요구한 최소 기준("최소한 자동 재제출은 하지 말고 사용자 확인")은 충족된다고 판단, 더 정교한 Runway 쪽 조회·입양은 별도 판단 필요. `nest watch` graceful shutdown(요구사항 G)도 안 건드림 — 락의 60초 stale 회수가 이미 재시작 자체의 안전성을 담보하므로 우선순위 낮음. 장기 프로젝트(Episode) 영상 경로(`episode-videos.service.ts`)는 똑같은 `advanceReal`/`advanceRealCore` 모양을 갖고 있어 같은 위험이 있을 가능성이 높지만 이번 라운드에선 손대지 않음 — 다음 라운드 후보.
  - 신규 테스트 다수: `project-lock.test.ts`(락 유틸 4건 — 직렬화, 다른 키는 병행, 죽은 보유자 회수, 예외 시에도 해제), `runway-workflow-support.test.ts` 3건(클레임이 POST보다 먼저 저장됨, 유효 기간 내 클레임은 손 안 댐, 만료된 클레임은 재제출 없이 실패+장부 기록), `local-video-workflow.runway.test.ts` 2건(서로 다른 서비스 인스턴스 두 개가 동시에 같은 프로젝트에 붙어도 POST 정확히 1회, 죽은 클레임을 만난 새 인스턴스가 재제출 없이 실패로 처리).
  - **테스트 환경 노트**: 백엔드 전체 스위트를 이 머신에서 병렬로 돌리면 `images.app-module.integration.test.ts`/`videos.app-module.integration.test.ts`(둘 다 이번 변경과 무관, local-fake 경로)가 간헐적으로 타임아웃 — 이번 변경 적용 전 `HEAD`(`git stash`)에서도 동일하게 재현되는 것을 확인해 이 세션의 사전 존재 환경 이슈임을 확인함, 이번 수정으로 만든 문제 아님.
  - 검증: root typecheck 전부 통과, Backend(실패 무관 2개 제외 전부 통과, 신규 9건 포함), frontend 798개 전부 통과, root build(shared/backend/frontend/desktop) 전부 통과. 유료 Provider 호출 없음(모든 테스트는 `fetch` mock 사용).
  - 커밋: `ced4baa`.
- [x] **🚨🚨 백엔드 — "앱을 거치지 않는 실제 유료 호출"의 진짜 경로: 통합 테스트 2개가 실제 자격증명으로 실제 Runway/OpenAI를 호출하고 있었음(`.claude-bridge` Round 154)**: 위 Round 152 수정 직후 Cowork가 "지금 실제 키로 유료 POST가 나가고 있다, 앱 파일 어디에도 흔적이 없다"를 대시보드 로그로 확정 — 원인을 찾음.
  - **원인**: `ProviderSettingsModule`의 `PROVIDER_SETTINGS_ROOT`가 안 정해지면 `process.cwd()`로 떨어지는데(`apps/backend`에서 테스트를 돌리면 정확히 `apps/backend/.env` — 실제 저장된 자격증명 파일), provider를 건드리는 `*.app-module.integration.test.ts` 대부분은 이걸 자기 임시 디렉터리로 오버라이드하는 반면 `images.app-module.integration.test.ts`의 첫 테스트("...without a provider")와 `videos.app-module.integration.test.ts`의 테스트 3개는 전혀 오버라이드를 안 했다 — 진짜 `AppModule`을 진짜 HTTP 서버로 띄우면서 fetch도 안 막은 채로. `apps/backend/.env`에 실제로 연결된 키가 있는 머신에서 이 테스트를 돌리면(`npm test`든 CI든) 진짜, mock 안 된 네트워크 호출이 그대로 나간다.
  - **수정**: `no-test-network.guard.ts` 신설 — vitest 아래에서 resolve된 `fetchImpl`이 mock(`.mock` 속성 있음)이 아니면 무조건 throw, Runway `requestWithRetry` 1곳 + OpenAI 어댑터 5곳 전부에 배선(프로덕션에서는 완전 no-op). 두 통합 테스트 파일도 `PROVIDER_SETTINGS_ROOT`를 자기 임시 디렉터리로 오버라이드하도록 고침.
  - **검증 방식이 결론을 증명함**: 가드만 넣은 상태로 돌리자 이 2개 파일의 실패 양상이 "타임아웃"에서 "즉시 500/failed"로 바뀜 — 가드가 실제로 뭔가를 막았다는 뜻. 격리까지 고친 뒤엔 이 2개 파일이 10~16초(간헐적 타임아웃 포함)에서 **1.44초**(전부 통과)로, 전체 스위트도 이전보다 빠르고 690개 전부 통과 — 실제 네트워크 왕복이 사라졌다는 강한 정황.
  - **정직하게 기록**: 이 세션 초반 사용자가 "지금 유료 호출 중이냐"고 두 번 물었을 때 "아니다"로 답했으나, 그때 감사 범위는 새로 만든 Runway 관련 단위 테스트뿐이었고 이 2개 통합 테스트 파일은 포함되지 않았었다 — `.env` 파일 mtime이 이 세션보다 훨씬 이전이라, 이 세션 중 여러 번 돌린 전체 스위트 실행이 이 구멍에 걸렸을 가능성을 완전히 배제할 수 없음(Cowork가 찾은 특정 4건과의 일치 여부는 로그만으로 확정 불가).
  - 검증: root typecheck 전부 통과, Backend 690개 전부 통과(스위트 전체 정상 속도), root build 전부 통과. 이 커밋 이후로는 테스트에서 유료 Provider 호출이 구조적으로 불가능 — 이전엔 그렇지 않았다는 것이 이번 발견의 핵심.
  - 커밋: `2bd166d`.
- [x] **`submit_interrupted` 전용 안내 문구(Round 155)**: 위 항목이 만든 새 실패 카테고리(`submit_interrupted`)가 프런트 일반 폴백("영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.")으로 떨어지면, 백엔드가 "모르면 재시도하지 않는다"로 일부러 멈춘 상태를 사용자가 일시적 오류로 오해해 직접 다시 눌러 이중 과금을 스스로 만들 위험이 있었다 — 전용 문구("요청이 이미 접수되었을 수 있어 자동으로 다시 보내지 않았습니다. Runway 계정에서 확인 후 다시 시도해 주세요.") 추가.
  - 검증: root typecheck 전부 통과, frontend 799개 전부 통과(+1 신규), root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `c5a5277`.
- [x] **🔴 백엔드 — `PROVIDER_SETTINGS_ROOT` 미설정 시 fail-closed(Round 156)**: Round 154(`2bd166d`)가 고친 "process.cwd()가 실제 자격증명 디렉터리로 조용히 떨어지는" 근본 위험을 마저 닫음 — 그 라운드는 문제를 일으킨 통합 테스트 2개만 격리했을 뿐, `ProviderSettingsModule`의 기본값 자체(`process.env.PROVIDER_SETTINGS_ROOT ?? process.cwd()`)는 그대로 남아 있어서 다음 스크립트·디버그 도구·격리를 잊은 새 테스트가 같은 구멍에 다시 빠질 수 있었다. `requiredProviderSettingsRoot()`로 교체 — 환경변수가 없으면 조용히 `cwd()`로 떨어지지 않고 즉시 throw. 유일한 정당한 예외인 `main.ts`(실제 백엔드 부팅)만 부트스트랩 진입점에서 명시적으로 `process.cwd()`를 설정.
  - **부수 효과 — 실제 `AppModule`을 부팅하는 테스트 파일 8개 전부 점검**: `PROVIDER_SETTINGS_ROOT`를 이미 오버라이드하던 3개(images/videos/story-generation, Round 154)는 무변경. 나머지 5개(`app.module.test.ts`, `assets`/`mappings`/`project-cast`/`static-frontend` 각 `*.app-module.integration.test.ts`)는 오버라이드가 전혀 없어 fail-closed 도입 즉시 워커가 죽었다 — 각자 자기만의 임시 디렉터리를 `PROVIDER_SETTINGS_ROOT`로 설정하도록 수정.
  - **자가 발견 — 첫 수정이 불완전했음**: `assets.app-module.integration.test.ts`의 `it` 블록 4개 중 첫 번째에만 오버라이드를 넣고 나머지 3개를 빠뜨려서, 전체 스위트를 여러 번 돌릴 때마다 매번 다른 지점에서 워커가 native crash로 죽는 것처럼 보였다(사실은 파일 실행 순서에 따라 위치만 달라지는 같은 결정론적 버그) — 처음엔 이 머신의 알려진 병렬 실행 환경 플레이키니스(Round 152 기록)로 오인할 뻔했으나, `--no-file-parallelism`으로 순차 실행해 크래시 직전 파일을 정확히 특정하고 누락된 3곳을 마저 고쳐 재현이 완전히 사라짐을 확인.
  - 검증: root typecheck 전부 통과, Backend 690개 전부 통과(연속 3회 재실행으로 크래시 재현 없음 확인, 이 세션 중 1회 관찰된 `local-video-workflow.runway.test.ts`의 백그라운드 타이머 타이밍 실패는 Round 152에 이미 기록된 이 머신의 사전 존재 플레이키니스와 동일 증상), root build(shared/backend/frontend/desktop) 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `0e02926`.
- [x] **프런트 — 영상 프롬프트에서 길이 때문에 빠진 섹션을 화면에 표시(Round 157)**: Round 148(`198e7e2`)이 계약만 열어둔 `omittedSections`를 Cowork가 `VideoPromptPreviewScreen`에 붙임 — 잘린 장면에만 어떤 섹션(장면 연결/환경 움직임/표정·연기/움직임 속도, 한국어 라벨)이 빠졌는지 안내, 안 잘린 장면은 조용히 둠, 모르는 라벨은 원문 그대로 통과(숨기지 않음).
  - **검증 중 발견 — Cowork 신규 테스트 1건의 설정 버그**: "모르는 라벨 통과" 테스트가 `makePreviews(1)`(장면 1개)로 응답을 만들었는데, 프런트 응답 검증기(`isGetVideoPromptPreviewResponse`)가 `previews.length >= MIN_SCENE_COUNT`(2)를 요구해 응답 자체가 무효 처리되어 항상 에러 화면으로 떨어지고 있었다 — 화면 로직이 아니라 테스트 설정의 최소 장면 수 미달, `makePreviews(2)`로 수정.
  - 검증: root typecheck 전부 통과, frontend 801개 전부 통과(+2 신규), root build(shared/backend/frontend/desktop) 전부 통과. 백엔드·계약 미변경.
  - 커밋: `af699ae`.
- [x] **🔴 백엔드 — 장기 프로젝트(Episode) 생성 중단 시 복구 경로가 아예 없던 것을 마저 닫음(Round 158)**: `orphaned-generation-recovery.service.ts`가 스스로 "Long-project generation loops carry the same single-process risk and are not covered here"라고 명시해 둔 구멍을 Cowork가 재확인(`.claude-bridge` Round 164) — 백엔드가 `generating_images`/`videos_generating`/`rendering` 도중 죽으면 그 Episode는 영원히 그 상태에 갇힌다(같은 workflow-state 게이트가 이후 모든 재시도를 영구히 거부, 이미 결제된 장면도 함께 묶임 — Round 129 사고와 정확히 같은 모양).
  - **신규 `OrphanedEpisodeGenerationRecoveryService`**(`long-projects/`) — 단편 프로젝트 파일과 같은 설계 원칙(각 생성 루프 자신의 catch가 이미 착지하는 상태로만 되돌림, 새 상태를 만들지 않음): `generating_images` → `asset_mapping_approved`(`EpisodeImagesService`의 실패 catch와 동일), `videos_generating` → `interrupted`(`EpisodeVideosService.stop()`과 동일, 기존 `restart()` 그대로 재사용), `rendering` → `failed`(단편 프로젝트의 `Rendering → VideosApproved`와 다르게, `EpisodeVideoMergeService`가 이미 렌더 실패를 `failed`로 모델링하고 있어 그 기존 설계를 그대로 따름).
  - **의도적으로 이번엔 안 만든 것**: 사용자에게 "왜 멈췄는지" 보여주는 메시지 — `LongEpisodeOutline`/`LongEpisodeDetail` 계약에 단편 프로젝트의 `warnings` 같은 필드가 아직 없어서, 이번엔 상태 전환(재시도 가능하게 만드는 것)만 처리하고 문구는 다음 라운드 후보로 `.claude-bridge`에 남김 — 조용히 범위를 줄인 게 아니라 명시적으로 flag.
  - 각 Episode는 `episode_outlines.json`(요약 배열)과 `Episode{NN}/project.json`(상세) 두 파일에 상태가 중복 저장되는데, 두 값이 이미 어긋나 있으면(예: 이전 부분 쓰기) 어느 쪽이 맞는지 추측하지 않고 그 Episode는 건드리지 않고 넘어감.
  - 신규 테스트 6건(`orphaned-episode-generation-recovery.service.test.ts`): 세 생성 상태 전부 복구 + 이미 만들어진 영상 파일 보존, 생성 중이 아닌 Episode는 무변경, 2회 연속 실행 시 두 번째는 아무것도 안 함(멱등), 요약·상세 상태 불일치 시 건드리지 않음, 장기 프로젝트가 아닌 디렉터리·`projects` 루트 자체가 없는 경우 예외 없이 스킵.
  - 검증: root typecheck 전부 통과, Backend 696개 전부 통과(연속 재실행 확인, +6 신규), root build(shared/backend/frontend/desktop) 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `7071b62`.
- [x] **🔴 백엔드 — 이미지 생성이 프로젝트 화면비를 전혀 안 쓰고 항상 세로로 나가던 것 + `avoid` 문구 유실(Round 159)**: Cowork가 코드를 읽다가 발견(`.claude-bridge` Round 165) — `OPENAI_IMAGE_SIZE`(세로 `1024x1536`) 기본값을 아무 호출부도 오버라이드하지 않아서, 영상 쪽은 이미 `ratioFor()`로 화면비를 반영하는데 이미지만 항상 세로로 생성되고 있었다. 가로(`16:9`) 프로젝트라면 세로 이미지를 첫 프레임으로 Runway에 가로 영상을 주문하는 셈이라, 잘리거나 레터박스가 생기고 장면당 $0.25는 그대로 청구됨(단편 프로젝트·장기 프로젝트(Episode) 둘 다 동일 결함).
  - `image-prompt.ts`에 `imageSizeFor()` 신설 — `ratioFor()`와 완전히 같은 출처·우선순위(`project.style_profile.aspect`)로 OpenAI 사이즈 문자열(`16:9` → `1536x1024`, 그 외 → `1024x1536`)을 파생, `local-image-generation.service.ts`의 두 호출부(생성/재생성)에 배선. 장기 프로젝트는 프로젝트 단위 `style_profile`이 없어 `episode-images.service.ts`에 별도 `imageSize()`(episode-videos.service.ts의 `ratio()`가 이미 신뢰하는 같은 `aspect_ratio` 필드 사용)를 신설해 두 호출부(생성/재생성)에 배선.
  - **같은 세션에서 함께 확인된 두 번째 결함**: `styleLineFor()`가 `visualStyle`/`color`/`lighting`만 읽고 `styleNotes.avoid`는 어디서도 안 읽어서, 설정 화면의 "피할 것" 입력란이 실제 프롬프트에 아무 효과가 없었다 — 같은 우선순위(사용자 설정 우선, `style_profile` 폴백)로 읽어 별도의 `Avoid: ...` 문장으로 추가(콤마 목록에 섞으면 "포함할 것"으로 읽히므로 분리).
  - 신규 테스트 6건(단편: 화면비별 이미지/edits 두 경로 사이즈 3건 + avoid 문구 1건, 장기: 화면비별 사이즈 2건).
  - 검증: root typecheck 전부 통과, Backend 701개 전부 통과(+6 신규), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `5bebaa3`.
- [x] **참고 이미지 16장 캡 신호 + 장기 프로젝트(Episode) 복구 안내 문구 + Round 159가 놓친 재생성 경로(Round 160)**: Cowork가 확정한 계약 2건(Round 168)을 구현.
  - **참고 이미지 캡**: `ImageReview`/`LongEpisodeImageReview`에 `referencesUsedCount`/`referencesOmittedCount` 추가(캡에 실제로 걸렸을 때만 포함, `omittedSections`와 같은 원칙 — 필드 하나 대신 둘로 나눈 건 Cowork 요청: 프런트가 백엔드의 캡 상수를 몰라도 되게). `collectReferenceImages()`/`collectEpisodeReferenceImages()`가 이제 잘린 개수를 같이 반환 — 파일로 실제 존재하는 것 중 자리가 없어서 못 보낸 것만 세고, 애초에 파일이 없어 못 보낸 건 캡과 무관하므로 안 셈. 단편은 이미 `generate()`가 채우는 `image_generation_records`에 얹고(장기와 달리 별도 저장 없이 재사용), 장기는 그런 배열이 없어 리뷰 항목에 캡 걸린 장면에만 새로 얹고 `approve()`를 거쳐도 보존되게 함.
  - **자가 발견 — Round 159가 놓친 세 번째 호출부**: 화면비 수정 때 `local-image-generation.service.ts`의 두 호출부(생성/재생성)만 고쳤는데, 리뷰 화면의 재생성(`image-review.service.ts`의 `regenerate()`, 완전히 별개 파일)이 `size`를 안 넘기는 같은 결함을 그대로 갖고 있었다 — 이번에 캡 신호를 배선하다가 발견해서 같이 고침.
  - **장기 프로젝트 복구 안내**: `LongEpisodeOutline.warnings?: string[]` 신설(단편의 `Project.warnings`와 다르게 선택적, 비어있으면 필드 자체 생략) — `orphaned-episode-generation-recovery.service.ts`가 자기 파일 주석으로 스스로 남겨뒀던 구멍("복구는 하지만 왜 멈췄는지는 못 알림")을 마저 닫음. 이 저장소엔 단편의 `project.mapper.ts` 같은 단일 매퍼가 없어서, Episode 상태를 읽어 내보내는 지점 9곳(서비스 6개의 `detail()`, `outline()` 파서 2개, `LongProjectsService.outlines()`) 전부에 `withoutStaleEpisodeRecoveryWarnings`(단편의 `withoutStaleRecoveryWarnings`와 동일 원리)를 배선.
  - 신규 테스트 다수: `image-reference-selection.test.ts`/`episode-image-reference-selection.test.ts`(신규 파일) 각 캡 경계 테스트, `image-review.service.test.ts`/`local-image-generation.service.test.ts`/`episode-images.service.test.ts` 실제 캡 도달 시나리오, `orphaned-episode-generation-recovery.service.test.ts` 문구 검증 4건 추가.
  - 검증: root typecheck 전부 통과, Backend 712개 전부 통과(연속 재실행 확인, +11 신규), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `d607b60`.
- [x] **프런트 — 참고 이미지 캡 신호 + 장기 프로젝트 경고 문구 화면 부착(Round 161)**: Cowork가 Round 169~170에서 세 계약(`omittedSections`는 이미 별도 커밋, 참고 이미지 캡 두 필드, `LongEpisodeOutline.warnings`)을 단편·장기 화면 양쪽에 부착. 문구·총량 계산식을 두 화면에서 동일하게 맞춤(같은 사실을 다르게 말하면 사용자가 뭘 믿어야 할지 모르게 됨).
  - **같이 온 결함 수정**: 화면비 수정(`5bebaa3`) 이후 가로 프로젝트가 실제로 가로 이미지를 만들게 됐는데, 리뷰 썸네일이 `aspect-[9/16]` + `object-cover`로 고정돼 있어 가로 이미지의 좌우를 잘라내고 있었다 — 돈이 걸린 승인/재생성 판단을 모델이 만들지 않은 슬라이스를 보고 내리게 됨. 임시로 `object-contain`(레터박스, 최소한 잘리지 않음)으로 전환 — 근본 수정은 아래 `aspectRatio` 계약 필요.
  - 검증: root typecheck 전부 통과, frontend 803개 전부 통과, root build 전부 통과. 백엔드·계약 미변경(이미 열려있던 계약 소비).
  - 커밋: `6b93dc0`.
- [x] **영상 보관함 백엔드 4개 + `ProjectSummary.aspectRatio`(Round 153/166, Round 162)**: Cowork의 원래 요청(Round 153) — 결과물 아카이브, 이미지 보관함(입력 소재)과 성격이 다름. `local-video-workflow.service.ts`의 `archive()`가 이미 만들던 `videos/history/scene{n}_v{NNN}.mp4`를 노출·복원 가능하게 함.
  - `GET /videos/library` — 영상 1개 이상 있는 프로젝트 목록(장면/최종 준비 수, 누적 Runway 실비용).
  - `GET /projects/:id/videos/:sceneOrFinal/versions` — 현재+전체 버전, 최신순. `:sceneOrFinal`이 장면 번호 또는 리터럴 `"final"`을 둘 다 받아 장면·최종 영상 아카이브를 같은 서비스·라우트 하나로 처리.
  - `GET .../versions/:versionId/content` — 스트림.
  - `POST .../versions/:versionId/restore` — 과거 버전을 현재로 승격. 항상 무료(provider 호출·예산 행 없음), 항상 비파괴적(교체당할 파일을 먼저 `archiveCurrent()`로 보관 — 복원 자체가 되돌리기 가능, 삭제 없음).
  - **판단 — 복원이 `Completed`를 `VideosApproved`로 되돌리는 것**: 장면 복원은 `finalVideoPath`를 비우고, 프로젝트가 `Completed`였다면 `VideosApproved`로 되돌려 재병합을 실제로 가능하게 함. `WORKFLOW_TRANSITIONS`(`shared/workflow.ts`)엔 `Completed`발 전환이 하나도 없다고 적혀 있지만, 이 표는 이 저장소 어디서도 런타임에 강제되지 않는 문서일 뿐임을 확인 — 강제됐다면 복원해도 재병합이 영원히 안 되는 막다른 골목이 됐을 것. Cowork에게 판단 근거와 함께 보고, 조용히 결정하지 않음.
  - **Round 166 요구사항**: `video-merge.service.ts`의 `merge()`가 이제 최종 영상을 덮어쓰기 전에 기존 파일을 `videos/final/history/`로 먼저 보관(장면 영상의 `archive()`와 같은 패턴) — 복원 후 재병합이 이전 최종본을 조용히 지우지 않게.
  - **의도적으로 미룬 것(Cowork 요청)**: 버전별 `actualCostUsd`는 이번엔 안 실음 — 현재 예산 장부엔 지출 행을 특정 보관 파일에 묶을 versionId가 없어서, 근사치를 보이면 틀린 숫자를 보일 위험이 있음.
  - **함께 반영 — `ProjectSummary.aspectRatio`**: 오늘 세 번째로 "두 곳이 각자 화면비를 추측해서 갈라진" 사례(이미지 사이즈, 참고 캡 총량, 이제 리뷰 썸네일)라 Cowork 요청대로 `project.mapper.ts`의 `toApiSummary()`에 추가 — 영상 보관함 카드도 어차피 필요해질 것이라 이 라운드에 함께 넣음.
  - 신규 테스트 20건(`video-library.service.test.ts`) + 병합 아카이빙 1건(`video-merge.service.test.ts`).
  - 검증: root typecheck 전부 통과, Backend 733개·frontend 803개·shared 25개 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `013d4ab`.
- [x] **프런트 — 영상 보관함 화면 완성(Round 163)**: 계약 나온 지 얼마 안 돼 Cowork가 전부 부착. 신규 4파일 + 수정 3파일 — 내비게이션에 `이미지 보관함` 바로 다음 `영상 보관함`(입력 소재/결과물 구분), 프로젝트 카드(주제·최종 영상 유무·누적 비용·화면비), 장면·최종 버전 목록(인라인 재생, `preload="none"`), 되돌리기 확인 패널(무료지만 "저장된 작업물이 바뀐다"는 이유로 확인 — 밀려나는 버전 보관 안내 + 장면일 때만 재병합 필요 경고). 되돌린 뒤 버전 목록 재조회(밀려난 버전이 실제로 보관됐다는 증거를 화면이 직접 보여줌).
  - `videoLibraryApi.ts`가 `totalActualCostUsd`(NaN/Infinity/음수/문자열)와 `aspectRatio`(`9:16`/`16:9` 외 값) 둘 다 응답 전체를 거부 — 알 수 없는 값에 기본 모양을 추측하지 않음(오늘 세 번 반복된 실수와 같은 종류).
  - `ImageGenerationScreen.tsx`가 `Project.aspectRatio`로 썸네일 박스를 맞추고 `object-cover`로 복귀 — 이전 라운드의 `object-contain` 임시 처방 종료.
  - **자가 발견 — 타입 오류 1건 직접 수정**: `videoLibraryApi.ts`의 `restoreVideoVersion` 반환 캐스트가 `Record<string, unknown>` → `RestoreVideoVersionResponse` 직접 캐스트라 타입 겹침 부족 오류 — 이 저장소의 다른 API 모듈이 이미 쓰는 `as unknown as` 이중 캐스트로 수정(빌드 깨짐 예외 범위).
  - 신규 테스트 16건(API 8 + 화면 8, 특히 되돌린 뒤 밀려난 버전이 새로 나타나는지 + 최종 영상 되돌리기엔 재병합 경고가 안 뜨는지).
  - 검증: root typecheck 전부 통과, frontend 819개 전부 통과(세션 중 1회 `SceneEditScreen.test.tsx` 순서 의존 플레이키니스 관찰 — 재실행으로 무관함 확인), root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `27dec42`.
- [x] **`WORKFLOW_TRANSITIONS` 표를 실제 동작과 맞춤(Round 164)**: Cowork 요청(Round 171) — 영상 보관함 복원이 실제로 쓰는 `Completed → VideosApproved` 전환이 표엔 없었고(`Completed`는 문서상 종결), 이 표가 이 저장소 어디서도 런타임에 강제되지 않는다는 사실도 주석에 없었다. 둘 다 추가 — `terminalStates`/`isTerminalState`는 그대로(정상 파이프라인은 여전히 `Completed`에서 끝남, 복원은 그걸 여는 별개의 명시적 사용자 행동이라는 구분 유지).
  - 검증: root typecheck 전부 통과, shared 25개·Backend 733개 전부 통과, root build 전부 통과. 백엔드 코드·API 계약 미변경(문서성 타입 파일만).
  - 커밋: `b28e4a4`.
- [x] **영상 프롬프트 캐릭터 정보/부정문 문서화(Round 165)**: Cowork가 "영상 프롬프트에 캐릭터 설명 없음"을 결함으로 올렸다가(Round 148) Runway 공식 Gen-4 문서 확인 후 스스로 철회(Round 172) — 첫 프레임 이미지가 이미 피사체 정보를 주므로 반복하면 "움직임 감소·예상 밖 결과"가 된다는 게 공식 지침, 의도된 설계였음. `video-preview.service.ts`의 `promptFor()`에 이 사실과, 같은 문서가 밝힌 인접 사실(Gen-4는 부정문 미지원 — 이미지 쪽 `styleNotes.avoid` 패턴을 영상에 절대 옮기면 안 됨)을 함께 주석으로 남김.
  - 검증: `apps/backend/src/videos/video-preview.service.test.ts` 6개 통과(주석만 추가, 로직 미변경). 백엔드·계약 미변경.
  - 커밋: `d43c478`.
- [x] **🔴 BGM 보관함 착수 전 확인 — Pixabay엔 오디오 API가 없음(Round 166)**: Cowork의 BGM 계약 요청(4·5번, Pixabay 검색·가져오기) 구현 전에 공식 문서 두 곳(API 문서·이용약관) 교차 확인 — Pixabay REST API는 이미지·영상만 지원, 음악·효과음 엔드포인트가 아예 없고, 이용약관은 스크래핑을 명시적으로 금지. 대체 방법이 없어 해당 두 엔드포인트는 보류, Cowork에게 판단(다른 제공자로 교체 또는 업로드만 우선)을 요청하고 조용히 결정하지 않음. 코드 변경 없음 — 조사만.
- [x] **BGM 보관함 백엔드(업로드·목록·스트림) + `ProjectSummary.narrationAvailable`(Round 167)**: Pixabay와 무관한 나머지(로컬 업로드·보관함 목록·스트림)부터 구현.
  - `GET /audio/library`, `POST /audio/library/upload`(멀티파트, MP3/WAV/M4A/OGG, 50MB), `GET /audio/library/:trackId/content` — 이미지 검증처럼 포맷을 직접 파싱하지 않고 `ffprobe`(이미 영상 병합의 필수 의존성)로 실제 오디오 스트림·길이를 검증. 저장 구조는 `asset_library`와 동일한 모양(JSON 인덱스 + 파일), 동시 쓰기 보호는 `videos/project-lock.ts`의 프로세스 간 락을 재사용(이름과 달리 범용 — 두 번째 락 구현을 새로 안 만듦).
  - `ProjectSummary.narrationAvailable` — `narrationEnabled` 설정이 아니라 실제 생성된 나레이션 파일이 있는지로 판정, 병합 화면이 "이 프로젝트가 실제로 가진 재료"에서 오디오 모드 기본값을 파생할 수 있게 함(Round 163 규칙).
  - **의도적으로 이번엔 안 만든 것**: 외부 검색·가져오기(위 항목의 Pixabay 결론에 따라 보류), 병합 화면의 오디오 설정 통합(다음 항목).
  - 신규 테스트 13건(`audio-library.service.test.ts`).
  - 검증: root typecheck 전부 통과, Backend 746개 전부 통과(+13 신규), frontend 819개·shared 25개·root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `4b65262`.
- [x] **BGM을 실제 병합 파이프라인에 배선(Round 168)**: `MergeVideosRequest.audio`로 한 번의 병합 호출이 `narration`/`narration+bgm`/`silent`를 선택 — 요청을 생략하면 기존 동작(narrationEnabled 토글 + 파일 존재 여부)을 정확히 그대로 유지하지만, **명시적으로** 모드를 지정하면 그 토글을 이번 한 번만 덮어씀(예: 이번엔 무음으로 내보내서 인스타에서 직접 음원을 붙이려는 의도적 선택).
  - `FfmpegMergeEngine.mixBackgroundMusic()` 신설 — 기존 장면 합치기 뒤 2차 패스로 실행. BGM 입력에 `-stream_loop -1`(디먹서 단계 반복, `aloop` 필터의 샘플 수 계산 불필요)로 길이 제한 없이 반복시킨 뒤 병합 영상의 실제 길이(`ffprobe`)만큼 잘라내고, 양끝 페이드 + 볼륨 적용, `amix`의 자체 정규화는 꺼서(`normalize=0`) 나레이션 음량이 입력 개수 기준으로 임의로 줄어들지 않게 함.
  - **의도적 범위 — 실시간 더킹 아님**: 나레이션과 겹칠 때 사이드체인 컴프레서로 동적으로 낮추는 것도 가능하지만(병합 영상 자체 오디오를 사이드체인 키로 쓸 수 있음), 실제 다중 트랙으로 검증하기 어려워 이번엔 고정 볼륨 감쇠만 구현 — Cowork가 "더킹 또는 볼륨 자동 조절 둘 다 괜찮다"고 명시.
  - **자가 발견 — 회귀 1건**: 기본값 파생을 `narrationAvailable`(파일 존재)만으로 계산했다가 기존 테스트(`narrationEnabled`를 끄면 파일이 있어도 무음이어야 함)가 깨짐 — 요청 생략 시의 기본값은 `narrationAvailable && narrationEnabled` 둘 다로 되돌리고, 명시적 요청만 파일 존재 여부만으로 검증하도록 분리해 수정.
  - 신규 테스트 10건(`video-merge.service.test.ts` 7건 + `ffmpeg-merge.service.test.ts` 3건 — 페이드 타이밍·클램프·`-stream_loop` 배치까지 커맨드 배열 직접 검증).
  - 검증: root typecheck 전부 통과, Backend 757개 전부 통과(+10 신규, 연속 재실행 확인), root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `a4621cd`.
- [x] **BGM 라이선스 메타데이터 필수화 + 삭제 엔드포인트 + 병합 화면 오디오 설정 배선(Round 169)**: Cowork의 계약 역제안(Round 173/174) — `AudioLibraryTrack.licenseKind`/`attributionRequired`를 업로드 시점에 선택이 아니라 필수로. 동의하고 구현.
  - **판단 — 왜 업로드 시점에 필수인가**: 업로드하는 순간이 업로더가 출처를 정확히 기억하는 유일한 시점이라, 처음에 선택으로 뒀다가 나중에 채워 넣게 하는 방식은 거의 항상 공란으로 남는다는 게 Cowork의 근거 — 동의. `licenseKind`(`cc0`/`cc-by`/`purchased`/`self-made`/`other`)와 `attributionRequired`(boolean)는 필수, `attributionText`/`sourceUrl`은 선택 유지.
  - **판단 — 삭제 허용(Cowork 질문에 답)**: 영상 보관함은 유료 AI 생성 결과물이라 삭제를 의도적으로 막았지만, BGM은 사용자 자신이 올린 파일이라 원본이 로컬에 그대로 있고 잘못 올렸을 때 되돌리는 비용이 0에 가까움 — Asset Library의 기존 삭제 선례와 같은 모델이 맞다고 판단, "보관함에서 숨기기" 대신 실제 삭제로 결정. `AudioLibraryService.remove()` + `DELETE /audio/library/:trackId` 신설.
  - `packages/shared/src/api.ts`의 `AudioLibraryTrack` 주석에 BGM 외부 검색·가져오기를 보류가 아니라 영구 포기로 확정한 근거를 정리(Pixabay: 오디오 API 자체 없음+스크래핑 금지, Freesound: CC-BY 위주+효과음 중심, Jamendo: 상업적 사용에 별도 유료 라이선스, Meta Sound Collection: 인스타그램 내 사용만 허용·다운로드 불가) — 검색 기능을 넣으면 "나중에야 저작권 조건을 알게 되는" 이 기능 영역 전체가 막으려던 실패를 스스로 재현하게 됨.
  - **자가 발견 — Cowork의 최근 `App.test.tsx` 편집이 자체 회귀**: Cowork의 로컬 typecheck(`tsc --noEmit --noResolve`)가 `--noResolve`라 `packages/shared`에 정의된 필수 필드 누락을 못 잡음 — `narrationAvailable` 누락 6곳을 빌드 깨짐 예외로 직접 수정.
  - 프런트(Cowork, Round 174): 병합 화면에 나레이션/나레이션+BGM/무음 라디오 선택 추가(`narrationAvailable`로 기본값 유도), BGM 보관함 화면(업로드·목록, 라이선스 필드 입력) 신설.
  - **자가 발견 — 병합 화면 테스트 1건이 새 기본 동작과 불일치**: "본문 없이 병합" 테스트가 예전 동작(요청 생략) 가정 그대로였는데, 새 UI는 항상 명시적으로 오디오 모드를 선택해 보내므로(기본 `narrationAvailable=false`→`silent`) 실제로는 `{"audio":{"mode":"silent"}}` 본문이 감. 의도된 새 동작에 맞춰 테스트 기대값 수정.
  - 신규/수정 테스트: `audio-library.service.test.ts`에 라이선스 필수 검증 2건 + 속성 텍스트/출처 URL 왕복 1건 + 삭제 1건 추가(총 18건), `video-merge.service.test.ts`의 BGM 통합 테스트 1건에 라이선스 필드 보강, frontend `VideoMergeScreen.test.tsx` 기대값 수정.
  - 검증: root typecheck 전부 통과, Backend 762개·frontend 837개·shared 25개 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `934727d`.
- [x] **프런트 — BGM 라이선스 종류 선택 UI + 삭제 확인(Round 170)**: Cowork가 Round 175에서 부착. 법률 용어 대신 상황으로 묻고(`CC0·퍼블릭 도메인` / `CC BY(출처 표시 필요)` / `구매·구독` / `직접 제작` / `그 밖의 경우`), 답이 정해진 종류는 `attributionRequired`를 다시 안 물음(`other`만 체크박스) — 같은 걸 두 번 물으면 정확도가 떨어진다는 근거. 삭제는 Round 169에서 합의한 대로 만들되 확인 패널에 "보관함에서만 사라지고 원본은 컴퓨터에 남는다"를 명시.
  - Cowork가 자기 로컬 검사 방식도 이번에 고침: 기존 `tsc --noEmit --noResolve`는 모듈 해석을 꺼서 `packages/shared`의 필수 필드 누락(`TS2741`)을 구조적으로 못 잡았고, 게다가 노이즈 필터에 `TS2741` 자체가 들어 있어 계약 위반이 나도 걸러내고 있었다 — `paths` 매핑으로 모듈 해석을 켠 스크래치 tsconfig로 교체, 이번 라운드에서 바로 실제 파손 2건(`audioLibraryApi.test.ts`의 업로드 시그니처 불일치)을 스스로 잡아냈다고 보고.
  - **자가 발견 — 내 라이선스 계약 변경(Round 169)이 만든 회귀**: `VideoMergeScreen.test.tsx`의 `makeTrack()` 픽스처가 `licenseKind`/`attributionRequired` 없이 남아 있었는데, `audioLibraryApi.ts`의 `isTrack()` 검증이 이제 그 두 필드를 요구해서 모킹한 트랙 목록이 조용히 빈 배열로 취급됨 — `narration+bgm` 테스트 2건이 "트랙 없음" 경로로 깨짐. 픽스처에 기본값 추가로 수정.
  - 검증: root typecheck 전부 통과, frontend 841개 전부 통과(+4 신규), root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `e45bfa3`.
- [x] **`ProjectSummary.usedAudio` — 출처 표시 문장이 캡션까지 도달할 경로 마련(Round 171)**: Cowork가 Round 176에서 지적 — 라이선스 필수 입력(Round 169)의 원래 목적("반년 뒤 출처를 못 쓰는 사고 방지")이 보관함 목록·병합 화면까지는 닿지만, 실제로 그 문장이 필요한 자리(게시 시점, 캡션)까지는 못 간다는 구조적 빈틈. 요청한 계약 그대로 구현.
  - `ProjectSummary.usedAudio?: { mode, trackId?, attributionRequired?, attributionText? }` 신설, `merge()`가 병합 완료 시점에 채움. `AudioLibraryService.get(trackId)` 신설(기존 `content()`는 재생 파일 경로만 반환, 메타데이터 전체가 필요해 별도 메서드로).
  - **판단 — `attributionRequired`/`attributionText`는 참조가 아니라 값으로 복사**: Cowork가 정확히 요청한 이유대로(Round 169에서 트랙 삭제를 허용했으므로, 트랙을 지운 뒤에도 그 음원이 들어간 영상의 출처 표시 의무는 남는다) `merge()` 시점에 `AudioLibraryTrack`에서 값을 읽어 `StoredProject.used_audio`에 그대로 박아 넣음 — 트랙 삭제와 완전히 독립.
  - **판단 — Video Library 복원 시 `usedAudio`는 양방향 모두 초기화**: 장면 복원은 최종 영상 자체를 무효화(재병합 필요)하니 당연히 지움. 최종 영상 자체를 과거 버전으로 복원하는 경우도 지움 — 버전별 오디오 이력을 따로 저장하지 않아서, 프로젝트에 하나뿐인 "가장 최근 병합" 기록을 복원된 과거 버전의 것인 양 보여주면 틀린 정보가 됨. 완벽한 정확도(버전별 이력)는 이번 범위 밖.
  - **경미한 계약 차이 — mode 값**: Cowork 제안은 `"narration" | "bgm" | "narration+bgm" | "silent"`(`bgm` 단독 포함)였지만, 백엔드에 `bgm` 단독 모드가 실제로 없어(`MergeAudioSettings["mode"]`와 동일하게) 기존 3개 값(`narration`/`narration+bgm`/`silent`)만 사용 — `.claude-bridge`에 보고.
  - 신규 테스트 7건: `video-merge.service.test.ts` 2건(narration+bgm 병합 후 `usedAudio` 확인 + 트랙 삭제해도 프로젝트에 저장된 값은 그대로임을 확인, silent 병합의 attribution 필드 없음 확인), `video-library.service.test.ts` 2건(장면·최종 복원 양쪽 초기화), `project-storage.schema.test.ts` 3건(기본값 null, 전체/최소 필드 파싱, 잘못된 mode·비객체 거부), `audio-library.service.test.ts` 1건(`get()`).
  - 검증: root typecheck 전부 통과, Backend 769개(+7 신규)·frontend 841개(1회 `SceneEditScreen.test.tsx` 순서 의존 플레이키니스 재관찰, 재실행으로 무관함 재확인)·shared 25개 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `a6a033d`.
- [x] **병합 화면 출처 문구 표시 + `VideoLibraryProjectSummary.attributionRequired/attributionText` + 인스타 게시물 준비 화면(사용자 승인, 게시 없음)(Round 172)**: Cowork Round 177(병합 화면)·178(인스타 화면) — 사용자가 "어 승인"으로 인스타 화면 착수를 직접 승인.
  - **병합 화면**: `usedAudio`를 읽어 병합 완료 직후 출처 문구 + 복사 버튼 표시(`attributionRequired`일 때만), `attributionText`가 비어 있으면 "채워 주세요" 별도 상태, 클립보드 거부 시 "직접 선택해 복사" 대체 경로. 트랙 선택 중에도 미리 보여주게 함(병합 후에야 아는 것보다 낫다는 근거).
  - **`VideoLibraryProjectSummary`에 두 필드 추가**: `attributionRequired?`/`attributionText?`, `ProjectSummary.usedAudio`에서 그대로 파생(트랙 ID·mode는 카드에 불필요해 제외) — `video-library.service.ts`의 `list()`에 배선. 다만 인스타 화면이 실제론 `GET /projects/:id`(전체 `usedAudio`)를 직접 읽어 이 필드 없이도 동작하게 돼서, 우선순위는 낮지만 보관함 카드 자체에도 여전히 유효한 계약이라 그대로 반영.
  - **인스타 게시물 준비 화면(신규, 게시는 안 함)**: 계약 추가 없이(`GET /videos/library`, `GET /projects/:id`, `GET /projects/:id/settings` 셋 다 읽기 전용, Instagram/Meta API 호출 0건) 영상 선택 → 세로/길이(릴스 3분 한도, 2025-01 90초에서 상향된 값 확인 후 적용) 확인 → 캡션(본문+해시태그+AI 고지)+출처 문구 자동 삽입(수정 불가) → 복사. 캡션 글자 수(2,200)·해시태그 개수(30) 한도 초과 시 복사 차단, `attributionRequired`인데 문구가 비면 복사 자체를 막음.
  - **화면 쪽 소스 스캔 테스트**: `graph.instagram.com`/`media_publish`/`access_token`/브라우저 저장소가 이 파일에 안 들어가게 고정 — 실수로 게시 기능이 섞여 들어가는 것을 스캔으로 막음.
  - **판단 요청 받음 — 캡션 임시 저장**: Cowork가 `GET/PUT /projects/:id/post-draft` 계약을 제안(연재하는 사용자는 해시태그 세트가 거의 고정이라 반복 입력이 아깝다는 근거) — 다음 라운드에 검토·답변 예정, 이번엔 코드 변경 없음.
  - Cowork가 이번에도 자기 로컬 검사 방식의 실제 구멍을 스스로 찾아 고침: 스크래치 tsconfig가 파일을 평평하게 복사해서 상대 경로 import(`../api/...`)가 전부 `TS2307`로 떨어지고 그걸 노이즈로 걸러내고 있었음 — 즉 로컬 import 자체가 지금까지 타입 검사가 안 되고 있었다는 뜻. 실제 디렉터리 구조 그대로 복사하도록 수정.
  - 신규 테스트: 병합 화면 6건 + 인스타 화면 14건 + `App.test.tsx` 1건 + 백엔드 2건(`video-library.service.test.ts` — 파생 필드 존재/부재).
  - 검증: root typecheck 전부 통과, Backend 771개(+1 순증, `project-lock.test.ts`의 동시성 테스트 1회 Windows 파일시스템 EPERM 관찰 — 재실행으로 무관한 플레이키니스 확인)·frontend 864개·shared 25개 전부 통과, root build 전부 통과. 유료 Provider 호출 없음, 실제 Instagram/Meta API 호출 없음.
  - 커밋: `337f45e`.
- [x] **`GET/PUT /projects/:id/post-draft` — 인스타 캡션 임시 저장(Round 173)**: Cowork Round 178에서 판단 요청 받은 계약 — 연재하는 사용자는 해시태그 세트가 매번 거의 같으니 반복 입력을 줄이자는 근거에 동의해 구현.
  - `project-asset-references.ts`와 같은 패턴으로 `lore_context.post_draft`(자유 형식 필드)에 저장 — 새 스키마 필드·Python 호환성 변경 없이 이렇게 좁은 범위의 값을 넣기엔 이 패턴이 이미 있는 선례라 그대로 따름.
  - **판단 — 출처 문구는 절대 저장 안 함**: 캡션 본문/해시태그/AI 고지만 저장하고 출처 문구는 저장하지 않음 — 항상 그 프로젝트의 현재 `usedAudio`에서 새로 가져오게 해서, 트랙을 수정·삭제해도 임시 저장된 캡션에 오래된 출처 문구가 남는 사고를 원천 차단.
  - **판단 — PUT은 병합이 아니라 전체 교체**: 필드 생략 시 지워짐(유지 아님) — 화면이 항상 현재 상태 전체를 한 번에 저장하는 방식과 맞춤.
  - 신규 테스트 15건(`project-post-draft.test.ts` 13건 + `projects.service.test.ts` 2건 — 저장·재오픈 왕복, 유효성 검사 거부).
  - 검증: root typecheck 전부 통과, Backend 786개(+15 신규) 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `a1ee275`.
- [x] **캡션 임시 저장 배선 + 영상 보관함 카드 출처 표시 + 최종 영상 복원 전 출처 경고(Round 174)**: Cowork Round 179 — 열려 있던 계약 3개(post-draft, `VideoLibraryProjectSummary` 출처 필드, 복원 시 안내) 전부 화면에 부착.
  - **`post-draft` 저장 시점 — blur**: 키 입력마다는 낭비, 버튼은 사람이 안 눌러서 이 기능이 생긴 원인 그 자체(화면 이탈 시 유실)를 반복함 — blur가 "화면을 벗어나기 직전" 시점과 정확히 일치. 체크박스만 `onChange`(체크박스엔 의미 있는 blur가 없음). 세 필드 항상 전체 전송(PUT은 병합이 아니라 교체라는 계약을 정확히 지킴 — 부분 전송하면 나머지 필드가 조용히 지워짐).
  - **저장 실패가 복사를 막지 않게 함**: 텍스트는 화면에 그대로 있으니 저장 실패는 손실이 아니라 경고 — 복사 버튼까지 잠그면 캡션을 꺼낼 유일한 경로를 저장 실패가 막아버리는 역효과.
  - **영상 보관함 카드**: `attributionRequired`/`attributionText`를 `select-all`로 표시, 비어 있으면 "음원 보관함에서 채워 주세요" 안내 — Cowork가 지적한 대로 이 자리가 우선순위 낮다고 했던 예상과 달리 더 중요한 자리였음(병합 화면은 방금 만든 사람이 보고, 보관함은 몇 달 뒤 "잊어버린 사람"이 봄).
  - **최종 영상 복원 확인 패널에 사전 경고**: 되돌린 뒤가 아니라 되돌리기 **전** — 확인 패널이 유일하게 손쓸 수 있는 순간이므로, 사라질 출처 문구를 그 자리에서 복사해 갈 수 있게 같이 표시.
  - **자가 발견 — `InstagramPostScreen.test.tsx` 실제 타입 오류 2건 직접 수정**: `renderScreen()`의 `fetchMock`이 `input` 파라미터 하나만 갖도록 타입이 좁혀져 있어서, `init`을 구조분해하는 테스트 2건이 컴파일 실패 — `init?: RequestInit` 파라미터 추가로 수정(빌드 깨짐 예외 범위).
  - **Cowork가 보고한 하니스 한계 하나 확인**: `LongProjectDetail.tsx(188)`의 `[...new Set(...)]`가 자기 스크래치 tsconfig에서만 `TS2345`로 뜬다고 보고 — 이 파일을 직접 확인, 실제 root typecheck는 clean. Cowork의 lib/DOM 설정이 실제 프로젝트와 다른 데서 오는 하니스 아티팩트로 확인, 실제 결함 아님을 회신.
  - 신규 테스트 12건(`postDraftApi.test.ts` 6건 + 인스타 화면 6건 + 영상 보관함 4건 — Cowork 집계 총 16건 중 일부는 이미 InstagramPostScreen.test.tsx 파일 자체에 포함).
  - 검증: root typecheck 전부 통과, Backend 786개·frontend 880개(+16 신규)·shared 25개 전부 통과, root build 전부 통과. 유료 Provider 호출 없음, 실제 Instagram/Meta API 호출 없음.
  - 커밋: `f06d924`.
- [x] **🔴🔴 Long Episode 영상 생성의 교차 프로세스 중복 제출 경합 수정(Round 175)**: Cowork가 여러 라운드에 걸쳐 리마인드한 결함 2건 중 하나 — 조사해서 실제로 살아있는 위험임을 확인, 수정.
  - **원인**: `EpisodeVideosService.advanceReal()`의 인메모리 `advancing` Set이 같은 프로세스 안에서만 중복 호출을 막고, `nest start --watch`가 파일 저장마다 프로세스를 재시작하며 신구 프로세스가 잠깐 겹치는 창에서는 각자 빈 Set을 가져 둘 다 같은 장면을 Runway에 제출할 수 있음 — **단편 프로젝트 쪽에서 이미 확정 실제 사고가 났던 것과(Round 152, 장면 3개 중복 제출, 실제 $3.00 청구) 완전히 같은 구조**를 롱 프로젝트(Episode) 쪽만 안 고친 채로 갖고 있었음.
  - **수정**: `local-video-workflow.service.ts`가 이미 쓰는 `withProjectLock`(교차 프로세스 파일 락)을 `advanceReal`이 `advanceRealCore`를 감싸는 지점에 동일하게 배선 — 락 범위·키 구조(`${projectId}:${episodeNumber}:${jobId}`)까지 단편 쪽과 동일하게 맞춤.
  - 신규 테스트 1건: 단편 쪽의 "두 프로세스 경합" 테스트를 그대로 이식(`EpisodeVideosService` 인스턴스 2개가 같은 디스크 프로젝트를 놓고 경합, 하나가 파일 락에 막혀 중복 제출이 실제로 0건임을 검증).
  - **자가 발견 — 별개의 테스트 위생 결함**: 새 테스트가 전체 파일과 같이 돌 때만 5초 타임아웃으로 행(hang) — `episode-videos.runway.test.ts`의 `afterEach`가 `vi.unstubAllGlobals()`만 하고 `vi.useRealTimers()`를 안 불러서, 앞선 fake-timer 테스트가 다음 테스트(실제 타이머가 필요한 락의 재시도 루프 포함)의 `setTimeout`을 조용히 멈춰 세우고 있었음 — 단편 쪽 테스트 파일(`local-video-workflow.runway.test.ts`)의 동일한 `afterEach` 패턴과 맞춰 수정.
  - **의도적으로 범위 밖으로 둔 것**: `start`/`stop`/`restart`/`regenerate`/`approve` 등 사용자 트리거 동기 호출은 단편 쪽도 락이 없어 그대로 둠 — 이번 수정은 단편 쪽 선례와 정확히 같은 범위(폴링 타이머 루프만)를 유지.
  - 검증: root typecheck 전부 통과, Backend 787개(+1 신규) 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `465c8f3`.
- [x] **`userData` 폴더명을 사람이 찾을 수 있게 수정 + 기존 데이터 자동 이전(Round 176)**: 리마인드받은 결함 2건 중 나머지 하나. Electron이 `app.getPath("userData")`를 패키지의 원본 npm 이름(`@ai-animation-studio/desktop`)으로 기본 설정해서, Windows에서 `%APPDATA%\@ai-animation-studio\desktop`처럼 실제로 찾기 어려운 중첩 경로가 됨 — Runway 크레딧 조사 때 사용자가 실제로 겪은 문제(`.claude-bridge` Round 176/179에 걸쳐 리마인드).
  - `app.setName("AI Animation Studio")`로 새 설치는 바로 사람이 찾을 수 있는 이름을 씀.
  - **판단 — 이미 패키지 설치가 있고 그 안에 실제 데이터가 있을 가능성**: 이름만 바꾸면 다음 실행부터 앱이 새 경로를 보게 되어, 옛 경로에 있던 실제 데이터가 사라진 것처럼 보이는 위험이 있음 — `migrateUserDataFolder()`(신규, 단위 테스트 완비)로 앱 시작 시 자동 이전. rename 우선 시도, 드라이브가 다르면 copy로 대체. **양방향으로 비파괴적**: 옛 경로에 아무것도 없으면 아무 일도 안 함, 새 경로에 이미 뭔가 있으면(이전에 이미 이전했거나 우연히 새 이름으로 설치됨) 옛 경로를 절대 안 건드림 — copy 성공 후에도 옛 경로를 지우지 않아, 부분 실패가 데이터 손실처럼 보이는 일이 없게 함.
  - `oldPath`는 `app.setName()` 호출 **전에** 캡처해서 이름 변경 전 기본 경로를 정확히 반영.
  - 신규 테스트 5건(`userdata-migration.test.ts`, `node --test`) — 동일 경로, 옛 경로 없음, 새 경로에 이미 존재(옛 경로 안 건드림 확인), rename 성공, rename 실패 시 copy 대체(옛 경로 보존 확인).
  - 검증: root typecheck 전부 통과, desktop 13개(+5 신규) 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `a5fef82`.
- [x] **락이 걸렸을 때 전용 에러 코드 `PROJECT_LOCKED` 신설(Round 177)**: Cowork Round 181 질문 — 두 프로세스가 경합할 때 락이 "기다리는지 거절하는지" 프런트가 알 방법이 없었음. 조사해서 답함: 평소엔 기다림(락 보유자가 문서화된 대로 수초 안에 끝남, 클라이언트에 보이는 에러 없음)이 맞지만, 실제 경합이 `ACQUIRE_TIMEOUT_MS`(10초)를 넘으면 `ProjectLockTimeoutError`가 던져지는데 **단편·롱 어느 쪽 호출부도 이걸 안 잡고 있었음** — `code` 없는 맨 500으로 떨어져 프런트가 응답 자체를 파싱 못 함(`CLIENT_MALFORMED_RESPONSE`). Round 152 사고를 막으려던 락이, 정작 걸렸을 때는 "다시 시도"를 유도하는 정반대 문구를 보여줄 뻔했음.
  - `video-workflow-api.error.ts`/`long-project-api.error.ts` 양쪽에 `PROJECT_LOCKED` 코드 신설(Cowork 요청대로 **같은 문자열 코드**를 공유 — 프런트 안전 메시지 표 하나로 양쪽 다 처리 가능). `advanceReal()` 두 곳(단편·Episode) 모두 `ProjectLockTimeoutError`를 잡아 새 에러로 재던짐.
  - `withProjectLock`에 선택적 `timeoutMs` 오버라이드 추가(실제 호출부는 전부 기본값 사용, 테스트 전용) — 진짜 10초를 기다리지 않고도 타임아웃 경로가 실제로 `ProjectLockTimeoutError`를 던지는지 검증하는 신규 테스트 1건 추가.
  - 검증: root typecheck 전부 통과, Backend 788개(+1 신규) 전부 통과, root build 전부 통과. 유료 Provider 호출 없음.
  - 커밋: `e782d96`.
- [x] **프런트 — `PROJECT_LOCKED` 안전 메시지 배선(Round 178)**: Cowork Round 182 — `videoWorkflowApi.ts`/`longProjectsApi.ts`(단편·롱 공유 코드) 양쪽에 "다시 누르지 마세요"를 명시하는 전용 문구 배선, 일반 "다시 시도" 폴백으로 되돌아가지 않게 문구 자체를 테스트로 고정.
  - **질문 답변 — 제출(POST) 경로는 이 코드를 못 던진다, 확인**: `videos.controller.ts`/`episode-videos.controller.ts` 둘 다 `POST .../generations`가 `submissions.start()`(락 없음) 뒤에 `this.workflow.run(...)`를 `.catch(() => undefined)`로 fire-and-forget 호출 — `run()`(락을 잡는 진짜 지점) 안의 어떤 에러든 POST 응답과 완전히 분리되어 클라이언트에 절대 안 감. `PROJECT_LOCKED`는 이후 폴링(`GET .../generations/:jobId`)이나 `restart`에서만 나올 수 있음. `videoSubmissionApi.ts`엔 추가 안 하는 게 맞다고 확인 — 코드 변경 없음, 조사만.
  - 검증: root typecheck 전부 통과, frontend 885개(+5 신규) 전부 통과, root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `84323b4`.
- [x] **프런트 — "연결됨" 문구가 한 번도 확인한 적 없는 주장이었던 것 수정(Round 179)**: 사용자가 실사용 중 잡은 결함(Round 184) — Runway 크레딧 유출 조사 때 대시보드에서 키를 직접 폐기했는데 카드는 계속 "연결됨"을 표시. `connected`는 순수 로컬 스위치일 뿐 이 앱이 제공사에 유효성을 물어본 적이 한 번도 없었는데, 화면 문구가 확인한 것처럼 주장하고 있었음 — 하필 사용자가 "이 키 아직 살아있나"를 가장 알아야 했던 순간에 틀린 확신을 줬음.
  - "키 저장됨 · 이 앱에서 사용"/"· 사용 안 함"으로 로컬 상태만 정직하게 표현, 버튼도 "이 앱에서 사용 안 함"/"다시 사용"으로 개명. 키가 저장돼 있을 때만 "제공사에서 지웠거나 만료됐는지는 실제로 요청을 보내봐야 안다"는 설명 문구 추가.
  - 신규 테스트 2건("연결됨" 문자열 부재 확인 + 설명 문구 노출 확인) + 기존 문자열 테스트 전부 갱신.
  - 검증: root typecheck 전부 통과, frontend 887개 전부 통과, root build 전부 통과. 백엔드·계약 미변경.
  - 커밋: `8ff332c`(아래 인스타그램 백엔드 기반 작업과 같은 커밋에 함께 들어감 — 커밋 메시지는 이 항목만 설명하지만 실제로는 둘 다 포함).
- [x] **인스타그램 게시 — 백엔드 기반 작업 착수: `ProviderCredentialKind`에 "instagram" 추가 + Graph API 어댑터(Round 180)**: 사용자가 "문 2"(Facebook Login for Business)를 확정(Round 183)한 뒤 조사·구현 착수. 착수 전에 Meta 공식 문서를 직접 확인(WebFetch) — 서드파티 요약이 아니라 `developers.facebook.com`의 `content-publishing`/`resumable-uploads` 페이지, 표준 Graph API 에러 응답 형태를 직접 인용해 프로토콜을 검증.
  - `ProviderCredentialKind`에 `"instagram"` 추가 — 토큰 하나만 저장(OpenAI·Runway와 동일한 단일 문자열 credential 모델), 사용자가 직접 붙여넣기(Cowork 요청: "토큰은 내가 절대 안 다뤄"). Instagram Business Account ID는 별도 비밀 아닌 설정으로 둘 계획 — 어디에 저장할지는 아직 미정, Cowork에게 열어둔 질문으로 보고.
  - `instagram-graph-adapter.ts` 신규(`runway-video-adapter.ts`와 동일한 순수 함수 패턴) — 컨테이너 생성(`POST /media`, `media_type=REELS`, `upload_type=resumable`) → 영상 업로드(`POST rupload.facebook.com/ig-api-upload/...`, `Authorization: OAuth` 헤더가 다른 단계와 다름을 실제 문서로 확인) → 상태 확인(`GET /<container>?fields=status_code`, `IN_PROGRESS`/`FINISHED`/`ERROR`/`EXPIRED`/`PUBLISHED` 5개 값) → 게시(`POST /media_publish`, `creation_id`). 컨테이너 생성·업로드·게시 3곳 모두 `maxRetries: 0` 강제 — Runway 유료 작업 생성과 같은 이유(모호한 네트워크 실패를 재시도하면 중복 생성/중복 게시 위험), 특히 게시는 되돌릴 수 없는 공개 행위라 가장 엄격하게 적용.
  - 에러 분류는 Graph API 표준 에러 코드(190=인증 만료, 4/17/613=요청 한도, 1/2=일시적 서버 오류, 10·200-299=권한) 우선, 없으면 HTTP 상태로 폴백 — Meta 원문 메시지는 절대 노출 안 하고 고정 한국어 문구만, 원문은 `detail`로만 보존(Runway 패턴과 동일).
  - `assertRealNetworkCallAllowed`(Round 154 유출 사고 이후 만든 테스트 프로세스 실제 네트워크 호출 차단 가드)를 그대로 재사용 — 새 Provider도 처음부터 같은 안전장치 적용.
  - **아직 안 만든 것**: 실제 발행 서비스(orchestration)·확인 게이트·컨트롤러·엔드포인트는 이번 라운드에 포함 안 함 — 토큰 전략(수동 붙여넣기 vs 앱 내 OAuth) 결정이 먼저 필요해 Cowork에게 판단 결과와 함께 다음 라운드에 이어감.
  - 신규 테스트 24건(`instagram-graph-adapter.test.ts`) + settings 관련 기존 테스트 3곳 fixture 갱신(3-provider 배열로).
  - 검증: root typecheck 전부 통과, Backend 812개(+24 신규)·frontend 887개·root build 전부 통과. 실제 Instagram/Meta API 호출 없음, 유료 Provider 호출 없음.
  - 커밋: `8ff332c`(위 "연결됨" 문구 수정과 같은 커밋).
- [x] **인스타그램 토큰 확보 경로 확정 및 구현 — 앱 내 로그인(A) 채택(Round 181)**: Cowork가 판단을 넘긴 두 갈래(A: 앱 안 OAuth / B: 사용자가 토큰 직접 붙여넣기)를 **문서로 결정**. 취향이 아니라 사실이 갈랐음.
  - **결정 근거**: 장기 토큰은 약 60일이고, Meta 문서에 **이미 발급된 장기 토큰을 만료 전에 갱신하는 경로가 없음**(`.../access-tokens/refreshing/` 직접 확인). 문서가 제시하는 유일한 복구책이 *"the person will have to go through the login flow again to get a new token."* → B를 고르면 그 "login flow"가 사용자에게는 Graph API Explorer를 다시 찾아가는 개발자 도구 절차가 되고, 반년에 한 번 그걸 기억해내야 함. A를 고르면 문서가 말하는 복구책이 **최초에 눌렀던 그 버튼 그대로**임.
  - **A가 예상보다 가볍다는 사실도 문서로 확인**: Meta가 데스크톱 웹뷰 전용 리디렉트 값을 문서화하고 있음 — *"If you are using this in a webview within a desktop app, this must be set to `https://www.facebook.com/connect/login_success.html`"*. 덕분에 localhost 리디렉트 등록·HTTPS 예외·로컬 백엔드 콜백 라우트가 **전부 불필요**. Cowork가 "구현이 더 무겁다"고 본 전제가 실제로는 성립하지 않음.
  - `instagram-oauth.ts` 신규(순수 함수, 저장·창 띄우기 없음): 로그인 대화창 URL 생성, 리디렉트 URL 파싱(`code`만 있고 `state`가 없으면 **신뢰하지 않고 거부** — state가 이 코드가 우리 요청에 대한 응답임을 증명하는 유일한 근거), `code`→단기 토큰, 단기→장기 토큰, `debug_token` 검사.
  - **재시도 정책을 호출별로 분리**: `code` 교환은 `maxRetries: 0`(코드가 1회용이라 재시도하면 이미 소진된 코드를 보내 "로그인 거부"처럼 보이는 실패가 됨), 장기 토큰 교환은 입력이 1회용이 아니므로 재시도 허용.
  - **권한 범위(scope)를 문서로 확정**: `instagram_basic`·`instagram_content_publish`·`pages_read_engagement`(문서상 필수 3종) + `pages_show_list`(사용자가 Instagram Business Account ID를 직접 찾아 손으로 옮겨 적는 단계를 없애기 위해 페이지 목록 조회용). `ads_management`/`ads_read`는 **의도적으로 요청 안 함** — Business Manager 경유 역할일 때만 필요하다고 문서에 적혀 있고, 쓰지도 않을 광고 계정 권한을 요구하는 건 과요구. scope 목록이 조용히 넓어지면 테스트가 실패하도록 문자열째 고정.
  - **Cowork의 두 번째 질문(유효성 확인 버튼)도 같은 호출로 해결됨**: `debug_token`이 `is_valid`와 실제 만료 시각을 무료·읽기 전용으로 반환 — Round 184에서 문구만 정직하게 고쳤던 "이 키 아직 살아있나"에 앱이 실제로 답할 수 있게 됨. 만료 시각이 0/부재일 때는 문서에 의미가 명시돼 있지 않으므로 `null`("명시된 만료 없음")로 두고 뜻을 단정하지 않음.
  - **공유 기계 분리**: 요청·재시도·Graph 에러 분류를 `instagram-request.ts`로 추출해 두 어댑터가 공유 — 복제해두면 분류 표가 갈라지고, 그게 이 세션에서 반복해 잡아온 실패 유형이라 처음부터 차단.
  - **아직 안 만든 것**: Electron 로그인 창 배선, 토큰·앱 시크릿 저장 서비스, 컨트롤러/엔드포인트, 실제 게시 orchestration — 다음 라운드.
  - 신규 테스트 21건(`instagram-oauth.test.ts`). 기존 24건은 리팩터링 회귀 검증으로 그대로 사용.
  - 검증: root typecheck 전부 통과, Backend 833개(+21 신규) 전부 통과, root build 전부 통과. 실제 Meta API 호출 없음.
  - 커밋: `c0bb9ee`.
- [x] **🔴 커밋된 소스가 커밋 안 된 파일을 참조하던 문제 — 결정 기록 문서 신설 + 링크 검사기(Round 182)**: Cowork가 Round 185에서 발견, 사용자 승인 후 Round 187~188에서 설계 확정. 소스 주석 다수가 `.claude-bridge/` 라운드 번호를 근거로 가리키는데 그 폴더는 `.gitignore`에 있어 **저장소를 클론한 사람에게는 전부 도달 불가능한 링크**였음. 근거가 있다고 가리켜 놓고 가리킨 곳이 없으면 읽는 사람이 다른 데를 찾아보지도 않게 되므로, 참조가 아예 없는 것보다 나쁨.
  - **실제 개수를 작업 트리에서 셈: 87곳**(backend 52·frontend 20·shared 14·desktop 1) — Cowork 미러 기준 추정(34곳)의 2.5배였음.
  - `docs/06_DECISIONS.md` 신설. 수록 기준은 Cowork가 사용자 승인을 받아 정한 **"이걸 아는 것이 나중 사람의 행동을 바꾸는가"** — 살아있는 결정과 **근거를 대고 접은 막다른 길**은 담고(Pixabay 건이 원형), 정정된 주장의 틀린 중간 단계와 작업 보고·커밋 해시는 제외("실패한 시도"와 "철회된 주장"은 다름).
  - **제목이 아니라 불변 ID(`D-###`)를 가리키게 함** — 제목이 앵커면 제목이 사실상 API가 되어 더 나은 이름으로 고치는 순간 참조가 전부 깨짐. ID는 재사용 안 하고, 뒤집힌 결정은 지우지 않고 `(뒤집힘 → D-###)`로 자리에 남김(지우면 **뒤집혔다는 사실 자체**가 사라지는데 그게 다음 사람이 가장 알고 싶어 할 정보).
  - **핵심은 검사기**(`apps/backend/src/decision-doc-references.test.ts`) — 이 구멍이 몇 달간 아무도 모르게 커진 이유가 검사기 부재라, 문서만 잘 만들어서는 재발을 못 막음. 4개 워크스페이스 전체에서 `D-###` 참조를 모아 문서 헤딩과 대조, 없으면 **파일:줄번호와 함께** 실패, ID 중복도 실패(중복이면 한쪽이 조용히 도달 불가가 됨). 참조가 0개여도 통과하므로 지금 당장 넣어도 아무것도 안 막음.
  - **검사기가 비어서 통과하는 게 아님을 실제로 증명**: 없는 ID를 일부러 심어 `instagram-request.ts:101 -> D-404`로 잡히는 것 확인 후 되돌림.
  - **자가 발견 — 검사기 첫 실행이 검사기 자신의 버그를 잡음**: 문서의 ID 규칙 설명에 넣은 형식 예시(코드 펜스 안의 `### D-000`)가 실제 항목 정의로 집계돼 중복으로 실패. 코드 펜스 안의 헤딩은 정의가 아니라 예시라는 걸 파서가 알도록 수정하고 그 동작도 테스트로 고정 — Cowork의 4번 제안이 없었으면 이 문서가 처음부터 망가진 채 시작될 뻔했음.
  - 씨앗 항목 9건 수록(D-001~D-009): BGM 외부 검색 영구 폐기, 라이선스 업로드 시점 필수, 출처 문구 값 복사, 음원/영상 삭제 정책 비대칭, 되돌릴 수 없는 요청의 재시도 금지, "확인 안 한 걸 확인한 것처럼 말하지 않는다", 인스타 토큰 앱 내 로그인, 안 쓸 권한 미요구, `WORKFLOW_TRANSITIONS` 비강제. Cowork가 프런트 주석을 옮기려면 ID가 먼저 고정돼야 한다고 해서 우선 채움.
  - **우편함을 git에 넣는 안은 폐기**(Cowork 판단 수용): 우편함엔 이후 철회된 주장이 그대로 살아 있어, 커밋하면 어떤 참조는 **틀렸다고 인정한 내용을 가리키게 됨** — 링크는 살아나지만 도착지를 믿을 수 없어 죽은 링크보다 나쁨.
  - 세션 시작 규칙(`docs/03_TEAM_WORKFLOW.md`)에 새 문서와 우편함을 추가하고, **"라운드 번호는 출처 표시일 뿐 근거 자체는 주석이나 결정 문서에 있어야 한다"**는 규칙 명문화. `AGENTS.md`·`CLAUDE.md` 읽기 순서에도 반영.
  - **아직 안 한 것**: 87곳 주석의 실제 이관(구역별 분담, 인스타 작업 후), 그리고 마지막 참조가 사라진 뒤 켤 "소스 주석은 `.claude-bridge`를 참조할 수 없다" 잠금 검사.
  - 신규 테스트 4건. 검증: root typecheck 전부 통과, Backend 837개 전부 통과, root build 전부 통과.
  - 커밋: `cd4368c`.
- [x] **인스타그램 게시 대상 계정 선택 계약(Round 183)**: Cowork가 Round 186에서 요청한 계약 — 게시 화면이 여기서 막혀 있었음. `GET /settings/instagram/targets`, `PUT /settings/instagram/target`.
  - **판단 — 계정 ID는 `ProviderCredentialKind`에 넣지 않음**(Cowork 제안 수용): 자격증명은 "우리가 행동할 수 있나"를 답하고 설정 화면에 속하지만, 계정 ID는 **"어디에 올리나"**를 답하고 게시하는 순간 보여야 함. 설정 화면은 뭔가 고장났을 때 가는 곳이지 게시할 때 가는 곳이 아님. 마스킹도 안 함 — 가리면 사용자가 목적지를 확인할 수 없어짐.
  - **판단 — 저장된 선택의 유효성 대조는 서버가 함**: 페이지 연결이 끊기거나 권한이 회수되거나 페이지가 삭제될 수 있으므로, 저장된 ID를 확인 없이 돌려주는 건 D-006(확인 안 한 걸 확인한 것처럼 말하기)의 재발. 이번 조회 결과에 실제로 있을 때만 `selectedIgUserId`를 채우고, `PUT`도 매번 새로 조회해 검증한 뒤 목록에 없으면 저장하지 않고 거부. 화면에 맡기지 않은 이유는 호출부마다 빠뜨릴 수 있고, 빠뜨리면 **조용히 엉뚱한 계정에 게시**되는 종류라서.
  - **판단 — 토큰 없음/만료는 빈 목록이 아니라 전용 코드** `INSTAGRAM_NOT_CONNECTED`: "올릴 계정이 없다"와 "로그인이 필요하다"는 사용자가 할 일이 완전히 다름. 페이지 연결이 없는 정상 상태는 에러가 아니라 `{ targets: [] }`로 구분해 내려감.
  - **자가 발견 — 계정 탐색의 비공식 문법 대비**: `/me/accounts?fields=name,instagram_business_account{id,username}`의 중첩 필드 조회가 Meta 공식 필드 목록에 없는 문법이라, 핸들이 안 올 경우를 "불가능"으로 가정하지 않고 2단계로 처리(따로 읽기 → 그것도 실패하면 숫자 ID를 대신 넣어서라도 계정을 목록에서 빼지 않음). 목록에서 빼면 사용자가 자기 계정을 아예 못 고르게 되는데 그게 더 나쁨. 다만 `username`이 숫자로 보일 수 있다는 점은 확인 패널의 "계정 이름 표시" 규칙과 충돌할 수 있어 Cowork에 판단 요청.
  - 신규 테스트 17건(`instagram-targets.service.test.ts` 12건 + 계정 탐색 5건).
  - 검증: root typecheck 전부 통과, Backend 854개(+17 신규)·frontend 887개·shared 25개 전부 통과, root build 전부 통과. 실제 Meta API 호출 없음.
  - 커밋: `e7147eb`.
- [x] **프런트 — 게시 대상 계정 선택 화면 + 결정 기록 이관 프런트 절반 완료(Round 184)**: Cowork Round 189~190.
  - 계정 선택기를 **올릴 영상 바로 옆**에 배치하고, 계정이 하나뿐이어도 계속 표시(안 묻는 것과 안 보여주는 것은 다르고, 두 번째 계정이 생기는 날이 사고 나는 날). 네 가지 상태(`INSTAGRAM_NOT_CONNECTED` / 빈 목록 / 저장된 선택 사라짐 / 정상)를 각각 다른 문구로 구분 — Cowork 보고: 로그인 필요와 계정 없음을 서버가 갈라준 게 화면에서 크게 도움됐고, 합쳤으면 사용자가 페이스북 페이지를 만들어야 할 상황에서 로그인 버튼을 찾고 있었을 것.
  - **숫자 핸들 판단(내가 넘긴 건) 해결**: 핸들을 못 읽어 `username`이 숫자로 오는 경우, 목록에서 빼지 않는 백엔드 판단은 유지하되 화면은 `targetLabel()`로 **`pageName`을 대신 쓰고 "핸들을 읽지 못했다"고 명시**. 페이지 이름을 핸들인 척 보여주지 않는 것이 D-006과 같은 종류라는 Cowork 근거가 정확. `targetLabel()`을 화면이 아니라 api 모듈에 둔 것도 좋은 판단 — 게시 확인 패널이 생기면 같은 규칙을 써야 하고, 두 곳에서 따로 판단하면 한쪽만 숫자를 거르는 날이 옴.
  - **결정 기록 이관 프런트 완료**: 19곳을 세 갈래로 처리(기존 ID 매핑 7 / 주석에 이유가 완결돼 있어 참조만 삭제 4 / 새 ID 필요 8). **참조만 삭제한 판단이 특히 좋음** — 없는 결정을 억지로 만들면 문서가 부풀고, 문서가 커밋 로그처럼 되면 아무도 안 읽어 애초 목적이 사라짐. `apps/frontend/src`의 도달 불가 참조 **0곳** 달성.
  - **자가 발견 — Cowork 집계에서 빠진 1곳**: 19 대 20 차이의 정체가 `ProviderCredentialCard.test.tsx:59`였음(같은 결정의 `.tsx`만 옮기고 테스트 파일을 지나침). 보고 후 Cowork가 함께 처리. 백엔드 이관 시 같은 함정(`.tsx`만 보고 `.test.tsx`를 지나치기) 주의 필요.
  - **자가 발견 — 제출 배치의 실패 2건 직접 수정**(빌드 깨짐 예외): ① `toMatchObject({ selectedIgUserId: undefined })`가 키의 **존재**를 요구해서, 이 상태를 정의하는 "부재"의 정반대를 검사하고 있었음 → 필드별 단언으로 교체. ② 게시 화면이 계정 목록을 읽기 전에 작성된 내비게이션 테스트가 `/videos/library` 하나만 기대 → 두 mount 읽기를 순서 무관하게 단언하도록 수정하고, "provider 경로를 건드리지 않는다"는 본래 보호 장치는 유지.
  - 신규 D-010~D-012 항목 추가(`ef466db`) — D-010은 Cowork 제안대로 D-005와 분리(하나는 코드가 재시도하지 않는 **동작**, 다른 하나는 화면이 재시도하라고 말하지 않는 **문구**, 합치면 하나가 묻힘).
  - 신규 테스트 11건. 검증: root typecheck 전부 통과, frontend 902개·Backend 854개 전부 통과, root build 전부 통과.
  - 커밋: `1e954fa`.
- [x] **인스타그램 로그인 백엔드 — 연결을 한 레코드로 통합(Round 185)**: 앱 ID·시크릿 저장, 로그인 URL 발급, 코드→토큰 교환, 로그아웃까지.
  - **판단 — `ProviderCredentialKind`에서 `"instagram"` 제거(Round 180에서 넣은 것을 되돌림)**: 자격증명 모델은 제공사당 마스킹된 비밀 하나인데, 인스타 연결은 값이 넷(앱 ID·앱 시크릿·토큰·만료일)이고 **같은 로그인으로 쓰이고 같은 순간에 거짓이 된다.** 토큰만 자격증명 자리에 두면 만료일이 다른 곳에 있어야 하고, 그러면 토큰과 만료일이 서로 다른 얘기를 하는 상태가 생김 — 이 저장소가 반복해 밟은 실패 모양이라 구현 중 자리가 틀렸음을 확인하고 되돌림. `PROVIDER_SETTINGS_ROOT`(fail-closed) 아래 단일 파일에 원자적으로 저장. 프런트 영향 없음 확인(설정 화면이 OpenAI/Runway 카드를 하드코딩).
  - **판단 — 앱 자격증명을 바꾸면 저장된 토큰을 버림**: A 앱이 발급한 토큰은 B 앱에 무의미하므로, 남겨두면 "로그인된 것처럼 보이는데 게시는 전부 실패"하는 상태가 됨(D-006).
  - **`state` 1회용 처리**: 발급한 state와 일치하지 않는 코드는 교환하지 않고 거부하고, 성공·실패와 무관하게 소비되어 재사용 불가. 10분 지나면 버려진 시도로 간주. 미완료 로그인은 메모리에만 두어 재시작 시 남지 않음(사용자는 버튼을 다시 누르면 됨).
  - **만료일을 절대 시각으로 1회 변환**: Meta가 수명을 알려준 그 순간에 절대 시각으로 바꿔 저장 — 기간(duration)으로 저장하면 읽을 때마다 다른 뜻이 됨. `tokenExpiresAt`을 화면에 노출하는 이유는 D-007(갱신 경로 없음)이라 안 보여주면 만료가 항상 "갑자기 안 됨"으로 나타나기 때문.
  - **`appConfigured`와 `tokenStored` 분리**: "앱 등록부터 해야 함"과 "로그인만 하면 됨"은 사용자가 할 일이 다름. `tokenStored`는 "Meta가 아직 받아준다"는 뜻이 아님을 계약 주석에 명시(D-006).
  - **자가 발견 — 8개 스위트가 워커째 죽던 원인**: `ProviderSettingsModule`이 `PROVIDER_SETTINGS_ROOT` 토큰을 **export하지 않고** 있었음. 주입 시 DI가 bootstrap에서 실패하는데 **Nest는 이를 테스트 실패가 아니라 프로세스 abort로 만들어**, 배선 실수가 워커 플레이키니스처럼 보였음. 이 세션에서 같은 모양을 두 번째 겪음(첫 번째는 `PROVIDER_SETTINGS_ROOT` fail-closed 도입 때) — "워커가 죽었다"는 거의 항상 DI/모듈 초기화 문제라는 것을 모듈 주석에 기록.
  - **아직 안 만든 것**: Electron 로그인 창(IPC), 게시 orchestration.
  - 신규 테스트 19건(`instagram-login.service.test.ts`). 검증: root typecheck 전부 통과, Backend 874개·frontend 902개·shared 25개 전부 통과, root build 전부 통과. 실제 Meta API 호출 없음.
  - 커밋: `a7e1e86`.
- [x] **Electron 인스타그램 로그인 창(Round 186)**: 로그인 경로의 마지막 조각. 렌더러가 백엔드에서 로그인 URL을 받아 이 창에 넘기고, 창이 도착한 URL을 **통째로** 돌려주면 렌더러가 백엔드에 넘겨 완료 — 이 모듈은 아무것도 파싱하지 않아 코드 추출·state 검증이 서버 한 곳(테스트된 곳)에만 있음.
  - **판단 — IPC 핸들러가 https facebook.com이 아닌 URL을 거부**: 지금 호출자가 우리 화면뿐이지만, 넘겨받은 URL을 그대로 여는 핸들러는 그 자체로 피싱 표면임(진짜 로그인 폼을 보여주는 창이므로). 창도 preload 없이·Node 없이·샌드박스로 띄워 최소 권한만 부여. 유사 호스트(`notfacebook.com`, `www.facebook.com.evil.example`)도 테스트로 차단 확인.
  - **판단 — 창 닫기는 실패가 아니라 답**: 마음을 바꾸는 건 평범한 경우라 로그인 실패와 구분되어야 함(`cancelled`). 또한 결과는 한 번만 확정되므로, 성공 후 창을 닫을 때 발생하는 `closed` 이벤트가 성공을 취소로 덮어쓰지 못함.
  - **Cowork 쪽 남은 배선 1건 전달**: `apps/frontend/src/api/electronBridge.ts`는 Cowork 구역이라 건드리지 않고 추가할 코드와 함께 요청. 특히 `hasElectronBridge()`가 false인 브라우저 탭(개발 서버)에서는 창을 띄울 수 없어 안내가 필요함을 명시.
  - 신규 테스트 7건(`instagram-login-window.test.ts`, `node --test`). 검증: root typecheck 전부 통과, desktop 20개·Backend 874개 전부 통과, root build 전부 통과.
  - 커밋: `181df7f`.
- [x] **프런트 — 인스타그램 연결 설정 카드(Round 187)**: Cowork Round 193. API 설정 화면 안에 배치 — "우리가 행동할 수 있나"를 답하는 값이라 OpenAI·Runway 키와 같은 질문이고, "어디로 가나"를 답하는 계정 선택(게시 화면)과 자리를 나눈 Round 186의 구분을 유지.
  - **`tokenStored`를 "로그인됨"이라고 쓰지 않음**: 토큰이 디스크에 있다는 뜻일 뿐 인스타그램이 아직 받아주는지와는 무관 — D-006과 완전히 같은 함정이 새 자리에서 재발한 것이라, 계약 주석에 적어둔 대로 처음부터 갈라 씀. 다만 **"만료일이 지났다"는 단언함**(그건 우리가 가진 사실). 만료 2주 전 경고도 추가 — 60일 토큰에 갱신 경로가 없어(D-007) 날짜를 안 보여주면 만료가 항상 "갑자기 안 됨"으로 나타남. 테스트에 `"로그인됨"`·`"연결됨"` 문자열 부재를 고정.
  - **앱 정보 교체 = 토큰 삭제를 저장 *전에* 안내**: 단, 토큰이 있을 때만 2단계 확인. 없는 것을 확인받는 확인 창은 클릭 훈련만 시킨다는 Cowork 판단에 동의.
  - **자가 발견 — 제출 배치의 실패 2건 직접 수정**(빌드 깨짐 예외): ① `setInstagramApp`이 trim하지 않는데 자기 테스트는 trim을 기대 → 클라이언트에서 trim(서버도 trim하지만, 붙여넣은 값의 표시가 서버 동작에 의존하면 안 됨). ② **제공사 설정 테스트 6건이 이 화면의 mount 읽기가 하나 늘면서 깨짐** — 순서 기반 mock(`mockResolvedValueOnce`)이 통째로 한 칸씩 밀려 **제공사 로직이 깨진 것처럼 보였음.** 인스타 호출만 옆으로 라우팅하는 래퍼를 두고 단언은 안쪽 mock에 그대로 유지해, 각 테스트의 호출 수 단언이 원래 의도를 그대로 지키게 함. (App.test.tsx에서 겪은 것과 같은 유형이 다른 화면에서 반복됨.)
  - 검증: root typecheck 전부 통과, frontend 928개·Backend 874개 전부 통과(각 1건 기존 플레이키니스 관찰, 재실행으로 무관함 확인), root build 전부 통과.
  - 커밋: `ca310d5`.
- [x] **인스타그램 게시 실행 — 파이프라인 완성(Round 188)**: `POST /projects/:id/instagram/publish` — 컨테이너 생성 → 업로드 → 처리 대기(폴링) → `media_publish`. 사용자가 Round 183에서 승인한 기능의 마지막 단계.
  - **설계 전체가 하나의 사실을 중심으로 배치됨 — 중복 게시는 되돌릴 수 없음**: 유료 중복 요청은 사후에 따질 수 있지만(D-005), 중복 게시는 이미 본 사람에게서 되돌릴 수 없음. 그래서 ① 이미 게시된 프로젝트는 **Meta에 요청이 나가기 전에** 거절, ② 전체 시퀀스가 교차 프로세스 락을 잡아 창 두 개가 동시에 게시 못 함, ③ 락 안에서 프로젝트를 **다시 읽어** 대기 중 다른 창이 끝냈는지 확인.
  - **판단 — 게시 기록은 Instagram이 받아들인 뒤에만 씀**: 그래서 기록의 존재가 "시도했다"가 아니라 **"그 게시물이 존재한다"**를 뜻함. 실패한 시도는 아무것도 남기지 않아 재시도가 안전하고, `INSTAGRAM_PUBLISH_FAILED`를 "아무것도 안 올라갔다"로 정확히 말할 수 있음.
  - **판단 — `igUserId`를 저장된 선택에서 읽지 않고 요청에 실어 받음**: 그래야 **확인 패널이 말한 계정 = 실제로 올라간 계정**이 증명됨. 서버는 그것이 지금 이 로그인으로 게시 가능한 계정인지 한 번 더 대조(취소된 ID가 조용히 남의 계정이 되면 안 됨, D-006).
  - `approved: true`는 기본값 없음 — Runway 유료 단계와 같은 등급의 명시적 게이트(Cowork Round 183 요구사항).
  - 캡션 2200자 한도를 서버도 검사 — 화면을 거치지 않은 호출이 업로드까지 끝낸 뒤 거절당하지 않도록.
  - `ProjectSummary.instagramPost?: { mediaId, igUserId, publishedAt }` 신설 — 화면이 이미 게시된 프로젝트에 버튼을 아예 안 띄울 수 있게("실패할 선택지는 선택지가 아니다"). `StoredProject.instagram_post`로 저장.
  - **처리 대기는 단일 요청 안에서 폴링**(최대 3분, 초과 시 실패). 중간 진행률이 필요하면 작업(job) 방식으로 바꿀 수 있음을 Cowork에 알림.
  - 신규 테스트 12건. 검증: root typecheck 전부 통과, Backend 886개(+12 신규)·frontend 928개·shared 25개 전부 통과, root build 전부 통과. **실제 Meta API 호출 없음**(전부 mock).
  - 커밋: `7ddcf87`.
- [x] **프런트 — 게시 버튼 + 계정 명시 확인 패널, 그리고 D-012 첫 뒤집힘(Round 189)**: Cowork Round 196. 확인 패널이 나갈 계정을 핸들로 말하고, 계정이 하나뿐일 때도 그렇게 함. "지운다고 해도 이미 본 사람에게서는 사라지지 않습니다"를 문구에 명시.
  - **이미 게시된 프로젝트는 버튼을 비활성이 아니라 아예 없앰** — 비활성 버튼은 "조건을 맞추면 누를 수 있다"는 뜻인데 여기엔 맞출 조건이 없음. 그 표시가 로컬 플래그가 아니라 **게시 응답의 서버 기록**에서 나오게 해서 새로고침해도 동일.
  - **결정 기록의 "뒤집힘" 메커니즘 첫 사용**: `D-012`(이 화면은 아무것도 올리지 않는다)가 실제로 뒤집혀, 규칙대로 항목을 **지우지 않고** 제목에 `(뒤집힘 → D-015)`를 달고 본문에 경위를 남김 — 기존 참조가 여전히 도달하고, 따라간 사람이 "바뀌었고 어디로 갔는지"를 그 자리에서 알게 됨. 신규 `D-015` 추가.
  - **Cowork 자가 발견**: 소스 스캔 테스트의 주석이 거짓이 됨("게시는 범위 밖"). 검사 자체는 그대로 두고 지키는 대상을 다시 씀 — 이 화면은 이제 게시하지만 **메타와 직접 말해서는 안 됨**(그러려면 페이지 안에 토큰이 있어야 하고, 그게 절대 일어나면 안 되는 그 하나).
  - 커밋: `cde34c1`.
- [x] **결정 기록 이관 완료 + 잠금 검사 가동(Round 190)**: `.claude-bridge` 도달 불가 참조를 저장소 전체에서 제거(시작 시 87곳 → 0곳, 검사기 자신의 설명 1곳 제외). 신규 `D-016`(테스트 프로세스는 실제 Provider 호출 불가), `D-017`(코드가 `instanceof`로 판단하는 값을 테스트에서 흉내 내지 않는다).
  - **자가 발견 — 내 대량 변경이 근거를 삭제할 뻔함**: 괄호 묶음을 통째로 지우는 정규식을 먼저 썼는데, 라운드 번호뿐 아니라 **실제 근거까지 제거**했음(갇힌 사용자 프로젝트 사례, 테스트 실행이 실제 과금을 낸 사례, 검토 후 의도된 설계로 확인하고 접은 대안). 마지막 것은 이 문서가 특히 보존하려는 "근거를 대고 접은 길". diff를 한 줄씩 검토하다 발견해 **전량 되돌리고**, 참조 토큰만 치환하고 주변 단어는 건드리지 않는 방식으로 재작업. D-013이 경고하는 실패 모드가 테스트 리팩터가 아니라 내 변경에서 나온 사례.
  - **잠금 검사가 첫 실행에서 놓친 1곳을 잡음**: `apps/desktop/src/main.ts` — 내 이관 작업의 grep이 아예 훑지 않은 워크스페이스. 규율보다 검사가 나은 이유가 그대로 드러남.
  - **자가 발견 — 사용자 로컬 데이터를 실수로 커밋**: `git add apps`가 세션 내내 추적되지 않던 `apps/backend/learning_data/`(프로젝트·에셋 목록·예산 장부)를 함께 커밋. 자격증명은 포함되지 않음(실제 키는 provider settings 루트에 별도 보관)을 확인한 뒤 추적 해제하고 `.gitignore`에 등록, 작업 트리 파일은 그대로 유지. 히스토리에는 남아 있음.
  - 검증: root typecheck 전부 통과, Backend 887개·frontend 943개·desktop 20개·shared 25개 전부 통과, root build 전부 통과.
  - 커밋: `db22e2e`, `452e9d9`, `9bacfa7`.

- [x] **데스크톱 셸의 자격증명·데이터 서랍이 브라우저와 갈라져 있던 것 수정(Round 191)**: 개발 모드 데스크톱 셸이 `PROVIDER_SETTINGS_ROOT`를 설정하지 않아, 브라우저 개발 서버와 **다른 서랍**을 보고 있었음.
  - **심각한 쪽은 자격증명이 아니라 학습 데이터**: 셸에서 실행하면 `learning_data`가 저장소 루트로 잡혀 **보존 대상인 Python 베이스라인을 읽고, 나아가 덮어썼을 것**. `AGENTS.md`가 명시적으로 보존을 요구하는 그 디렉터리.
  - `apps/desktop/src/runtime-roots.ts`로 경로 결정을 한곳에 모으고(패키징=`userData`, 개발=`apps/backend`), 순수 함수라 테스트가 실제 파일 없이 두 모드를 다 검사함. 신규 D-018(시점 검사 결과를 현재 상태처럼 보여주지 않는다)도 함께.
  - 커밋: `892e124`, `3664134`.
- [x] **인스타그램 로그인을 백엔드 콜백 방식으로 전환 — 브라우저에서도 됨(Round 192)**: 기존 로그인은 Meta의 데스크톱 webview 리다이렉트에 의존해 **자기 창 주소를 읽을 수 있는 셸**을 요구했음. 사용자는 브라우저에서 작업하고 패키징 전까지 그럴 예정이라, 그 경로는 아예 쓸 수 없었고 버튼이 "데스크톱 앱에서만 가능"으로 비활성이었음.
  - 이제 Meta가 **백엔드 자신의 콜백**으로 리다이렉트함. 창 안을 들여다볼 필요가 없어져 브라우저 탭과 패키징 셸이 같은 경로를 쓰고, 유지할 로그인 경로가 둘이 아니라 하나가 됨. Meta는 개발 모드 앱에 `http://127.0.0.1` 리다이렉트를 허용하는데, 이 앱은 자기 소유 계정에만 게시하므로 심사도 공개 도메인도 영영 필요 없음.
  - **판단 — 포트를 통일하지 않고 두 줄 등록**: Cowork가 통일을 제안했으나, 리다이렉트 URI를 백엔드 자기 포트에서 만들면 환경마다 제 주소가 나오고(브라우저 개발 서버 3000, 패키징 4317) Meta 앱 설정에 두 줄 등록하면 끝 — 런타임 동작을 바꾸지 않는 쪽이 더 작은 수술.
  - **콜백은 어디로도 되돌려 보내지 않고 자기 완결 페이지로 답함**: 개발 중엔 화면이 개발 서버 포트에 있고 패키징하면 이 프로세스가 서빙하므로, "사람을 어디로 돌려보낼지 아는 백엔드"는 틀릴 거리가 하나 더 늘어남.
  - Electron 로그인 창과 IPC 브리지 삭제(코드를 백엔드가 직접 받으면 존재 이유가 없음).
  - **콜백 전용 테스트 5건 추가**: 이 앱에서 **주소가 구조적으로 공개된 유일한 엔드포인트**라 쿼리가 공격자 도달 가능. 실패 시 던지지 않고 페이지로 답함(던지면 낯선 사람 브라우저에 이 앱의 에러 봉투가 렌더됨), 제공사 문구·코드·state를 페이지에 절대 싣지 않음, 쿼리를 반사하지 않고 이스케이프함, **페이지가 외부에서 아무것도 불러오지 않음**(로그인 완료 페이지야말로 주입된 fetch가 가장 안 띄는 자리).
  - 커밋: `4ba8e1a`, `e950dde`.
- [x] **프런트 — 로그인 완료를 자동 감지, 수동 확인은 예비로 남김(Round 193)**: Cowork Round 204. 폴링을 **갈아치우지 않고 얹음** — 폴링은 정당하게 포기할 수 있고(창이 닫힘, 5분 경과) 그 순간에도 사람은 실제로 로그인이 돼 있을 수 있어서, 유일한 경로가 방금 만료된 흐름은 클릭 하나 더 있는 흐름보다 나쁨. "로그인 완료 확인" 버튼 유지.
  - **🔴 순서가 곧 기능**: 창 닫힘 검사가 상태 읽기 **앞**에 와야 함 — 콜백 페이지가 토큰 저장 직후 자기 창을 닫으므로, 뒤집으면 **진짜 로그인이 절반쯤 "아무 일도 안 일어남"으로 끝남**. 재현이 간헐적이라 실제로 만났으면 원인 찾는 데 한참 걸렸을 종류. 테스트로 고정.
  - 인스타 카드에 상태를 둘이 아니라 **셋**(loading/ready/unavailable) 부여 — 읽기 실패 시 숨기는 것이 최악(없는데 없다는 말도 없고, "이 앱에 그 기능이 없다"와 "닿지 못했다"를 구분할 수 없음).
  - **🔴 자가 발견 — D-013이 그 문서를 쓰게 만든 파일에서 재발**: 재작성 과정에서 `routingInstagramAside` 래퍼가 빠져 제공사 설정 테스트 6건이 또 깨졌고, 증상도 똑같이 원인과 무관한 `"OpenAI를 찾을 수 없다"`였음. 복원하고 이번엔 주석에 **D-013을 직접 인용**. 문서화만으로는 안 되는 부류라는 증거이므로, 세 번째 재발 시 규칙이 아니라 **검사**로 올리기로 Cowork와 합의.
  - Cowork가 못 돌려본 것 확인해 회신: vitest가 테스트에서 `vite.config.ts`를 다시 import하는 것 **됨**(`?raw` 불필요).
  - 검증: root typecheck 전부 통과, frontend 949개·Backend 892개 전부 통과(백엔드 1건 기존 플레이키니스 관찰, 재실행으로 무관함 확인), root build 전부 통과.
  - 커밋: `4ab7767`.
- [x] **인스타그램 로그인 실패 사유를 콘솔에 남김(Round 194)**: 콜백 페이지는 사람에게 이유를 말하지 않는다 — 로그인 페이지야말로 제공사 원문 에러가 엉뚱한 곳에 붙여넣어지기 가장 쉬운 자리라서 의도적이다. 그런데 이유가 **아예 버려지고 있었다**: 사람에게 사유를 숨기는 유일한 경로가 동시에 어디에도 기록하지 않는 유일한 경로였음.
  - 하필 지금 문제가 되는 이유: `nest start --watch`가 파일 변경마다 재시작하고 발급된 `state`는 메모리에만 있어서, **사람이 메타 로그인 화면에 있는 동안 백엔드가 재시작하면 정상 로그인이 메타가 교환을 거부한 것과 똑같은 두 문장으로 실패**한다. 둘을 구분할 근거가 아무 데도 없었음.
  - 통과시키는 어휘를 고정: 에러 코드·제공사 분류·메시지 — 전부 이 저장소가 직접 쓴 문자열. `InstagramAdapterError`의 `detail`(메타 원문)은 예외에 실리지 않고, 쿼리는 어떤 형태로도 이름이 남지 않음. `code`와 `state`는 이 흐름에서 절대 기록되면 안 되는 두 값이고 로그는 그걸 실수로 흘리기 가장 쉬운 자리다(출력처럼 안 보이므로). 성공 시 아무것도 로그하지 않는 것까지 테스트로 고정.
  - `@Optional()`이 기능적: 로거 파라미터 타입이 인터페이스라 `Object`로 리플렉트되고, 없으면 Nest가 그걸 해석하려다 **테스트 실패가 아니라 부트스트랩에서 프로세스를 중단**시킴 — 이번 세션에 여덟 개 스위트에서 "worker exited unexpectedly"로 읽혔던 그 모양.
  - 커밋: `d086efb`.
- [x] **주석이 대는 근거도 확인한 것만 적는다 — D-019 신설(Round 194 문서)**: 인스타 로그인 폴링의 순서(창 닫힘 검사를 상태 읽기 앞에 둠)에 "콜백 페이지가 토큰 저장 직후 자기 창을 닫는다"는 **아무도 확인한 적 없는 근거**가 붙어 있었음. 그 페이지는 스크립트가 없는 정적 HTML이고(부재를 고정한 테스트가 이미 있음), 창을 닫는 건 사람이다.
  - **위험한 건 코드가 맞았다는 점**이다 — 순서는 옳고 테스트도 통과한다. 틀린 건 코드가 아니라 코드를 지키는 이유이고, 나중에 그 순서를 뒤집을지 판단하는 사람이 저울에 올리는 게 정확히 그 이유다. 같은 가짜 근거가 테스트 주석에도 있었고 그쪽이 더 나빴다(테스트를 지워도 되는지 판단하는 사람이 읽는 게 그 설명이므로).
  - 커밋: `3af7a18`, `c3b9ca0`.
- [x] **🔴 인스타그램 로그인을 데스크톱 창으로 복원 — 메타는 이 앱이 제공할 수 있는 어떤 주소도 등록해 주지 않는다 + D-020(Round 195)**: Round 192의 백엔드 콜백 전환을 되돌림. 메타 앱 설정이 `http://` 리디렉션을 전부 거부하고("모든 리디렉션 URL에는 HTTPS가 필요합니다"), 2018년 이후 만든 앱은 예외 토글이 잠겨 있어 끌 수 없음. 개발 모드 여부와 무관.
  - **전환의 근거가 확인되지 않은 한 문장이었다.** "메타는 개발 모드에서 localhost 리디렉션을 허용한다"를 블로그 문장 하나에서 읽고 확인한 것처럼 적었고, 그 한 줄 위에 아키텍처 변경과 코드 삭제가 얹혔음. D-019의 실패가 **설계 결정 규모로** 난 사례라 D-020으로 기록.
  - **되돌림이 아님**: 리디렉션 주소를 로그인 건별로 고르고 pending state와 함께 기억하도록 바꿈 — 메타는 다이얼로그와 교환에서 **글자 하나까지 같은 문자열**을 요구하므로, 시도에 묶어두면 그게 구조가 된다. 두 흐름 모두 하나의 private `finish()`로 수렴 → 토큰이 써지는 자리와 state 검사가 각각 한 곳. `extractOAuthResult`가 규칙을 다시 만들지 않고 `readOAuthCallback`에 위임(테스트로 고정)해, "state 없는 code를 받아도 되는가"에서 두 판독기가 갈라질 수 없게 함.
  - 커밋: `2a79c6d`, `c6244a3`(D-020 정정 — 거부당한 것은 로컬 주소가 아니라 스킴).
- [x] **🔴 가로형 프로젝트가 세로로 생성·과금·병합되던 버그 + D-021(Round 196)**: 사용자가 프로젝트 설정에서 가로형(16:9)을 골랐는데 아무 일도 일어나지 않았음. 저장은 `lore_context.style_notes.aspect`로 가는데 **읽는 곳 다섯 곳이 전부 `style_profile.aspect`**(아무것도 쓴 적 없는 필드)를 보고 있었고, 실제 저장 데이터로 확인 결과 그 필드를 가진 프로젝트는 0개 — 하위 호환 대상이 아니라 처음부터 없던 자리였음.
  - **표시 버그가 아니었다**: 이 한 값이 이미지 크기·Runway 비율·병합 캔버스를 모두 결정해서, 장면 이미지가 세로로 생성되고 → 그 이미지로 세로 영상이 **과금**되고 → 세로 캔버스로 병합됐음. 유료 단계 세 번이 전부 틀린 모양으로.
  - **복사본 다섯 개가 서로 어긋난 게 아니라 똑같이 틀렸다** — 그래서 비교해도 일치했고 아무도 못 잡았다. 복사본의 진짜 대가는 어긋나는 것이 아니라 **고쳐질 자리가 없다는 것**. `projects/project-aspect.ts` 한 곳으로 모음(`videos/`·`images/`가 이미 `projects/`에 의존하므로 레이어 역전 없음).
  - **테스트도 같이 틀려 있었음**: 가로를 시험하던 5건이 전부 `style_profile.aspect`에 값을 넣어서, 기능이 망가진 채 초록이었고 테스트의 존재가 안전 신호가 되지 못했음(D-017·D-013 계열). 새 회귀 테스트는 설정 저장 경로를 실제로 거친 뒤 읽음.
  - 이미 생성된 결과물은 손대지 않음 — 재생성은 재과금이라 사용자 결정.
  - 커밋: `e016c6b`.
- [x] **🔴 인스타그램 로그인 흐름 두 개 확정 — 개발은 브라우저(로컬 HTTPS 콜백), 배포는 데스크톱 창 + D-022(Round 197)**: Cowork Round 213이 요구사항을 정정 — 사용자 확정본은 **"지금은 브라우저, 나중에 데스크톱"**이고 둘 다 참이라 어느 하나도 미룰 수 없음. D-020의 "데스크톱 창을 쓴다"는 결론은 **배포 시점**만 다루고 있었고, 사용자가 실제로 막혀 있던 건 **개발 시점**이었음. 하나만 만족시키는 답을 고르려 한 것이 하루에 다섯 번 왕복한 원인.
  - **D-020에서 확인한 제약은 전부 유효하다** — 메타가 `http://`를 거부하는 것, `https://127.0.0.1`은 등록되는 것(사용자가 실제로 등록·저장 성공), 자체 서명 인증서가 배포된 앱의 모든 사용자에게 경고를 띄우는 것. 틀린 건 그 제약에서 **흐름을 하나만 골라낸** 부분이다. mkcert가 개발자 도구라는 판단도 취소되지 않고, **개발자만 지나가는 경로에만 걸리는** 제자리를 찾는다.
  - **계약(`packages/shared`)**: `InstagramConnectionStatus.callbackLoginAvailable: boolean` 신설 — 브라우저 탭이 버튼을 누르기 **전에** 정상 경로인지 알 수 있어야 안내를 쓸 수 있음. 주장하는 것은 "이 프로세스가 콜백을 HTTPS로 제공 중"뿐이고, 메타 등록 여부·브라우저의 인증서 신뢰 여부는 알 수 없으므로 주장하지 않음(D-006). 데스크톱 셸 안에서는 이 필드와 무관하게 데스크톱 흐름이 항상 가능하므로, 나머지 절반은 화면이 스스로 안다.
  - **🔴 `StartInstagramLoginRequest.flow` 필수 — 기본값 없음**: 기본값이 `"desktop"`인 동안 화면은 콜백 방식으로 쓰여 있었고, **그 불일치는 어디에서도 에러를 내지 않았다** — 창은 메타 페이지로 가고 아무도 읽지 않고 화면은 5분을 기다린 뒤 아무 말도 안 함. 필수로 만들면 같은 사고가 첫 호출에서 거부된 요청이 된다. 어느 흐름인지 아는 유일한 쪽은 **호출자**다(자기 창을 볼 수 있는지는 서버가 알 수 있는 사실이 아님). 같은 이유로 콜백을 요청했는데 백엔드가 제공하지 않으면 데스크톱으로 조용히 대체하지 않고 **거부**한다.
  - **`instagram-callback-tls.ts` 신규**: 인증서를 환경 변수(`INSTAGRAM_CALLBACK_TLS_CERT`/`_KEY`/`_PORT`, 기본 3443)로만 받고 **번들하지 않음** — 패키징된 앱은 아무것도 설정하지 않아 리스너가 없고 데스크톱 창으로 로그인. 경로가 아니라 **파일 내용을 여기서 읽는다**: `callbackLoginAvailable`이 같은 해석 결과에서 나오므로, 리스너가 못 뜰 이유는 그 사실을 보고하기 전에 실패해야 함. 반쪽만 설정된 경우는 폴백이 아니라 **부팅 실패** — 폴백의 증상이 "브라우저에서 창이 기다리다 아무 말 없이 끝남"이라 진단 비용이 가장 비싼 실패이기 때문.
  - **TLS 리스너는 돌아가는 앱의 express 인스턴스를 그대로 쓴다**: 발급된 `state`가 서비스 인스턴스 하나의 메모리에 있어서, 별도 프로세스/별도 Nest 앱으로 받으면 **자기가 발급한 적 없는 state**를 받게 되고 모든 브라우저 로그인이 검증 불가로 거부됨. 포트만 하나 더 연다. listen 실패는 로그하고 넘어가지 않고 부트스트랩을 거부 — 이미 "문이 열려 있다"고 말한 뒤이므로.
  - 신규 테스트: TLS 해석 7건(반쪽 설정 거부, 빈 파일 거부, 포트 검증, **에러에 개인키 내용이 실리지 않음** 포함), `flow` 필수·잘못된 값 거부, 콜백 미제공 시 거부, `callbackLoginAvailable` 양쪽 값, 상태와 실제 발급 주소가 한 해석에서 나오는지.
  - **프런트는 Cowork 몫이고 이 커밋에 없음** — 계약이 이 커밋으로 확정되므로 Cowork이 `callbackLoginAvailable`로 안내를 갈라 쓰고 콜백 흐름 폴링을 되살리면 완료. 그때까지 커밋된 화면은 `flow` 없이 start를 호출해 400을 받는다(기존의 조용한 5분 대기보다는 나은 실패). Cowork의 미커밋 프런트 작업은 건드리지 않음.
  - 검증: root typecheck 전부 통과, Backend 928개(+12 신규) 전부 통과, frontend 945개 전부 통과, root build 전부 통과.
  - 커밋: `3ef0087`.
- [x] **프런트 — 두 로그인 흐름 배선 완료, 브라우저가 정상 경로가 됨(Round 198)**: Cowork Round 214. 계약(`3ef0087`)의 프런트 절반.
  - 흐름 결정을 화면이 한다 — 서버는 호출자가 브라우저인지 셸인지 모르기 때문: Electron 셸이면 `"desktop"`(`callbackLoginAvailable`과 무관), 브라우저 + available이면 `"callback"`, 브라우저 + 아니면 **버튼 비활성 + 이유 명시**. 버튼을 살려두면 실패가 **메타 페이지에서** 나는데 그건 우리 화면 밖이라 문구를 고를 수 없고 사용자는 자기 앱 설정을 의심하게 됨.
  - `canOpenInstagramLogin()`을 `hasElectronBridge()`와 분리 유지 — 옛 셸은 브리지가 있고 창 기능이 없음. 그 경우 브라우저와 같이 취급(테스트로 고정).
  - **`callbackLoginAvailable: true`일 때 화면은 아무 말도 하지 않는다** — "로그인 준비 완료" 배지 없음. 등록 여부도 인증서 신뢰도 앱이 모르는데 초록 배지가 있으면 메타 페이지에서 실패했을 때 사용자가 그 배지를 믿고 엉뚱한 데를 뒤짐(D-006).
  - `pollUntilTokenStored` 되살림(Round 211에서 지운 것) — 지운 이유(그 흐름이 없어짐)가 사라졌으므로. 창 닫힘 검사를 상태 읽기 **앞**에 두는 순서와 그 근거(D-019)를 그대로 유지. 콜백 흐름의 끝을 셋으로 구분: 저장됨 / 창 닫음(취소) / 5분(시간 초과) — 사람이 한 일과 안 한 일을 같은 문구로 묶지 않음.
  - `isStatus`가 `callbackLoginAvailable`을 **필수로** 검사 — 기본값이 없는 이유는 없을 때 고를 수 있는 값이 둘 다 틀리기 때문(`false`면 멀쩡한 콜백을 숨기고, `true`면 완료될 수 없는 로그인을 권함). 계약이 깨지면 카드가 "불러오지 못했습니다"로 떨어지는 게 맞음.
  - **🔴 CLI가 직접 고친 빌드 깨짐**: `instagramConnectionApi.test.ts`가 갱신되지 않아 typecheck 3건(TS2554 — `startInstagramLogin()` 인자 누락)과 테스트 1건(status fixture에 `callbackLoginAvailable` 누락)이 깨져 있었음. Cowork 보고의 "타입체크 통과 / 누락 fixture 0건"과 실제가 달랐음 — 우편함 규칙의 기계적 빌드 깨짐 예외로 CLI가 고치고 보고에 명시. 실제 검증은 항상 CLI가 돌린다는 구역 분담이 여기서 값을 함.
  - 검증: root typecheck 전부 통과, frontend 954개 전부 통과, Backend 928개 전부 통과, root build 전부 통과.
- [x] **🔴 실제 인스타그램 로그인 첫 성공, 그리고 그 과정에서 드러난 오분류 수정(Round 199)**: 사용자가 mkcert·인증서·메타 등록·비즈니스 계정 전환까지 마치고 **브라우저에서 로그인 성공**(토큰 저장, 만료 2026-10-27). 이 기능에서 실제 메타 상대로 돌아본 적 없던 유일한 구간이 처음 돌았음.
  - **첫 시도는 실패했고, 원인은 앱 시크릿이 인스타그램 쪽 시크릿이었던 것**(앱 설정 → 기본 설정의 "앱 시크릿 코드"가 아니라 Instagram → API 설정 화면의 시크릿). 메타 대시보드에 시크릿이 두 개 있어 밟기 쉬운 자리.
  - **🔴 진짜 결함은 그게 아니라 분류였다**: `classifyGraphErrorCode`가 Graph `code === 1`을 `"server"`로 보내고 있었고, 그 문구가 "Instagram(Meta) 서버의 일시적인 오류가 발생했습니다"임. **자격증명이 틀려서 거절당한 로그인이 "메타 장애"로 보고됐고**, 그 설명에 대한 합리적 반응(기다렸다 그대로 재시도)은 절대 성공할 수 없는 행동이었음. Cowork이 이 분류를 믿고 "시크릿 문제는 400이 나와야 맞으니 가능성 낮다"며 정답을 배제했던 것이 기록에 남아 있음.
  - **메타 문서를 직접 확인해서 고침**(추측 위에 쌓지 않기 — D-019/D-020): code 2는 "가동 중단으로 인한 일시적인 문제입니다" 하나뿐이라 `"server"` 유지. code 1은 "가동 중단일 수 있습니다 … **문제가 다시 발생하면 기존 API를 요청하고 있는지 확인하세요**" — **서로 다른 두 상황을 한 코드가 덮음**. 둘 중 하나를 사실로 단언할 수 없으므로 `"unknown"`("Instagram 요청을 완료하지 못했습니다.")으로 분리 — 아무것도 주장하지 않고 아무 행동도 지시하지 않는 것이 포괄 코드의 정직한 내용(D-006). 부수 효과로 `RETRYABLE`에서도 빠지는데 이것도 옳음(영영 성공 못 할 요청일 수 있는데 재시도는 추측).
  - **분류의 근거가 된 숫자를 진단 로그에 실음**: `InstagramErrorDiagnostics`(HTTP status, Graph code·subcode) 신설 → 어댑터 에러 → `instagramProviderError`의 `details.diagnostics` → 콘솔 로그(`status=400, graphCode=1, graphSubcode=33`). **숫자만** — 메타 원문이 로그에 닿지 않는 기존 규칙(Round 194)은 그대로이고 테스트로 재확인. 이게 없으면 분류는 **검증할 방법이 없는 단언**이고, 이번 실패가 정확히 그 상태였음.
  - **화면 문구는 이미 옳았음을 확인**: 프런트 `SAFE_ERRORS.INSTAGRAM_PROVIDER_ERROR`가 "앱 ID와 시크릿이 맞는지 확인한 뒤 다시 시도해 주세요"라고 말하고 있고, 콜백 페이지는 의도적으로 이유를 말하지 않음. 즉 오도된 것은 사용자 화면이 아니라 **로그를 읽고 진단하던 쪽**이었음 — 고칠 자리가 프런트가 아니라 분류라는 뜻.
  - 신규 테스트 5건: code 1 → unknown, code 2 → server, diagnostics 3값 전달, 본문을 못 읽을 때도 status는 남음, 콘솔에 숫자가 찍히되 메타 원문은 안 찍힘.
  - 검증: root typecheck 전부 통과, Backend 933개(+5 신규) 전부 통과, frontend 954개 전부 통과, root build 전부 통과. (`local-video-workflow.runway.test.ts` 1건 기존 타이머 플레이키니스 재관찰 — 단독 재실행 13개 전부 통과, 인스타와 무관.)
- [x] **`lastLoginError` 계약 신설 — 거절당한 로그인이 5분 침묵 뒤 거짓말로 끝나던 것(Round 200)**: Cowork Round 217 요청. 브라우저 흐름에서 메타가 로그인을 거절하면 사용자는 이유를 어디서도 못 봤음 — 콜백 페이지는 의도적으로 침묵하고(맞는 설계), 카드는 5분 폴링 뒤 "로그인이 끝나지 않아 기다리기를 멈췄습니다"라고 함. **끝나지 않은 게 아니라 거절로 끝났고, 기다림이 부족했던 것도 아님** — 모르는 것을 말한 게 아니라 아는 것과 다른 것을 말한 것이라 D-006보다 나쁨. 비용이 5분이고 그 뒤 안내가 잘못된 방향.
  - **`InstagramConnectionStatus.lastLoginError?: { code: string }`** — `code`는 실패한 요청 자신이 반환하는 그 에러 코드. Cowork은 `category`를 요청했지만 프런트 `SAFE_ERRORS`가 **코드로 키잉**돼 있어서, category를 주면 category→문구 두 번째 표를 만들어야 했음. **한 결정을 두 표가 나눠 가지면 어긋난다**는 이 저장소의 반복 실패라 코드로 줌. 진단 숫자는 싣지 않음(로그만 묻는 질문) — 메타 원문은 애초에 앱 밖으로 안 나감.
  - **🔴 실패를 앱이 아니라 "시도"에 묶었다**: 전역 `lastLoginError`면 D-018을 정면으로 밟음(어제 실패가 남아 있다가 오늘 성공한 로그인 옆에 표시됨). `pending`을 `LoginAttempt` 유니온(`pending` | `failed`) **한 필드**로 바꿔서, 시작이 이전 것을 대체하고 완료가 비움. 두 필드로 나누면 서로 어긋날 수 있지만 **한 필드는 자기 자신과 어긋날 수 없음**.
  - `finish()`는 여전히 state를 **아무 일이 일어나기 전에** 소진 — 한 번 발급된 state가 두 번 쓰일 수 없다는 성질 유지. 거절은 그 뒤에 `failed` 페이즈로 **되써짐**이지 pending을 살려두는 게 아님.
  - **열려 있던 시도가 없으면 아무것도 기록하지 않음** — 대기 중인 화면이 없는 콜백에 실패를 지어내면 아무도 시작 안 한 로그인 옆에 에러가 붙음. "없음"이 계속 "말할 시도가 없음"을 뜻해야 함.
  - **경합 처리**: 실패 경로 전체가 비동기라 실패하는 도중에 사용자가 버튼을 다시 누를 수 있음. 새 시도가 슬롯의 주인이고, 덮어쓰면 **진행 중인 로그인에 대한 질문에 그 전 것의 결과로 답하는** 꼴이 됨. 테스트로 고정(fetch 도중 `start` 재호출).
  - 신규 테스트 8건: 거절 보고, 시작 전 부재, 새 start가 지움, 성공이 지움, state 검증 실패도 보고, 대기 없던 콜백은 무기록, 경합, signOut이 지움.
  - **프런트는 Cowork 몫** — 폴링 중 `lastLoginError`가 보이면 즉시 중단하고 기존 `SAFE_ERRORS` 문구 재사용(새 문구 안 만듦: 이미 옳은 문구가 있고 도달만 못 했음). `timedOut`은 남김 — 진짜로 아무 일도 안 일어난 경우는 여전히 있고 그때는 그게 사실.
  - 검증: root typecheck 전부 통과, Backend 941개(+8 신규) 전부 통과, frontend 954개 전부 통과, root build 전부 통과.
  - 커밋: `91604e3`.
- [x] **프런트 — 거절당한 로그인이 즉시 이유를 말한다 + 언마운트 후 상태 갱신 차단(Round 201)**: Cowork Round 218. `lastLoginError` 계약의 프런트 절반, 그리고 Round 193에서 CLI가 짚은 폴링 수명 문제.
  - 폴링 종료 조건에 거절을 **예외가 아니라 같은 규칙으로** 추가: `status?.tokenStored || status?.lastLoginError` — 둘 다 "서버가 이 시도에 대해 할 말이 생겼다".
    ```
    before  거절 → 5분 침묵 → "로그인이 끝나지 않아 기다리기를 멈췄습니다"
    after   거절 → 즉시 중단 → "인스타그램에서 요청을 거부했습니다. 앱 ID와 시크릿이 맞는지 확인한 뒤..."
    ```
    **"오래 걸렸다"는 도움이 안 되는 게 아니라 거짓이었고**, 고칠 것이 사용자 손에 있는데 기다리라고 지시했음. 어제 실제로 그 5분이 두 번 있었음.
  - **문구 표가 하나임을 코드로 못박음**: `instagramConnectionErrorForCode(code)`를 export 하고 기존 `toInstagramConnectionDisplayError`가 그걸 호출 — throw된 에러와 폴링이 읽은 상태가 같은 `SAFE_ERRORS`를 지나감. 저장소 전체에 `INSTAGRAM_PROVIDER_ERROR` 문구는 한 곳(grep 확인). CLI가 계약을 `category`가 아니라 `code`로 준 이유가 여기서 실현됨 — category였으면 두 번째 표가 생기고 같은 실패에 데스크톱/브라우저가 다른 말을 하는 날이 옴.
  - `timedOut`은 유지 — 창을 열어두고 자리를 뜬 진짜 침묵은 여전히 있고 그때는 그게 사실.
  - `isStatus`는 `lastLoginError`를 **모양만** 검사(있으면 `{ code: string }`). `callbackLoginAvailable`과 사정이 다름: 그쪽은 없을 때 고를 수 있는 값이 둘 다 틀려서 필수였지만, 이쪽은 **없음이 이미 "말할 시도가 없음"이라는 정확한 뜻**이라 선택이 맞음.
  - **언마운트 후 상태 갱신 차단**(CLI Round 193 지적): 콜백 폴링이 클릭 핸들러 안에서 최대 5분 도는데 중단 수단이 없었음 — 설정 화면은 사람이 왔다 갔다 하는 화면이라 대기가 카드보다 오래 사는 게 예외가 아니라 일상. `useRef` + 언마운트 cleanup으로 `abandoned`를 되살리고 `onStatusChange`·`setError`·`setPending` 모두 통과시킴. ref인 이유는 렌더되지 않는 값이고 정리 중인 컴포넌트에 렌더를 예약하면 안 되기 때문.
  - 신규 테스트 2건: 폴러가 거절에 즉시 종료(읽기 2회로 확인), 카드가 거절을 `SAFE_ERRORS` 문구 그대로 표시하며 **timeout·cancelled 표시는 뜨지 않음** — 시계 탓도 사용자 탓도 하지 않는다는 것을 고정. 어제 화면이 한 게 정확히 그 둘이었음.
  - **Cowork이 못 돌린 것을 못 돌렸다고 보고함**(Round 214의 반대) — 새 카드 테스트가 실제 폴링 인터벌 1.5초를 기다리므로 `findBy` 4초가 이 환경에서 충분한지 미확인. CLI가 실행: 충분함(frontend 956개 전부 통과).
  - 검증: root typecheck 전부 통과, frontend 956개(+2 신규) 전부 통과, Backend 941개 전부 통과, root build 전부 통과.
  - 커밋: `0d94b9b`.
- [x] **🔴 유료 단계를 "비용이 들지 않습니다"라고 말하던 화면 2건 + "무료" 주장 전수 감사(Round 202)**: Cowork Round 219~223. **사용자가 실제로 과금된 상태에서 두 번 "돈 안 나갔다"는 말을 들었음.**
  - `LongProjectOutlineScreen.tsx:217` — "이 단계는 비용이 들지 않습니다 — AI를 부르지 않고 프롬프트만 저장합니다." **거짓.** `LongProjectsService`는 `ProviderSettingsService`·`OpenAiBudget`을 주입받고 `approve()`가 OpenAI를 호출하며 `LONG_OUTLINE_ESTIMATED_COST_USD`를 예산에 기록함.
  - `LongEpisodeScriptScreen.tsx:126` — "AI를 부르지 않고 … 조립합니다." **거짓.** `EpisodeScriptsService`도 provider·budget 주입, `callOpenAiStoryApi` + `preflight(STORY_ESTIMATED_COST_USD)`. $0.05 유료.
  - **🔴 문구·주석·테스트가 셋 다 같은 낡은 사실을 붙들고 있었음**: 두 화면 모두 근거 주석("constructed with only a projects root … cannot reach a provider")이 같이 낡았고, 테스트가 `toContain("비용이 들지 않습니다")`로 **그 거짓말을 고정**하고 있었음. 그래서 기능이 틀린 채 초록이었고 아무도 못 잡았음 — D-021·D-017과 같은 계열(테스트의 존재가 안전 신호가 되지 못함).
  - 수정: 문구를 사실대로, **금액은 공유 상수에서 읽음**(리터럴 금지 — 요율이 바뀌면 또 뒤처짐). 테스트 단언도 청구 문구 + 상수 기반 금액 + **옛 문장 부재**를 함께 검사.
  - **"무료"라고 말하는 화면 13곳 전수 감사**(모듈 주입과 대조): 거짓 2건(위), 참 10건. provider를 든 서비스 = `LongProjectsService`/`EpisodeScriptsService`/`EpisodeImagesService`/`EpisodeVideosService`/`EpisodeNarrationService`.
  - **Round 221은 Cowork이 전면 철회**(`LongProjectsService` 배선 누락 보고 → 마운트의 낡은 사본을 읽은 것. 실제 배선 정상). CLI는 그 기준으로 아무것도 고치지 않았음.
  - **🟠 Round 220의 회귀 테스트가 유실됨**: 대본 화면의 `planned` 상태 안내(`episode-script-needs-outline`)는 화면에 들어왔으나, 보고된 회귀 테스트가 작업 트리에 없음(테스트 헬퍼의 status 유니온에 `"planned"` 미추가, 신규 `it` 블록 없음). **새 안내 분기가 무테스트 상태** — Cowork에 반환.
  - 검증: root typecheck 전부 통과, frontend 956개 전부 통과, Backend 941개 전부 통과, root build 전부 통과.
  - **다음 항목으로 이월**: Cowork 요청 — "provider를 든 서비스의 화면이 무료라고 말하는 것"은 프런트에서 표현할 수 없으므로 백엔드 가드 필요. 설계는 CLI.
- [x] **장기 프로젝트 경로 계산 13곳 → 1곳 통합(Round 203)**: 에셋 모델 재설계(단기 `mappings` 재사용)의 1단계 — 동작을 바꾸지 않고 복사본만 없애서, 이후 단계가 건드릴 코드를 줄이고 기존 테스트가 그대로 안전망이 되게 함. 사용자 지시: "안정적이고 코드는 효율적으로."
  - `long-project-paths.ts` 신규 — `longStoryRoot(projectsRoot, projectId)` / `episodeDirectoryName(n)`. `projectsRoot`를 인자로 받아 `.archive` 아래 동일 레이아웃도 같은 함수가 처리(두 번째 함수를 만들면 그게 이 함수와 갈라질 자유가 생김).
  - **🔴 13개 복사본이 서로 달랐다** — D-021(다섯 복사본이 *똑같이* 틀림)의 반대 모양이라 더 나쁨: 하나를 읽어도 나머지에 대해 아무것도 알 수 없었음.
    ```
    사전 검사   isSafeProjectId 를 하는 곳과 안 하는 곳이 섞여 있었음
                → 같은 입력에 longUnsafeId() vs unsafeProjectId() 로 갈렸음
                  (다만 code=UNSAFE_PROJECT_ID, status=400 이 동일해 API 계약은 불변 — 확인함)
    봉쇄 검사   episode-continuity-reference 한 곳만 path.resolve + relative 검사, 나머지 12곳은 path.join
    회차 번호   호출부마다 각자 검증, 두 곳은 경로를 만든 뒤에 검증
    ```
  - **검증을 함수 안에 넣음**: `episodeDirectoryName`이 정수 검사를 자기가 하므로 **검증 안 된 번호로 디렉터리 이름을 만들 수 없다.** 다음 호출자에게 규칙을 알려줘야 하는 관례가 아니라 구조가 됨.
  - `episode-continuity-reference`의 봉쇄 검사는 **삭제**했다 — `Episode`+숫자에는 구분자가 들어갈 수 없어 발동 불가였고, **발동할 수 없는 검사는 다음 사람에게 "이 이름은 못 믿을 값"이라고 잘못 말한다**(D-019). 그 성질은 이름을 만드는 자리(`episodeDirectoryName` 테스트)에서 단언한다.
  - `longStoryRoot`가 같은 검사를 하므로 그 앞의 사전 검사 6곳도 제거. 남은 `isSafeProjectId`/`resolveSafeProjectDirectory` 사용처 4곳은 전부 정당함(readdir 필터, 신규 id 검증, `withProjectLock`의 프로젝트 디렉터리).
  - `episodeDirectory()`도 만들었다가 **삭제** — 13곳 중 단독으로 필요한 곳이 0이었음. 쓰이지 않는 export 는 다음 사람이 두 번 해석하게 만든다.
  - 신규 테스트 7건. 순 변경 **+37 / -41** (기능 추가 없이 줄어듦).
  - 검증: root typecheck 전부 통과, Backend 948개(+7 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
- [x] **매핑 흐름을 `StoredProject`에서 떼어냄 — `MappingOwner` 신설(Round 204)**: 에셋 모델 재설계 2단계. 매핑 서비스가 `StoredProject`를 받아 그 안을 뒤지고 있었는데, **실제로 묻는 건 네 가지뿐**이었음: 장면 수, 장면 목록, `script_revision`, 승인됐을 때 소유자가 할 일.
  - 26개 필드짜리 레코드에 묶여 있던 탓에 회차를 넘길 수 없었음 — 회차는 같은 네 가지를 **다른 필드 이름, 다른 파일 모양**으로 답한다(`scenes` vs `script.scenes`, `workflow_state` vs `state`). 질문을 "그 질문에 우연히 답할 수 있던 레코드"와 분리해야 회차가 들어올 수 있음.
  - `MappingOwner` — 네 가지만. **식별자·디렉터리·워크플로 상태는 일부러 뺐다**: 파일이 어디 있는지는 리포지토리 소관이고 승인이 무슨 뜻인지는 소유자 소관이라, 흐름 자신은 둘 다 쓸 일이 없음. **안 쓰는 필드는 틀려도 아무도 모르는 필드다**(D-021).
  - `markMappingApproved(mappingRevision)`를 소유자에게 둔 이유: 단기는 `WaitingForAssetMappingReview`에서만 전진해야 함(재승인이 허용되므로 **상태가 거절하는 쪽이어야 함** — 안 그러면 이미 지나간 단계로 프로젝트를 되돌림). 회차는 상태 집합이 아예 다르므로, 판단을 소유자에 두면 흐름이 두 상태 기계를 몰라도 됨.
  - `ShortProjectMappingOwners`가 읽기를 **여전히 매핑 리포지토리를 통해** 함 — 거기가 "프로젝트 없음"을 매핑 흐름의 not-found 에러로 바꾸는 자리라, 읽는 곳을 옮기면 없는 프로젝트가 내는 에러가 조용히 바뀜.
  - `scenes`를 `readonly unknown[]`으로 둔 이유: 이 흐름은 길이·각 항목의 `number`·해시만 쓴다. 더 좁게 타입을 박으면 장면 레코드가 실제로 다른 두 소유자가 같은 경로를 못 쓰게 되는데, 얻는 게 없음.
  - 서비스 생성자의 세 번째 인자가 선택 → 필수로 바뀜(`projects?` → `owners`). "프로젝트 저장소 없음"은 이제 `new ShortProjectMappingOwners(repository)`로 표현됨 — 동작 동일.
  - 신규 테스트 5건(네 값 전달, 없는 프로젝트 에러, 전진, **되돌아가지 않음**, 저장소 없을 때 무동작).
  - 검증: root typecheck 전부 통과, Backend 953개(+5 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
- [x] **매핑 저장소를 `projectId`가 아니라 `MappingLocation`으로 키잉(Round 205)**: 에셋 모델 재설계 3단계. 리포지토리가 `projectId`로 경로를 **자기가** 만들고 있었는데, 그러려면 레이아웃을 알아야 하고 회차 레이아웃을 아는 것이 바로 `mappings/`가 하면 안 되는 일이었음.
  - **🔴 순환 의존을 구조로 막았다**: 확인한 현재 방향은 `mappings/ → assets/, projects/`이고 `long-projects/`와는 서로 모름. 매핑에 회차 개념을 넣으면 4단계에서 `long-projects/ ↔ mappings/` 양방향이 됨. **레이아웃을 아는 쪽이 위치를 만들어 넣어주는** 방향으로 고정 — `mappings/`는 회차를 영영 모른다.
  - `MappingLocation` = `id` + `directory` + `ensureExists()`. **존재 확인을 위치에 둔 이유**: 단기는 `project.json`, 회차는 다른 모양의 다른 파일이라 스코프마다 다름. 디렉터리 존재만 보는 일반 검사로 바꿨다면 프로젝트 파일이 없거나 깨진 경우를 통과시켰을 텐데, 지금 그건 저장소 에러다.
  - **🔴 2단계에서 그은 경계를 정정했다**: `MappingOwner`에 "디렉터리는 일부러 뺐다 — 리포지토리 소관"이라고 적었는데 **틀렸다.** 리포지토리는 자기가 아는 레이아웃만 해석할 수 있고, 회차 레이아웃을 알게 하는 것이 바로 피해야 할 일이었음. 소유자가 `MappingLocation`을 **확장**하도록 바꿈 — 위치를 따로 두면 항상 같이 다녀야 하는 두 값이 생기고 그게 서로 어긋날 수 있음.
  - 소유자의 `ensureExists()`는 **즉시 반환**한다 — 프로젝트를 읽어서 만든 객체라 존재는 이미 증명됨. 다시 물으면 같은 파일을 다시 읽고 다시 파싱함. 반면 `projectLocation()`이 만든 위치는 지연 검사를 유지(외부 호출부는 소유자 사실이 필요 없음).
  - 타입 변경이 **컴파일러가 호출부 전체를 열거하게** 만들었다 — 서비스 15곳 + 외부 8곳. 테스트는 타입체크 제외라 런타임에야 드러났고(44건 실패 → 문자열을 넘기던 자리 34곳), 그것도 `location.directory`가 `undefined`가 되는 형태로 즉시 터졌음.
  - 신규 테스트 4건. **그중 하나는 소스 스캔 가드**: `ensureExists:`를 만드는 파일이 허용 목록 밖에 없는지 검사. 이 설계의 안전 근거가 "위치를 만드는 곳은 둘뿐이고 둘 다 검증한다"인데, 세 번째는 어디선가 객체 리터럴 하나로 조용히 생긴다 — 리뷰로는 안 잡힌다. (가드 경로를 `import.meta.url` 기준으로 잡음 — cwd 기준이면 workspace 실행과 루트 실행 중 한쪽에서만 동작해 조용히 감시를 멈춤.)
  - 검증: root typecheck 전부 통과, Backend 957개(+4 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과. (`local-video-workflow.runway.test.ts` 1건 기존 타이머 플레이키니스 — 단독 13개 통과, 무관.)
- [x] **회차가 단기 매핑 흐름의 소유자가 됨 — `EpisodeMappingOwners` 신설(Round 206)**: 에셋 모델 재설계 4단계 전반부. **"단기 mappings 재사용"이 실제로 성립하는 지점**이고, 회차가 공급하는 건 파일 위치와 네 사실이 어디 있는지뿐 — 흐름·저장·리뷰 규칙은 전부 단기 것 그대로다.
  - 서비스를 **스코프 키에 대해 제네릭**으로 열었다(`ProjectAssetMappingsService<Key = string>`). 단기는 기본값이라 기존 호출부가 한 글자도 안 바뀜. 회차는 `{ projectId, episodeNumber }` 두 값을 **두 값 그대로** 넘긴다 — 하나의 문자열로 합치면 반대편에 파서가 생기고 양쪽이 형식을 계속 합의해야 함.
  - 그 과정에서 서비스의 `projectId` 실사용이 **저장 시 id를 찍는 두 곳뿐**임이 드러나 `owner.id`로 바꿈. "조회 키가 곧 저장되는 식별자"라는 가정이 사라짐 — 회차는 그 둘이 다르다.
  - **회차의 `id`는 `"<projectId>/Episode01"`** — 롱 프로젝트 id만 쓰면 한 회차에서 다른 회차로 복사한 파일이 그대로 통과함. 단기의 같은 검사는 그걸 잡으므로 회차가 더 약할 이유가 없음. 이전 부담 없음(회차 매핑 파일이 전부 비어 있음).
  - `markMappingApproved`가 `waiting_for_asset_mapping_review`에서만 전진 — 단기와 같은 규칙, 같은 이유(재승인이 허용되므로 상태가 거절해야 함). **상태 집합이 아예 다르다는 게 이 판단을 흐름이 아니라 소유자에 둔 이유.**
  - 존재 판단을 **개요 목록**으로 함 — 회차 자기 파일은 롱 프로젝트가 이미 지운 번호로도 남아 있을 수 있고, 그 파일로 답하면 아무도 도달할 수 없는 것을 설명하게 됨.
  - 신규 테스트 9건(네 사실, 회차를 지목하는 id, `scene_count` 6 폴백, `ensureExists` 무동작, 전진, **되돌아가지 않음**, 개요에 없는 회차 거부, 잘못된 회차 번호, 경로 이탈 id).
  - **아직 배선은 안 함** — 라우트를 옮기는 것은 계약이 걸려 Cowork 프런트 작업을 유발하므로 우편함 합의 후.
  - 검증: root typecheck 전부 통과, Backend 966개(+9 신규) 전부 통과, frontend 956개 통과(`SceneEditScreen.test.tsx` 1건 신규 관찰된 플레이키 — 단독 8개 통과, 프런트 파일 미변경 상태에서 발생), root build 전부 통과.
- [x] **회차가 단기 매핑 흐름을 끝까지 도는지 통합 테스트로 증명(Round 207)**: **낡은 구현을 지우기 전에** 썼다 — "새 경로가 옛 경로가 하던 걸 다 하고, 옛 경로가 못 하던 것도 한다"가 삭제를 정당화하는 유일한 근거인데, 지우고 나서 단언하면 이미 늦다.
  - 실제로 도는 것 확인: 폴더 에셋 **수동 연결**(회차 구현엔 엔드포인트 자체가 없었음) → 리뷰 시작 → 승인 → **회차 상태가 `asset_mapping_approved`로 전진**.
  - 폴더에 `follow_latest`가 자동 선택됨 — 거부가 아니라 선택. **B-1(폴더 거부)이 재사용만으로 사라진다**는 증명이다.
  - 파일이 **회차 자기 디렉터리**에 쓰이고 `project_id`가 `"long-1/Episode01"`로 찍힘(형제 회차로 복사한 파일이 통과하지 않음).
  - **장면 단위 범위**(`{kind:"list", sceneNumbers:[2,4]}`)가 동작 — 회차 구현은 주석으로 못 한다고 자인하던 것. **B-3의 뿌리(에피소드 쪽 선택권 부재)가 여기서 풀린다.**
  - 장면 번호 상한이 **그 회차의 `scene_count`** 임을 확인(롱 프로젝트 것이 아님), 다른 script revision으로 시작한 리뷰는 거부됨.
  - 검증: root typecheck 전부 통과, Backend 971개(+5 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
- [x] **회차 매핑 라우트 배선 — 단기와 대칭인 7개(Round 208)**: Cowork Round 226이 계약 A를 확정("화면 재작성이 아니라 인자 주입 하나")한 뒤 착수. **Cowork 조사가 결정적이었다** — 단기 화면의 `projectId` 15회가 전부 API 호출 첫 인자였고 장면 수조차 프로젝트에서 안 가져와서, A의 비용이 예상보다 훨씬 작았음.
  - `API_ROUTES`에 회차 5개 빌더 추가, 단기 `projectAssetMapping*` 다섯 개와 1:1 대응. 라우트 7개(list/create/update/review/begin/approve/snapshot)가 **요청·응답 모양까지 단기와 동일** — 같은 서비스·같은 저장 형식·같은 공개 매퍼를 지나므로 다를 이유가 없음.
  - **타입 신규 0개.** `AssetMapping*` 계열을 그대로 씀. `LongEpisodeAssetMapping*` 11개는 철거 대상이나 **Cowork이 화면을 옮긴 뒤에** 지움(먼저 지우면 프런트가 컴파일 안 됨).
  - **🔴 명시적 DI 토큰(`EPISODE_ASSET_MAPPINGS`)을 씀** — `ProjectAssetMappingsService`가 이미 단기 바인딩으로 제공되고 있어서, 같은 클래스 토큰에 두 번째 바인딩을 걸면 **모듈 스코프로만 갈린다.** 그러면 나중에 이 컨트롤러를 다른 모듈로 옮기는 날 조용히 단기 바인딩으로 바뀌고 아무것도 실패하지 않음. 토큰이 어느 바인딩을 뜻하는지 이름으로 말함.
  - 신규 테스트 3건(앱 모듈 HTTP): 폴더 수동 연결 + 장면 범위 + 승인 후 회차 전진, **회차 자기 디렉터리에 기록**(`project_id: "long_http/Episode01"`), 없는 회차 거부. **바인딩이 시험 대상** — 단기 바인딩이었다면 한 단계 위 디렉터리를 해석하면서 나머지 단언은 전부 통과했을 것.
  - 검증: root typecheck 전부 통과, Backend 974개(+3 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
  - **낡은 `episode-asset-mappings` 는 아직 살아 있음** — 프런트가 옮겨간 뒤 철거.
- [x] **🔴 합치기가 한 번 실패하면 영구히 막히던 것 수정 — 단기·장기 양쪽(Round 209)**: Cowork Round 225가 장기에서 발견. 확인해 보니 **단기도 같은 막다른 길**이었고, 장기는 거기에 더해 **앱이 스스로 못 지킬 약속을 파일에 써 넣고** 있었음.
  - `failed`/`WorkflowState.Failed` 를 쓰는 곳이 **양쪽 다 정확히 한 곳** — 합치기 실패 경로뿐. 즉 그 상태는 "합치기가 끝나지 못했다"만 뜻하고, 끝나지 못했으면 **아무것도 게시되지 않았다.** 재시도 말고 할 게 없는 상태였는데 게이트가 그걸 거부했음.
  - **게이트가 `failed`도 받도록** 수정(양쪽). 승인된 클립은 디스크에 그대로 있고 화면도 "그대로 남아 있습니다"라고 말하는데, 정작 서버가 거절하고 있었음.
  - **🔴 복구 서비스가 거짓 약속을 저장하고 있었다**: `rendering` → `failed` 로 옮기면서 `"이전에 최종 영상을 합치다가 서버가 꺼져서 중간에 멈췄습니다. **다시 시도할 수 있습니다.**"` 를 회차에 기록. 그런데 `failed` 에서 나가는 길이 없었음. **우연히 틀린 문구가 아니라 코드가 생성하는 약속**이라 오늘 고친 다른 건들보다 나쁨. `nest --watch` 가 저장마다 재시작하므로 개발 중 자주 밟힘.
    - 복구 목표를 **`videos_approved`** 로 변경 — 단기의 `Rendering → VideosApproved` 와 일치. 서버가 꺼진 건 합치기의 *실패*가 아니라 *중단*이고, 그 사실은 경고 문구가 말한다. 실패로 기록하면 상태가 일어나지 않은 일을 주장함.
  - **화면 변경 불필요** 확인 — 장기 합치기 화면은 회차 상태로 버튼을 막지 않음(`confirmationOpen || pending` 뿐). 백엔드 게이트만 고치면 버튼이 실제로 동작함.
  - **🔴 테스트 둘이 막다른 길을 정상 동작으로 고정하고 있었다**:
    - 장기: 이름은 `"records a recoverable failed state"` 인데 단언은 재시도가 `LONG_EPISODE_MERGE_NOT_ALLOWED` 로 거부되는 것이었음 — **"recoverable" 이 이름에만 있었다.** 이제 재시도가 실제 사유로 실패하고, 도구가 복구되면 성공하는 것까지 단언.
    - 단기: 재시도를 시험하려고 **상태를 손으로 `VideosApproved` 로 되돌려 저장**하고 있었음. 사용자에게는 없는 수단이라, 막다른 길이 테스트에 우회로로 박혀 있던 셈. 그 줄을 지우고 `Failed` 에서 바로 재시도되는 것을 단언.
  - 검증(백엔드 단독): typecheck 0, Backend 973개 전부 통과, backend build 정상. (전체 실행의 `decision-doc-references` 1건은 Cowork의 미커밋 프런트 파일 3개가 `.claude-bridge` 를 참조해 나는 것으로, 이 커밋에 포함되지 않음 — 우편함으로 반환.)
- [x] **프런트 — 화면 하나가 두 소유자를 섬긴다(Round 210)**: Cowork Round 227~228. 계약 A의 프런트 절반. **화면 재작성이 아니라 어댑터 주입 하나였다.**
  - `MappingApi` 인터페이스 + `projectMappingApi(projectId)` / `episodeMappingApi(projectId, episodeNumber)` 팩토리. `MappingReviewScreen`의 `projectId` **15회 → 0회**. `onOpenImageGeneration?: (projectId) => void` → `() => void` — 인자로 소유자를 돌려주면 화면이 다시 소유자를 아는 셈이라서.
  - 어댑터에 `id` 문자열을 둔 이유가 코드에 적힘: 객체 정체성에 의존하면 인라인 생성 호출부가 매 렌더마다 재조회함. 호출부에 `useMemo` 규율을 요구하는 대신 안정 문자열로 끊음(`useEffect(..., [api.id])` 에서만 사용).
  - **옛 함수 7개를 래퍼로 남기지 않음** — 남기면 그게 다음 사람이 `projectId`를 다시 들고 들어오는 입구가 됨.
  - 신규 회귀 테스트: 같은 화면에 회차 어댑터를 물리면 **`/projects/`로 시작하는 요청이 하나도 없을 것**을 단언. 누가 다시 화면에 id를 쥐여주면 거기서 터짐.
  - **🔴 `create` 테스트가 원래 아예 없었음** — 하필 회차에서 도달 불가능했던 그 호출. 새로 추가하며 **`versionPolicy`를 안 보내는 것**을 단언: 서버가 폴더는 `follow_latest`, 낱장은 `pinned`로 정하고 폴더+pinned를 거부하는데, 화면이 같이 정하면 규칙이 두 벌이 되고 **그 두 벌이 어긋난 결과가 바로 "UI가 제시한 폴더를 저장이 거부"였음**(B-1).
  - **🔴 Cowork의 탐색 방식이 바뀜**: "`mappingsApi.test.ts`가 없다"고 보고했는데 실제로는 존재했고 지운 함수들을 시험하고 있었음. 원인은 **마운트가 부분 거울**인데 거기에 `ls`를 건 것 — Round 222의 "낡은 모듈 파일을 읽었다"와 같은 뿌리. 이후 파일 존재는 실제 디렉터리에 묻기로 바꿨고, **그 교훈이 곧바로 값을 함**(새 테스트의 `{mode:"all"}` vs `{kind:"all"}` 오타를 하네스가 잡음 — 이번엔 그 파일을 하네스에 넣었기 때문).
  - 소스 주석 3곳의 `.claude-bridge` 참조 제거(도달 불가 링크, Round 182 검사기가 잡음). **링크만 걷어내고 이유는 문장이 스스로 서게 다시 씀.**
  - 검증: root typecheck 전부 통과, frontend 960개(+4 신규) 전부 통과, Backend 973개 전부 통과, root build 전부 통과. (`local-video-workflow.runway.test.ts` 기존 타이머 플레이키 3회째 관찰 — 단독 13개 통과.)
- [x] **🔴 회차 이미지 생성을 새 매핑 흐름에 연결 — 라우트만 열고 데이터 경로를 안 이었던 것 수정(Round 211)**: 라우트 배선(Round 208) 뒤 철거를 준비하다 발견. **내가 만든 공백**이다 — 새 흐름과 낡은 흐름이 **같은 파일 이름에 다른 형식**을 쓰는데, 이미지 생성은 아직 낡은 형식을 읽고 있었음.
  - **🔴 지문 계산이 서로 달랐다**: 회차 파이프라인은 `withoutNarration`으로 내레이션을 뺀 뒤 해시(내레이션을 고쳐도 매핑 리뷰가 무효화되지 않게 — 올바른 규칙), 단기는 안 뺌. **새 흐름으로 승인해도 이미지 생성 게이트가 영영 막혔을 것.** 참고 이미지가 안 가는 정도가 아니라 생성 자체가 거부됨.
    - `MappingOwner.scenes`가 내레이션을 **뺀 장면**을 답하게 함 — 소유자가 자기 장면이 무엇인지 정한다. 두 함수가 우연히 일치해서가 아니라 **구조적으로** 같아짐. 그 등가성을 테스트로 고정(내레이션을 바꿔도 지문이 같음).
    - 참고로 `withoutNarration`은 회차 쪽 **두 파일에 복사본**으로 있었다 — 새 흐름은 그 존재를 몰랐고, 그래서 어긋났다.
  - **🔴 상태 전이 한 단계가 빠져 있었다**: 낡은 `begin()`이 `script_approved` → `waiting_for_asset_mapping_review` 전이를 했는데 새 흐름엔 그게 없었음. 결과: 승인된 리뷰가 `script_approved`에 머문 회차 위에 앉고, 이미지 게이트는 준비 안 됨으로 읽음 — **매핑은 끝난 것처럼 보이는데 생성은 거부**되고, 두 사실이 다른 파일에 있어 잇는 게 없음.
    - `MappingOwner.markMappingReviewBegun()` 신설(`markMappingApproved`와 대칭). 단기는 무동작(직전 단계가 이미 그 상태로 놓음), 회차는 전이하고 **대본 미승인이면 거부**.
  - `collectEpisodeReferenceImages`(회차 재구현) 대신 단기 `collectReferenceImages` 사용. 회차가 **장면 단위 참고 이미지 범위와 스냅샷 지원**을 공짜로 얻음 — 회차판은 에피소드 단위뿐이었고 스냅샷 개념이 없었음.
  - **`episode-images.openai.test.ts`의 시드를 새 흐름으로 교체** — 이제 그 테스트가 통합 증명이다. 리뷰를 쓰는 쪽과 게이트가 검사하는 쪽이 어긋나면 여섯 케이스 전부 게이트에서 실패한다(예전엔 기능이 도달 불가인 채로 통과했음).
  - 신규 테스트 5건(내레이션 제외, 지문 등가성, 전이, 재시작 무해, 대본 미승인 거부).
  - 검증: root typecheck 전부 통과, Backend 979개 전부 통과, frontend 960개 전부 통과, root build 전부 통과.
- [x] **낡은 회차 매핑 구현 철거 — 에셋 모델 재설계 완료(Round 212)**: 새 경로가 옛 경로가 하던 걸 다 하고 못 하던 것도 한다는 걸 **먼저 증명한 뒤**(Round 207 통합 테스트, Round 211 데이터 경로 연결) 지움.
  - 삭제: `episode-asset-mappings.service.ts`(+테스트), `episode-asset-mappings.controller.ts`, `episode-image-reference-selection.ts`(+테스트), `LongEpisodeMappingReviewScreen.tsx`(+테스트).
  - shared에서 **타입 12개**(`LongEpisodeAssetMapping*` 계열 + `LongEpisodeAutomaticReferenceSummary` 계열) + **라우트 5개** 제거. 프런트의 죽은 API 함수·타입 가드·테스트 케이스도 함께.
  - **테스트 시드를 공용 픽스처로 모음**(`episode-mapping-test-fixtures.ts`): 6개 테스트 파일이 같은 3줄 시드를 반복하고 있었음. 파일을 직접 찍어 만드는 대신 **실제 흐름을 돌린다** — 리뷰를 만드는 쪽과 다음 단계가 검사하는 쪽이 어긋나면 여섯 파일이 전부 실패해서 알려줌. 직접 찍는 픽스처였으면 계속 초록이고 아무것도 증명 못 했을 것(D-017).
  - **중복 `withoutNarration`/`fingerprint` 사본 2개가 함께 사라짐** — 그 복사본들이 어긋난 것이 Round 211의 근본 원인이었음. 이제 그 규칙은 `MappingOwner.scenes` 한 곳에만 있음.
  - 결과: 회차 매핑이 단기와 **같은 흐름·같은 저장·같은 리뷰 규칙·같은 화면**을 씀. Round 224의 B-1(폴더 거부)·B-3(에피소드에서 매핑 생성 불가)이 별도 수정 없이 해소되고, B-2(적용 범위가 단수)는 장면 단위 `sceneScope`로 대체됨.
  - 검증: root typecheck 전부 통과, Backend 971개 전부 통과, frontend 953개 전부 통과, root build 전부 통과.
- [x] **회차 장면 이미지를 실제로 가져올 수 있게 — `/content` 라우트 신설(Round 213)**: Cowork Round 225의 BLOCKING 1번. **회차 이미지 컨트롤러에 바이트를 내주는 라우트가 아예 없었고**, 그래서 화면에 `<img>`가 0개였음 — 사용자가 **그림을 한 번도 못 본 채 승인하고 유료 재생성을 눌러 왔음.** 단기에는 처음부터 있던 라우트(`images.controller.ts:19`).
  - `GET /long-projects/:id/episodes/:n/images/:sceneNumber/content` — 단기와 같은 모양(스트리밍, `image/png`, `Content-Length`, `X-Content-Type-Options: nosniff`). shared에 `longEpisodeImageContent` 빌더 추가.
  - **상태 게이트를 일부러 두지 않음** — 존재하는 그림은 언제든 볼 수 있어야 함. 회차가 다음 단계로 갔다고 이미지를 안 보여주면 **검토 화면이 검토 대상을 못 보여주는** 상황이 되고, 그게 이 라우트가 없애려는 실패임.
  - 장면 번호는 **그 회차의 `scene_count`** 로 상한을 검사(파일 이름으로 아무거나 집지 않게), 생성 안 된 장면은 거부.
  - 신규 테스트 4건: 여섯 장면 모두 실제 파일을 가리킴, 회차 상태가 진행돼도 조회됨, 없는 장면 번호 거부, 생성 안 된 장면 거부.
  - **프런트 `<img>` 는 Cowork 몫** — 라우트 이름이 확정됐으니 우편함으로 요청.
  - 검증: root typecheck 전부 통과, Backend 974개(+4 신규) 전부 통과, frontend 953개 전부 통과, root build 전부 통과. (`local-video-workflow.runway.test.ts` 타이머 플레이키 4회째 관찰.)
- [x] **🔴 회차 영상 프롬프트를 편집하면 거부되던 것 수정(Round 214)**: Cowork Round 225의 BLOCKING. 화면의 프롬프트 칸이 **편집 가능한데**, 서버가 preview가 만든 텍스트와 **바이트 동일**을 요구해서 모든 편집이 `"입력 내용을 확인해 주세요."`로 거부됨 — 무엇이 잘못됐는지 말해주는 것도 없음. 단기 백엔드는 처음부터 임의 프롬프트를 받음(`local-video-submission.service.ts:95`, 모양만 검증).
  - **두 반쪽이 함께 움직여야 했다**: ① 동일성 검사를 제거하고 ② 기록이 **제출된 프롬프트**를 쓰게 함. ①만 하면 편집을 받아놓고 사용자가 방금 바꾼 그 텍스트로 생성하게 되는데, **아무도 그 사실을 말해주지 않으므로 거부보다 나쁨** — 영상이 조용히 요청한 것과 달라짐. `records`가 `preview.scenes`의 프롬프트를 복사하고 있었음.
  - **신선도 가드는 그대로 유지** — `confirmationId`는 장면에서 파생되므로 대본이 밑에서 바뀌면 여전히 걸림. 원래 그 검사가 지키려던 게 그것이고, 프롬프트 텍스트 동일성은 거기에 얹혀 있던 것.
  - **모양 검증을 새로 넣음**(비어있지 않음, `RUNWAY_PROMPT_MAX_LENGTH` 이하 — 단기와 같은 규칙). 회차 백엔드엔 **길이 검증이 아예 없었음**(서버 생성본만 받으니 필요가 없었던 것). 검사 없이 받기만 하면 **검증 안 된 필드가 유료 호출로 바로 들어감.**
  - 신규 테스트 3건: 편집한 프롬프트가 기록에 실제로 저장됨, 신선하지 않은 confirmation은 여전히 거부, 빈/공백/1001자 거부. **기존 테스트는 전부 통과했었다 — 즉 아무도 이 동작을 지키고 있지 않았다.**
  - 검증: root typecheck 전부 통과, Backend 978개(+3 신규) 전부 통과, frontend 953개 전부 통과, root build 전부 통과.
- [x] **프런트 — 장면 이미지가 화면에 뜬다 + 어휘 통일(Round 215)**: Cowork Round 229. `/content` 라우트(Round 213)의 프런트 절반.
  - `<img>` + 캐시 버스터(`review.updatedAt`) — 없으면 다시 만들기를 누른 사람이 **자기가 거부한 이미지를 보면서** 승인 여부를 정하게 됨. 상태 게이트 없음(CLI 요청대로), `waiting_for_video_confirmation`에서도 뜨는지 회귀 테스트로 고정.
  - 화면 비율을 `getLongProjectSettings`로 받아 박스 모양을 맞춤 — 16:9 회차를 세로 박스에 넣으면 **가로 그림의 세로 조각** 위에서 유료 결정이 내려짐(D-021 계열).
  - **어휘 통일**: `장소 → 배경`, `오브젝트 → 소품`. 서버는 이미 `usageRole: character|background|object|style` 한 가지 말을 쓰고 있었고 **어긋난 건 화면 라벨뿐**이라, 사용자가 "장소 탭인데 배경 폴더를 만들어야 한다"를 외우고 있었음. 두 라벨 표에 서로를 가리키는 주석을 달아 한쪽만 고치면 번역표가 다시 생긴다는 걸 남김.
  - **🔴 CLI가 고친 테스트 결함 — 새 기능이 사실상 무테스트였다**: 목이 `{ settings: { aspectRatio } }` 부분 객체만 줬는데 응답 검증기는 **완전한 `LongProjectSettings`**를 요구함. 그래서 요청이 조용히 실패하고 화면이 기본값(9:16) 폴백으로 떨어짐 — **세 신규 테스트가 전부 폴백 경로만 시험**하고 있었고, 16:9를 단언한 하나가 그 사실을 잡았음. `makeLongProjectSettings` 헬퍼로 교체(12곳). 더불어 설정 요청이 하나 늘어 호출 수·인덱스 단언도 정정(11곳).
    - 조용한 폴백은 Cowork이 **의도한 설계**(설정 요청이 실패해도 그림은 뜬다)이고 그 자체는 옳음. 다만 **그 폴백이 테스트에서도 조용해서** 정작 기능이 검증되지 않았음.
  - 검증: root typecheck 전부 통과, frontend 956개(+3 신규) 전부 통과, Backend 978개 전부 통과, root build 전부 통과.
- [x] **새로고침하면 진행 중인 유료 영상 작업으로 못 돌아가던 것 — 현재 작업 조회 라우트 신설(Round 216)**: Cowork Round 225의 BLOCKING. 진행·중지·재시도·검토 라우트가 **전부 `jobId`를 요구하는데 그걸 찾는 라우트가 없었음.** `jobId`는 시작한 브라우저 탭의 메모리에만 있었고, `preview`(유일하게 id를 돌려주는 곳)는 생성이 시작되면 거부함. **새로고침·탭 닫기·다음 날 열기 = 유료 작업이 돌고 있는데 보지도 멈추지도 못함.**
  - `GET /long-projects/:id/episodes/:n/videos/generations/current` → `{ jobId: string | null }`. 기록 파일이 이미 알고 있던 것을 답하는 자리만 만든 것.
  - **가장 최근 작업을 답한다**("돌고 있는 것"이 아니라) — 끝난 작업도 새로고침한 검토 화면이 보여줘야 할 대상이기 때문. 작업이 없으면 **에러가 아니라 `null`** — 없다는 건 질문에 대한 평범한 답이지 답하기 실패가 아님.
  - **🔴 앱을 띄워 검증한 이유**: 이 라우트가 `generations/:jobId`와 같은 경로 접두사에 놓임 — 라우터 입장에서 `current`는 job id다. **어느 쪽이 잡는지는 등록 순서가 정하고 두 핸들러 어디에도 안 보임.** 서비스만 테스트했으면 통과하면서 실제로는 "작업을 찾을 수 없음" 에러가 나갔을 것이고, 화면은 "아무것도 안 돌고 있음"을 실패로 표시했을 것.
  - 신규 테스트 3건: 전용 라우트로 도달(200 + `{jobId: null}`), 시작한 작업 id를 돌려주고 그 id가 기존 progress 라우트에서 실제로 동작, 생성이 끝난 뒤에도 계속 보고됨.
  - **프런트 절반은 Cowork 몫** — 화면이 마운트 때 이 라우트를 물어 복귀하면 됨.
  - 검증: root typecheck 전부 통과, Backend 981개(+3 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
- [x] **🔴 자리표시자 음성이 진짜 음성을 영영 막던 것 수정(Round 217)**: Cowork Round 225가 "키 없을 때 4바이트 가짜 MP3가 최종 영상에 무음으로 들어간다"로 보고. 파보니 **더 나쁜 게 있었음** — 그 파일이 나중에 진짜 음성이 만들어지는 것 자체를 막고 있었음.
  - 재사용 판정이 `validAudio(destination)`(= `size > 0`) 하나였음. 즉 **"파일이 있나"만 묻고 "맞는 파일인가"는 안 물음.** 그래서 두 가지가 조용히 틀림:
    ```
    ① 키 없이 한 번 돌림 → 4바이트 자리표시자 기록됨
       나중에 TTS 키 연결 → 전부 "이미 있음"으로 건너뜀
       → 내레이션이 영영 진짜가 될 수 없음. 에러 없음, 비용 없음, 화면은 계속 "음성 있음"
    ② 내레이션 텍스트를 고쳐도 옛 오디오가 남음
       → 생성을 눌러도 아무 일 없고, 영상은 계속 이전 대사를 말함
    ```
  - **기록은 처음부터 알고 있었음** — `adapter: "local-fake-tts-adapter" | "gpt-4o-mini-tts"` 와 `narration` 텍스트가 저장돼 있었는데 재사용 판정이 그걸 안 봤음. `stillGoodAudio()` 신설: 기록이 없거나 텍스트가 달라졌으면 재생성, 자리표시자인데 **이제 진짜를 만들 수 있으면** 재생성.
  - **자리표시자를 계속 쓰는 경우는 유지** — 키가 여전히 없으면 자리표시자가 이 앱이 낼 수 있는 최선이고, 다시 만들어도 달라지는 게 없음. 매번 전체 재생성이 되지 않도록 테스트로 고정.
  - 신규 테스트 3건. **기존 테스트는 전부 통과했었음** — 아무도 이 동작을 지키지 않았다는 뜻.
  - **남은 절반은 계약**: 자리표시자가 `hasAudio: true`로 보고되어 화면이 "음성 있음"이라 말함(D-006 계열). 화면이 구분할 수 있게 하려면 응답에 표시가 필요 — Cowork에 넘김.
  - 검증: root typecheck 전부 통과, Backend 984개(+3 신규) 전부 통과, frontend 956개 전부 통과, root build 전부 통과.
- [x] **프런트 — 새로고침해도 유료 작업으로 돌아온다 + 설정집이 거짓말을 멈춤(Round 218)**: Cowork Round 231. `7213a4e` 계약의 프런트 절반과, 설정집 문구 수정.
  - 마운트 시 `getLongEpisodeCurrentVideoJob` 으로 복귀. CLI가 건 계약 두 조건을 **테스트로 못 박음**: `{ jobId: null }` 일 때 `role="alert"` 가 없을 것(처음 들어온 사람에게 "아무것도 안 돌고 있음"이 빨갛게 뜨지 않게), 그리고 `current` 로 "생성 중"을 판단하지 않고 반드시 progress 를 물어 상태를 정할 것(`succeeded` 면 진행 화면이 아니라 검토 화면).
  - `current` 요청 실패는 조용히 포기(복귀는 덤이지 화면의 전제가 아님), **progress·review 실패는 그대로 표시**(그건 진짜 문제라서).
  - **설정집 문구**: "여기 적은 내용은 회차마다 등장인물의 생김새·성격이 흔들리지 않게 붙잡아 주는 역할을 합니다" 삭제 — `buildContext` 가 캐릭터·배경·소품을 넘기지 않으므로 거짓. 대신 **실제로 전달되는 것**(비밀·복선)과 이미지가 쓰이는 경로를 명시. 테스트를 문구가 아니라 **주장**에 걸어("생김새·성격이 흔들리지 않게"가 없을 것 + "비밀·복선"이 있을 것), 나중에 기능이 배선되면 그 테스트를 **의도적으로 같이 고치게** 됨 — 조용히 지워지지 않음.
  - **🔴 CLI가 고친 것 셋**:
    - **Cowork이 자기 Round 229 어휘 수정을 되돌렸음** — 낡은 사본 위에서 편집해 탭 단언이 `배경` → `장소` 로 복귀. **타입체크로는 못 잡는 부류**(둘 다 유효한 문자열). 낡은 사본 문제가 이번엔 *읽기*가 아니라 *편집*으로 나타나 **커밋된 작업을 조용히 되돌림.**
    - 기존 목 체인의 호출 수·인덱스 4+4곳(`current` 요청이 하나 늘어난 만큼) — Cowork이 미리 지목한 자리.
    - 신규 테스트가 렌더되지 않는 텍스트(`/장면 1/`)를 앵커로 잡고 있었음. 다른 테스트가 쓰는 testid 로 바꾸고, **`current` 가 실제로 응답한 뒤** 단언하도록 `waitFor` 추가 — 안 그러면 아직 안 온 요청에 대해 단언하게 됨.
  - 검증: root typecheck 전부 통과, frontend 960개(+4 신규) 전부 통과, Backend 984개 전부 통과, root build 전부 통과.
- [x] **🔴 유료 단계가 "무료"로 표시되는 것을 막는 가드 신설(Round 219)**: Cowork Round 223이 CLI에 넘긴 설계. 오늘 그 부류를 **두 번** 고쳤으므로(장기 개요 승인 $0.10, 회차 대본 초안 $0.05) 세 번째를 구조로 막음.
  - **화면은 스스로 확인할 수 없다** — 프런트에서 백엔드 생성자를 볼 방법이 없음. **이 테스트도 화면을 확인할 수 없다** — "무료"라고 말하는 화면 17곳 중 다수가 정당하므로 문자열만으로는 판정 불가.
  - **대신 깨지는 순간을 시끄럽게 만든다.** 두 사고를 만든 변경은 정확히 하나 — *서비스가 예산을 갖게 된 것* — 이고 그건 지금 아무 소리도 안 냄. 예산을 든 서비스 14개를 핀으로 박고, 목록이 바뀌면 실패하며 **실패 메시지가 아무도 안 물었던 질문을 던짐**: "이 단계를 제공하는 화면들이 아직 사실을 말하는가?"
  - **🔴 가드가 실제로 잡는지 오류 주입으로 증명함** — 그리고 **첫 시도가 안 잡혔다.** 정규식이 타입을 직접 이름으로 쓴 경우만 봤고 `import("...").OpenAiBudget` 형태를 그냥 통과시켰음. **자기가 생각해 본 철자만 아는 가드는 그 자체가 이 가드가 막으려는 것.** 선언 위치(`:` 뒤)로 좁히되 `import(...)` 접두를 허용하도록 고치고, **잡아야 하는 철자 4개와 잡으면 안 되는 4개**(임포트문, `OpenAiBudgetExceededError` catch 등)를 테스트에 박음.
    - 이 과정 자체가 오늘의 교훈 적용이다 — Cowork이 하네스에 오류를 주입해 "정말 보는지" 증명한 것과 같은 방법. **증명 안 했으면 조용히 아무것도 안 지키는 가드가 하나 더 생겼을 것.**
  - 검증: root typecheck 전부 통과, Backend 986개(+2 신규) 전부 통과, frontend 960개 전부 통과, root build 전부 통과.
- [x] **단기에도 같은 자리표시자 음성 버그가 있던 것 수정(Round 220)**: 회차 쪽을 고친 뒤(Round 217) **단기 대응물을 확인하니 정확히 같았음** — 오늘 반복된 패턴(한쪽을 고치면 다른 쪽에도 있음).
  - `local-narration-generation.service.ts:102`가 `existing === destination && validAudio(destination)` 만 봄. 즉 **"파일이 있나"만 묻고 "맞는 파일인가"는 안 물음.** 회차와 동일하게 ① 키를 나중에 연결해도 자리표시자가 영영 안 바뀜, ② 내레이션 텍스트를 고쳐도 옛 오디오가 남음.
  - 기록(`narration_generation_records`)이 `adapter`와 `narration`을 저장하고 있었는데 재사용 판정이 안 봄 — 회차와 같은 이유, 같은 수정. 다만 이 기록은 `unknown[]`으로 저장되므로 **알아볼 수 없는 것은 "좋지 않음"으로 취급해 재생성** — 그 방향으로 틀리면 호출 한 번이고, 반대로 틀리면 자리표시자가 영원히 남음.
  - 신규 테스트 3건. **여기서도 기존 테스트가 전부 통과했었음.**
  - 검증: root typecheck 전부 통과, Backend 989개(+3 신규) 전부 통과, frontend 960개 전부 통과, root build 전부 통과.
- [x] **음성 상태를 한 필드로 — `NarrationAudioState` 계약 + 병합까지 세 소비자 연결(Round 221, 백엔드 절반)**: Cowork Round 232가 답한 계약을 확정. `hasAudio: boolean` → `audio: "none" | "placeholder" | "generated"`.
  - **두 필드(`hasAudio` + `audioIsPlaceholder`)를 안 쓴 이유는 조합 하나 때문**: `{hasAudio: false, audioIsPlaceholder: true}` 가 타입상 표현 가능한데 의미가 없음. 그러면 모든 사용처가 "둘 다 봐야 한다"를 기억해야 하고, 한 곳에서 잊으면 **화면이 데이터가 뒷받침하지 않는 말을 함** — 오늘 네 번 고친 그 실패. union 은 그 상태를 표현 불가능하게 만듦.
  - **🔴 소비자가 화면만이 아니었다** — Cowork 지적. `episode-video-merge.service.ts` 가 `size > 0` 으로 판단해서, **화면이 정직해져도 자리표시자는 최종 영상에 그대로 들어감.** 병합도 같은 사실(기록의 adapter)을 읽게 함 — 파일 크기에서 다시 유도하지 않음. 무음이라 들리는 결과는 같지만, **앱이 그것을 자기가 만든 내레이션으로 제시하는 것이 멈춤.**
  - `audioDurationSeconds` 주석에서 자리표시자 얘기를 뺌 — "길이 없음"이 사실상 자리표시자 신호로 쓰이면서 ffprobe 실패와 구분이 안 됐음. **정확히 두 필드가 어긋나는 그 모양**이고, `audio` 가 생겼으니 길이는 길이만 뜻하면 됨.
  - 기록이 없는 파일은 `generated` 로 보고 — 이 서비스가 쓰지 않은 파일이라 자리표시자라고 부르면 **모르는 것에 대한 주장**이 됨.
  - 백엔드 테스트의 `hasAudio: true` 를 `audio: "placeholder"` 로 옮기면서 **가짜 모드가 자리표시자를 만든다는 사실 자체를 단언**하게 됨(이전에는 "오디오가 있다"까지만).
  - 신규 테스트 1건(병합이 자리표시자를 최종 영상에서 제외).
  - **프런트 4곳은 Cowork 몫** — 상태칩, 플레이어(자리표시자도 **반드시 렌더** — 들어봐서 무음인 걸 확인할 수 있어야 함), 다시 만들기 버튼, `data-audio` 테스트 훅.
  - 검증(백엔드 절반): backend typecheck 0, Backend 990개(+1 신규) 전부 통과, backend build 정상. 프런트는 Cowork 작업 전이라 미완.
- [x] **🔴 개요 승인이 두 번 과금되던 것 — 실제로 사용자 돈이 나간 건(Round 222)**: 원장에 남은 증거로 시작(`project_id=12`, `long_story_outline` $0.10 이 **23초 간격 두 번**). 원인을 코드로 확정함.
  ```
  198행  게이트: outline_status !== "planned" 이면 거부
  ~215행 유료 OpenAI 호출 (느림 — 개요 생성)
  235행  outline_status = "outline_ready" 기록
  ```
  **게이트와 기록이 유료 호출을 사이에 두고 떨어져 있음.** 첫 번째가 아직 안 쓴 23초 사이에 두 번째 클릭이 같은 게이트를 통과함. **느린 단계가 아무 신호도 안 주면 사람은 다시 누른다** — 그러니 거절하는 쪽이 앱이어야 함.
  - `withProjectLock` 으로 감쌈(`instagram-publish.service.ts` 가 같은 이유로 쓰는 것). **락이 두 번째 클릭을 거절하는 게 아니라 기다리게 함** — 그 사이 상태가 `outline_ready` 가 되므로 거절이 *타이밍*이 아니라 *상태*에서 나옴. "대체로 괜찮음"과 "옳음"의 차이.
  - `longProjectLocked()` 신설 — 기존 `longEpisodeLocked()`·단기 쌍둥이와 **같은 `PROJECT_LOCKED` 코드**를 공유해 프런트가 안전 문구를 하나만 갖게 함(D-010).
  - 신규 테스트 2건: `Promise.allSettled` 로 **동시에** 두 번 승인 → 하나만 성공하고 하나는 `LONG_OUTLINE_NOT_ALLOWED`, 그리고 시간이 지난 뒤 두 번째 승인도 거부.
  - **조사 결과 다른 장기 유료 경로도 확인함**: 이미지 생성은 호출 **전에** `generating_images` 를 기록해 창이 닫혀 있음(안전). 내레이션은 재사용 판정(Round 217/220)이 두 번째 호출을 막음. **대본 생성은 게이트가 재생성을 허용하는 설계라 락으로는 안 막힘** — 멱등 키가 필요한 다른 문제이고, 사용자가 아직 안 밟았으므로 기록만 남김.
  - 검증: root typecheck 전부 통과, Backend 992개(+2 신규) 전부 통과, frontend 960개 전부 통과, root build 전부 통과.
- [x] **프런트 — 자리표시자 음성이 화면에서 자기 이름을 얻음(Round 223)**: Cowork Round 233. 음성 계약(Round 221)의 프런트 절반, **장기·단기 양쪽**.
  - `data-audio={item.audio}`, `generated → "음성 있음"(success)`, `placeholder → "임시 음성"(progress 톤)`. **칩을 숨기지 않고 이름을 붙임** — 자리표시자일 때 아무것도 안 띄우면 "내레이션이 없는 회차 앞에 아무 표시 없이 서 있는" 상태가 되고, 그건 원래 증상의 다른 얼굴.
  - **`<audio>` 플레이어를 자리표시자에도 렌더** — 눌러서 무음인 걸 확인할 수 있어야 **칩이 하는 말이 검증 가능**해짐. 다시 만들기 버튼도 그대로(자리표시자가 오히려 주 대상).
  - CLI가 컴파일만 살리려 넣었던 임시 매핑(`entry.hasAudio ? "generated" : "none"`)을 걷어내고 픽스처가 상태를 **직접 이름**으로 쓰게 함(장기 5곳/단기 9곳). 프런트 전체 `hasAudio` 잔존 0.
  - **회귀 테스트가 주장 셋을 함께 검사**: `"임시 음성"이 있을 것` + **`"음성 있음"이 없을 것`** + `<audio>가 여전히 있을 것`. 두 번째가 핵심 — 칩이 그냥 아무 말도 안 하게 바뀌어도 "거짓 문구 부재"만으로는 통과함. **정직한 문구의 존재와 거짓 문구의 부재를 둘 다** 걸어야 "아무 사실도 안 고정하는 테스트"가 안 됨(Round 205 지적 적용).
  - **Cowork이 짝 파일(컴포넌트+테스트)을 함께 재스테이징함** — Round 231에서 한쪽만 받아 커밋된 어휘 수정을 되돌렸던 일의 재발 방지. 이번엔 첫 실행에 962개 전부 통과.
  - 검증: root typecheck 전부 통과, frontend 962개(+2 신규) 전부 통과, Backend 992개 전부 통과, root build 전부 통과.
- [x] **이어쓰기 화면이 저장 가능 여부를 미리 안다 — `canSave` 신설(Round 224, 백엔드 절반)**: Cowork Round 225의 DESIGN 항목. `get` 은 **어느 상태에서든 열리고** `save` 는 `waiting_for_video_confirmation` 이후만 허용 — 그래서 **다 적고 저장하면 409**.
  - **거절 자체는 옳다** — 이어쓰기 메모는 회차가 어떻게 끝났는지를 적는 것이라 영상 작업이 시작된 뒤에야 의미가 있음. 틀린 건 거절의 **시점**이고, 바꿀 수 있는 것도 그것뿐임. **다 쓴 뒤에 듣는 게 가장 나쁜 순간.**
  - `GetLongEpisodeContinuityResponse.canSave: boolean` — **저장 경로가 검사하는 바로 그 목록에서 계산**함. "어느 상태가 저장 가능한가"의 사본이 둘이 되면 화면이 자기 서버와 다시 어긋남(이 화면이 애초에 어긋난 이유).
  - 메모가 아직 없을 때(404 분기)도 같은 값을 보고 — 저장 가능 여부는 메모 존재와 무관한 사실.
  - 신규 테스트 3건: 타이핑 전에 `canSave: false`, 상태가 바뀌면 `true`, **보고와 실제 저장 결과가 같은 답을 내는지**(get→save 를 두 상태에서 짝지어 확인), 메모 없어도 보고됨.
  - **프런트 절반은 Cowork 몫** — 저장 불가일 때 입력을 막고 이유를 말하기. 응답이 늘어난 것뿐이라 지금도 화면은 깨지지 않음.
  - 검증: root typecheck 전부 통과, Backend 995개(+3 신규) 전부 통과, frontend 962개 전부 통과, root build 전부 통과.
- [x] **개요 승인 두 번째 클릭이 10초 기다린 뒤 거절되던 것 — 즉시 거절로(Round 225)**: Cowork Round 234 조사에 대한 답. 락을 건 뒤(Round 222) 남은 문제를 확인해 보니 **`withProjectLock` 기본값이 10초 대기**였음(50ms 간격 재시도). 개요 생성은 그보다 오래 걸리므로 두 번째 클릭은 **화면이 10초 멈춰 있다가 빨간 에러**를 봄.
  - **여기서 기다림은 순수한 손해** — 락 보유자가 끝나는 순간 개요가 존재하므로 이 호출은 어차피 무효가 됨. 기다려서 도달하는 결론이 처음부터 확정돼 있음. `{ timeoutMs: 0 }` 으로 한 번 시도하고 즉시 거절.
  - `withProjectLock` 의 옵션 주석이 *"테스트가 타임아웃 경로를 시험하려는 목적으로만 override"* 라고 적혀 있었음 — 이제 실제 호출부가 생겼으므로 **주석도 함께 고침**(D-019: 주석이 대는 근거도 확인한 것만).
  - **🔴 기존 동시 승인 테스트가 락 경로를 지나지 않고 있었음** — 가짜 모드에서 첫 승인이 너무 빨라 겹치지 않아 상태 거절만 났음. **즉 방금 바꾼 동작을 아무도 안 지키고 있었음.** 락을 실제로 잡고 승인을 부르는 테스트를 추가(즉시 거절 + 2초 미만 + 개요가 여전히 `planned`).
  - 그리고 기존 테스트의 단언이 과하게 구체적이었음(거절 코드를 하나로 고정) — **전체 실행에서는 실제로 겹쳐서 다른 코드가 남**. 어느 거절이 나오는지는 타이밍 문제이고 **둘 다 "유료 호출에 도달하지 않았다"를 뜻함**. 그것이 시험 대상이므로 둘 중 하나를 허용하도록 넓힘(기계 속도에 따라 통과/실패가 갈리지 않게).
  - **Cowork 조사 결과 기록**: 두 번째 클릭의 출처는 화면 가드(`approveBusy` ref)가 **컴포넌트 인스턴스 안에만 살아서** 언마운트→리마운트(Vite HMR·화면 이동·새로고침) 시 초기화되는 것으로 추정. 확정하려면 예산 기록 타임스탬프와 HMR 시각을 맞춰야 하는데 그 시각의 로그가 없음. **맞다면 개발 중에만 나는 것**이지만 락은 어느 쪽이든 필요함.
  - 검증: root typecheck 전부 통과, Backend 996개(+1 신규) 전부 통과, frontend 962개 전부 통과, root build 전부 통과.
- [x] **유료 호출 열 곳 전수 조사 — 여섯 곳에 이중 과금 창이 열려 있었다 (D-029)**: 개요 건을 고친 뒤 같은 모양을 전부 찾았다. 판정 기준은 "락이 있나"가 아니라 **"한 번이면 되는 일에 두 번 과금되나"** — 전자로 물었으면 필요 없는 넷에도 락을 달았을 것이다.
  - **이미 보호돼 있던 넷**(단기 스토리·단기 이미지·회차 이미지·영상)은 **호출 전에 진행 중 상태를 쓰는 방식**으로 창을 닫고 있었다. 알려진 해법이 있었고 나머지가 안 따라 한 것.
  - **새로 잠근 여섯**: 개요 승인(`47fca8c`), 회차 대본·회차 내레이션(`686a274`), 단기 내레이션 일괄·단기 내레이션 재생성·단기 이미지 재생성(`be9d55c`).
  - **🔴 내레이션 둘이 제일 나빴다** — 상태 기계 밖이라 쓸 상태가 없고, 장면별 재사용 검사는 동시 요청에 무력하다(같이 온 둘은 둘 다 1번 장면을 "없음"으로 읽는다). **장면 수만큼** 이중 과금.
  - **재생성은 장면별 키** — 다른 장면을 이어서 다시 만드는 건 정당하니 프로젝트 키면 거짓 거절이 된다. 테스트는 **거절과 통과를 짝으로** 건다(거절만 걸면 전부 거절하는 가드도 통과).
  - **🔴 락 자체를 먼저 고쳐야 했다(`de054d6`)**: `STALE_LOCK_MS = 60_000` 이 "보유자가 죽었나"가 아니라 **"작업이 60초를 넘었나"** 로 동작하고 있었다. 넘으면 락을 빼앗겨 이중 과금이 부활한다 — **느린 호출에서만**, 즉 사람이 다시 누르는 그 경우에만. 살아 있는 보유자가 파일을 갱신하게 하고, 소유권 토큰으로 남의 락을 지우지 않게 했다.
  - **원장으로 확정한 사실**: 두 과금(20:46:59.629 / 20:47:22.502)은 **서버 시간 기준으로 실제로 겹쳤다.** 기록은 호출이 끝난 순간이고 상태 쓰기는 그 몇 ms 뒤이므로, 두 번째가 게이트에서 `planned` 를 읽었다는 것은 첫 번째가 아직 돌고 있었다는 뜻이다. 따라서 **첫 호출은 22.9초보다 오래 걸렸고**, 두 번째 클릭의 원인은 HMR 리마운트 가설이 없어도 설명된다 — **23초 동안 아무 표시가 없었다.** 그 화면 표시는 Cowork가 붙였다(`723e024`).
  - 검증: root typecheck 0, Backend 1003개 전부 통과, frontend 966개 전부 통과, build 정상. 신규 테스트 6개는 **전부 락을 실제로 잡고**, **락을 우회시킨 서비스에서 빨간 것을 확인**했다.
- [x] **매핑 장면 선택기가 없는 장면을 제시하던 것 — 계약에 실제 장면 수를 실었다 (`426ee77`)**: `SCENE_NUMBERS = sceneNumbersFor(MAX_SCENE_COUNT)` 라서 4장면 프로젝트에도 5·6번이 떴고, **서버는 그걸 `INVALID_REQUEST` 로 거절한다**(`scopeFromRequest` 가 `owner.sceneCount` 로 검증). 앱이 자기가 안 받을 선택지를 내주고 있었다.
  - `GetProjectAssetMappingReviewResponse.sceneCount` 를 **필수로** 추가. 없으면 `undefined` 인데 화면 타입은 `number` — Cowork가 `canSave` 에서 짚은 그 부류가 된다. `review.reviewedScenes` 로는 못 구한다(비어 있게 시작하고, 검토자가 표시한 것이지 존재하는 장면이 아니다).
  - 필수로 둔 덕에 **타입체크가 고쳐야 할 프런트 목을 지목**했다 — 문자열 편집이었으면 아무도 안 알려줬다(D-025).
  - 테스트는 **보고한 수와 `create()` 가 받는 수를 같이** 건다. 아무도 강제하지 않는 수를 보고하는 건 또 다른 거짓말이고, 하드코딩 6은 둘 다 못 만족한다(6을 돌려주게 해서 빨간 것 확인).
  - 🔴 **첫 테스트가 있을 수 없는 프로젝트를 만들었다** — 장면만 4개로 두고 설정은 6인 상태. 승인이 그 조합을 거절하므로 의도한 것과 다른 이유로 빨갰다. 설정(`lore_context.scene_count`)까지 맞춰야 맞다.
  - 화면 쪽(가드 + 선택기 목록)은 Cowork 몫으로 넘김.
- [x] **`narrationApi` 안전 문구 표가 통째로 무테스트였다 (`1b58e82`)**: `PROJECT_LOCKED` 항목을 넣다가 드러났다. 이 표는 **백엔드 원문을 화면에서 막는 장치(D-010) 자체**인데, 항목이 지워져도 새 서버 코드가 항목 없이 도착해도 아무도 안 알려줬다.
  - 전체 코드를 돌며 **코드가 맞는지와 폴백이 아닌지를 같이** 건다. 코드만 보면 사용자가 일반 오류 문장을 읽는 동안에도 통과한다.
  - provider 카테고리는 **모르는 카테고리**도 걸었다 — 카테고리는 서버가 주는 값이라, 조회가 항상 맞는다고 가정하면 백엔드가 하나 추가하는 날 화면에 `undefined` 가 뜬다.
  - 증명: 표에서 항목을 빼면 `expected 'CLIENT_UNKNOWN_ERROR' to be 'PROJECT_LOCKED'`.
- [x] **가드 네 개가 "무엇을 지키는가"가 아니라 "어디서 실행됐는가"로 실패하고 있었다 (`80090bd`)**: `process.cwd()` 가 워크스페이스 디렉터리라고 가정해서, 저장소 루트에서 돌리면 **없는 파일을 찾다 실패**했다. 지키려던 소스에 대해 아무 말도 안 하는 실패이고, 진짜 위반도 똑같이 가린다.
  - 자기 위치 기준으로 바꿨다. 프런트 것은 **node 환경으로** 돌려야 했다 — jsdom 에서는 `import.meta.url` 이 `http://` 라 경로로 되돌릴 수 없다.
  - 넷 다 **금지된 문자열을 심어서** 빨간 것을 확인했다. 소스를 훑는 가드는 그 증명이 없으면 아무것도 안 지키는 것과 구별되지 않는다(D-024).
  - 자산 저장소 락의 60초 상수는 **그대로 두고 이유를 적었다** — 감싸는 게 전부 로컬 색인 작업이라 여기선 실제로 안전하다. `project-lock.ts` 에서 같은 상수가 조용히 상한이 됐던 것과 무엇이 다른지, 그리고 느린 작업을 `serialized()` 로 감싸면 그 전제가 깨진다는 것을 명시.
- [x] **🔴 `SceneEditScreen` — 화면이 뜨자마자 고치면 그 입력이 조용히 사라진다 (`1820b13` 에서 해결)**: 불안정 테스트(`sends only the fields that changed`, 전체 실행 3~4회에 1회 빨강)를 쫓다 나온 실제 결함.
  - 초안 초기화 이펙트가 `[selected]` 에 걸려 있는데, `selected` 는 **GET 완료 후 `null → 첫 장면` 으로도 바뀐다.** 그래서 최초 로드에서도 한 번 돈다. React 의 passive effect 는 커밋 뒤 비동기라, **화면이 보이는 순간과 초안이 지워지는 순간 사이에 창**이 있다.
  - 사람에게는: 편집 화면이 뜨자마자 빠르게 고치면 고친 게 사라지고 저장 버튼이 계속 비활성이며 **아무 에러도 안 뜬다.**
  - 고칠 방향은 이펙트가 "장면이 바뀜"과 "처음 정해짐"을 구분하는 것. **`waitFor` 를 늘려 초록으로 만들면 안 된다** — 초록은 되지만 사람이 겪는 결함은 그대로 남는다.
- [x] **전 과정을 HTTP 로 걷는 테스트 둘 — 장기(`f51a2a5`)·단기(`29118ae`)**: 서비스 테스트는 이미 이 순서를 걷는다(병합 테스트 setup 이 그것). 없던 건 **그 사이 층**이다. 모든 URL 을 `API_ROUTES` 로 만들고, 컨트롤러는 데코레이터에 경로를 손으로 쓰는데 **둘을 비교하는 게 아무 데도 없었다.** 전에 만든 배선 구멍(회차 이미지 생성이 아무도 안 쓰는 매핑 형식을 읽던 것)이 정확히 이 틈에 있었고 서비스 테스트는 그동안 전부 초록이었다.
  - 증명: 컨트롤러 경로를 한 글자 옮기면 **어느 경로인지 이름을 대며** 빨갛다.
  - 응답만이 아니라 **디스크의 상태**도 건다. 응답은 저장된 적 없는 값으로 조립될 수 있고, 둘이 어긋나는 것이 이 산책이 잡으려는 실패다.
  - 예산 원장 두 개가 **없다는 것**을 건다 — "자격증명 없음"이 첫 단계만이 아니라 끝까지 지켜졌다는 증거.
  - 🔴 **작업 상태와 화면이 볼 상태는 다른 시점에 도착한다**: `POST videos/generations` 는 실행을 띄우고 바로 반환하므로, 작업이 `succeeded` 여도 회차/프로젝트 상태는 아직 안 넘어와 있다. 승인이 409로 거절되는 것이 **전체 실행 부하에서만 4회에 1회** 났다. 다음 단계의 전제인 상태 쪽을 기다리게 고쳤고, 전체 실행 5회 연속 깨끗하다.
  - 🟠 **버그로 보고할 뻔한 것을 테스트가 두 번 막았다**: `review?.scriptRevision ?? 0` 을 보고 "첫 매핑 검토가 화면에서 시작조차 안 된다"고 확신했는데, 서버가 소유자 값을 돌려주고 있었다. 보고 대신 **그 불변식을 고정하는 테스트**로 바꿨다 — 화면이 보낼 수 있는 유일한 값이 그것이고, 그게 참이라 첫 검토가 되는 건데 아무도 적어두지 않았다.
- [x] **`SceneEditScreen` 결함 수리 + 🔴 그 수리를 지키는 것이 없던 문제 (`1820b13`)**: Cowork가 이펙트를 가드하지 않고 **없앴다**(초기화를 탭 클릭 핸들러로). 방향이 내 제안보다 낫다 — 가드는 틈만 좁히고 틈을 만든 모양은 남긴다.
  - **옛 결함을 다시 심었더니 회귀 테스트 10개가 전부 통과했다.** 부하에서만 나는 실패는 회귀 테스트가 될 수 없다(testing-library 가 이펙트를 먼저 flush 해서 그 틈을 닫는다).
  - 그래서 **모양을 거는 파일**을 따로 만들었다(`SceneEditScreen.draft-reset.test.ts`, node 환경). 이펙트를 되돌리면 이것만 빨갛다. **타이밍으로 못 잡는 결함은 모양으로 잡는다.**
- [x] **🔴 생성이 끝나는 순간 화면이 검토 대신 빨간 에러를 볼 수 있었다 (`e285b70`)**: 전 과정 HTTP 산책이 409로 터지면서 나왔다(부하에서 4회에 1회).
  - **"모든 장면이 끝났다"와 "다음 단계가 열렸다"는 쓰기 두 번 차이다** — 마지막 기록이 `succeeded` 로 저장되고, 그다음 소유자 상태가 검토로 넘어간다. 진행률은 **기록만 보고** 계산해서, 그 사이에 들어온 조회에 `succeeded` 라고 답했다.
  - **영상 화면 둘 다 정확히 그 단어로 검토를 연다.** 그리고 첫 동작이 검토 조회인데, 상태가 안 넘어갔으면 서버가 거절한다(`review()` 가 `videos_review|videos_approved` 를 요구). 즉 **사람이 생성이 끝난 그 순간에 결과 대신 에러를 본다.**
  - **단기가 더 나빴다** — 진행률 응답에 프로젝트가 아예 없어서 화면이 대신 읽을 것이 없었다. 그래서 화면을 고치는 게 아니라 **`succeeded` 가 말하는 조건 자체**를 고쳤다: 마무리 중은 `running` 으로 읽힌다(실제로 그렇다).
  - 양쪽 테스트는 상태를 되돌려 그 창을 재현하고, **옛 규칙에서 빨간 것을 확인**했다. 이 수리로 Cowork 화면은 손댈 필요가 없다.
- [x] **대본 생성 이중 과금 — 락으로 못 막는 나머지를 멱등키로 닫았다 (`04a5630`)**: 락은 **겹친** 두 번을 막는다. 첫 번째가 끝난 뒤 오는 두 번째는 못 막고, 대본은 **재생성이 정당한 반복**이라 상태 게이트도 안 막는다. 30초 동안 화면에 아무 표시가 없어서 다시 누른 사람이 두 번 낸다 — 개요가 당한 것과 같은 이야기.
  - `GenerateLongEpisodeScriptRequest.userRequestId` 를 **필수로** 추가. 같은 id가 다시 오면 첫 번째가 만든 것을 돌려준다. **회차에 저장**하므로 새로고침해도 유지된다(화면 안의 busy 플래그는 애초에 이걸 지키던 게 아니다 — 그게 지워지는 것이 개요 23초 이중과금의 경로였다).
  - **선택적으로 두지 않은 이유**: 없으면 "보호 없음"이 조용히 된다. 로그인 `flow` 기본값에서 값을 치른 그 모양(D-014).
  - 화면은 **의도가 생길 때 하나 만들어 성공할 때까지 유지**한다. 클릭마다 만들면 매번 다른 id라 아무것도 못 막는다 — 심어서 확인했고 신규 프런트 테스트만 빨갛다.
  - 🔴 **여기서 내가 틀린 보고를 한 번 했다(정정 기록)**: `LongEpisodeVideoWorkflowScreen` 이 클릭마다 id를 만드는 걸 보고 "영상도 이중 과금 노출, 6장면이면 $1.50"이라고 Cowork에 보냈다. **확인해 보니 아니다** — 영상 시작은 **상태 게이트가 막는다**(첫 시작이 회차를 `videos_generating` 으로 옮기므로 두 번째 시작은 id와 무관하게 `LONG_EPISODE_VIDEOS_NOT_ALLOWED`).
    - **두 보호는 다른 일을 한다**: 상태 게이트가 돈을 막고, 멱등키는 **재전송**(타임아웃난 클라이언트가 같은 요청을 다시 보냄)에 기존 job 을 돌려준다. 클릭마다 새 id면 그 재전송이 "현재 상태에서 허용되지 않음"이라는 **엉뚱한 에러**가 된다 — 돈 문제가 아니라 메시지 문제다.
    - **대본이 다른 이유가 여기서 분명해진다**: 대본은 생성 후에도 상태가 `script_review` 라 재생성이 계속 허용된다. 즉 **막는 상태가 없어서** 멱등키가 유일한 보호다. 영상은 상태가 막는다.
    - 두 사실을 **한 테스트에 같이** 박았다(`53660d1`) — 한쪽만 걸면 내가 준 것과 같은 잘못된 인상이 남는다.
  - 🔴 **테스트 파일은 typecheck 대상이 아니다** — 필수 필드 추가가 컴파일 오류가 아니라 **실행 실패 91개**로 나타났다. 계약을 바꿀 때 타입체크가 다 잡아준다고 믿으면 안 된다.
- [x] **테스트를 타입체크 안으로 들였다 — 그리고 조용히 썩고 있던 넷을 찾았다 (`2d410e3`, D-030)**: 백엔드·데스크톱만 `"exclude": ["src/**/*.test.ts"]` 였고 프런트·shared 는 아니었다. **같은 저장소에서 절반만 검사받고 있었다.**
  - 필수 필드 하나 추가가 프런트에서는 **컴파일 오류 2건**(어디를 고칠지 지목), 백엔드에서는 **실행 실패 91건**(빨간 벽)으로 나타났다.
  - 제외를 푸니 65개. 그중 넷은 잡음이 아니라 **테스트가 자기가 믿는 일을 안 하던 것**:
    - `collectReferenceImages` 를 **리팩터 전 6인자 형태로** 호출 — 문자열이 `sceneNumber` 자리에, 숫자가 `continuityImagePath` 자리에. 범위가 `all` 이라 런타임은 신경 안 썼다.
    - **유료 어댑터 4곳의 테스트 38군데가 `sleep` 을 주입** — 어댑터는 "Never retried"(유료·비멱등)이고 `sleep` 을 받지도 않는다. 읽는 사람에게 재시도를 제어한다는 인상만 준다.
    - `ProjectsController` 를 **의존성 하나 빠뜨리고** 생성(장면 편집이 `undefined`). 아무도 안 건드려서 아무 말이 없었다.
    - 자산 `update` 에 `enabled: false` — 받지 않는 필드라 무시. 테스트 이름은 "disabled" 인데 **미승인**을 시험하고 있었고, 이야기 설정집의 `!asset.enabled` 분기는 앱에서 도달 불가라는 것도 드러나 주석으로 남겼다.
    - `episodeDurationSeconds: 45` 가 거절된 이유는 "허용 안 되는 길이"가 아니라 **"모르는 필드"** — 이제 파생 필드라서. 파생 자체를 거는 테스트로 바꿨다.
  - 나머지는 목 타입이고, 그건 **비용이 아니라 목이 흉내내는 대상과 같은 모양인지 확인받는 것**이다(부분 목이 런타임 검증기에서만 걸려 조용한 폴백으로 새던 D-023 ④와 같은 뿌리).
  - 증명: 낡은 6인자 호출을 되돌리면 `Expected 5 arguments, but got 6` 으로 즉시 빨갛다.
- [x] **회차별 설정 쓰기 경로 (`f22b1b5`)**: 캡틴D 결정 — "장기 프로젝트 생성 때 정한 값이 기본값이고 회차마다 바꿀 수 있다. **화면 비율은 제외.**"
  - **읽는 쪽은 이미 다 돼 있었다** — 대본 프롬프트·영상 미리보기·병합 전부 회차 자기 스냅샷(`scene_count`, `duration_seconds`)을 읽는다. 없던 건 **그 스냅샷을 바꿀 방법**뿐이었다.
  - `GET/PUT /long-projects/:id/episodes/:n/settings`. `episodeDurationSeconds` 는 **파생이고 보내면 거부**(프로젝트 설정과 같은 규칙), 계산은 `episode-settings.ts` 한 곳에서만 한다.
  - **대본이 있으면 변경 거부**(`LONG_EPISODE_SETTINGS_NOT_ALLOWED`). 대본은 장면 수와 클립 길이를 **전제로** 쓰인다(둘 다 프롬프트에 들어간다) — 나중에 바꾸면 다른 값으로 쓰인 대본이 남는다. 다시 만드는 것이 그 방법이고 그건 사람이 고르는 유료 단계다.
  - 읽기가 **`changeable`** 를 같이 준다 — 화면이 저장 실패로 알게 되는 대신 미리 비활성화하고 이유를 말할 수 있게(이어쓰기 `canSave` 와 같은 방식).
  - **값이 든 테스트**: 바꾼 뒤 대본을 생성해서 **장면이 4개로 나오는지** 건다. 그게 없으면 "어딘가에 저장됐다"만 증명된다. 장면 수 쓰기를 빼서 빨간 것 확인.
  - 비율을 뺀 근거(Cowork 의견 채택): 세 화면이 각자 비율을 추측해 셋 다 틀렸던 전례, 그리고 연속성 참조 이미지가 회차를 넘나든다는 것.
- [x] **기존 타이머 불안정 테스트를 없앴다 (`780e910`)**: `keeps advancing on its own background timer` 이 고정 대기(폴 간격×2+3초) 뒤에 기록을 읽고 있었다. 바쁜 기계에서는 틱이 그 뒤에 도착해 **반쯤 진행된 상태**를 읽는다 — 단독 실행은 항상 통과, 전체 실행에서 몇 번에 한 번 빨강. **틱이 하는 일을 기다리게** 바꿨고(장면 1이 succeeded 가 될 때까지), 타이머를 아예 안 걸면 마감 시한에 걸려 빨간 것도 확인했다.
- [x] **🔴 단기 쌍둥이 — 이야기가 있는데 장면 수를 바꾸면 프로젝트가 막다른 길에 들어갔다 (`c316e05`)**: 회차 설정에 "대본이 있으면 변경 거부"를 넣고 나서 단기를 확인했더니 **게이트가 아예 없었다.**
  - **끝까지 돌려서 확인했다**: 설정 저장 `200` → 이야기는 6장면 그대로 → 매핑 검토가 **`Exactly 8 Story scenes are required before Asset Mapping review.`** 로 거절. **사용자가 타이핑한 적 없는 숫자**로, **다른 화면에서 한 변경** 때문에.
  - 이미지 생성·검토·내레이션·매핑 소유자가 모두 **설정의 장면 수**를 읽고, 이야기의 실제 장면은 `project.scenes` 에 있다. 둘이 어긋나는 순간 다음 단계가 전부 막힌다.
  - 저장 시점에 거절하면 **사용자가 방금 바꾼 필드를 보고 있는 동안** 원인을 말할 수 있다(`PROJECT_SCENE_COUNT_LOCKED`).
  - **장면 수만, 그리고 실제로 값이 바뀔 때만.** 이름·주제·메모는 이야기가 있어도 계속 편집된다. 클립 길이는 단기 이야기 프롬프트에 안 들어가므로 안 막는다 — **회차는 둘 다 프롬프트에 들어가서 둘 다 막는다.** 같은 규칙이 아니라 같은 이유에서 나온 다른 범위다.
- [x] **🔴 화면 비율을 나중에 바꾸면 이미 만든 이미지와 어긋난 채로 유료 영상이 나갔다 — 장기(`de24830`)·단기(`14aeed3`)**: 회차 설정 게이트를 넣고 나서 "그럼 프로젝트 설정은?" 을 물어서 나왔다.
  - **이미지·영상 요청·병합이 각자 실행 시점에 비율을 읽는다.** 이미지를 9:16으로 만든 뒤 16:9로 바꾸면 **세로 이미지를 주면서 가로 영상을 달라고** 하고, 병합이 그 결과를 새 모양으로 덧댄다. 전부 유료이고 서로 안 맞는다. **이 저장소가 이미 한 번 낸 사고**(`fix: a landscape project was generated, billed and merged portrait`)의 설정 저장판이다.
  - 장기는 **회차 하나라도 이미지가 있으면** 거절(어느 회차인지 이름을 댄다). 단기는 **`generated_images` 가 있으면** 거절.
  - **비교를 `project-aspect.ts` 의 단일 판독기로** 한다 — 거기가 `"16 : 9"` 와 `"16:9"` 를 같다고 정하는 곳이다. 요청 원문으로 비교하면 **똑같은 값을 다시 저장한 것이 변경으로 읽힌다**(그렇게 바꿔서 빨간 것 확인). 전에 이 파생의 사본 다섯이 **똑같이 틀려서** 아무도 못 잡았던 그 자리다.
  - **비율만.** 장면 수·클립 길이는 이제 새 회차의 기본값이라 나중에 바뀌는 게 정상이다 — 회차·단기·장기 세 곳에 같은 질문을 하고 **세 곳이 서로 다른 답**을 얻었다. 규칙을 복사하지 않고 근거를 따라간 결과다.
- [x] **단기 설정 화면이 서버 규칙을 베끼지 않게 신호를 줬다 (`f27d55e`)**: Cowork 요청. `GetProjectSettingsResponse` 에 **`sceneCountChangeable` 과 `aspectRatioChangeable` 둘**을 넣었다.
  - **하나짜리 `changeable` 이면 거짓이 된다** — 이미지는 있는데 이야기는 없는 상태가 있고, 그때 장면 수는 여전히 편집 가능하다. 회차 설정은 잠금이 하나라 플래그도 하나다. **모양은 다른 화면이 아니라 규칙을 따른다.**
  - 두 플래그를 **각자의 거절이 검사하는 바로 그 사실**에서 읽는다. 화면이 `scenes.length > 0` 를 직접 보면 서버 조건의 두 번째 사본이 되고, 그게 이어쓰기 화면이 자기 서버와 어긋났던 이유다.
  - `PROJECT_SCENE_COUNT_LOCKED` 에 **`details.sceneCount`** 를 실었다 — 서버 메시지는 화면에 못 가므로 "이미 6장면으로"를 쓰려면 숫자를 따로 줘야 한다.

## 2026-08-28 — 사용자가 직접 실제 사이클을 돌리기로 함

캡틴D가 "사이클은 내가 할게"라고 확정. **자동 검사로 잡을 수 있는 것과 돌려봐야 아는 것의 경계**가 여기다 — 결과물 품질(그림이 제대로 나오는지, 영상이 자연스러운지), 실제 게시, 사람이 겪는 흐름은 테스트가 답하지 못한다.

**돌리기 전 확인한 예산 여유** (`learning_data/*_budget_usage.json`, 2026-08 기준):

```
OpenAI   $1.30 / $10  → 남음 $8.70     장기 1회차 소요 ≈ $0.75 (개요 0.10 + 대본 0.05 + 이미지 6×0.10)
Runway   $2.00 / $10  → 남음 $8.00     장기 1회차 소요 ≈ $1.50 (영상 6×0.25)
```

둘 다 여유가 있어 **한도에 걸려 도중에 멈출 일은 없다.** 한도는 `DEFAULT_MONTHLY_LIMIT_USD = 10` 으로 양쪽 어댑터에 각각.

**🔴 사이클 도중 백엔드 소스를 고치면 안 된다.** `nest start --watch` 가 재시작하고, 그건 개요가 23초 간격으로 두 번 청구된 그 상황(D-005 / 프로세스 두 개가 겹치는 창)이다. 사이클 중에는 `docs/`·`.claude-bridge/` 만 건드린다.

**돌리고 나서 볼 것**: 원장에 타임스탬프까지 남으므로, 무엇이 몇 번 얼마에 나갔는지 사후에 정확히 확인할 수 있다 — 지난 이중 과금도 그것으로 확정했다.
- [x] **🔴 자격증명이 있어야만 도는 경로 전수 확인 — 회차 내레이션 하나가 비어 있었다 (`3449b2e`)**: 캡틴D가 실제 사이클을 곧 돌리므로, **지금까지 검증한 것이 전부 가짜 경로**라는 점에서 출발했다.
  - 예산을 쓰는 서비스 10곳 중 9곳은 자격증명을 붙인 테스트가 있었다(`providerSettings.save("openai"|"runway")`). **회차 내레이션만 없었다.**
  - 있던 유일한 "자격증명 있음" 테스트는 스텁으로 키만 주고 실제 호출은 **네트워크 가드에 막혀 에러**가 나는데, 테스트가 그 에러를 허용한다 — 재사용 판정을 시험하는 것이지 진짜 경로가 아니다.
  - **그래서 `audio: "generated"` 가 저장소 어디에서도 단언된 적이 없었다.** 두 boolean 을 대체한 3값 union 이 `none`·`placeholder` 두 값만 증명된 상태였다 — 도입 이유의 3분의 2.
  - 단기 쌍둥이(`narration-openai.test.ts`)는 처음부터 있었다. 회차만 없었다.
  - 새 테스트는 **처음 실행에 통과했다** — 경로 자체는 동작한다. 기록에서 진짜 어댑터를 빼서 두 테스트가 빨간 것을 확인(자리표시자로 읽히고 재사용이 깨진다).
- [x] **중간 실패 후 재시도가 이미 산 것을 다시 사는지 (`9b5c467`)**: 실제 사이클을 앞두고 **돈이 걸린 진짜 경로**를 이어서 확인했다.
  - 기존 실패 테스트는 **1번 장면에서** 실패해서 중간 진행이 없다 — 그래서 "4번에서 실패하면 1~3번을 다시 사나?" 를 아무도 안 물었다. 6장면 × $0.10 이라 틀리면 **그 단계 비용의 대부분**이 조용히 날아가고, 하필 사람이 에러 직후 누르는 재시도에서 그렇게 된다.
  - **통과했다** — 3장 남기고 3장만 산다. 재사용 검사를 빼면 호출이 3회에서 **6회**로 늘어 바로 빨갛다.
  - 단기는 이미 재개를 덮고 있지만 **디스크 실패**로 장부(reused/generated)만 검증하고 **유료 호출 횟수는 안 센다.** 같은 `continue` 에서 따라오는 사실이라 중복 테스트 대신 차이를 기록한다.
- [x] **🔴 작품 설정이 두 군데 저장돼 프롬프트에 두 번 갔다 (`5e55367`)**: 캡틴D가 설정집 화면 스크린샷을 보고 찾았고 Cowork가 넘겼다.
  - `create()` 가 설정 8개 필드를 설정집 `basic` 에 **복사**하는데 `updateSettings()` 는 `project.json` 만 쓴다. **이름을 한 번이라도 바꾸면 사본이 낡는다.** 두 프롬프트 경로 모두 설정집을 설정 옆에 실어 보내므로 **모델이 새 제목과 옛 제목을 같이 받는다.** 갓 만든 프로젝트에서는 두 값이 같아 안 보인다.
  - **고치기 전에 재현했다** — 이름을 바꾼 뒤 개요 프롬프트에 옛 제목 `A long story` 가 그대로 있었다.
  - **수리는 둘이고 서로를 안 덮는다**(변이로 확인): ① 새 프로젝트는 사본을 아예 안 만든다 ② 프롬프트 조립에서 **설정이 소유한 8개 키만** 빼는 함수 하나를 두 경로가 같이 쓴다.
  - **옛 데이터는 안 지운다.** `basic` 은 고급 편집 JSON 으로 접근 가능해서 사람이 손으로 적은 줄이 섞여 있을 수 있고, 그건 중복이 아니다. 겹치는 것만 빼면 모순이 사라지고 나머지는 남는다. **"어느 키가 중복인가"의 사본이 둘이 되는 것**이 이 문제를 만든 모양이라 함수는 하나다.
  - 🟠 그 과정에서 알게 된 것: **회차 개요 제목이 승인 시점의 작품 제목을 담는다**(`Episode 1: <제목>`). 이름을 바꿔도 소급되지 않는다 — 사람이 고칠 수 있는 회차 자기 데이터라 결함이 아니지만, 이름 변경 후 프롬프트에서 옛 제목이 보이는 두 번째 경로다.
- [x] **설정집 축소 + 전체 그림체 이동 (`f00f5d8`)**: 항목 폼이 이름 위에 ID·설명·상태를 더 물었는데, ID는 비우면 생성돼서 매번 생성됐고, 설명은 아무 데도 안 갔고, 상태는 읽는 곳이 없는 자유 텍스트였다. **더 나빴던 건 이름** — 자동 매칭이 이름으로 찾는데 여기서 두 번째 이름을 적으면 폴더의 진짜 이름이 몇 픽셀 옆에서 안 쓰인 채, 참조가 찾아지는지가 조용히 결정됐다. 이제 폴더에서 이름·설명을 가져오고 이름은 편집 가능하게 남는다.
  - 🔴 **내 테스트 수정 둘 — Round 241에서 내가 경고한 그것에 또 물렸다**: 설정 화면 테스트가 요청을 **위치로** 집고 `toHaveBeenCalledTimes` 로 "PATCH 안 갔다"를 세고 있었다. 화면이 에셋을 부르는 카드를 갖는 순간 둘 다 거짓이 된다. 경로와 메서드를 지목하게 고쳤다.
- [x] **🔴🔴 회차 수를 바꾸면 프로젝트가 영구히 안 열렸다 (`404f23e`)**: 설정집 사본 건을 고친 뒤 **"`updateSettings` 가 또 무엇을 안 따라가나"** 를 물어서 나왔다. 오늘 찾은 것 중 제일 심하다.
  - 모든 읽기가 **개요 목록 길이 == 회차 수**를 검사하는데, `updateSettings` 는 새 회차 수만 쓰고 목록은 그대로 뒀다. **저장이 이미 파일을 쓴 뒤에** `LONG_PROJECT_DATA_INVALID` 로 실패하고, **그 뒤 모든 읽기도 같은 오류**로 실패한다.
  - 즉 **설정 화면에서 숫자 하나 바꾸면 그 프로젝트를 앱 안에서 다시는 못 연다.** 되돌릴 방법도 앱 안에 없다(project.json 을 손으로 고쳐야 한다).
  - 늘리면 `planned` 회차를 덧붙인다(`create()` 와 같은 모양). 줄이면 뒤에서 잘라내되, **잘려나갈 회차가 작업된 적 있으면 거절**한다 — 대본·이미지는 디스크에 남으므로 개요만 지우면 **돈 낸 작업이 가리키는 것 없이 남는다.** 어느 회차가 걸리는지 이름을 댄다.
  - 양쪽 절반을 각자의 결함으로 확인: 동기화를 빼면 첫 테스트가, 축소 가드를 빼면 두 번째가 빨갛다.
- [x] **잠금 거절이 어느 회차 때문인지 화면이 말할 수 있게 함**: `404f23e` 가 만든 `LONG_PROJECT_EPISODE_COUNT_LOCKED` 는 회차 번호를 **영어 메시지에만** 담았다. 그 메시지는 백엔드 자기 말이라 화면에 안 나간다 — 즉 사용자는 "작업된 회차가 있어 줄일 수 없다"만 보고 **어느 회차인지는 못 본다.**
  - 단기 쪽 `PROJECT_SCENE_COUNT_LOCKED` 는 이미 `details` 로 숫자를 같이 보낸다(Round 249에서 같은 이유로 넣었다). 같은 모양으로 맞췄다.
  - **같은 자리에 있던 `LONG_PROJECT_ASPECT_RATIO_LOCKED` 도 같이** — 오늘 반복된 패턴대로, 한쪽에 있으면 다른 쪽에도 있었다. 둘 다 회차 번호를 부르면서 그걸 화면에 못 주고 있었다.
  - 기존 거절 테스트 두 건에 `details.episodeNumber` 단언을 더했다. **머테이션으로 확인** — `details` 를 빼면 정확히 그 둘이 빨갛다(처음 시도한 머테이션은 줄 번호가 밀려 아무것도 안 바꿨고, 그대로였으면 "통과"를 검사 통과로 착각할 뻔했다).
  - 검증: root typecheck 통과, Backend 1028개 전부 통과, root build 통과. 화면 절반은 Cowork 소관 — 우편함에 넘긴다.
- [x] **잠금 넷을 화면이 말한다 — Cowork 배치(Round 252) 검증·커밋**: 방금 넣은 `details.episodeNumber` 와 기존 `details.sceneCount` 를 화면 문구가 실제로 쓴다. 회차 수 거절 문구에는 **"늘리는 것은 언제든 됩니다"** 가 같이 붙었다 — 거절의 *범위*를 거절문이 직접 말하지 않으면 "바꿀 수 없습니다"만 읽은 사람이 늘리는 것까지 포기한다. 폴백은 같은 문장에서 숫자만 뺀 게 아니라 **회차를 아예 안 말하는 문장**이고("undefined회차"가 더 나쁘다), 테스트가 `undefined/{}/"3"/0/1.5` 다섯을 돌면서 폴백 문구가 나오는 것과 숫자가 안 나오는 것을 둘 다 건다.
  - 🔴 **내가 고친 것 둘 — 둘 다 "응답에 필드가 하나 늘면 그 응답을 흉내내는 목이 몇 개인가" 였다.**
    - **화면**: 저장 성공 핸들러가 상태를 통째로 갈아치우며 새 플래그 둘을 떨어뜨렸다. 타입 에러로 드러났지만 실제 결함이기도 하다 — **저장 직후 잠긴 칸이 다시 편집 가능해 보인다.** 저장은 그 플래그를 바꿀 수 없고(이야기·이미지 생성만 바꾼다) 응답도 안 실어 주므로 이전 값을 유지한다.
    - **테스트 목 7곳**: Cowork이 라우트 문자열로 grep 해 23곳을 고쳤는데, **정규식이 아닌 모양 7개**가 남아 있었다 — 손으로 쓴 `fetchMock` 넷(`ShortProjectSettingsScreen`), `{ settings: { ...settings, ... } }` 둘(`NarrationReviewScreen`), 그리고 **애초에 배치 목록에 없던 파일**(`ProjectDetail`). 실패 7건과 정확히 일대일이다.
  - ⚠️ **루트에서 vitest 를 돌려 30건이 빨간 것을 보고 잠깐 오진했다** — `document is not defined`. 루트 설정은 node 환경이라 화면 테스트가 애초에 못 돈다(`80090bd` 가 남긴 그 교훈). 프런트 워크스페이스로 다시 돌린 7건이 진짜다.
  - 검증: root typecheck 통과, frontend 1011개 전부 통과, root build 통과.
- [x] **영상 화면 `userRequestId` 가 하는 일이 생겼다 + 🔴 비밀 공개 시점이 화면에 없었다 (Cowork Round 253·254)**: 우편함에 두 라운드가 한꺼번에 올라와 같이 검증했다.
  - **`userRequestId` 는 보낼 때마다 새로 만들어지고 있었다** — 그러니 두 번째 누름이 **어떤 것과도 절대 일치할 수 없었다.** 값은 갔지만 하는 일이 없는, D-023 의 필드판. 이제 `VideoPromptPreviewScreen` 이 이미 쓰던 모양(확인창 열 때 만들고, 실패하면 유지, 성공·취소면 버림)을 따른다. **이중 과금을 막는 건 여전히 상태 게이트다**(D-030) — 이건 두 번째 누름이 엉뚱한 에러 대신 같은 요청으로 인식되게 하는 것이고, 그 구분을 주석에 적었다.
  - 🔴 **`reveal_available_episode` 를 입력할 칸이 화면에 한 번도 없었다.** 서버는 받고, 저장 스키마에 있고, `episode-context-builder` 가 그걸로 `revealable` / `forbidden` 을 가르는데 **화면만 안 물었다.** 없으면 `1` 로 읽으므로 **모든 비밀이 항상 공개 가능이고 `forbidden_information` 은 항상 빈 배열**이었다 — "3화에서 8화 비밀을 흘리지 마라"가 처음부터 아무것도 안 막고 있었다. **백엔드 테스트로는 못 잡는다**(빌더는 주는 값으로 정확히 동작한다). 계약판 D-023.
  - Round 249가 다섯 컬렉션 공통 폼에서 `설명` 칸을 지우며 **비밀·복선의 내용 입력까지 없앤 것**도 같이 복구됐다 — 그 둘은 적은 글이 실제로 프롬프트에 가는 유일한 컬렉션이다. 캡틴D가 화면을 보고 찾았다.
  - 🔴 **내가 고친 것 하나**: 새 테스트 2건이 탭을 `getByRole("button")` 으로 집었다. 이 화면 탭은 `role="tab"` 이고 **같은 파일 65행이 이미 그렇게 쓴다.** 선택자만 고쳤다.
  - 🟠 **옛 프로젝트의 비밀은 전부 1화로 남는다** — 마이그레이션할 값이 없고(사람만 아는 정보다), 기본값을 뒤집으면 쓸 수 있는 비밀이 하나도 없어진다. 그대로 두는 것이 맞다.
  - 검증: root typecheck 통과, frontend 1013개 전부 통과, root build 통과.
- [x] **설정집 저장 실패가 눌린 버튼 옆에서 보인다 (Cowork Round 255)**: 거절은 제대로 오고 있었는데 **화면 맨 위(393행)에 렌더되고 폼은 한참 아래(565행)** 라, 버튼을 보고 있던 사람에게는 **아무 일도 안 일어난 것**이었다. 그리고 아무 일도 안 일어나면 다음 행동은 다시 누르는 것이다. `submitError` 를 폼 안에 두고 버튼 바로 위에 띄운다. 테스트가 `within(form)` 으로 **위치까지** 건다 — 존재만 걸면 지금처럼 맨 위에 떠 있어도 통과한다.
  - 🔴 **커밋된 내 수정이 낡은 사본에 덮여 되돌아왔다 (D-024, 오늘 세 번째)**: `3863622` 에서 고친 탭 선택자 두 곳이 `role="tab"` → `role="button"` 으로 복귀해 같은 테스트 2건이 다시 빨갰다. **타입체크로는 안 잡히는 부류**(둘 다 유효한 문자열)라 vitest 를 안 돌렸으면 그대로 커밋됐다. 다시 적용했고, 그 커밋의 다른 변경은 안 잃었음을 diff 로 확인했다(신규 1건 추가뿐).
  - 검증: root typecheck 통과, frontend 1014개(+1 신규) 전부 통과, root build 통과.
- [x] **B-1 결론: 설정집의 Asset 링크를 없앤다 — 서버·계약 절반**: Cowork Round 255가 넘긴 결정 요청. 두 갈래(①폴더도 받게 고친다 ②연결을 없앤다) 중 **②**.
  - **근거가 Cowork이 든 것보다 강했다.** Cowork은 "설정집 링크는 두 번째 입구고 `bibleCandidates` 를 통해서만 쓰인다"고 적었는데, **`bibleCandidates` 는 저장소에 없는 이름이다.** `asset_link` 를 누가 읽는지 전수로 보니 **자기 서비스와 자기 테스트·타입 정의가 전부** — 이미지 생성도, 회차 매핑도, 프롬프트 조립도 안 읽는다. 두 번째 입구가 아니라 **아무 데로도 안 통하는 입구**였다. ①은 아무것도 안 하는 기능을 동작하게 고치는 일이 된다.
  - 화면은 폴더만 고를 수 있는데 서버는 폴더를 언제나 거절해서(`asset.is_folder`) **경로 자체가 도달 불가**이기도 했다 — 원래 B-1 의 교착. 그게 Round 209에서 "재사용으로 해소"로 적혀 닫힌 걸로 넘어갔는데, **재사용이 고친 것은 회차 참고 이미지 연결이고 설정집 자신의 경로가 아니었다.** 그 줄을 그렇게 적은 것은 CLI 쪽이다.
  - **읽기는 관대하게, 쓰기는 엄격하게** (`platform` 과 같은 모양): 디스크의 `asset_link` 는 읽고 버린다 — 거절하면 링크를 가졌던 모든 설정집이 안 열린다. 요청의 `assetLink` 는 **거절이 아니라 무시**한다: 화면이 그 fieldset 을 지울 때까지 계속 보내는데, 거절하면 항목 추가 자체가 막힌다. 화면이 정리되면 이 관용과 계약 타입을 같이 지운다(계약에 `@deprecated` 로 그 순서를 적어뒀다).
  - 지운 것: `validateAssetLink`(폴더·타입·승인·버전·범위 검사 전부), 그것만 쓰던 링크 파서와 `episodeCount` 헬퍼, `toApiItem` 의 링크 분기. **전역 그림체 링크(`styleAssetLink`)는 안 건드린다** — 그건 실제로 모든 회차 이미지에 붙는다.
  - 테스트: 링크 왕복 테스트 → **"들어올 때 무시하고, 디스크에 있던 것은 버린다"** 로 교체(두 절반을 한 테스트가 각각 단언). 거절 테스트는 삭제(검사가 없어졌다). 복제 테스트에서 링크 부분 제거. **머테이션 둘 다 확인** — 관용을 빼면(저장분) 빨갛고, 요청 무시를 빼면(입력분) 빨갛다.
  - ⚠️ 편집 중 `styleAssetLink` 메서드를 실수로 같이 잘랐다가 타입체크가 즉시 잡았다. 파일 중간을 인덱스로 잘라내는 편집의 위험 — 잘라낼 구간의 **양 끝을 먼저 눈으로 확인**해야 한다.
  - 검증: root typecheck 통과, Backend 1027개 전부 통과, frontend 1014개 전부 통과, shared 25개 전부 통과, root build 통과. **화면 절반은 Cowork 소관** — 우편함에 순서와 함께 넘겼다.
- [x] **설정집이 언제 읽히는지 말하고, 세계관은 빈 줄 하나로 시작한다 (Cowork Round 256)**: 캡틴D가 "기본 세계관 설정은 입력 자체가 안 돼"라고 **두 번** 말했는데 버튼은 멀쩡했다 — **누르기 전까지 적을 곳이 하나도 없어서 기능이 없는 것으로 읽힌 것**이다. 빈 줄 하나는 저장 때 어차피 버려지므로(`draftFromRows`) 공짜다. 그리고 화면이 *"작품 전체에 걸쳐 변하지 않는 설정"* 이라고만 하고 **언제까지 적어야 효과가 있는지**를 한 번도 말하지 않았다 — 8화 반전을 8화에 적으면 3·4·5화는 이미 그걸 모르고 쓰였다. 비밀의 `공개 가능 회차`(Round 254)가 그 기회를 만드는 필드라, 그 사실이 화면에 없으면 그 필드도 반쪽이다. 탭 순서도 설정집이 회차 나누기 앞으로 갔다(유료 단계가 그것이 읽는 것보다 앞에 있으면 사람은 순서를 거꾸로 밟는다).
  - 🔴 **내가 고친 것 셋**:
    - **접근성 이름이 겹쳤다**: 세계관 줄의 왼쪽 칸과 항목 이름 칸이 **둘 다 `aria-label="항목 이름"`** 이었다. 줄이 없을 땐 안 겹쳤는데 **빈 줄이 항상 생기면서 상시 충돌**한다 — 화면 읽기 프로그램에도, 질의에도 두 컨트롤이 한 이름이다. 보이는 라벨과 같게(`무엇에 대한 설명인지`) 맞췄다. 테스트 9건이 이걸로 빨갰다.
    - **낡아버린 단언**: "빈 줄이 살아남는다" 테스트가 `항목 추가` 후 줄이 **1개**라고 단언했는데 이제 시작부터 하나가 있어 2개다. 시작 상태와 추가 후 상태를 **둘 다** 걸도록 고쳤다 — 그게 이번 변경의 요지라서.
    - 🔴 **탭 선택자가 네 번째로 되돌아왔다 (D-024)**: `role="tab"` → `role="button"`. `3863622` 에서 고치고 `3f7f1c0` 에서 다시 고친 그 두 줄이다. **타입체크가 못 보는 부류**라 vitest 만이 잡는다.
  - 검증: root typecheck 통과, frontend 1016개 전부 통과, root build 통과.
- [x] **회차 제목이 언제 정해진 값인지 화면이 말한다 + D-번호 둘 (Cowork Round 259)**: `5e55367` 에서 알게 된 🟠 — 회차 개요 제목이 승인 시점의 작품 제목을 담아 이름을 바꿔도 소급되지 않는다. 소급 수정은 틀렸다는 판단(사람이 고칠 수 있는 회차 자기 데이터)이 남긴 결론은 **화면이 말해주는 것**뿐이었고, 이번에 그 힌트가 들어갔다. **"안 따라간다"만 말하면 사람이 할 일이 없어서** 나가는 길(여기서 고치면 된다)을 같이 말하고, 테스트가 그 두 조각을 다 건다.
  - `mappingsApi.ts`·`MappingReviewScreen.tsx` 에 D-026·D-028 참조를 붙였다. 나머지 D-번호는 의도적으로 안 붙였다 — **주석만 고치는 편집은 타입체크 밖(D-025)** 이고, 오늘 낡은 사본에서 문자열을 되돌린 사고가 이미 났다. 파일을 많이 열수록 그 위험만 커진다.
  - **`bibleCandidates` 의 정체가 밝혀졌다**: 실재하지 않는 이름이 아니라 **지워진 파일**(`episode-asset-mappings.service.ts`)에 있던 것으로, Cowork의 마운트 사본에만 남아 grep 에 걸렸다. **낡은 사본 문제가 "파일이 존재한다"는 거짓말로 나타난 형태** — 내용이 낡은 것(D-024)보다 나쁘다. 결정 자체(설정집 캐릭터·배경·소품은 지워도 잃는 것이 없다)는 CLI가 실제 저장소에서 확인한 것이라 그대로 유효하다.
  - 검증: root typecheck 통과, frontend 1017개(+1 신규) 전부 통과, root build 통과. **오늘 처음으로 배치가 첫 시도에 전부 초록이었다.**
- [x] **🔴 대본 프롬프트가 처음으로 주인공 이름을 받는다 — 대표 캐릭터 계약·저장·프롬프트**: 캡틴D 결정("생성할 때 대표 캐릭터 폴더를 고르고 그 이름으로 대본")의 백엔드 절반. **옮기는 게 아니라 새로 만드는 것이다** — 지금까지 어느 경로로도 캐릭터 이름이 진짜 대본 프롬프트에 간 적이 없다(`buildEpisodeContext` 의 `characters` 는 항상 비어 있고, 설정집 캐릭터 컬렉션은 프롬프트에 안 실린다). 그래서 대본에 인물 이름이 안 나왔다.
  - **자리는 `project_overview`, `characters` 가 아니다.** 그 배열은 회차별 후보 자리인데 대표 캐릭터는 작품 단위다. 빈 배열에 성격이 다른 값을 처음 넣으면 나중에 진짜 회차별 후보가 생길 때 둘이 섞인다.
  - **폴더만 받는다 — 설정집 항목 링크와 정확히 반대다.** 캐릭터는 한 사람의 각도 묶음이고 낱장은 포즈다. 이름은 폴더에서 오고, 자식별 설명이 이미지 프롬프트가 읽을 수 있는 유일한 것이다.
  - **이름은 저장 시점에 복사하지 않고 프롬프트 시점에 읽는다.** 복사본은 폴더 이름을 바꾸는 순간 낡는다 — 오늘 두 번 수리한 그 모양(`basic` 의 설정 사본, 회차 제목)이다. 링크가 못 읽는 것을 가리키면 **이름 없이 진행한다**: 라이브러리 파일 하나가 대본 생성을 막으면 안 된다.
  - 🟠 **찾은 김에 고친 것 — `style_asset_link` 가 프롬프트에 날 것으로 가고 있었다.** Asset ID 와 버전 정책은 대본 쓰는 모델에게 아무 뜻이 없는데 이야기 설정 한가운데 있었다. 링크 둘 다 배관이라 `storyBibleBasicForPrompt` 에서 같이 뺀다 — 안 뺐으면 이번 변경이 그런 걸 하나 더 늘렸을 것이다.
  - `updateContent` 가 `basic` 을 통째로 갈아치우므로 style 처럼 **보존**한다(안 하면 무관한 편집이 링크를 지운다).
  - **머테이션 셋 다 확인**: 이름을 빼면 / 배관을 다시 넣으면 / 폴더 요구를 빼면 각각 해당 테스트가 빨갛다.
  - 검증: root typecheck 통과, Backend 1031개(+4 신규) 전부 통과, frontend 1017개 전부 통과, shared 25개 전부 통과, root build 통과. **화면은 Cowork 소관** — `GlobalStyleAssetCard` 옆에 붙이면 된다.
