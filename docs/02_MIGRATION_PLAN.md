# Python to TypeScript Migration Plan

## 원칙

- Python을 줄 단위로 번역하지 않고 사용자 동작, 검증, 저장 데이터와 오류 처리를 TypeScript 구조에 맞게 이전한다.
- `prompts/`는 지금도 실행 중에 읽힌다(`prompts/story/story_generation.txt`) — 베이스라인 유물이 아니라 살아 있는 자산이다.
- `app/`, `tests/`는 **2026-09-02 캡틴D 요청으로 삭제**했다(이전 완료 후, `apps/` 어디도 참조하지 않음을 확인하고). 원본 동작을 다시 확인해야 하면 git 히스토리에 있다: `git log --diff-filter=D -- app`.
- 사용자에게 보이는 작은 기능 하나씩 Frontend와 Backend를 함께 구현하고 통합 검증 뒤에만 완료 처리한다.
- Preview는 유료 요청을 보내지 않으며 모든 Provider는 예산·승인·중복 방지 Gate 뒤에 둔다.


## 상태: 마이그레이션 완료 (2026-08-24), 현재는 기능 개선·다듬기 단계

Python → TypeScript 이전 자체는 끝났다 — 상위 15개 체크리스트(8절)와 44개 개별 기능 전부 구현·검증·커밋 완료. 이후 사용자가 실제 패키징된 앱을 써보고 "Python 원본보다 다운그레이드된 것 같다"고 지적해 UI/UX 격차 감사를 진행했고("2026-08-24 UI/UX 완성도 및 레거시 데이터 편입" 이하), 1~3순위(핵심 기능 막힘·UX 문제·폴리싱, 총 10개 항목) 전부 완료했다. 이어서 별도의 UI 스타일 리디자인(Phase 0~2, "2026-08-24 UI 셸 리디자인" 이하)으로 `apps/frontend/src/components/*.tsx` 26개 화면 전체와 App.tsx에 violet/gold 다크 테마 시각 언어를 일관 적용하는 것까지 완료했다 — 이건 3순위 폴리싱의 연장선이며 새로운 우선순위 항목은 아니다. 남은 4순위(패키징된 exe 실사용 테스트·DPI 확인·NSIS 설치 프로그램·실제 유료 Provider E2E)는 사용자가 먼저 직접 써보고 안정성을 확인한 뒤 순서대로 진행하기로 했다(패키징·배포는 사용자 승인 후).

**지금부터의 작업은 "Python 기능 이전"이 아니라 "이미 이전된 프로그램의 개선·다듬기"다.** AGENTS.md의 "Feature discipline"(예전 "Migration discipline")은 이 단계에도 그대로 적용된다 — 작업 하나씩, 완료 조건 먼저 정의, 검증 후에만 문서 갱신.

## 현재 상태 (2026-08-29)

```
Backend   1190 통과 (+1 의도적 skip)
Frontend  1142 통과
Shared    25 통과
root typecheck / build 통과
```

**실제 유료 사이클 1회차를 캡틴D가 직접 돌렸다**(`IBAD_memory_city`). 개요·대본까지 나왔고 주인공 이름이 대본 52개 필드에 들어간 것을 디스크에서 확인했다. 이미지·영상은 아직이다. 원장은 `apps/backend/learning_data/`(D-032 — 저장소 루트의 같은 이름 폴더는 파이썬 베이스라인이다).

진행 중인 3단계 합의:

```
1. ✅ 주인공 이름이 대본에 나오는지 확인          2026-08-29 완료
2. →  설정집에서 캐릭터·배경·소품 탭 + 연결 상태 점검 버튼 제거   (화면 담당)
3.    서버에서 관계 감사 엔드포인트·미사용 필드·assetLink 계약 제거  (2 뒤에)
```

아래 "인수인계 상태 (2026-08-23)" 절은 **그 시점의 기록**이다. 테스트 수와 "Runway 미연결" 같은 서술은 그날 기준이고 이후 날짜 섹션에서 갱신됐다 — 현재 사실은 이 절과 문서 끝의 최신 날짜 섹션에서 확인한다.

## 인수인계 상태 (2026-08-23 시점 기록)

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
- [x] **약속한 훑기: "계약에는 있는데 화면이 한 번도 안 보내는 필드" — 요청 방향은 깨끗했고, 대신 더 큰 것이 나왔다**: Round 254에서 비밀 공개 시점이 그 부류였으므로 다른 것도 있을 거라 적어두고 미뤄뒀던 작업.
  - **계약의 요청 필드 120개를 프런트 소스 전체와 대조했다 — 안 보내는 것은 없었다.** 유일한 후보(`imagePath`)는 정규식 오탐(응답 타입 `VideoScenePreview`)이었다. 방법 자체는 이미 아는 사고(`revealAvailableEpisode`)로 검증했다 — 그 필드는 수리 전이었다면 이 훑기에 걸린다.
  - 🔴 **그런데 계약이 아니라 서버 화이트리스트를 보니 다른 게 나왔다. `연결 상태 확인`(관계 일관성 감사)은 아무것도 못 찾는다.** 감사는 `location_id`·`owned_item_ids`·`character_ids`·`owner_id`·`location_ids` 가 가리키는 ID가 실재하는지 검사하는데, **그 필드를 채울 수 있는 경로가 앱에 없다.** 설정집 화면이 보내는 것은 `id/name/description/status/revealAvailableEpisode/assetLink` 뿐이다. 즉 **관계가 생길 수 없으므로 감사는 언제나 "이상 없음"** 이다 — 버튼이 있고, 로딩이 돌고, 초록 문구가 뜨는데, 그게 무엇도 증명하지 않는다.
  - **우리가 만든 회귀가 아니다.** 파이썬 원본에도 이 관계 필드를 채우는 UI가 없다(`app/ui` 전체에 언급 없음). `episode-context-builder.ts:37` 주석이 이미 같은 사실을 이웃 필드에 대해 적어두고 있었다 — 파이썬의 `Episode.character_ids` 도 아무 경로가 안 채운다. **처음부터 아무것도 못 하던 기능을 충실히 이식한 것**이다.
  - 같은 훑기에서 나온 작은 것: `truth`·`content`·`plannedRevealEpisode`·`actualRevealEpisode`·`alive`·`injured`·`referenceId`·`lastAppearance`·`emotionalState`·`episodeIds` 도 서버는 받지만 화면이 안 보낸다. 비밀·복선의 본문은 `description` 으로 가고 있어 `truth`/`content` 는 쓰이지 않는다.
  - **판단은 캡틴D 몫이라 아무것도 지우지 않았다** — B-1 과 같은 갈래다(①관계를 화면에서 만들 수 있게 하거나 ②감사를 없애거나). 다만 **지금 상태가 제일 나쁘다**: 아무것도 안 하는 초록 문구는 "확인했다"는 잘못된 안심을 준다. 우편함에 근거와 함께 넘겼다.
- [x] **"양쪽 끝은 멀쩡한데 중간이 없다"에 가드를 세웠다**: 이번 달 같은 모양의 사고가 넷이었다(`userRequestId`·`reveal_available_episode`·`style_asset_link`·관계 감사). **타입체크가 못 보는 부류다** — 아무도 안 보내는 선택 필드는 완벽하게 타입이 맞고, 서버 테스트는 "받는다"만 증명한다. 그래서 반대편에서 본다: 계약이 받는다는 요청 필드를, 이 앱이 한 번이라도 언급하는가.
  - **일부러 약한 증거를 쓴다.** "정말 보낸다"를 증명하려면 화면을 다 돌려야 하고, **아무도 통과시킬 수 없는 가드는 지워진다.** 반대로 *전혀 안 나타난다* 는 강한 증거고 그쪽만 잡는다. 실패 메시지가 묻는 것은 "어떻게 초록으로 만드나"가 아니라 **"배선했는가, 아니면 계약이 아무도 안 쓰는 필드를 들고 있는가"** 이다.
  - 🔴 **파서를 두 번 틀렸고 둘 다 내 눈이 아니라 단언이 잡았다**: ① 첫 `}` 에서 끊으니 인라인 객체(`episodeScope: { mode: "all" }`)를 가진 인터페이스가 반토막 나 48개만 읽었다 — **"50개 넘게 찾았나" 정합성 단언이 첫 실행에 바로 잡았다.** ② 줄머리 `}` 까지 읽게 고치니 이번엔 **한 줄짜리 인터페이스가 뒤따르는 타입을 통째로 삼켰다**(`imagePath` 가 `SaveProviderCredentialRequest` 의 필드로 보고됨). 중괄호를 세는 방식으로 바꿨다. **정합성 단언이 없었으면 절반만 보는 가드가 조용히 초록이었을 것이다** — Round 219에서 배운 그대로다.
  - **오류 주입으로 증명했다**: 블록형·한줄형 인터페이스에 각각 안 쓰이는 필드를 하나씩 넣으니 **둘 다 이름이 불린다.**
  - 검증: root typecheck 통과, frontend 1018개(+1 신규) 전부 통과, root build 통과.
- [x] **유료 대본 프롬프트에 제목만 있고 내용이 없는 칸이 셋 있었다**: Round 261에 적어둔 세 번째 축("뜻 없는 값이 유료 프롬프트에 실린다")의 후속. `style_asset_link` 는 **뜻 없는 값이 실린** 경우였고, 이번은 **아무 값도 안 실린** 경우다.
  - 템플릿의 각 섹션은 `[제목]` → 값 → *그 값을 어떻게 쓰라는 지시* 순서다. 값이 빈 문자열이면 **제목 아래가 비고 그 밑의 지시가 빈자리를 가리킨다** — 모델에게는 "없는 내용"이 아니라 **"빠진 내용"** 으로 읽힌다. 그리고 그대로 돈 내고 나간다.
  - **파이썬은 셋 다 문장으로 채우고 있었다**: `project_asset_metadata` → `"선택한 추가 Asset 없음"`, `previous_scene_context` → `"연결된 이전 이야기 없음"`, `additional_notes` → `"별도 지시 없음"`. TS 이식에서 이 폴백만 빠졌다. 나머지 세 metadata 변수는 이미 자기 "없음" 문장을 갖고 있어 대비가 분명했다.
  - `character_asset_metadata` 는 **템플릿에 자리가 없는 죽은 변수**여서 같이 지웠다(`prompts/` 전체에 해당 placeholder 없음).
  - **5번 섹션에 이쪽 선택기가 없다는 사실도 같이 적었다** — 파이썬이 "추가 Asset" 한 덩어리로 모으던 것을 TS는 대표/서브 캐릭터·전체 분위기·장면 참고 셋으로 나눠 각자 섹션을 준다. 그래서 5번은 오늘 언제나 그 문장이다.
  - 🔴 **테스트를 손으로 쓴 제목으로 걸었다가 틀린 제목으로 통과했다**: `[3. 전체 분위기 Reference Asset]` 이라 적었는데 실제는 `[3. 영상·장면 전체 분위기 Reference Asset]` 이다. 제목을 못 찾으면 빈 문자열이 나오고, 단언이 "비어 있지 않을 것"이라 **찾지 못한 것과 통과가 구분되지 않았다.** 템플릿에서 **`$변수` 한 줄로만 이뤄진 섹션을 직접 뽑도록** 바꿨고, 그러자 아무도 안 보던 `[9. 사용자 추가 지시사항]` 이 같이 걸려 셋째를 찾았다.
  - 머테이션 확인: 폴백을 다시 빈 문자열로 되돌리면 그 테스트가 빨갛다. 기존 통합 테스트 하나가 **빈 값을 고정하고 있어**(`previous=`) 같이 갱신했다 — 의도한 변경이라 단언에 이유를 적었다.
  - 검증: root typecheck 통과, Backend 1032개(+1 신규) 전부 통과, frontend 1018개 전부 통과, root build 통과.
- [x] **대표 캐릭터 화면 — 이제 대본에 주인공 이름이 나올 준비가 끝났다 (Cowork Round 264)**: `a04838c` 의 계약을 화면이 받았다. `ProtagonistAssetCard` 신설, 전체 그림체 **위**에 배치(사람은 주인공을 정하고 나서 그림체를 정하고, 둘 중 대본까지 가는 건 이쪽이다).
  - **폴더만 목록에 올린다 — 설정집 교착의 정확히 반대다.** 거기서는 고를 수 있는 게 폴더뿐인데 서버가 폴더를 거절했고, 여기서는 화면이 폴더만 주고 서버가 폴더만 받는다. 테스트가 배경 폴더와 낱장 캐릭터 그림을 같이 넣어두고 **폴더 하나만 남는 것**을 단언한다. `approved` 는 양쪽 다 안 본다(폴더는 `approved:false` 로 만들어지고 서버가 뒤집을 수단이 없다).
  - `pinnedVersion` 은 항상 `null` — **폴더는 자기 버전이 없고 버전은 자식이 갖는다.** 숫자를 넣으면 아무것도 안 가리키는 값을 저장하는 것이다.
  - 🔴 **"이름 적는 칸이 왜 없지?"에 화면이 답한다**: 이름을 저장 시점에 복사하지 않는다는 백엔드 결정이 화면 문구를 하나 만들어냈다 — *"폴더 이름이 곧 주인공 이름입니다 … 다음 대본부터 바로 반영됩니다."* **설계가 사용자 언어로 그대로 옮겨진 경우**고, 테스트가 그 세 조각을 다 건다.
  - 버전 정책 라벨을 폴더 언어로: `최신 버전 따라가기` → `새로 넣은 것까지 같이 쓰기`(앞엣것은 낱장 이미지의 말이다). 폴더가 하나도 없으면 드롭다운·저장 버튼을 아예 안 그린다(빈 드롭다운 옆 저장 버튼은 고장으로 읽힌다).
  - 검증: root typecheck 통과, frontend 1025개(+7 신규) 전부 통과, root build 통과. **첫 시도에 전부 초록** — Cowork이 미리 경고한 목 문제(`LongProjectSettingsScreen.test.tsx` 에 요청이 하나 더 늘었다)도 안 났다.
  - 다음: 캡틴D가 회차 하나를 돌려 이름이 실제로 대본에 나오는 것을 본 뒤에 설정집 캐릭터·배경·소품 탭을 지운다. **대체물이 도는 걸 확인하기 전에 지우지 않는다.**

## 2026-08-29 — 실제 사이클 1회차: 주인공 이름이 대본에 들어갔다

캡틴D가 `IBAD_memory_city` 로 회차 하나를 돌렸다. **`a04838c`+`748102b` 로 만든 경로가 끝에서 끝까지 동작한다.**

```
story_bible.json  basic.protagonist_asset_link.asset_id = FOLDER-A6A2645FE495
그 폴더            display_name "이배드", character, is_folder, 자식 5개
Episode01/script.json   "이배드" 가 52개 필드에 57번
                        장면 6개, 장면당 7~10개 필드
```

**제목에만 박힌 게 아니라 카메라·구도·연속성 힌트까지 퍼져 있다** — 모델이 그 값을 실제로 쓴다는 뜻이다. Round 265에 "테스트로는 프롬프트 본문에 들어가는 것까지만 증명했고 모델이 실제로 쓰는지는 돌려봐야 안다"고 적었는데 그 나머지 절반이 이걸로 확인됐다. 원장에 $0.15(개요 $0.10 + 대본 $0.05)가 찍혔고 이미지·영상은 아직이다.

- [x] **🔴 `learning_data` 가 두 군데인 것을 "정리"하지 않기로 했다 (D-032)**: Cowork이 결과 파일을 찾다 발견하고 두 가지 정리안을 냈는데 **둘 다 접었다.** 루트 쪽은 **git 에 추적되는 파이썬 베이스라인 데이터**(198개 파일, 원장 마지막 2026-08-02)이고 `apps/backend` 쪽은 **gitignore 된 현재 실행 데이터**(마지막 2026-08-28)다. 이름만 같고 다른 물건이라 "중복 제거"라는 전제 자체가 틀렸다 — ①은 TS 앱이 커밋된 베이스라인 폴더에 쓰게 만들고, ②는 `AGENTS.md` 가 금지한 베이스라인 삭제다.
  - **사람이 아니라 우리가 틀린다**: Cowork이 루트 사본을 열어 `script.json` 이 전부 `{}` 인 것을 보고 "대본이 안 나왔다"고 답할 뻔했다. 같은 시각 `apps/backend` 쪽에는 13KB 대본이 있었다. 구분법을 D-032에 적었다 — `git ls-files` 에 잡히면 파이썬 것, `.gitignore` 에 걸리면 지금 것.
  - 코드 주석 한 줄은 **사이클이 끝난 뒤에** 붙인다. 백엔드 소스를 고치면 `nest --watch` 가 재시작하고 그게 D-005 창이다.
- [x] **🔴 전체 스위트에서만 나던 간헐 실패를 잡았다 — 테스트가 자기가 단언하는 것 중 *앞엣것*만 기다리고 있었다**: 백그라운드 타이머 테스트가 **1번 장면이 `succeeded` 되는 것**을 기다린 뒤 곧바로 **2번 장면이 이미 `running`** 이라고 단언했다. 2번 제출은 1번의 쓰기 *뒤에* 일어나므로, 부하가 걸린 기계에서는 두 쓰기 **사이**를 읽고 2번이 아직 `created` 다. **단독 실행 8회는 전부 통과하고 전체 실행 5회 중 1회 실패**한 이유가 이것이다. 2번이 `running` 인 것은 1번이 끝났다는 뜻이므로 **뒤엣것을 기다리면 둘 다 덮인다.** 고친 뒤 전체 6회 연속 초록.
  - `780e910`("타이머 테스트는 틱이 하는 일을 기다리지, 걸리는 시간을 기다리지 않는다")이 이 파일에 이미 적용돼 있었는데, **두 사실 중 하나에만** 적용돼 있었다. 같은 교훈의 절반만 옮겨진 셈이다.
  - 🟠 같은 실행에서 `project-lock.test.ts` 도 한 번 같이 빨갰는데 이후 10회 넘게 재현되지 않았다. 같은 부하 스파이크의 동반 실패로 보이지만 **확정하지 않았다** — 재현하면 그때 고친다.
- [x] **영상 재시도가 이미 산 장면을 다시 사지 않는 것을 처음으로 검사한다**: 이 파일의 실패 테스트가 **전부 1번 장면에서** 실패해서, "4번에서 실패하면 1~3번을 다시 사나?"를 아무도 안 물었다. **장면당 $0.25 로 틀리면 제일 비싼 자리**고, 하필 사람이 에러 직후 누르는 버튼에서 그렇게 된다. 이미지 쪽(`9b5c467`)과 같은 이유로 같은 테스트를 영상에 넣었다 — 이쪽이 2.5배 비싸다.
  - **통과했다** — 재시도는 1건만 제출하고, 그것이 4번 장면의 프롬프트이며, 1~3번은 `succeeded` 로 남는다. 머테이션(`regenerate` 가 선택된 장면만이 아니라 전부를 리셋하도록)으로 이 테스트가 그 사실을 실제로 지키는 것을 확인했다.
  - 검증: Backend 1033개(+1 신규) 전부 통과, backend typecheck 통과.

## 2026-08-29 — 등장인물·설정집 화면과 관계 감사 제거 (3단계 합의 완료)

- [x] **화면 절반 (Cowork Round 268·269)**: 세계관·비밀·복선을 작품 기본 설정으로 옮기고(`StoryWorldCard`·`StorySecretsCard` 신설), 남은 캐릭터·배경·소품 탭과 함께 `LongStoryBibleScreen` 을 통째로 삭제했다. **프롬프트가 실제로 읽는 넷 중 셋이 안 읽는 셋 뒤의 4·5번째 탭에 숨어 있었다** — 순서가 정확히 뒤집혀 있었다.
  - 없어진 화면 이름을 부르던 문구 셋도 같이 고쳤다. 제일 나빴던 것은 연속성 화면의 힌트 — **그 칸의 번호를 읽어올 수 있는 유일한 장소가 방금 사라진 화면**이었다. 없는 화면을 가리키는 안내는 아무 말도 안 하는 것보다 나쁘다.
  - 🔴🔴 **내가 고친 것 둘 — 문구만 고친다던 편집이 낡은 사본 위에서 이뤄져 커밋된 로직을 지웠다**: ① 개요 화면이 **이미 승인된 개요에 승인 버튼을 다시 내주지 않는 가드**를 잃었다. 지워진 주석이 그 가드의 이유를 직접 적고 있었다 — *"한 프로젝트가 같은 개요로 두 번 청구됐다"*. ② 연속성 화면이 **서버가 답해 주는 `canSave` 선판정**을 통째로 잃었다(사람이 다 타이핑한 뒤에 거절하는 대신 미리 칸을 치우는 기능). 둘 다 `git checkout` 으로 되돌리고 **의도한 문구만 다시 얹었다.** D-024 가 이번엔 돈 막는 가드를 지웠다.
- [x] **서버 절반**: 관계 감사 엔드포인트·서비스·계약·프런트 호출을 전부 제거했다. `LongStoryBibleCollection` 은 이제 `secrets | foreshadowing` 둘이고, `LongStoryBibleItem` 은 `name/status/description/revealAvailableEpisode` 넷만 남는다. `assetLink` 계약과 그 임시 관용도 같이 걷었다(막고 있던 화면이 사라졌으므로).
  - **저장된 데이터는 지우지 않는다.** 옛 항목의 키(관계 4필드·`truth`·`content`·`alive` 등)는 읽고 버리고, **캐릭터·배경·소품 배열 자체는 `retired` 로 들고 있다가 저장할 때 그대로 되쓴다.** 이 서비스는 저장할 때마다 파일 전체를 다시 쓰므로, 안 들고 있으면 **다른 것을 한 번 고치는 순간 사람이 적어둔 항목이 조용히 빈 배열이 된다.**
  - 🔴 편집 중 `LongStoryBibleItem` 의 닫는 괄호를 같이 지웠는데 **타입체크가 즉시 잡았다** — 인덱스로 구간을 잘라내는 편집의 위험(오늘 두 번째).
  - 검증: root typecheck 통과, Backend 1030개·frontend 1020개·shared 25개 전부 통과, root build 통과. 저장소 전체에 `relationship-audit`·`LongStoryBibleAssetLink` 잔재 없음.
- [x] **세계관 저장이 `basic` 을 지나가지 않는다 — 요청에서 그 칸을 없앴다**: `PATCH .../story-bible/content` 가 `basic` 과 `world` 를 **둘 다 요구하고 둘 다 갈아치웠다.** `basic` 에는 지금 **주인공 링크와 전체 그림체 링크**가 들어 있어서, 세계관 노트만 저장하려는 호출자가 `basic` 을 되읽어 그대로 실어 보내야 했고 **한 번 빠뜨리면 그 프로젝트의 주인공이 지워진다.** 화면이 그 되읽기를 실제로 하고 있었다(Cowork이 Round 268에서 짚고 테스트까지 걸어둔 자리).
  - `UpdateLongStoryBibleWorldRequest { world }` 로 좁히고 라우트도 `/story-bible/world` 로 바꿨다 — **요청이 `basic` 을 말할 수단이 없으면 어떤 호출자도 그걸 틀릴 수 없다.** 서버의 보존 로직(`preservedStyle`/`preservedProtagonist`)과 `style_asset_link` 거절 분기도 같이 사라졌다: 애초에 도달할 수 없는 상태가 됐다.
  - 화면에서 저장 전 `getLongProjectStoryBible` 되읽기를 걷었다 — 요청이 2회에서 1회로 준다.
  - **`basic` 을 편집하던 화면이 이미 없어졌기 때문에 가능한 정리다.** 그 화면이 있을 때 이 좁히기를 했으면 고급 편집 JSON 이 못 저장했다.
  - 머테이션 확인: 여분 키 거절(`Object.keys(request).length !== 1`)을 빼면 서비스·컨트롤러 테스트가 각각 빨갛다.
  - 검증: root typecheck 통과, Backend 1030개·frontend 1020개·shared 25개 전부 통과, root build 통과.
- [x] **화면 문구·어휘 정리 배치 (Cowork Round 272·273·274) — 검증에서 42건이 빨갰고 원인이 셋이었다**: 캡틴D의 *"UI가 너무 길고 말이 너무 많아"* 에서 시작해 좌측 메뉴 아홉 화면을 훑은 배치.
  - **진짜 버그 하나**: 저장된 등장 캐릭터가 **raw id 로 표시**됐다(`FOLDER-C91BA4DC1ECB`). 이름을 검색·추가할 때만 채워서, 설정을 다시 열면 저장돼 있던 캐릭터가 전부 id 였다. 마운트 시 라이브러리에서 이름을 채우고, 못 찾으면 `지워진 폴더 · 제거해 주세요` 로 — **id 를 보여주면 사람은 앱이 고장 났다고 읽지 "이 줄을 지우면 된다"고 읽지 않는다.**
  - 저장 방식이 두 가지인데(위 폼은 버튼, 아래 셋은 즉시) 그 안내가 세 섹션을 **다 지나간 뒤** 있었다 → 섹션마다 `고치면 바로 저장` 태그. 남아 있던 영어(`Asset`·`credential`)를 `이미지`·`API 키` 로(D-028의 남은 자리). 홈 배너의 이관 메모 삭제 — **몇 달째 참이고 몇 달째 안 바뀌는 문장은 안내가 아니라 배경이다.**
  - 🔴🔴 **낡은 사본 되감김이 셋 (D-024, 오늘 다섯 번째)**: ① `LongProjectOutlineScreen` 이 **이중 과금 방지 가드를 또 잃었다** — 내가 오늘 한 번 복구한 바로 그 코드다. ② `ShortProjectSettingsScreen.test.tsx` 가 `cbc3f9c` 이전 사본으로 돌아가 **잠금 테스트 3건이 사라지고** 목이 플래그 둘을 잃어 29건이 빨갰다. ③ `MappingReviewScreen.test.tsx` 에서 **장면 수 관련 테스트 2건이 통째로 삭제**돼 7건이 빨갰다. 셋 다 커밋 상태로 되돌리고 **의도한 문구·신규 테스트만 다시 얹었다.**
  - 🟠 **축약이 사실을 지운 자리 셋을 되살렸다**: 주인공 카드에서 *"보관함에서 고치면 다음 대본부터 반영됩니다"*(이름 칸이 없는 이유의 유일한 답), 그림체에서 *"모든 회차의"*(작품 단위 선택인 이유), 내레이션에서 *"에피소드마다"*(장기는 회차마다 반복되는 비용). **짧게 유지하되 사라진 사실만 한 조각씩 되돌렸다** — 나머지 축약(자막 "비용 없음", API 키 안내)은 뜻이 살아 있어 단언을 맞췄다.
  - 🟠 **접근성 이름 중복 하나는 결함이 아니었다**: 헤더와 폼 끝의 두 버튼이 `프로젝트로 돌아가기` 로 같아졌는데 **둘 다 같은 동작(`onBack`)** 이라, 아까 고친 "서로 다른 컨트롤이 한 이름"과 다르다. 테스트가 testid 를 집게 했다.
  - 검증: root typecheck 통과, frontend 1022개 전부 통과, root build 통과.
- [x] **🔴 단기 대본 프롬프트가 주인공을 두 번, 서로 다르게 말할 수 있었다**: Cowork이 Round 274에서 "한 화면에 대표 캐릭터가 두 벌"이라고 넘긴 것을 서버에서 확인했다. **둘 다 프롬프트에 간다** — 그것도 템플릿에서 세 줄 간격으로 붙어서:

  ```
  대표 캐릭터: $character                          ← settings.character 자유 텍스트
  대표 캐릭터 Asset 및 프로젝트 등장 캐릭터 정보:
  $character_cast_metadata                         ← cast 중 하나를 "구분: 대표 캐릭터"로 표시
  ```

  둘을 맞춰주는 것이 아무것도 없어서, 이름을 다르게 적어두면 **모델이 서로 다른 두 주인공을 받는다** — 그리고 바로 아래 줄이 *"서로 다른 Character Asset의 이름, 외형과 역할을 섞지 마십시오"* 다. **프롬프트가 스스로 어긴다.** 제목 사본(`5e55367`)·설정집 사본과 같은 부류의 세 번째다.
  - **cast 가 이긴다**: 이름·이야기 역할·설명·하위 이미지별 특징까지 담는 쪽이라 자유 텍스트보다 엄격히 풍부하다. cast 에 대표가 있으면 `$character` 가 그 폴더 이름을 말하고, 없으면 예전처럼 적어둔 텍스트를 쓴다 — **폴더가 없는 프로젝트는 잃는 게 없다.**
  - 파이썬도 둘 다 보내고 있었다(이식 결함이 아니라 상속). 그래도 고친 이유는 D-031 그대로다 — 양쪽 끝이 각자 정상이라 아무도 중간을 안 봤다.
  - 머테이션 확인: `castLeadName ?? ` 를 빼면 그 테스트가 빨갛다. **화면의 자유 텍스트 칸을 지우는 것은 Cowork 몫**이고, 이제 지워도 프롬프트가 잃는 것이 없다고 알렸다.
- [x] **🟠 가드가 내 빈틈을 잡았다**: 방금 커밋한 프런트 배치에 **커밋되지 않는 우편함을 가리키는 주석**(`.claude-bridge Round 184`)이 들어 있었다. `decision-doc-references.test.ts` 가 백엔드 스위트에 있어서, **프런트 전용 배치라고 백엔드를 안 돌린 것**이 놓친 이유다. 앞으로 프런트만 바뀐 배치도 전체를 돌린다 — 저장소 규칙을 지키는 가드가 어느 스위트에 있는지는 바뀐 파일과 무관하다.
  - 검증: root typecheck 통과, Backend 1031개(+1 신규)·frontend 1022개 전부 통과, root build 통과.
- [x] **대표 캐릭터 칸이 자기가 쓰이지 않는다고 말한다 (Cowork Round 276)**: `131f699` 로 서버가 `castLeadName ?? settings.character` 를 고른 뒤, **화면은 어느 쪽이 사는지 한 글자도 말하지 않았다.** 이름을 칸에 적고 아래에서 폴더에 `대표` 를 누르면 적은 이름이 조용히 버려진다. 이제 그 칸이 대표의 폴더 이름을 표시하고 비활성이 되며, 아래 한 줄이 어디서 바뀌는지 말한다. **숨기지 않고 비활성**이라 대표를 빼면 칸이 다시 살아나고 저장된 자유 텍스트는 폴백으로 남는다.
  - 🔴 **내가 고친 것 셋 — 셋 다 다른 부류다**:
    - **목이 잠금 플래그 둘을 또 빠뜨렸다**(세 번째). 응답 가드가 거절해 화면이 에러로 그려지고 새 테스트 2건이 빨갰다.
    - **픽스처가 `castRole: "representative"` 였다.** 이 시스템에서 대표는 `protagonist`/`lead` 둘뿐이고 `representative` 는 **서브 캐릭터로 읽힌다** — 화면(`isRepresentative`)도 서버(`describeCharacterCast`)도 그렇다. 그 철자로는 테스트가 무엇도 증명하지 못한다. 바로 옆에 *"프롬프트 조립부가 실제로 읽는 철자로"* 라는 이름의 테스트가 이미 있다.
    - **폼이 그려지자마자 단언했다.** 이름은 요청 둘(cast → 라이브러리)을 거쳐 카드에서 폼으로 끌어올려지므로, 칸의 존재만 기다리면 그 전에 읽는다. `waitFor` 로 값이 도착하기를 기다리게 했다 — `780e910`("틱이 하는 일을 기다린다")의 화면판.
  - 검증: root typecheck 통과, frontend 1024개(+2 신규)·Backend 1031개 전부 통과, root build 통과.
- [x] **🔴 되감김이 *초록으로* 지나가는 자리에 가드를 세웠다**: 오늘 되감김 다섯 번 중 **가드가 잡은 것과 못 잡은 것의 차이**를 먼저 갈랐다.
  - **가드가 지워지면 그 테스트가 빨개진다** — 이중 과금 가드는 두 번 다 테스트가 잡았다. 문제는 커버리지가 아니었다.
  - **가드와 그 테스트가 *같이* 지워지면 아무도 못 잡는다.** 스위트는 더 적은 수로 통과하고, **줄어든 숫자는 늘어난 숫자와 똑같이 읽힌다.** 오늘 세 번 그렇게 사라졌다(잠금 테스트 3건, 장면 수 테스트 2건). 둘 다 **사람이 diff 를 읽어서** 찾았고 그건 통제 수단이 아니다.
  - 그래서 **돈이 나가거나 이미 낸 작업이 사라지는 것을 막는 테스트의 이름을 핀으로 박았다**(`money-guard-tests.test.ts`, 6개). 이름이 사라지면 실패하고, 실패 메시지가 그 테스트가 왜 있는지를 같이 말한다. **목록에 오르는 기준을 주석에 적었다** — "중요한 테스트"가 아니라 *없으면 돈이 나가거나 낸 것이 없어지는* 테스트만. 목록이 제2의 스위트가 되면 아무도 안 읽는다.
  - 🔴 **오류 주입에서 첫 판이 안 잡혔다 — 가드가 자기 자신을 읽고 있었다.** 목록의 제목이 이 파일 안에 문자열로 있으니 무엇을 지워도 통과한다. Round 219에서 겪은 *"자기가 생각해 본 철자만 아는 가드"* 의 다른 얼굴이고, **정합성 단언(파일 100개 이상)도 이건 못 잡았다.** 자기 파일을 빼고 다시 주입해 실제로 빨간 것을 확인했다.
  - `learning_data` 경로를 만드는 두 번째 자리(`assets.module.ts`)에도 D-032 포인터를 붙였다. 첫 자리는 `e7b72e0`.
  - 검증: root typecheck 통과, Backend 1032개(+1 신규)·frontend 1024개 전부 통과, root build 통과.

## 2026-08-29 — 실사용 사이클이 저장된 파일 때문에 막혔다

- [x] **🔴🔴 장기 3개 중 2개가 참고 이미지 연결 검토를 못 열어 사이클이 멈췄다 (Cowork Round 279·280)**: `GET .../assets/mapping-review` 가 `ASSET_MAPPING_REVIEW_INVALID` 로 500. **통과한 하나는 그 파일이 아예 없어서 기본값이 쓰인 프로젝트**였다 — 즉 코드가 아니라 **저장된 파일**이 지금 파서와 안 맞는다. 그래서 **오늘 만든 프로젝트는 되고 어제 만든 것이 막히며, 시간이 갈수록 늘어난다.**
  - 실제 파일 둘을 직접 열어 확인했다(추정 위에 고치지 않았다). 깨지는 자리가 **셋이고 서로 독립**이라 하나만 고치면 다음 것이 나온다:
    ① `parseReview` 가 모르는 키(`episode_number`·`candidates`)를 통째로 거절 — **빠진 키는 기본값이 채우는데 남는 키는 못 견딘다.**
    ② 회차 검토의 `project_id` 가 `"12"` 인데 지금은 `"12/Episode01"` 을 기대한다.
    ③ `design-preview-long-1` 은 `status: "approved"` 인데 `reviewed_scenes` 가 없다 — ①②를 고쳐도 여기서 또 걸린다.
  - **`id` 게터의 주석이 바로 그 가정을 근거로 들고 있었다**: *"모든 Episode mapping 파일은 비어 있으므로 마이그레이션할 데이터가 없다."* 매핑 파일은 그랬지만 **검토 파일은 아니었다.** 같은 폴더의 다른 파일도 그 id 를 들고 있다는 것을 아무도 안 봤다.
  - 고친 모양 — **읽기는 관대하게, 쓰기는 엄격하게**(`asset_link`·`platform` 과 같은 갈래). `parseStoredReview(value, locationId)` 를 읽기 경로에만 두고 `saveReview` 는 그대로 `parseReview` 를 지난다. 즉 **저장되는 것은 언제나 오늘의 모양**이다.
  - **③은 승인으로 통과시키지 않는다.** 승인은 누군가 모든 장면을 봤다는 뜻인데 그 기록이 없다. `waiting` 으로 낮춘다 — 사람이 한 번 더 누르면 되고 그건 무료다. 반대로 지어낸 승인은 빠진 장면 검사를 건너뛰고 **그림 단계로 넘어간다.**
  - **②의 교정은 접두 규칙으로 좁혔다**: 저장된 값이 이 위치 id 의 *프로젝트 절반*일 때만 교정한다. **다른 회차에서 복사해 온 파일(`12/Episode02`)은 그대로 두고 호출부가 거절한다** — 그 검사가 존재하는 이유가 그것이라 교정으로 덮으면 안 된다.
  - 머테이션 셋: 관용 키를 비우면 3건, id 교정을 빼면 2건, 승인 강등을 빼면 1건이 각각 빨갛다.
  - 검증: root typecheck 통과, Backend 1035개(+3 신규)·frontend 1024개 전부 통과, root build 통과.
  - 🟠 별건: `project-lock.test.ts` 의 다른 테스트 하나가 **전체 스위트 부하에서만** 한 번 빨갰다(단독 3회는 통과). 이 파일에서 두 번째 목격이라 기록만 하고 넘어간다 — 재현되면 그때 잡는다.
- [x] **새로고침하면 메인으로 튕기던 것 — 화면 위치가 주소창에 담긴다 (Cowork Round 281)**: 화면이 React 상태에만 있어서, 네 번 눌러 도착한 화면에서 새로고침하면 목록으로 돌아갔다. 주소는 `#/longEpisodeMappingReview?projectId=12&episodeNumber=1` 모양이고, **경로 표가 아니라 필드 표**(`Record<Screen["name"], …>`)라 **화면을 추가하고 안 적으면 타입 에러**다 — "새로고침에서 조용히 빠진 화면"이 생길 수 없다. 안 풀리는 주소는 프로젝트 목록으로 보낸다(**잘못된 주소는 다른 페이지지 고장난 페이지가 아니다**), `justCreated` 는 주소에 안 담는다(북마크하면 첫 실행 안내가 영원히 뜬다).
  - 🔴 **내가 고친 것 — 프로젝트를 만들면 설정 화면에 갔다가 곧바로 생성 폼으로 되돌아왔다.** 두 흐름 테스트가 이걸로 빨갰다.
    - **원인은 우리가 쓴 주소의 메아리다.** `location.hash` 에 쓰면 `hashchange` 가 **비동기로** 돌아오는데, 그 이벤트가 화면이 이미 다음으로 넘어간 뒤에 도착한다. 그 순간 주소창에는 아직 이전 값이 있어서 **"누군가 뒤로 갔다"로 읽힌다** — 그래서 설정 화면이 뜬 직후 생성 폼으로 되돌아갔다.
    - 첫 수리(현재 화면과 주소를 비교)는 **모자랐다**: 비교 시점의 주소가 옛 값이라 여전히 어긋난다. **우리가 쓴 주소를 순서대로 큐에 넣고 그 메아리를 하나씩 소비**하도록 고쳤다. 밖에서 온 변경(뒤로/앞으로/직접 입력)은 큐와 안 맞으므로 그대로 따른다.
    - 이 부류는 **로그를 찍기 전까지 추측이 세 번 틀렸다.** 전이를 출력해보고서야 순서가 보였다 — `WRITE create` → `EVENT(cur=settings)` → `WRITE settings` → `WRITE create`.
  - 타입 오류 하나(`raw.split("?", 2)` 의 `string | undefined`)도 고쳤다 — Cowork 하네스에는 `noUncheckedIndexedAccess` 가 없어 안 보이는 부류다.
  - 검증: root typecheck 통과, frontend 1032개(+9 신규)·Backend 1035개 전부 통과, root build 통과.
- [x] **🔴🔴 회차 영상이 여섯 장면 모두 청구되고 파일은 자리표시자였다**: 캡틴D의 실사이클에서 영상이 안 나온다는 보고. **원장에는 Runway 6건 × $0.25 = $1.50 이 전부 `ok` 로 찍혔고**, 기록에는 진짜 task id 와 `succeeded` 가 있는데, 디스크의 여섯 mp4 는 **32바이트로 로컬 가짜 상수와 바이트 단위로 동일**했다.
  - 원인은 한 줄이다. `episode-videos.service.ts` 의 실제 경로 성공 분기가 **내려받은 `result.bytes` 를 버리고** `this.binary(...)` — 항상 `MP4` 상수를 쓰는 함수 — 를 불렀다. **단기 프로젝트 쪽은 처음부터 `result.bytes` 를 쓴다**(`local-video-workflow.service.ts:352`). 회차 쪽이 가짜 경로의 모양에서 이식되면서 성공 분기만 따라오지 못했다.
  - **아무도 못 본 이유**: 기록은 `succeeded` 고, `validVideo` 는 길이와 `ftyp` 박스만 봐서 **32바이트 껍데기를 통과시킨다.** 화면도 원장도 성공이라고 말한다 — 실제로 없는 것은 파일 안의 영상뿐이다.
  - 고친 것 둘: ① 성공 분기가 내려받은 바이트를 쓴다. ② **헤더보다 크지 않은 응답은 성공으로 세지 않는다** — 그 장면을 `failed`(`empty_output`)로 두어 다시 만들 수 있게 한다. 그대로 통과시키면 회차가 볼 것 없는 검토 단계로 넘어간다.
  - 진단은 **추측이 아니라 대조로** 했다: 파일 바이트를 가짜 상수와 비교(동일), 작업 기록이 한 건이고 전부 `execution_mode: "runway"`(즉 가짜 루프는 안 돌았음), 원장의 6건.
  - 테스트 둘 신규 + 목의 응답 바디를 실제에 가깝게(자리표시자보다 길게) 바꿨다. **머테이션 둘 다 확인** — 바이트 쓰기를 되돌리면 1건, 길이 검사를 빼면 1건이 빨갛다.
  - 🟠 **이미 청구된 6장면**: Runway task id 가 기록에 남아 있고 `getRunwayTask` 는 기존 task 를 GET 으로 조회할 뿐이라 **재생성 비용 없이 회수 가능**하다. 다만 출력 URL 은 시간이 지나면 만료되므로 결정이 늦으면 다시 $1.50 을 쓰게 된다. 회수 경로를 만들지, 그냥 재생성할지는 캡틴D 판단이라 **만들지 않고 우편함에 올렸다.**
  - 검증: root typecheck 통과, Backend 1037개(+2 신규) 전부 통과, root build 통과.
- [x] **회수 경로 신설 — 이미 청구된 영상을 다시 사지 않고 가져온다 (캡틴D 결정: 회수)**: `POST .../videos/generations/:jobId/recovery`. 기록에 남은 task id 로 `getRunwayTask` → `downloadRunwayOutput` → 바이트를 디스크에 쓴다. **생성 호출이 없으므로 원장에 추가 청구가 없다** — 테스트가 제출 횟수와 `spentThisMonth()` 를 둘 다 건다.
  - 범위를 좁혔다: `succeeded` + task id 가 있고 **디스크 파일이 진짜 영상이 아닌** 장면만. 이미 진짜 바이트를 가진 장면은 손대지 않고, 성공한 적 없는 장면은 회수 대상이 아니라 사람이 결정할 생성이다.
  - 🔴 **`validVideo` 로 판정했더니 회수가 전부 건너뛰었다 — 이 버그의 핵심을 내 회수 경로가 그대로 밟았다.** 자리표시자는 길이 32에 `ftyp` 이라 그 검사를 통과한다. `realVideo`(자리표시자보다 커야 함)를 따로 두고 그 이유를 주석에 적었다.
  - 회수한 응답이 또 헤더뿐이면 **쓰지 않고 그 장면을 `failed("empty_output")` 로 남긴다.** Cowork이 미리 짚은 자리다 — 만료된 URL 이 빈 응답을 주면 조용히 32바이트를 다시 쓰게 된다. **머테이션에서 이 가드가 처음엔 아무 테스트도 안 잡는 것을 발견해** 그 경우(200 + 헤더뿐)를 재현하는 테스트를 추가했다.
  - 회수 불가 장면은 **임의로 재생성하지 않는다**. 이유(`no_output`·어댑터 category·`empty_output`)와 함께 응답에 담아 사람이 정하게 한다 — 돈 쓰는 결정은 폴백이 아니다.
  - 검증: root typecheck 통과, Backend 1040개(+3 신규)·shared 25개 전부 통과, root build 통과.
- [x] **병합이 유료 실행의 자리표시자를 이어 붙이려 했다 (Cowork Round 286)**: 합치기 화면이 `[최종 영상 만들기]` 를 열어두고 있었고, 서버의 파일 검사는 **`size <= 0`** 뿐이라 32바이트 헤더가 통과했다. 승인 수·기록은 제대로 막지만 **파일이 쓸 만한지는 아무도 안 봤다** — `validVideo` 가 자리표시자를 통과시킨 것과 같은 자리다. **비용이 안 든다는 것이 이 자리를 안전하게 만들지 않는다**: 경고가 없어 누르기 쉽고, 나온 것이 "최종 영상"이라는 이름으로 보관함에 간다.
  - **판정을 실행 모드로 좁혔다.** 로컬 가짜 경로에서는 자리표시자가 **정상 산출물**이라, 전부 막으면 무자격 사용자 흐름이 통째로 깨진다(실제로 병합 테스트 다섯 개가 그것으로 빨개져서 알았다). 기록에 `runway` 가 하나라도 있으면 진짜 클립을 요구하고, 가짜 실행은 예전처럼 0바이트만 막는다.
  - **자리표시자 정의를 하나로 모았다**(`videos/placeholder-clip.ts`). 같은 바이트가 세 군데 있었고, **그 상수를 아는 자리의 수가 곧 서로 다른 의견을 가질 수 있는 자리의 수**였다 — 실제로 그렇게 갈라졌다.
  - 머테이션 확인: 유료 판정을 빼면 그 테스트가 빨갛다. 테스트는 **막는 것과 통과시키는 것을 둘 다** 건다(유료 기록이면 거절, 같은 파일이라도 가짜 기록이면 병합 성공).
  - 검증: root typecheck 통과, Backend 1041개(+1 신규) 전부 통과, root build 통과.
- [x] **오늘 만든 돈 관련 가드 셋을 이름 핀 목록에 넣었다**: `d4b0e5c` 로 세운 `money-guard-tests.test.ts` 에 영상 건 셋을 추가했다 — 내려받은 바이트를 쓰는 것, 회수가 읽기로 남는 것, 유료 실행의 자리표시자를 병합하지 않는 것. 셋 다 **없으면 돈이 나가거나 낸 것이 사라지는** 부류라 그 목록의 기준에 맞는다.
  - 🟠 **주입을 처음에 잘못했다**: 제목 뒤에 문구를 덧붙이는 식으로 바꿨더니 가드가 통과했다 — `includes` 라 부분 문자열이 여전히 맞는다. **제목을 아예 다른 것으로 바꿔야** 빨갛다. 즉 이 가드는 *사라짐*은 잡지만 *이름이 늘어나는 것*은 안 잡는다. 그건 의도한 범위다(사라짐이 실제로 일어난 실패 모드다) — 다만 주입을 그렇게 해놓고 "확인했다"고 적을 뻔했다.
  - 검증: root typecheck 통과, Backend 1041개·frontend 1036개 전부 통과, root build 통과.
- [x] **단기 프로젝트 병합에도 같은 구멍이 있었다 — 찾아서 같이 막았다**: 회차 쪽을 고친 뒤 *"한쪽에 있으면 다른 쪽에도 있다"* 를 물어봤고, `video-merge.service.ts` 의 클립 검사도 **`size <= 0`** 이었다. 단기 기록도 `execution_mode` 를 갖고 있는데 병합이 그걸 안 읽었다.
  - 회차와 **같은 판정**을 넣었다: 기록에 `runway` 가 하나라도 있으면 진짜 클립을 요구하고, 로컬 가짜 실행은 예전처럼 0바이트만 막는다. 테스트가 **같은 파일로 두 방향**을 건다 — 유료 기록이면 거절, 가짜 기록이면 병합 성공.
  - 이름 핀 목록의 그 항목이 이제 **두 스위트에 걸친다**(단기·회차 제목이 같다). 목록 주석에 그 사실을 적었다 — 하나만 있어도 통과하면 짝이 덮인 것처럼 읽힌다.
  - 머테이션 확인: 유료 판정을 빼면 그 테스트가 빨갛다.
  - 검증: root typecheck 통과, Backend 1042개(+1 신규)·frontend 1036개 전부 통과, root build 통과.
- [x] **회수 버튼 (Cowork Round 290) + 🔴 회차 영상 content 라우트 신설**: 화면이 `9cff6bd` 의 회수를 부르고, 못 가져온 장면은 번호와 이유를 말하고 거기서 멈춘다(다시 만들면 돈이 든다고 덧붙인다). 응답 검증기가 **두 필드를 다 검사한다** — 목록이 빠지면 부분 회수가 "하나도 못 가져왔다"로 읽힌다.
  - **Cowork이 영상 볼 자리를 못 만든 이유가 계약이었다**: 단기에는 `videoContent` 가 있는데 **회차용 동등물이 없어서 `<video src>` 가 가리킬 데가 없었다.** 없는 주소에 플레이어를 그리면 검은 상자가 나오고, 그건 32바이트를 "성공"으로 보여준 것과 같은 부류라 **안 만든 판단이 맞다.**
  - `longEpisodeVideoContent` 와 스트리밍 라우트를 열었다(회차 이미지 content 의 모양 그대로). **`validVideo` 가 아니라 `realVideo` 로 막는다** — 자리표시자를 흘려보내면 빈 플레이어가 그려지고, 그것은 그 스텁이 디스크에서 하던 주장과 똑같다.
  - **이 자리가 있었으면 캡틴D가 32바이트를 확정하기 전에 알아챘다.** 검토 화면이 상태와 파일 이름만 보여주고 있었다.
  - 테스트: 진짜 클립은 경로를 돌려주고, 자리표시자와 없는 장면 번호는 거절. 머테이션(`realVideo` → `validVideo`)으로 확인.
  - 검증: root typecheck 통과, Backend 1043개(+1 신규)·frontend 1036개·shared 25개 전부 통과, root build 통과.
- [x] **영상 보관함도 유료 실행의 자리표시자를 "준비된 영상"으로 세고 있었다 — 같은 판정의 세 번째 자리**: `validFile()` 이 `size <= 0` 만 봤다. 여섯 개가 스텁인 상태에서 **보관함은 배치가 끝났다고 보고하고 내려받기를 권했다** — 병합 화면과 검토 상태가 하던 것과 같은 거짓말이다.
  - 병합 때와 **같은 갈래**로 갔다: 기록에 `runway` 가 있으면 진짜 클립을 요구하고, 로컬 가짜 실행은 그대로 나열한다(그쪽에서는 자리표시자가 진짜 산출물이다). 테스트가 같은 파일로 두 방향을 건다.
  - 이걸로 같은 판정이 네 곳에서 하나의 정의(`placeholder-clip.ts`)를 쓴다 — 회차 병합·단기 병합·보관함·회차 영상 content.
  - 머테이션 확인: 유료 판정을 빼면 그 테스트가 빨갛다.
  - 🟠 **Cowork이 "네 대기열"이라 적은 것 하나는 아직 결정이 필요하다**: 장기 회차 결과물이 **보관함에 아예 안 들어간다**(`VideoLibraryService.list()` 가 단기 프로젝트만 순회한다). 버그가 아니라 없는 기능이라 계약·백엔드·화면이 다 필요하고, 지금은 캡틴D의 회수가 우선이라 만들지 않고 우편함에 올렸다.
  - 검증: root typecheck 통과, Backend 1044개(+1 신규) 전부 통과, root build 통과.
- [x] **🔴 새로고침 한 번에 유료 작업이 화면에서 사라졌다 (Cowork Round 294) + 합치기 확정 수 (`897b62a`)**: `LongEpisodeVideoWorkflowScreen` 이 `job` 을 **`start()` 를 누른 그 페이지 로드 안에서만** 갖고 있었다. 새로고침하면 검토 구역 전체가 안 그려지고, **그 뒤에 있던 회수 버튼과 플레이어까지 같이 사라졌다** — $1.50 어치 결제된 작업에 손이 닿지 않는 상태였다. `getLongEpisodeCurrentVideoJob` 은 이미 있었고 화면이 안 부르고 있었을 뿐이다.
  - 합치기 화면 문구는 **장면 수를 "승인된" 뒤에 찍고 있었다**. 1/6 확정 회차도 "승인된 … 6개를 이어 붙입니다" 로 읽혔고 누르면 서버가 거절했다. 확정 수를 검토에서 읽어 따로 표시하고, 미확정이 남으면 **누르기 전에** 막는다. 수를 못 읽으면 아무것도 막지 않는다 — 추측으로 잠그느니 서버가 거절하는 편이 낫다.
  - 🟠 **테스트 5개가 깨진 원인은 요청이 하나 는 것이 아니라, 테스트가 요청을 *순서*로 붙잡고 있던 것이다**: `mockResolvedValueOnce` 체인 + `toHaveBeenCalledTimes(N)` + `mock.calls[i]`. 앞에 요청 하나가 끼면 전부 한 칸씩 밀리고, 무엇을 보고 있는지가 인덱스에만 적혀 있어 **조용히 다른 것을 단언하게 된다.** 경로 이름으로 찾는 헬퍼(`countTo`/`callTo`/`callsTo`)로 바꿨다.
  - 합치기 테스트의 "설정을 못 읽는" 건은 **2홉짜리 확정 수 도착을 기다리게** 했다. 1홉짜리 설정 읽기가 정착하기 전에 단언하면 문장이 틀릴 기회조차 갖기 전에 초록이다.
  - 머테이션 확인: `blocked = false` 로 두면 새 차단 테스트가 빨갛다.
  - 단기 쪽도 같은 모양인지 물어봤고 **아니었다** — `jobId` 가 주소에 실리고, 잃어도 `currentVideoJobId`(기록에서 파생)로 되돌아온다. 이미지 화면도 job 이 아니라 **Episode 상태**에서 복구하므로 안전하다.
  - 검증: root typecheck 통과, Backend 1044개·frontend 1037개(+1 신규) 전부 통과, root build 통과.
- [x] **🔴 설정집 검색 엔드포인트가 어떤 입력으로도 성공할 수 없었다 (`02a7d5e`)**: 클라이언트는 `?query=`(쿼리스트링)를 보내는데 핸들러는 `@Param("query")` 를 읽었고, 경로 `.../story-bible/:collection/search` 에는 **`:query` 구간이 없다.** 값은 언제나 `undefined` → 서비스가 `longInvalidRequest()`. **모든 호출이 400이었다.**
  - 아무도 못 잡은 이유가 D-031 그대로다: 클라이언트에 래퍼가 있고, 서비스는 올바르게 거르고 자체 테스트도 초록이고, `unknown` 이 `undefined` 를 군말 없이 받아 타입체크도 통과한다. **라우터를 지나가는 테스트가 하나도 없었다.** 이번엔 필드가 아니라 **파라미터가 있는 자리**가 어긋난 경우다.
  - 찾은 방법: "api 함수를 `api/` 밖에서 아무도 안 부른다" 전수 조사. 두 건이 나왔고(`searchLongStoryBibleItems`, `duplicateLongStoryBibleItem`) HTTP 로 두드려 보니 복제는 멀쩡, 검색은 400.
  - 새 테스트는 **공유 라우트 빌더가 만든 URL** 로 실제 앱을 두드린다. 직접 적은 URL이면 클라이언트가 딴 데로 보내기 시작해도 계속 통과한다. 고치기 전 4개 중 2개가 400 으로 빨간 것을 확인했다.
  - 🟠 **두 함수는 여전히 어떤 화면도 안 부른다.** 이제 엔드포인트가 실제로 답하니 붙일 값어치가 생겼다(전에는 붙여도 400 이었다). 화면은 Cowork 몫이라 우편함에 넘겼고, 붙고 나면 이 전수 조사를 가드로 고정한다 — 지금 넣으면 예외 목록을 달고 태어나고, 그런 가드는 곧 아무것도 안 지킨다.
  - 검증: root typecheck 통과, Backend 1048개(+4 신규)·frontend 1037개 전부 통과, root build 통과.
- [x] **클라이언트가 만드는 URL 을 서버가 여는지 모양으로 대조하는 가드 (`2c22405`)**: `API_ROUTES` 는 양쪽이 경로를 적는 유일한 자리인데 **적는 방식이 다르다** — 클라이언트는 완성된 URL 을 돌려주는 빌더를, 서버는 `:param` 패턴을 쓴다. 둘을 비교하는 것이 없어서 컨트롤러 경로를 바꿔도 타입은 전부 통과하고 화면만 404를 받기 시작한다. 양쪽을 `:x` 로 정규화해 대조한다. **현재 구멍은 0건이고, 그 상태를 고정한 것이다.**
  - **일부러 모양만 본다.** 핸들러가 엉뚱한 자리에서 파라미터를 읽는 건 못 본다(바로 위 검색 버그가 이 대조를 완벽히 통과하면서 400 이었다). 화면이 그 빌더를 부르는지도 못 본다(프론트의 `contract-request-coverage.test.ts` 축). **구멍 셋, 가드 셋** — 헤더에 어느 게 어느 건지 적어 다음 사람이 없는 걸 기대하지 않게 했다.
  - 🟠 **재는 도구를 두 번 틀렸다.** ① 컨트롤러가 빌더를 안 쓴다는 걸 놓쳐 108개 전부 "서버 없음" 으로 나왔다. ② 데코레이터가 상수를 그냥 넘기는 형태(`@Get(API_ROUTES.audioLibrary)`)를 빠뜨려 서비스되는 15개를 오탐했다. **두 번 다 크기 단언이 잡았다** — 리뷰가 아니라. 그래서 그 단언을 가드에 남겼다.
  - 주입 확인 2종 모두 빨감: 경로 세그먼트 변경(`search`→`find`), 상수 직접 전달 라우트 변경(`audioLibrary`).
  - 검증: root typecheck 통과, Backend 1050개(+2 신규)·frontend 1037개 전부 통과, root build 통과.
- [x] **파라미터를 라우트에 없는 자리에서 읽는 핸들러를 가드로 잡는다 (`d1fe3dc`)**: 검색 버그(`02a7d5e`)와 **같은 모양**이 다른 데 또 있는지 기계적으로 훑었다. `@Param("x")` 인데 경로에 `:x` 구간이 없으면 바인딩할 게 없어 `undefined` 가 들어온다 — 파라미터 타입이 `unknown`/`string` 이라 **타입 오류가 아니고**, 서비스 테스트는 서비스만 부르니 통과하고, 모든 호출이 실패한다.
  - 바로 옆의 **라우트 모양 대조로는 못 본다**: 검색 버그는 경로가 완벽히 맞았고 틀린 건 파라미터의 출처였다. 그래서 이 가드는 핸들러의 **파라미터 목록 자체**를 읽어 이름을 라우트와 맞춘다.
  - 현재 구멍 0건. 실제 버그를 되돌려 넣으면 **정확히 이 테스트만** 빨갛다. 핸들러 149개를 읽고, **읽었다는 것 자체**를 단언한다 — 아무것도 안 맞는 정규식은 빈 스윕을 깨끗한 스윕처럼 보이게 하고, 이번 주에 그 실수를 이미 두 번 했다.
- [x] **`project-lock` 간헐 실패 의심을 닫았다 (추측이 아니라 측정으로)**: "다른 키는 동시에 진행된다" 테스트의 **10ms 고정 대기**를 범인으로 의심했다(같은 파일의 다른 테스트 주석이 바로 그 실수를 경고하고 있다). **틀렸다.**
  - 잠금이 보호 함수에 도달하기까지 걸리는 시간을 200회씩 두 조건에서 쟀다: 유휴 p99 0.95ms·최대 1.53ms, **전체 스위트가 같이 도는 중** p99 0.72ms·최대 1.67ms. **400개 표본 중 10ms 예산을 넘은 것 0개** — 여유가 6~10배다.
  - 부하 중 스위트 자체도 초록이었다. **간헐 실패는 여전히 원인 불명이고 재현되지 않았다.** 다음 사람이 같은 자리를 다시 파지 않도록 측정값을 남긴다. 고정 대기를 "혹시 몰라" 고치는 것은 하지 않았다 — 측정이 아니라고 말한 자리를 고치면 무엇이 고쳐졌는지 아무도 모른다.
- [x] **설정집 검색·복제는 붙이지 않기로 했다 — 그리고 가드도 같이 미룬다 (Cowork Round 296, 캡틴D 결정)**: `02a7d5e` 로 엔드포인트가 살아났지만 **화면에는 얹지 않는다.** Cowork이 두 기능이 무엇인지 그대로 설명하고 지금은 값어치가 없다는 의견을 붙였다 — 항목이 몇 개뿐이면 검색할 게 없고, 복제는 눈으로 보고 새로 쓰는 게 빠르다. "UI 가 너무 길고 말이 너무 많다" 는 최근 요구와도 반대 방향이다. 캡틴D: **"미뤄"**.
  - **"api 래퍼를 화면이 부르는가" 가드도 같이 미룬다.** 지금 켜면 이 둘 때문에 빨간 채로 태어나고, **예외 목록을 달고 태어난 가드는 곧 아무것도 안 지킨다.** 라우트와 래퍼는 남긴다 — 붙일 날 400 을 다시 만나지 않는다.
  - 다시 꺼낼 조건: 회차가 20~30화 쌓여 비밀·복선이 수십 개가 될 때. **검색창을 붙이는 그 라운드에서 가드도 같이 켠다** — 둘은 한 묶음이고 따로 기억하면 둘 다 잊는다. D-031 에 적었다(우편함은 지워지지만 결정 문서는 남는다).
- [x] **🔴 회차 최종 영상에 주소가 없었다 — 보관함 문제가 아니라 같은 구멍이 한 층 위에 있었다 (`b1649b0`)**: "장기 회차 결과물이 보관함에 안 들어간다" 를 결정 대기로 두고 범위를 재다가, 더 앞의 사실을 발견했다. **회차를 합치고 나면 앱이 파일 경로를 글자로 보여주는 게 전부**고, 그 줄은 React state 라 새로고침하면 사라진다. 재생기도, 여는 방법도, 목록도 없다. 단기에는 `videoFinalContent` 가 처음부터 있었다 — `longEpisodeVideoContent` 를 만들기 전 장면 클립이 겪던 것과 **같은 구멍의 한 층 위**다.
  - 자리표시자 길이 이하인 파일은 **거절한다**. 합친 파일이 재료보다 작을 수는 없으므로 그 크기는 스텁을 이어 붙였다는 뜻이고, 거기에 재생기를 걸면 **검은 상자가 "최종 영상"이라고 주장한다** — 32바이트 장면 파일이 디스크에서 하던 주장 그대로다. 병합이 입력에 거는 것과 같은 검사다.
  - 🔴 **실제 앱으로 몰아본 것이 버그를 잡았다(예방이 아니라).** `videos/final/content` 와 `videos/:sceneNumber/content` 는 라우터에게 **같은 모양**이라 누가 답하는지는 등록 순서가 정한다 — 서비스 테스트로는 절대 안 보인다. 병합 컨트롤러에 선언했더니 **졌고**, 모든 요청이 "잘못된 장면 번호" 로 돌아왔다(`final` 은 장면 번호가 아니니까). 영상 컨트롤러의 장면 라우트 **위로** 옮겨서 고쳤다 — 단기 영상 컨트롤러가 이미 같은 이유로 같은 짝을 들고 있다.
  - 화면 절반은 Cowork 몫이다: 합치기 화면에 재생기를 걸 수 있고, 보관함의 회차 행도 이제 가리킬 데가 생겼다.
  - 검증: root typecheck 통과, Backend 1056개(+4 신규)·frontend 1043개 전부 통과, root build 통과.
- [x] **회수 라우트를 사람이 누르기 전에 실제 라우터로 몰아봤다 (`585ff59`)**: 캡틴D가 곧 누를 버튼인데 **서비스 테스트만 있고 라우트를 지나가 본 적이 없었다.** 서비스 테스트가 못 보는 것 둘: `generations/:jobId/recovery` 가 형제 라우트 `generations/:jobId` 에 먹히지 않는지, 승인 본문이 파싱되어 도착하는지 — 이번 주에 그 두 자리가 각각 "어떤 입력으로도 성공 못 하는 라우트" 와 "아무도 안 부르는 라우트" 를 만들었다.
  - 세 경우를 공유 라우트 빌더가 만든 URL 로 건다: 전체 회수(내려받은 바이트로 스텁을 덮음), 승인 없는 요청(Runway 를 **건드리기 전에** 거절), 만료된 출력 URL(못 가져온 장면을 전부 이름으로 말하고 자리표시자를 **그대로 둔다** — 다시 스텁을 쓰지 않는다).
  - **가장 센 단언은 부정형이다**: 회수는 작업 생성 엔드포인트를 **절대 부르지 않는다.** 그게 이미 낸 것을 가져오는 것과 다시 사는 것의 장면당 $0.25 차이고, 회수 경로가 "친절하게" 재생성으로 흘러내리는 실수가 정확히 여기다.
  - 🟠 **처음엔 네트워크 호출이 아예 안 나갔다.** 스텁을 평범한 함수로 만들었더니 `no-test-network.guard` 가 거절했다 — vitest mock 이 아닌 fetch 로 Runway 를 부르는 것을 막는 가드다(D-016: 디스크의 진짜 키로 실제 API 에 나가 정체불명 과금이 났던 사건). `vi.fn` 으로 감싸 해결했고, **그 가드가 의도대로 작동하는 것을 우연히 확인한 셈이다.**
  - 머테이션 확인: `realVideo` → `validVideo` (회수가 손상된 장면을 전부 건너뛰게 만들었던 그 버그)를 되돌려 넣으면 셋 중 둘이 빨갛다.
  - 검증: root typecheck 통과, Backend 1059개(+3 신규)·frontend 1043개 전부 통과, root build 통과.
- [x] **가짜 타이머를 켜 놓고 안 돌려주는 파일을 가드로 잡는다 (`520f908`)**: `project-lock` 간헐 실패를 닫으면서 `episode-videos.runway.test.ts` 의 `afterEach` 주석을 읽다 단서를 찾았다 — **파일 안**에서 가짜 타이머가 새면 다음 테스트의 **진짜 `setTimeout` 이 굶는다.** `project-lock.ts` 의 재시도 루프가 정확히 그것으로 매달렸고, 실패하는 건 아무 잘못 없는 다음 테스트다. 두 파일(`local-video-workflow.runway`, `episode-videos.runway`)의 `afterEach` 가 **그 일이 실제로 벌어진 뒤에** 쓰인 것이고 주석에 그렇게 적혀 있다.
  - 파일 간 누수는 불가능하다는 것도 같이 확인했다 — vitest 기본 `isolate` 라 파일마다 환경이 따로다. 즉 이건 파일 내부 문제고, 그래서 `afterEach` 안이어야 한다.
  - **"파일 어딘가에 `useRealTimers` 가 있으면 통과"가 아니라 `afterEach` 안일 것**을 건다. 시작한 테스트가 도중에 실패해도 돌려주는 경우가 그것뿐이고, 새는 것이 가장 곤란한 때가 바로 그때다. 주입 두 방향 확인: 복원을 지우기 / 복원을 `afterEach` 밖으로 빼기 — 둘 다 빨갛다.
  - 저장소 범위다(`decision-doc-references.test.ts` 와 같은 방식). 프론트 파일에 주입해도 백엔드에서 잡힌다. 스캔이 아무것도 안 읽는 경우를 위해 파일 200개 이상·가짜 타이머 사용 파일 1개 이상을 단언한다.
- [x] **완성된 회차가 재생되고, 새로고침을 넘긴다 (Cowork Round 297, `d000cea`)**: `b1649b0` 로 연 content 라우트에 합치기 화면이 `<video controls>` 를 걸었다. 실패 문구는 "장면 영상 중에 내용이 비어 있는 것이 섞여 있을 수 있습니다" — 자리표시자를 일부러 거절하는 라우트 옆에 붙는 말로는 이게 정직하다.
  - 🔴 **붙이다가 같은 부류를 하나 더 찾았다(두 번째다).** 성공 블록 **전체**가 합치기 응답 뒤에 있었다. 그 응답은 버튼을 누른 그 페이지 로드에만 있으므로, **합치고 나서 새로고침하면 "완성되었습니다" 도, 경로도, 이제는 재생기까지 전부 사라졌다.** 영상 화면의 `job` 과 똑같은 모양이다. 회차 자신의 `status === "completed"` 를 읽는 것으로 고쳤다 — 새로고침을 넘겨 살아남는 건 서버가 아는 사실이다.
  - 🟠 **테스트 픽스처가 거짓말을 하고 있었다.** `episodeWithScenes()` 의 기본 상태가 **`completed`**(합친 **뒤** 상태)였다. 화면이 상태를 안 읽는 동안은 무해했지만, 읽기 시작하는 순간 **합치기 전 테스트가 전부 성공 블록을 그리고**, "성공 블록이 나온다" 한 줄짜리 테스트가 **합치기 없이도 통과**하게 된다. 기본값을 `videos_approved`(사람이 이 화면을 실제로 여는 상태)로 바꿨다.
  - 머테이션 두 방향 확인: `alreadyMerged` 를 false 로 고정하면 새로고침 테스트 둘이 빨갛고, 픽스처 기본값을 `completed` 로 되돌리면 "합치기 전에는 완성이라고 말하지 않는다" 가 빨갛다. **초록이라서가 아니라 물어서 확인했다.**
  - 검증: root typecheck 통과, frontend 1046개(+3 신규)·Backend 1061개 전부 통과, root build 통과.
- [x] **단기 content 라우트 둘이 아직 유료 실행의 자리표시자를 내주고 있었다 — 같은 판정의 다섯·여섯 번째 자리 (`0c71e29`)**: 회차 쪽 content 는 `realVideo` 로 막고 있었는데 **단기 쌍둥이 둘은 여전히 `size <= 0`** 이었다. 32바이트 `ftyp` 헤더가 그 검사를 통과하므로, 스텁이 된 유료 실행에서 `<video>` 에 **검은 상자를 내주고 그것이 장면이라고 주장**한다 — 검토 화면이 스텁 여섯 개를 확정까지 통과시킨 그 주장 그대로다.
  - 나머지 넷과 **같은 갈래**: 기록에 `runway` 가 있으면 진짜 클립을 요구하고, 로컬 가짜 실행은 예전처럼 자리표시자를 내준다(그쪽에선 그게 정상 산출물이다). 테스트는 **같은 파일로 두 방향**을 건다 — "거절" 만 걸면 전부 거절하는 라우트에서도 통과하기 때문이다.
  - 🟠 **가드를 넣고도 스위트가 통째로 초록이었다.** 그래서 아무것도 안 덮여 있다는 걸 알았다. 둘 다 빼면 새 테스트 둘이 정확히 빨갛다.
  - 이걸로 같은 정의(`placeholder-clip.ts`)를 쓰는 자리가 여섯이다 — 회차 병합·단기 병합·보관함·회차 장면 content·단기 장면 content·단기 최종 content.
  - 검증: root typecheck 통과, Backend 1063개(+2 신규)·frontend 1046개 전부 통과, root build 통과.
- [x] **"새로고침하면 사라지는 구역" 세 번째는 없다 — 훑어서 확인했다**: `job`(영상 화면)과 `result`(합치기 화면)가 같은 모양이라 세 번째를 찾아봤다. 후보를 기계적으로 뽑으면 40건이 나오지만 대부분 오류 배너·다이얼로그로 **원래 page-local 이 맞다.** 좁힌 기준은 *"서버도 아는 완료 사실을 page-local 값 뒤에 숨겼는가"* 이고, 그 기준으로는 **0건**이다: 단기 합치기 화면은 이미 마운트에서 `workflowState === Completed` 로 복구하고, 이미지·내레이션·인스타그램 화면은 전부 서버에서 읽은 상태에서 파생한다.
  - **전역 가드는 만들지 않는다.** 판정이 의미론적이라(그 값이 서버도 아는 사실인가) 기계적으로는 오탐 40건이 먼저 나온다. 그런 가드는 예외 목록을 달고 태어나고, 곧 아무것도 안 지킨다(D-031 의 다섯 번째 가드를 미룬 것과 같은 이유).
- [x] **훑기를 Cowork의 더 날카로운 기준으로 끝냈다 (Round 298) — 세 번째는 없다**: Cowork이 기준을 다듬어 줬다. `useState` 뒤에 구역이 걸렸는지가 아니라 **그 구역이 없으면 유료 결과물에 손이 닿지 않는지**다. 이미지 화면 둘은 그 뒤에 있는 게 *이번 실행의 영수증*(몇 장 생성·몇 장 재사용)이고 그림 자체는 상태에서 나오므로 고치면 오히려 **"새로고침했더니 방금 안 한 작업의 요약이 떠 있다"** 가 된다 — 안 고치는 게 맞다.
  - 그 기준으로 나머지를 다 훑었다. **0건**: 내레이션 둘(`<audio>` 는 서버에서 읽은 목록 뒤, `generationSummary` 는 영수증), 대본·아웃라인·회차 대본(전부 `workflowState`/`status` 파생), 보관함 셋(서버 목록), 단기 합치기(이미 복구함).
  - **전역 가드는 안 만든다.** 판정이 의미론적이라 기계적으로는 오탐 40건이 먼저 나온다. 대신 **사라지면 조용한 것**만 이름으로 핀했다 ↓
- [x] **이번 주에 만든 돈 관련 가드 넷을 이름 핀 목록에 넣었다 (`e938ce4`)**: 두 화면의 새로고침 복구, 회수 라우트의 라우터 통과, content 라우트의 자리표시자 거절. 넷 다 **없어지면 스위트는 그냥 더 적은 수로 초록**이고, 적은 수는 큰 수와 똑같이 읽힌다.
  - 주입 확인 — 그리고 **맞는 주입만 유효하다**: 제목 뒤에 덧붙이면 `includes` 가 여전히 맞아 통과한다. 제목을 아예 갈아야 빨갛다. 갈았고, 빨갛다.
- [x] **🟢 회수 사건은 닫혔다 — 실사용 데이터를 읽어 확인했다(과금 호출 없음)**: 여러 라운드에 걸쳐 "회수 버튼 아직 안 눌림, 시한 있음" 을 반복했는데, **그 경고가 낡았다.** 실제 원장과 디스크를 대조했다:
  - `projects/12/long_story/Episode01/videos/` 의 여섯 클립은 **1.8~2.5MB 진짜 영상**이다(`ftyp` 확인). 32바이트 스텁이 아니다.
  - `runway_budget_usage.json` 의 `12:episode1` 행은 **정확히 6건, 합계 $1.50** — **두 번 청구된 흔적이 없다.**
  - 즉 **회수할 것이 남아 있지 않다.** `recover` 는 `realVideo` 인 장면을 건너뛰므로 지금 눌러도 0건 회수로 끝나고 비용도 없다.
  - 회수를 눌러서 복구된 것인지, 수정(`477fa40`) 이후의 실행이 처음부터 올바른 바이트를 쓴 것인지는 **이 데이터만으로는 구분되지 않는다** — 회수는 원장 행을 남기지 않고 `completed_at` 도 바꾸지 않으므로 두 경우의 흔적이 같다. 어느 쪽이든 결과는 같다.
  - 🟡 **남아 있는 32바이트 파일 여섯 개는 `design-preview-long-1` 것이고, 그 회차의 기록은 `execution_mode` 가 전부 로컬 가짜다.** 거기서는 자리표시자가 **정상 산출물**이다 — 나중에 이걸 보고 "또 스텁이다" 라고 고치지 않도록 적어 둔다. 자리표시자 판정을 실행 모드로 좁힌 것이 정확히 이 때문이다.
- [x] **회차 장면의 옛 클립을 목록·재생·되돌리기 (캡틴D 결정 ①, `745e114`)**: 직전 라운드에서 올린 질문에 캡틴D가 **"둘다 진행해줘"** 라고 답했다. 파일은 이미 쌓이고 있었다 — 재생성하면 밀려난 클립을 보관해 왔다 — 다만 `scene{n}_{타임스탬프}.mp4` 라는, **앱의 어떤 리더도 못 읽는 이름**이었다. 유료 결과물이 손 닿지 않는 곳에 쌓이는 건 덮어써지는 것과 같은 결함이고, 더 조용할 뿐이다.
  - 쓰기 형식을 **단기와 같은 `scene{n}_v{NNN}.mp4`** 로 맞췄다(Cowork 권고). 파서가 하나면 다음에 어긋날 자리가 없다. 라우트 셋(목록·재생·되돌리기)은 단기 보관함의 모양 그대로다.
  - 되돌리기는 **비용 없고 파괴적이지 않다** — 밀려나는 클립을 먼저 보관하므로 되돌리기 자체가 되돌려지고 아무것도 지워지지 않는다. 다만 **최종 영상은 무효가 된다**(재료가 바뀌었으니): `final_video_path` 를 지우고 `completed` 였으면 `videos_approved` 로 되돌린다. 단기 복원이 같은 이유로 같은 교환을 한다.
  - 재생은 **자리표시자를 거절**한다. 되돌릴지 정하는 사람에게 검은 상자를 보여주는 것이 이 화면이 막으려는 바로 그것이다.
- [x] **🔴 세 서비스가 합쳐진 회차를 손상으로 읽고 있었다 (위 작업 중 발견)**: Episode 상태 목록을 **다섯 서비스가 각자 한 벌씩** 갖고 있었고 그중 셋(`episode-videos`, `episode-images`, `episode-scripts`)이 `interrupted` 에서 끝났다. **최종 영상이 생기는 순간** 저장 상태가 `completed` 가 되는데 그 셋은 그 값을 안 받으므로 저장 데이터를 손상으로 판정하고 **500** 을 냈다 — 합친 뒤에는 장면 재생기도, 회수 버튼도, 대본도 전부.
  - `placeholder-clip.ts` 와 같은 교훈이다: **그 목록을 아는 자리의 수가 곧 서로 다른 의견을 가질 수 있는 자리의 수**다. shared 한 곳으로 모으고 **타입을 목록에서 파생**시켰다 — 상태 추가가 이제 한 번의 수정이다.
  - 서비스 테스트로는 안 보였다. 실제 라우터로 몰아본 되돌리기 테스트가 500을 뱉으면서 드러났다.
  - 주입 두 방향 확인: 목록을 15개로 되돌리면 합친-회차 테스트 둘이 빨갛고, 이력 이름을 타임스탬프로 되돌리면 되돌리기 테스트가 빨갛다.
  - 검증: root typecheck 통과, Backend 1071개(+8 신규)·frontend 1046개 전부 통과, root build 통과.
- [x] **회차 결과물이 영상 보관함에 들어간다 — 별도 배열로 (캡틴D 결정 ②, `1d1b9ce`)**: 단기 행이 들고 있는 사실을 그대로 담는다(장면 수·실제로 준비된 클립 수·최종 영상 유무·비용). 파일 위치는 Episode 서비스가 쓰는 **같은 경로 헬퍼**로 읽는다 — 경로에 두 번째 의견을 만들지 않는다.
  - 🔴 **`projects` 에 섞지 않고 `episodes` 배열을 따로 둔 것이 이 작업의 핵심 판단이다.** 그 목록을 **게시물 준비 화면도 같이 읽고**, 그 발행 라우트는 단기 프로젝트 id 를 받아 **단기 저장소**를 뒤진다. 회차를 `projects` 에 넣으면 거기서 **고를 수는 있는데 발행이 안 되는 행**이 생긴다 — 이번 주 내내 닫아온 "양쪽 끝은 멀쩡한데 중간이 없다" 그 모양이다.
  - 판단 근거를 한 줄로: **아무도 안 읽는 새 필드는 무해하지만, 모두가 이미 순회하는 배열의 새 행은 감당 못 해도 상속된다.** 회차를 발행 가능하게 만들지는 **별도 결정**으로 열어 뒀다.
  - 준비된 클립 수는 **다른 다섯 곳과 같은 유료 판정**으로 센다. 이걸로 여섯 번째이고, 여기서 틀리면 스텁 배치가 "끝난 배치"로 보고된다 — 사건 때 실제로 그랬다.
  - 읽기는 **회차 단위로 soft fail** 한다. 한 작품의 파일이 깨졌다고 보관함이 통째로 비면 안 된다.
  - 클라이언트 응답 가드는 회차 행을 검사하되 **거절하지는 않는다** — 아직 회차를 모르는 화면이 단기 목록마저 못 보고 오류 배너를 띄우면 안 된다. 화면은 Cowork 몫이고 이건 계약 절반이다.
  - 주입 두 방향 확인: 회차 배열을 빈 것으로 만들면 4개, 유료 판정을 떼면 자리표시자 테스트가 빨갛다.
  - 검증: root typecheck 통과, Backend 1076개(+5 신규)·frontend 1046개 전부 통과, root build 통과.
- [x] **장면 카드에 "이전 판" — 목록·재생·되돌리기 (Cowork Round 300, `69bf055`)**: `745e114` 계약대로 붙었다. 기본 접힘, 이력이 없으면 **아예 안 그린다**, 각 판의 재생기는 `preload="none"` 이라 누른 것만 받는다.
  - 계약에서 굵게 경고한 둘이 지켜졌고 테스트로 고정됐다: ① 목록을 **`isCurrent` 로 거른다**(자리로 읽으면 되돌린 뒤 *이미 쓰는 판*에 되돌리기 버튼이 붙고 진짜 옛 판 하나가 사라진다 — `v001` 이 `isCurrent` 인 뒤집힌 응답으로 고정했다), ② **최종 영상 무효화를 버튼 옆에** 적었다. 되찾는 것(비용·현재 판 보관)과 잃는 것(합친 결과)이 한 문장에 있고, 확인 패널을 거치므로 읽을 자리가 있다.
- [x] **🔴 회수 테스트가 추가된 요청에 세 번째로 깨졌다 — 이번엔 근본을 고쳤다**: 카드가 장면마다 판 목록을 조회하면서 그 뒤의 `mockResolvedValueOnce` 가 전부 한 칸씩 밀렸고, 회수 POST 가 progress 응답을 받아 결과 블록이 안 그려졌다. 3회 연속 동일 — flake 아님.
  - 🟠 **지난번 내 수정이 절반이었다**: *단언*은 경로 이름으로 바꿨는데 *응답*은 여전히 순서대로 내주고 있었다. 그래서 합치기 테스트에서 이미 효과를 보이던 `stubFetchByRoute` 를 `testUtils.ts` 로 올렸다 — `"METHOD /url-suffix"` 키, **가장 긴 일치가 이긴다**, 계획에 없는 요청은 **URL 을 말하며 throw** 한다(남의 응답으로 조용히 답하지 않는다).
  - 라우트별 **순차 응답**(`sequence([...])`)도 넣었다. 그게 순서 mock 이 유일하게 더 잘하던 것이고, 없으면 상태 변화를 폴링하는 테스트는 계속 취약한 방식을 써야 한다.
  - **주입으로 증명**: 마운트 요청을 하나 더 끼우면 **변환한 둘은 초록**이고 아직 순서 기반인 것들만 빨갛다. 그게 이 방식이 작동한다는 증거이자, 그 파일의 나머지도 옮길 값어치가 있다는 근거다.
  - 검증: root typecheck 통과, frontend 1050개·Backend 1076개 전부 통과, root build 통과.
- [x] **영상 보관함에 회차 구역 (Cowork Round 302, `0fc8c34`)**: `1d1b9ce` 계약대로 붙었다. 회차가 없으면 **제목줄도 안 그린다**, 식별자는 `projectId`+`episodeNumber` 를 **따로** 쓴다(합성 문자열을 안 만든 판단이 화면에서도 옳았다 — 쪼개는 코드가 두 번째 의견이 된다), 최종 영상은 `preload="none"` 재생기로, 합치기 전이면 없다고 말한다. 검색이 회차도 건다 — 한 상자 한 질문인데 단기만 걸면 누가 뭔가 치는 순간 회차 구역이 사라진다.
  - **별도 배열 판단이 화면에서 확인됐다**: Cowork 표현으로 *"`projects` 에 섞였으면 아무것도 안 하고도 회차를 발행 가능한 것처럼 띄웠을 것"* 이다. 지금은 그리려면 명시적으로 써야 해서 **게시물 준비에는 안 썼다** — 발행 안 되는 것을 고를 수 있게 두지 않았다.
  - 🟠 **검색 테스트가 한 방향만 걸고 있었다 — 내가 주입해서 발견했다.** 회차 필터를 통째로 빼도 **전부 초록**이었다: 기존 테스트는 *"검색어에 맞는 회차가 살아남는다"* 를 걸고 있는데, **한 번도 안 거르는 화면도 그 단언을 통과한다.** 즉 구역이 안 사라진다는 것만 증명하고 검색이 동작한다는 것은 증명하지 않았다.
  - 빠진 방향을 채웠다 — 아무것도 안 맞는 말을 치면 회차와 그 제목줄이 **같이 사라진다.** 같은 주입을 다시 넣으면 **정확히 새 것만** 빨갛고 기존 것은 초록이다. 둘 다 있어야 하는 이유가 그것이다.
  - 검증: root typecheck 통과, frontend 1055개(+1 신규)·Backend 1076개 전부 통과, root build 통과.
- [x] **🔴 내가 "이미지 보관함은 없다" 고 말한 것이 틀렸다 — 캡틴D가 잡았다 (Round 303)**: 나는 화면을 **내용물**로 분류해 `Asset = 입력 재료` 라고 적었는데, **사람이 보는 그 화면 이름이 "이미지 보관함"** 이다(`App.tsx:276` 메뉴 라벨, `AssetLibraryScreen.tsx:554` 제목). Cowork이 내 문장을 확인 없이 캡틴D에게 옮겼고, 캡틴D가 *"이미지 보관함 전에 만들었었잖아 왜 없어"* 로 바로 잡았다.
  - **교훈은 내 쪽이다: 화면 이름은 코드에서 읽어야 한다.** 내용물로 이름을 추론한 것이 `castRole: "representative"`·`WorkflowState.VideosReview` 를 지어낸 것과 같은 부류다. 정확한 사실은 *"이미지 보관함은 있고, **AI 가 만든 장면 이미지를 모아 보는 자리**가 없다"* 이다.
- [x] **자리표시자 PNG 를 한 정의로 모았다 (`8fcb2d5`)**: 같은 1×1 base64 가 세 서비스에 있었다. 지금은 일치하지만 **클립도 갈라지기 전까지는 일치했고**, 갈라진 뒤 유료 영상 여섯 개가 32바이트 스텁으로 바뀌는 동안 모든 검사가 초록이었다. 만든 이미지 목록을 만들면 진짜 그림과 가짜를 가려야 하므로 `isPlaceholderImage` 를 상수 옆에 같이 뒀다 — 처음 필요한 호출부에서 네 번째로 쓰이지 않도록.
  - 동작 변화 없음(바이트 동일), 스위트 그대로.
- [x] **경로 키 mock 이 상태도 실을 수 있게 했다 — 옵션 1 (Cowork Round 304, `fa28857`)**: 전환 13개 중 하나가 **같은 경로에서 500 → 200** 이라 표현이 안 됐다. `errorRoutes` 는 경로 전체를 실패로 고정하고 `sequence` 는 언제나 200 이라, 그 하나만 체인으로 남아 있었다 — **그리고 예외 하나를 남겨 두는 것이 이 방식이 세 번 무너진 자리다.**
  - `withStatus(status, body)` 를 넣었다. 단독으로도, `sequence` 항목으로도 쓴다. **유료 제출이 거절되고 사람이 다시 눌러 성공하는 건 이 앱에서 실제로 일어나는 일**이고, 그걸 못 쓰는 도구면 다음 사람도 체인으로 돌아간다.
  - 헬퍼에 **자체 테스트**를 달았다. 스캐폴딩이라서 더 필요하다 — 화면 테스트가 *stub 이 엉뚱한 경로에 답해서* 빨간 것과 *화면이 틀려서* 빨간 것은 똑같이 생겼고, 그 둘을 가리느라 세 라운드를 썼다.
  - 🟠 **주입이 그 테스트 중 하나가 무의미하다는 걸 잡았다**: 가장 긴 일치 정렬을 뒤집어도 초록이었다. 키가 `/generations/job` 과 `/generations/job/review` 라 **한 URL 에 하나만 맞으므로 규칙이 아무것도 결정하지 않았다.** 둘 다 맞는 키(`/review` 와 `/generations/job/review`)로 고치니 빨갛다. `/videos/preview` 탐침과 **반대편의 같은 교훈** — 아무것도 안 바꾸는 주입은 아무것도 측정하지 않는다.
  - 검증: root typecheck 통과, frontend 1063개(+8 신규)·Backend 1076개 전부 통과, root build 통과.
- [x] **통짜 mock 넷을 경로 키로 (Cowork Round 305, 10/13, `2ca1c48`)**: 이 넷은 **안 깨지고 있었다** — `mockResolvedValue` 하나가 모든 요청에 답하고 있었으니까. 그래도 옮긴 이유가 증상보다 낫다: **통짜 mock 이 마운트의 현재 작업 조회에 "미리보기 본문" 으로 답하고 있었고**, 그게 통과한 건 응답 가드가 그 모양을 거절해서 조회가 실패로 떨어지고 미리보기로 낙하했기 때문이다. **맞는 화면, 틀린 이유.**
  - 그 설명을 받아들이지 않고 **가드와 대조했다**: `Object.keys(value).length === 1` 을 요구하므로 미리보기 본문은 통과할 수 없다. Cowork 논증이 정확하다.
  - 🟡 Cowork이 **"이번 전환은 주입으로 못 잰다"** 고 스스로 적었다 — 통짜 mock 은 요청이 늘어도 원래 안 깨지므로 "흡수한다" 가 증거가 되지 않는다. 앞선 증거를 빌려 쓰지 않고 그렇게 적은 것이 맞는 판단이다.
  - 🔴 **그래도 재 봤더니 하나 나왔다**: 그 가드의 정확한 키 개수 검사를 느슨하게 해도 **프론트 1063개가 전부 초록**이었다. 그 넷이 기대고 있던 엄격함을 **아무것도 검사하지 않고 있었고**, 그 응답 뒤에 회수 버튼과 검토 카드가 걸려 있다. 서버가 실제로 보내는 두 모양은 받고 **그 밖의 것을 실은 본문은 거절한다**를 핀했다 — 같은 느슨하게 하기가 이제 정확히 그 테스트를 빨갛게 만든다.
  - 검증: root typecheck 통과, frontend 1065개(+2 신규)·Backend 1076개 전부 통과, root build 통과.
- [x] **만든 장면 이미지를 한 목록으로 (캡틴D 승인, `0639df3`)**: 승인 범위는 좁다 — 이미지 보관함 안의 **보기 전용** 구획, 편집·삭제 없음. 근거도 좁혀서 받은 승인이다: 이미지는 검토 화면에서 **이미 보이고**, 없던 건 *"그림이 속한 프로젝트를 기억하지 못한 채 예전 그림을 찾는 방법"* 이다.
  - **파일은 안 옮긴다.** 저장된 프로젝트가 자기 이미지의 **절대 경로**를 들고 있어서, 옮기면 프로젝트가 자기 그림을 못 찾고 디스크에 되돌릴 근거도 안 남는다. 영상 보관함처럼 **있는 것을 열거만** 한다.
  - 행은 **이미 있는 content 라우트**(`imageContent` / `longEpisodeImageContent`)를 가리킨다 — 같은 바이트에 두 번째 주소를 만들지 않는다. 통합 테스트가 그 링크를 **실제로 따라간다**(가정하지 않는다).
  - 자리표시자는 **뺀다**. 이 화면 용도가 "예전 그림 찾기" 라 1×1 흰 점은 찾을 대상이 아니다. `isPlaceholderImage` 를 먼저 한 벌로 모아 둔(`8fcb2d5`) 덕에 네 번째 의견이 안 생겼다.
  - 배열 둘, 영상과 같은 이유 — 단기 이미지와 회차 이미지는 **다른 content 라우트** 뒤에 있어서, 한 배열이면 주소를 못 만드는 행을 소비자에게 넘기게 된다.
  - 🟢 **프론트의 dev-proxy 테스트가 새 최상위 접두사(`/images`)를 즉시 잡았다** — 가드가 제 일을 한 경우다.
  - 🟠 **내 첫 PNG 픽스처가 틀렸다**: 자리표시자 뒤에 바이트를 붙였는데 앱 검증기가 **IEND 뒤의 바이트를 거절한다.** 그게 옳다 — 그건 PNG 가 아니다. 패딩을 IEND **앞의** 보조 청크로 바꿨다.
  - 주입: 자리표시자를 안 거르면 그 테스트가, 회차를 안 읽으면 다른 둘이 빨갛다.
  - 검증: root typecheck 통과, Backend 1081개(+5 신규)·frontend 1065개 전부 통과, root build 통과.
- [x] **이미지 보관함에 "만든 이미지" 구획 (Cowork Round 307, `b2e4c93`)**: `0639df3` 계약대로, 승인 범위대로 **보기 전용**. 78KB 짜리 화면에는 **한 줄만** 넣고 구획은 별도 파일로 뒀다. 접힘 기본, 아무것도 없으면 제목줄조차 안 그리고, **못 읽으면 말한다**(침묵은 "없습니다" 로 읽히는데 그건 다른 문장이고 틀린 문장이다).
  - **화면에 자리표시자 판정 코드가 한 줄도 없다** — 서버가 목록에서 빼기 때문이다. 영상에서 같은 판정이 여섯 곳이 된 것과 정반대고, `isPlaceholderImage` 를 먼저 한 벌로 모은 것이 여기서 값을 했다.
  - mock 전환 **13/13 완료**. 마지막 하나를 `sequence([withStatus(500, ...), ...])` 로 옮겼다 — 그 파일에 순서 체인도 통짜 mock 도 이제 없다.
- [x] **🔴 새 구획의 마운트 요청이 에셋 보관함 테스트 34개와 App 테스트 하나를 깼다 — 같은 재발, 새 파일**: 화면에 구획이 붙으면 마운트에서 조회하고, 그 뒤의 `mockResolvedValueOnce` 가 전부 밀린다. 그 파일은 **체인 응답이 82개**라, 전부 "그리고 이것도" 로 고쳐 쓰면 각 테스트가 무엇을 보는 건지 묻힌다.
  - `answerOutOfBand(routes, fallback)` 를 넣었다 — **그 한 라우트만 자기가 답하고 나머지는 기존 mock 에 그대로 넘긴다.** 각 테스트의 순서는 손대지 않는다.
  - 🟠 **인자를 개수까지 그대로 넘겨야 했다**: `init` 이 없는 호출에 `undefined` 를 명시로 넘겼더니 `toHaveBeenCalledWith("/assets")` 가 2인자 호출과 안 맞아 실패했다. **화면이 한 일이 아니라 테스트가 볼 수 있는 것을 바꾼 것**이라 잘못이다.
  - App 테스트("이미지 보관함은 `/assets` 만 부른다")는 **느슨하게 하지 않고 갱신**했다: 여전히 요청 집합을 **정확히** 이름으로 걸고(`/assets` + `/images/generated`), 원래 지키려던 것(보관함을 여는 것이 provider 라우트를 건드리지 않는다)도 그대로다.
  - 검증: root typecheck 통과, frontend 1070개·Backend 1081개 전부 통과, root build 통과.
- [x] **Episode 상세 매퍼를 한 벌로 (`a9d1b2f`)**: `detail()` 이 다섯 서비스에 **바이트 단위로 같은 사본**으로 있었다. 자리표시자 바이트·상태 목록에 이어 **세 번째**이고, 앞의 둘은 모으기 전에 실제로 갈라졌다(상태 목록은 합쳐진 회차를 다섯 중 셋에서 손상으로 읽게 만들었다). 사본이 다섯이면 **필드를 더할 때 다섯을 찾아야 하고, 넷만 찾은 사람은 어떤 화면에서는 맞고 어떤 화면에서는 틀린 응답을 낸다.** 바로 다음 작업이 필드를 더하는 것이라 먼저 했다. 동작 변화 없음.
- [x] **회차 최종 영상을 인스타그램에 발행한다 (캡틴D 승인, `d2c31d1`)**: 발행 라우트가 단기 프로젝트 id 를 받아 단기 저장소를 뒤지고 있어서 회차는 갈 데가 없었다. 캡틴D는 **CLI 작업이 필요한 건이라는 걸 알고** 승인했다.
  - **Meta 에 닿는 모든 것은 이제 한 메서드**다 — 대상 확인·컨테이너·업로드·처리 대기·발행. 일부러 한 벌이다: **공개되고 되돌릴 수 없는 것으로 끝나는 순서**라, 사본이 둘이면 순서나 대상 확인이 한쪽에서만 틀린 채 쌍둥이 옆에서 멀쩡해 보인다. 대상 확인을 빼면 **단기와 회차 테스트가 둘 다** 빨갛다 — 정말 공유한다는 증거다.
  - 다른 것은 **"이미 발행됨" 을 어느 기록이 말하는가와 파일이 어디 있는가**뿐이다. 회차는 자기 기록을 갖고, 그 기록은 **응답이 아니라 Episode 위에** 있다 — 응답은 그것을 받은 페이지 로드에만 산다. 새로고침 후 발행을 잊은 화면은 다시 하자고 권하게 되고, 이 저장소가 두 번 닫은 그 구멍이 여기서는 훨씬 나쁘게 끝난다.
  - 저장된 기록은 **관대하게 읽는다**: 이 필드가 생기기 전에 쓰인 회차는 그냥 없는 것이고, 반쯤 쓰인 것도 "없음" 이지 아무도 못 찾는 게시물로 보고하지 않는다.
  - 주입: 재발행 가드를 빼면 그 테스트가, 대상 확인을 빼면 양쪽 테스트가 빨갛다.
  - 검증: root typecheck 통과, Backend 1087개(+6 신규)·frontend 1070개 전부 통과, root build 통과.
- [x] **게시물 준비에서 회차를 발행한다 (Cowork Round 309, `4d0166e`)**: 고른 상태를 `kind` 로 갈랐다 — **영상 주소·발행 경로·게시 기록 셋이 전부 다르고**, 뭉갰으면 그중 하나가 조용히 단기 쪽으로 흘렀을 것이며 흘러갈 곳이 하필 "공개되고 되돌릴 수 없는" 쪽이다. 단기 선택 값은 한 글자도 안 움직였다. 고를 수 있는 것과 발행되는 것의 경계는 **양쪽 다 `finalVideoAvailable`** 이라, 화면이 감추는 것과 라우트가 거절하는 것이 같은 조건이다. 회차에 없는 것(캡션 초안·탐색기 열기)은 **없다고 적었다**.
- [x] **🔴 화면이 발행 잠금을 읽는 그 엔드포인트가 잠금을 안 싣고 있었다**: `GET /long-projects/:id/episodes/:n` 는 **여섯 번째 Episode 매퍼**(outline 기반이라 `a9d1b2f` 로 모은 다섯에 안 들어간다)가 만들고, 거기에 `instagramPost` 가 없었다. 발행은 되고 응답도 그렇게 말하는데, **새로고침하면 기록 없는 Episode 를 읽고 다시 발행하자고 권한다.**
  - 프론트 테스트로는 안 보인다 — 그 픽스처가 `instagramPost` 를 직접 넣어 주므로 **화면을 증명하지 서버를 증명하지 않는다.** 그래서 발행한 뒤 **화면이 실제로 부르는 서비스로 되읽는** 백엔드 테스트를 추가했다.
  - 🟠 **그 테스트가 내 고침이 절반이라는 것도 잡았다**: `parseStored` 가 기록을 필드별로 다시 만들어서 **새로 저장한 필드를 나가는 길에 버린다.** 쓴 값을 읽는 쪽이 버리는 것 — 이 저장소의 가장 오래된 실패 모양이다. 그걸 통과시키는 것이 실제로 구멍을 닫았고, 다시 버리게 하면 정확히 그 테스트가 빨갛다.
  - `LongEpisodeDetail.updatedAt` 도 더했다. Cowork이 최종 영상 `?v=` 로 썼는데 **루트 typecheck 가 그 필드가 없다는 걸 잡았다.** 합치기가 완료 시 `updated_at` 을 새로 쓰므로 **선택은 옳았고 필드만 없었다.**
  - 검증: root typecheck 통과, Backend 1088개·frontend 1075개 전부 통과, root build 통과.
- [x] **🟠 캡틴D가 실사용에서 막혔다: 토큰은 있는데 게시 대상 0개 — 진단을 한 단계 늘렸다 (`7207b68`)**: 빈 목록이 **세 원인을 한 문장으로 뭉개고** 있었다 — 페이스북 페이지 없음 / 페이지는 있는데 IG 프로 계정 연결 안 됨 / 토큰 권한 부족. 셋의 고치는 법이 다르고, **세 번째는 페이스북 쪽을 아무리 고쳐도 안 풀린다.**
  - **대부분은 이미 받고 있었다**: 대상 조회가 `/me/accounts` 를 연결 계정까지 함께 물으므로 페이지 수와 연결 수를 읽고 **버리고 있었다.** 권한만 한 번 더 묻는다(`/me/permissions`).
  - **목록이 빌 때만 진단한다.** 잘 되는 계정이 매번 두 번의 추가 호출을 치를 이유가 없다 — 항상 붙이게 만들면 그 테스트가 빨갛다.
  - **양쪽 다 soft fail**. 진단은 도움이지 전제가 아니다. 권한 확인 자체가 안 되면 **"확인 못 했다"** 고 말하지 "빠진 것 없음" 으로 보고하지 않는다 — *"못 봤다"* 와 *"봤는데 괜찮다"* 는 사람을 다른 데로 보낸다. 거절된 권한은 **보유가 아니라 없음**으로 센다(메타가 같은 배열에 다른 상태로 싣는다).
  - **토큰·id·시크릿은 계약을 넘지 않는다.** 개수와 권한 이름이면 셋이 갈린다. 문구는 Cowork 몫.
  - 주입 확인: 거절 권한을 보유로 세면 그 테스트가, 진단을 항상 붙이면 다른 테스트가 빨갛다.
- [x] **회차 제목이 버튼처럼 읽히던 것 (Cowork Round 310)**: `1화 재생` 에서 "재생" 이 **그 회차 제목**인데 재생 버튼으로 읽혔다. 「」로 감쌌다 — 제목은 사용자가 짓는 것이라 다음에 "확인"·"정지"·"삭제" 가 와도 같은 오해가 난다.
- [x] **🔴 진단이 "우리가 요청한 권한" 만 보고 있었다 — 사각지대를 닫았다 (`8130d93`)**: `missingPermissions` 를 **이 앱이 요청하는 네 개**에 대해서만 계산하고 있었다. 제공자가 우리가 **한 번도 요청하지 않은** 권한을 요구하면(`/me/accounts` 에 `business_management` 가 그런 후보다) 그 필드는 **"빠진 것 없음"** 이라고 말하면서 그게 원인 전부다.
  - 진단이 없애려던 **자신 있는 오답**이 한 층 아래에서 그대로 재현된 것이다. 그래서 **토큰이 실제로 가진 권한 전체**를 같이 싣는다 — 없다는 사실이 표현 불가능하지 않고 보이게 된다. 이름만 나가고 값은 안 나간다.
  - 주입: 보유 목록을 다시 우리 넷으로 좁히면 정확히 그 테스트가 빨갛다.
  - 🟡 캡틴D 상황 정리(Cowork Round 311): ①②는 지워졌다 — 페이스북 페이지·IG 프로 연결·앱 검수까지 끝났고 저장된 토큰도 진짜 사용자 토큰이다. 남은 건 ③(토큰/앱 쪽)이고, **서버가 볼 수 있는 것은 권한과 개수까지**다. 앱이 개발 모드인지 라이브인지는 Graph 로 확인할 방법이 없어 **못 본다고 적는다** — 모르는 것을 아는 척하는 문구를 쓰지 않는다.
  - 검증: root typecheck 통과, Backend 1095개(+1 신규)·frontend 1075개 전부 통과, root build 통과.
- [x] **빈 게시 대상 목록이 원인을 말한다 (Cowork Round 312, `74ecdee`)**: 권한을 **맨 앞**에 둔다 — 권한이 빠졌는데 "페이지를 연결하세요" 를 읽은 사람은 그 일을 하고도 아무 변화를 못 본다. **순서가 문구의 일부다.** `permissionsChecked: false` 면 권한 이야기를 아예 안 하고, 깨진 진단은 버리고 예전 한 문장으로 떨어진다(반쯤 읽은 진단은 이 패널이 없애려던 추측이 다시 되는 것이다).
  - 🟢 **붙이자마자 실사용에서 답이 나왔다**: `pageCount: 0`. 페이스북 페이지는 실제로 있으므로, **"페이지가 없다" 가 아니라 "이 토큰이 그 페이지를 못 본다"** 로 뜻이 좁혀졌다. 한 문장이 뭉개던 셋이 한 번에 갈렸다.
- [x] **재로그인 경로 두 가지의 실제 상태를 코드로 확인했다 (Cowork Round 312 질문)**: 추측으로 답하면 *"이미 해둔 것을 다시 하라"* 를 반복하게 되므로 코드와 빌드로 확인했다.
  - **① 데스크톱 로그인 — 끝에서 끝까지 붙어 있다.** `apps/desktop/src/instagram-login-window.ts` → `main.ts:206` 핸들러 등록 → `preload.cjs` → 프론트 `electronBridge.openInstagramLogin` → `InstagramConnectionCard` 가 `canOpenInstagramLogin()` 으로 흐름을 고른다. `npm run build` 통과(exit 0). 즉 `npm run dev`(= build + electron) 로 지금 쓸 수 있다.
  - **② 로컬 인증서 콜백 — 설정으로 열 수 있지만 준비물이 더 많다.** `INSTAGRAM_CALLBACK_TLS_CERT` / `_KEY` (PEM **내용**, 경로 아님) / 선택 `_PORT`(기본 3443), 그리고 메타 앱에 `https://127.0.0.1:3443/settings/instagram/callback` 등록. 반쯤 설정하면 시작 시 실패한다(의도된 것, D-022).
  - **①을 권한다** — 준비물이 없고 이미 빌드된다. ②는 인증서 발급·등록이 추가로 필요하다.
- [x] **재로그인 경로 ②(HTTPS 콜백)의 실제 요구사항을 코드로 확인했다 (캡틴D 제안, Cowork Round 313)**: 캡틴D가 *"백엔드 킬 때 코드 2줄 추가해서 인증서 불러오면 되지 않냐"* 고 제안했다. **방향은 맞지만 코드는 한 줄도 필요 없다** — 이 저장소는 이미 그 길을 갖고 있고, 앱 전체를 HTTPS 로 띄우는 것도 아니다.
  - `main.ts:43` 이 부팅 전에 `resolveCallbackTls(process.env)` 를 읽고, 환경변수가 있으면 `serveCallbackOverTls` 로 **콜백만 두 번째 리스너**에 올린다. HTTP 표면은 그대로다(D-022: 패키징된 앱은 아무것도 설정하지 않아 리스너가 없고 데스크톱 창으로 로그인한다).
  - Cowork이 캡틴D에게 말한 세 가지는 **전부 이 저장소와 어긋난다**: ① `httpsOptions` 로 앱을 띄우는 게 아니다(별도 리스너), ② 등록할 주소는 `localhost` 가 아니라 **`https://127.0.0.1:3443/settings/instagram/callback`** (메타는 정확 일치를 본다), ③ **프론트 프록시는 무관하다** — 메타가 브라우저를 그 포트로 직접 돌려보내지 Vite 를 거치지 않는다.
  - 반쯤 설정하면 **부팅이 멈춘다**(의도된 것). 자체 서명 인증서면 브라우저 경고로 흐름이 깨지므로 로컬 신뢰 인증서가 필요하다는 점만 Cowork 추측이 맞았다.
  - **①(데스크톱)이 여전히 더 짧다** — `apps/desktop` `npm run build` 통과(exit 0), 로그인 흐름이 끝에서 끝까지 연결돼 있고 준비물이 없다.
- [x] **캡틴D 결정: ②(백엔드 HTTPS 콜백)로 간다 — 실행 절차를 확정했다 (Cowork Round 314)**: 데스크톱 앱은 접는다(*"프로그램이 안정될 때까지 백엔드 쓸 거라니까"*). **코드 변경은 여전히 0줄**이다 — `main.ts:43` 이 환경변수를 읽어 콜백만 두 번째 리스너에 올리고, `instagram.module.ts` 가 **같은 `resolveCallbackTls` 로** 로그인 서비스의 콜백 주소를 만든다(주소와 문 여는 곳이 두 군데 합의가 아니라 구성상 하나다, D-022).
  - 🟠 **내가 앞 라운드에 틀리게 적은 것을 정정한다**: `INSTAGRAM_CALLBACK_TLS_CERT`/`_KEY` 는 PEM **내용이 아니라 파일 경로**다(`resolveCallbackTls` 가 그 경로를 `readFileSync` 한다). 내용이라고 적었던 것은 틀렸다 — 윈도우에서 여러 줄 PEM 을 환경변수에 넣으라고 시킬 뻔했다.
  - **프론트에서 바꿀 것은 없다**: 서버가 `callbackLoginAvailable: this.callbackUri !== null` 로 답하고 `InstagramConnectionCard:168` 이 그 값으로 흐름을 고른다. TLS 를 켜면 화면이 저절로 콜백 흐름으로 바뀐다.
  - 등록할 주소는 정확히 `https://127.0.0.1:3443/settings/instagram/callback` — 메타는 정확 일치를 본다.
- [x] **인증서 상태를 이 컴퓨터에서 실제로 확인했다 (Cowork Round 315)**: *"예전 인증서가 남아 있나"* 를 추측 대신 찾아봤다.
  - **mkcert 는 이미 설치돼 있다** (`C:\Users\USER\AppData\Local\Microsoft\WinGet\Links\mkcert.exe`).
  - **루트 CA 도 이미 있고 신뢰 저장소에 들어가 있다** — `mkcert -CAROOT` 에 `rootCA.pem` 이 있고, `Cert:\CurrentUser\Root` 에 `O=mkcert development CA` 가 조회된다. 즉 `mkcert -install` 은 이미 된 상태다.
  - **잎 인증서(127.0.0.1)는 어디에도 없다** — 저장소·사용자 폴더 전부 검색해 `*.pem` 이 CA 두 개뿐이다. 그래서 남은 일은 **한 줄(`mkcert 127.0.0.1`)** 뿐이다.
  - 🟠 **`apps/backend/.env` 는 자동 로드되지 않는다**: `@nestjs/config` 도 `dotenv` 도 의존성에 없고, 그 파일은 `provider-settings.repository.ts` 가 **프로바이더 자격증명 저장소**로 쓰는 파일이다("Local UTF-8 dotenv storage only. It neither reads process.env"). TLS 변수를 거기 적으면 **아무 일도 안 일어난다** — 셸에서 넣어야 한다.
  - 문서(D-020/D-022)는 mkcert 를 개발 경로 한정으로 명시한다 — openssl 자체 서명은 경고로 흐름이 깨져 안 된다.
- [x] **🔴 로그인 화면이 안 뜨고 통과됐다 — `auth_type=rerequest` 가 없었다 (`01e5cfc`)**: HTTPS 콜백까지 다 켜고 새로 로그인했는데도 `pageCount: 0` 이 그대로였다. 캡틴D 말이 결정적이었다 — **"그냥 바로 로그인 됐는데?"**. 동의 화면이 아예 안 떴다는 뜻이고, 페이스북은 **이미 결정된 권한을 다시 묻지 않는다.** 즉 개발 모드 시절의 권한을 그대로 든 **새 토큰**이 발급됐다. 토큰만 새것이고 내용은 그대로다.
  - **성공한 로그인과 구분이 안 된다** — 목록이 비는 순간까지는. 이 앱이 하루를 쓴 고리가 정확히 그것이다.
  - scope 자체는 문제가 아니었다: `pages_show_list` 는 **처음부터 요청하고 있었다**(코드로 확인). 빠진 건 **다시 묻는 것**뿐이었다.
  - 주입: 플래그를 다시 빼면 정확히 그 테스트가 빨갛다.
  - 🟢 절차 검증도 됐다 — 캡틴D가 인증서·URI·환경변수·로그 확인까지 다 통과했고, **프론트 변경 없이 화면이 저절로 콜백 흐름으로 바뀌었다**(`callbackLoginAvailable`).
- [x] **`grantedPermissions` 를 화면에 띄웠고, 그것이 후보를 갈랐다 (Cowork Round 317, `572077a`)**: `permissionsChecked` 가 참일 때만 그린다. 결과: **`pages_show_list` 를 토큰이 실제로 갖고 있는데 `pageCount` 는 0** — 세 라운드를 돌던 권한 가지가 통째로 지워지고, 진단이 일부러 *"여기서는 알 수 없습니다"* 로 라벨해 둔 칸에 도착했다. **"빠진 것" 이 아니라 "가진 것" 을 보여준 설계**가 그 자리를 갈랐다.
- [x] **`business_management` 를 scope 에 넣지 않기로 판단했다 (Cowork Round 317 질문)**: 넣지 않는다 — **아직은.**
  - `pages_show_list` 가 있는데 `/me/accounts` 가 빈 것은 **권한 문제의 모양이 아니다.** 그 권한은 *"나열해도 되는가"* 를 정하고, 무엇이 나열되는가는 **동의 화면에서 페이지를 골랐는가**가 정한다. 지금 증상은 후자와 정확히 같다.
  - scope 를 늘리는 비용이 비대칭이다: **검수 범위가 커지고 캡틴D는 이미 검수를 통과했다.** 승인되지 않은 권한을 요청하면 동의 화면 자체가 실패할 수도 있다. **되돌리기 쉬운 실험이 아니다.**
  - 그리고 ①과 ②는 **scope 를 안 건드리고도 구분된다**: 페이지를 명시적으로 고른 동의를 한 번 통과시키면 `/me/accounts` 가 비어 있지 않게 된다. 거기서도 0이면 그때 ②가 값을 한다.
  - **순서: ① 먼저, ②는 ①이 아닌 게 확인된 뒤.** 값싼 실험이 먼저다.
- [x] **🟢 원인을 찾았고 고쳤다 — 캡틴D 계정이 아니라 우리 코드였다 (`925fe25`)**: 가설을 하나 더 내는 대신 **저장된 토큰으로 메타에 직접 물었다**(읽기 전용·무료, 토큰 값은 출력하지 않음).
```
GET /me              200  강감찬 본인
GET /me/permissions  200  pages_show_list 포함 전부 granted
GET /me/accounts     200  {"data": []}          ← 오류가 아니라 진짜 빈 목록
GET /debug_token          pages_show_list → target 1328208640370353
                          instagram_content_publish → target 17841441335872655
GET /1328208640370353 200 name "Ibad", instagram_business_account @ibad_2012_
```
  - **부여는 처음부터 있었다.** `/me/accounts` 가 메타의 granular 권한에서 그것을 **열거하지 않을 뿐**이고, 이 앱에는 다른 방법이 없었다. 즉 캡틴D는 전부 옳게 했고 **앱이 그 계정이 답할 수 없는 질문을 하고 있었다.**
  - 고침: 목록이 비면 **부여 자체**로 간다 — `debug_token` 의 `granular_scopes.target_ids` 로 페이지 id 를 얻어 하나씩 직접 읽는다. **1차 목록이 있으면 안 부른다**(강제로 부르게 하면 테스트가 빨갛다). 실패는 soft — 두 번째 기회가 새로운 실패 경로가 되면 안 된다.
  - **실제 계정으로 검증했다**(픽스처만이 아니라): 1차 경로는 여전히 0개, 폴백은 `Ibad / @ibad_2012_` 를 돌려준다.
  - 지난 라운드들의 **진단이 이걸 찾을 수 있게 했다** — 권한 가지를 통째로 지우고 상자 하나만 남겼고, 답이 거기 있었다.
- [x] **배경음악만 붙이는 mode 를 만들었다 (캡틴D 요청, Cowork Round 319, `facce80`)**: 세 mode 가 전부 나레이션을 서술하고 있어서 **나레이션 없는 프로젝트가 도달할 수 있는 칸은 무음 하나뿐**이었다. 음악 단독은 금지된 적이 없다 — **말할 단어가 없었다.** `"bgm"` 은 트랙이 필요하고 나레이션은 필요 없다. 나레이션 요구(D-011)는 실제로 목소리를 섞는 두 mode 에 그대로 남는다.
  - **볼륨 기본값을 mode 로 나눴다**: `"bgm"` 은 1, `"narration+bgm"` 은 그대로 0.25. 0.25 는 음악을 목소리 아래 두려는 수인데 목소리가 없으면 그 이유가 사라지고, 그대로 쓰면 **사용자가 올린 음악이 화면에 아무 설명 없이 4분의 1로** 나온다. 둘 다 0.25 로 되돌리면 그 테스트가 빨갛다.
- [x] **회차 병합이 오디오를 받고, 크레딧을 기록한다 (`549aef0`)**: 요청 타입이 **아예 없었다** — 프로젝트 id 와 회차 번호뿐이라 화면에 보낼 곳이 없었다. 단편과 **같은 `MergeAudioSettings`·같은 규칙**을 쓴다. 어휘가 둘이면 틀릴 자리가 둘이다.
  - 🔴 **더 큰 절반은 크레딧이었다**: `LongEpisodeDetail` 에 `usedAudio` 가 없어서 CC BY 음원을 깐 회차는 출처가 **어디에도 안 뜬다** — 값이 비어서가 아니라 **읽을 자리가 없어서**다. 회차 게시는 두 라운드 전에 이미 나갔으므로 **가정이 아니라 실제로 열려 있던 구멍**이었고, D-003 이 막으려던 실패를 장기에서만 다시 연 상태였다.
  - 기록은 **병합 시점에 값으로 복사**한다(단편과 동일) — 게시된 것은 되돌릴 수 없으니 트랙이 나중에 지워져도 크레딧이 남아야 한다. 그 복사를 빼면 정확히 그 테스트가 빨갛다.
  - `narrationAvailable` 은 **선택 필드**다: 회차 자신의 GET 만 디스크를 보고, 회차를 곁들여 싣는 응답들은 **아무도 확인하지 않은 `false`** 를 내지 않기 위해 부재로 둔다.
  - 검증: root typecheck 통과, Backend 1109개(+9 신규)·frontend 1084개 전부 통과, root build 통과.
- [x] **두 병합 화면이 한 벌의 오디오 칸을 쓴다 (Cowork Round 320, `0c8d203`)**: 라디오 넷·잠금 규칙·트랙 선택·출처 문구를 화면마다 복사하지 않고 `mergeAudio.tsx` 로 뺐다. 갈라졌을 때 치르는 값이 **크레딧 없는 게시**라 `UsedAudio` 에 이름을 붙인 것과 같은 이유다. `idPrefix` 로 단편의 기존 id·testid 는 그대로다.
  - 회차 화면이 `usedAudio` 를 **merge 응답만이 아니라 회차 GET 에서도** 읽는다. 응답에서만 읽으면 크레딧이 **방금 병합한 사람에게만** 보이고 **나중에 캡션 쓰는 사람에게는 안 보이는데**, 캡션을 쓰는 건 후자다. 회차는 이미 병합된 상태로 다시 열리는 게 정상 경로라 단편보다 이 구분이 크다.
  - 기존 테스트 하나를 바꿨다: 회차 병합이 body 를 **안 보낸다** 는 단언은, 보낼 게 없어서 그랬던 것이지 없어야 했던 게 아니다. 확인 전에는 POST 가 없다는 쪽은 그대로다.
- [x] **🔴 `narration+bgm` 이 나레이션 없는 프로젝트에도 열려 있었다 — 잠금 조건이 절반이었다**: 그 mode 도 목소리를 섞으므로 **서버가 나레이션 없이는 거절**하는데, 화면 조건이 `option === "narration"` 만 보고 있었다. 즉 **누르면 오류로 돌아오는 선택지**를 띄우고 있었다. 목소리가 필요한 두 mode 를 한 번만 이름 붙여(`needsNarration`) 화면과 서버가 구성상 일치하게 했다. 옛 조건으로 되돌리면 "음악만 병합" 테스트가 정확히 빨갛다.
- [x] **🟢 프로바이더 스캔 가드가 새 주석의 단어에 걸렸다**: `longProjectsApi.ts` 에 들어온 *"local FFmpeg only"* 가 그 파일을 훑는 가드에 잡혔다. **주석을 허용하도록 스캔을 약하게 하면 가드의 이빨이 빠진다** — 문장을 도구 이름 대신 하는 일로 바꿨다. 가드가 제 일을 한 경우다.
- [x] **이어쓰기 메모와 회차 캡션을 무료로 프리필한다 (캡틴D 요청, Cowork Round 321, `09e09cc`)**: 메모 4칸을 **이 회차가 이미 쓰고 승인한 개요 문장**에서 채운다 — 저장된 메모가 있으면 개요를 **아예 안 부른다**(덮어쓰기 방지를 값이 아니라 **요청의 부재**로 증명한다). 회차 캡션도 단편이 늘 갖고 있던 제안을 받는다. `cliffhanger` 는 일부러 뺐다 — 캡션은 영상 위에 붙고 절정을 먼저 적으면 그 영상을 망친다. 해시태그는 비워 둔다(추측이고, 게시 뒤에는 못 되돌린다).
  - 🟢 **mock 함정이 이번엔 실제로 있었고, 들어가기 전에 읽어서 피했다**: 그 테스트 파일은 순서 사슬 + `toHaveBeenCalledTimes(1)` 두 곳이라, 마운트 읽기 하나만 늘려도 **네 번 깨뜨린 그 모양 그대로** 빨개졌을 것이다. `stubFetchByRoute` 로 전환하고 개수 단언을 **"쓰기가 없다"** 로 바꿨다 — 마운트 읽기는 늘 수 있지만 저장 전에 쓰기가 없다는 건 안 변하고, 원래 그 단언이 지키려던 것도 그쪽이다.
- [x] **🔴 이어쓰기 메모 13칸 중 9칸을 읽는 코드가 없다 — 확인했다 (Cowork Round 321 질문)**: grep 으로 대조했다. `appearedCharacterIds`·`appearedLocationIds`·`revealedSecretIds`·`resolvedForeshadowingIds` 가 나오는 곳은 **저장(`stored`)·복원(`fromStored`)·화면·클라이언트 가드뿐**이고 **소비자가 없다.** 다음 화 프롬프트로 가는 것은 `continuityContext()` 의 넷(요약·있었던 일·캐릭터 변화·다음에 할 일)이다.
  - 비밀·복선은 **메모가 아니라 Story Bible 이 결정한다**(`episode-context-builder.ts` 가 `status` 와 `reveal_available_episode` 를 읽는다). 메모의 "밝혀진 비밀 ID" 를 채워도 다음 화 프롬프트는 안 달라진다.
  - 게다가 `LongStoryBibleCollection` 은 `"secrets" | "foreshadowing"` 뿐이라 **캐릭터·장소 컬렉션이 없다** — "등장한 캐릭터 ID" 칸이 가리키는 목록이 존재하지 않는다.
  - **Cowork이 "고를 목록이 없는 칸을 체크박스로 바꾸기" 를 멈추고 확인을 받은 것이 옳다** — 만들었으면 아무것도 안 가리키는 UI 가 됐다. 다음 라운드에서 4칸을 위로, 9칸을 접어서 *"저장은 되지만 다음 화 대본에는 안 들어갑니다"* 로 두기로 한다.
- [x] **이어쓰기 메모가 어느 칸이 다음 화로 넘어가는지 화면으로 말한다 (Cowork Round 322, `b04cf88`)**: 열여섯 칸이 전부 똑같이 생겨서 **빈 칸 하나하나가 안 끝낸 일처럼 보였고, 그래서 전부 비어 있었다.** 넘어가는 넷(요약·있었던 일·다음에 할 일·달라진 캐릭터)을 위로, 나머지 열둘을 *"저장은 되지만 다음 화 대본에는 들어가지 않습니다"* 접이식으로 내렸다. **지우지 않았다** — 재배치지 삭제이면 이미 적어 둔 회차의 기록이 사라진다.
  - 🔴 **9가 아니라 12였다**: `itemChanges` 도 `continuityContext()` 가 안 넘긴다(`character_changes` 만 넘긴다). 그런데 화면에서 그 둘이 **"캐릭터·물건" 한 상자**로 묶여 있어서, 넘어가는 것과 안 넘어가는 것이 한 덩어리로 보였다. `timeElapsed`·`userEdits` 도 셈에서 빠져 있었다. **접기 전에 세어 본 덕에 경계가 실제 코드와 맞았다** — 앞 라운드의 9 로 접었으면 세 칸이 틀린 쪽에 앉는다.
  - 접힌 쪽에 **"그럼 어디서 바꾸냐"** 의 답을 한 줄 붙였다: 비밀·복선은 설정집에서 고쳐야 하고 다음 화 대본은 설정집의 `status` 와 `reveal_available_episode` 를 읽는다. 답 없는 안내는 칸을 고장 난 것처럼 보이게 한다.
  - 테스트가 **presence 가 아니라 containment 로** 단언한다 — 전부 담은 상자도, 텅 빈 상자도 presence 는 통과한다. 주입으로 확인했다: `worldChanges` 를 넘어가는 쪽으로 옮기면 정확히 그 테스트가 빨갛고, 되돌리면 초록이다.
  - 프리필 안내문도 같이 고쳤다: `newConflicts` 가 접힌 쪽으로 갔는데 문구는 여전히 "아래 네 칸" 이라 **안 보이는 칸을 채워 놓고 네 칸이라고 말하는** 상태였다.
- [x] **🔴 화면이 방금 보여준 계정을 발행이 모른다고 했다 — 목록을 부르는 곳이 둘이었다 (Cowork Round 323, `84ba1d8`)**: granular 폴백(`925fe25`)을 **목록 쪽에만** 넣었다. 발행 직전의 D-006 확인(`sendToInstagram`)은 폴백 없는 `listInstagramPublishTargets` 를 그대로 불렀고, 캡틴D 토큰의 `/me/accounts` 는 여전히 `{"data": []}` 라 **`some()` 이 false → `INSTAGRAM_TARGET_NOT_FOUND`**. 즉 **고른 계정이 화면에는 있고 발행에는 없었다.** 단편·회차 둘 다 같은 함수를 쓰므로 게시 전체가 막혀 있었다.
  - **그 함수 위 주석이 이 실패를 예고하고 있었다**: *"a second copy of it is a second place for the … **target check** to be got wrong — while looking correct beside its twin."* 두 호출자가 **같은 어댑터 함수**를 부르고 있어서 나란히 놓고 봐도 똑같아 보였다. 같은 질문을 두 번 물어봐야만 드러난다.
  - **발행 쪽에 폴백을 한 벌 더 붙이지 않았다** — 그건 세 번째 사본이다. `resolveInstagramPublishTargets()` 한 함수로 내리고 **두 호출자가 같은 것을 부르게** 했다. `grantedTargets` 도 서비스에서 그리로 옮겼다(여전히 실패는 소프트).
  - 주입 두 개로 확인했다: 폴백 자체를 빼면 **목록·발행 두 테스트가 같이** 빨갛고, **발행만** 원래대로 raw 목록에 되돌리면 **발행 테스트만** 빨갛다 — 후자가 이번에 실제로 있던 상태다. 그리고 없는 계정은 폴백이 있어도 여전히 거절한다(폴백은 도달 범위를 넓히지 확인을 끄지 않는다, D-006).
  - 프론트 문구는 안 건드렸다. `INSTAGRAM_TARGET_NOT_FOUND` → *"계정을 다시 골라 주세요"* 는 **진짜 취소된 경우에는 옳은 문장**이다. 틀린 것은 문장이 아니라 그 코드가 나온다는 사실이었고, 문구를 고쳤으면 버그를 덮었을 것이다.
- [x] **🔴🔴 캡션이 디스크까지만 가고 메타로 안 갔다 — 릴스가 실제로 캡션 없이 올라갔다 (Cowork Round 324, `2cfafb5`)**: `sendToInstagram()` 시그니처에 캡션이 **아예 없었다.** 릴스의 캡션은 **컨테이너를 예약할 때만** 실을 수 있고(`media_publish` 는 `creation_id` 만 받는다) 그 몸통은 `{ media_type, upload_type }` 뿐이었다. 요청·길이검사·`instagram_post.caption` 저장까지 전부 옳았고, **마지막 한 칸에서 끊겼다.**
  - 🔴 **캡션보다 무거운 것 셋이 같이 사라졌다**: CC BY 출처 문구(화면이 *"자동으로 들어갑니다"* 라고 약속한다), AI 생성 고지(기본 켜짐), 해시태그. D-003 이 막으려던 것이 정확히 *"라이선스가 요구하는 크레딧 없이 게시"* 인데, **경로가 열려 있었다.** 캡틴D가 음원을 안 써서 이번엔 피해가 없었을 뿐이다.
  - 🔴 **기록이 확인되지 않은 주장을 하고 있었다**: `instagram_post.caption` 은 저장되므로 앱은 *"이 게시물의 캡션은 이것"* 이라고 말하는데 실제 게시물에는 없었다. `LongEpisodeInstagramPost.caption` 은 그 주장을 계약으로 내보내기까지 한다.
  - **왜 안 잡혔나 — 테스트가 부재를 고정하고 있었다**: 캡션이 *저장되는지* 는 두 곳이 보고 *전송되는지* 는 아무도 안 봤다. 게다가 어댑터 테스트의 `toEqual({ media_type, upload_type })` 은 **캡션을 넣으면 빨개지는** 상태였다 — 정확한 단언이 **캡션 없는 몸통을 정확히** 고정하고 있었다(D-023 의 변종: 초록인데 지키는 게 반대쪽이다).
  - **`caption` 을 선택 인자가 아니라 필수 위치 인자로 만들었다.** 선택이면 다음 호출자가 같은 누락을 조용히 반복할 수 있다. 이제 안 넘기면 컴파일이 안 된다. 빈 캡션이면 필드 자체를 안 보낸다(빈 문자열을 보내지 않는다).
  - 주입: 서비스에서 캡션을 `""` 로 바꾸면 **단편·회차 두 테스트가** 빨갛다. 어댑터 단위 테스트만으로는 이 구멍을 못 잡는다 — 끊긴 곳이 어댑터가 아니라 **서비스와 어댑터 사이**였기 때문이다.
- [x] **🟠 없는 가드를 주석이 약속하고 있었다 (같은 커밋)**: `waitUntilPublishable()` 의 `PUBLISHED` 분기가 *"publishing again is refused below"* 라고 적고 **그냥 return** 했다 — below 에 거절이 없었다. **되돌릴 수 없는 동작 하나뿐인 경로에서, 주석은 독자가 코드 대신 읽는 것**이다. 가드를 진짜로 만들었다(거절). 성공이 아니라 거절인 이유는 **이미 게시된 컨테이너에는 기록할 media id 가 없고**, 이름 못 대는 게시물을 기록하면 화면이 읽는 자리에 지어낸 값이 앉기 때문이다.
- [x] **올리기 전 확인이 계획값이 아니라 영상 파일을 잰다 (Cowork Round 324, `93f2d9c`)**: 주석은 *"파일이 이 컴퓨터에 있는 동안 확인한다"* 인데 실제로는 `project.aspectRatio` 와 `settings.durationSeconds` 를 읽고 있었다 — **장면이 빠지거나 클립이 길어진 병합 결과를 계획한 숫자로 "한도 안" 이라고 보고**했다. `preload="metadata"` + `onLoadedMetadata` 로 실제 파일을 재고, 못 재면 계획값으로 떨어지되 **어느 쪽인지 화면이 말한다.** `duration` 이 Infinity/NaN 이면 **"못 쟀다"** 지 0초가 아니다 — 실제 영상 밑의 0:00 칩은 확신에 찬 오답이다.
- [x] **게시 기록을 지우면 같은 영상을 다시 올릴 수 있다 (캡틴D 요청, Cowork Round 325, `057d00d`)**: `instagram_post` 가 두 번째 게시를 영원히 막고 있었고, **영상을 다시 만든 순간부터는 그게 틀린 잠금**인데 푸는 문이 없었다. `DELETE /projects/:id/instagram/post` 와 회차판을 만들었다. **메타는 건드리지 않는다** — 이 앱은 남의 계정 게시물을 지우지 않고, 지울 수 있다고 믿게 해서도 안 된다.
  - **이름을 `republish` 로 안 지었다**(Cowork 판단 ①). 대체가 아니라 **기록 삭제**이고, 라우트 이름이 다음 사람에게 "메타에서 바뀐다" 고 읽히면 안 된다. `DELETE` + `post`(기록) 이다.
  - **보관함의 "주제를 그대로 입력" 관례를 따르지 않았다**(판단 ②의 변형). 그 관례는 *파괴적이라서* 확인받는 것인데, 여기서 물어야 하는 이유는 **앱이 확인할 수 없어서**다 — 인스타그램에서 지웠는지 앱은 볼 방법이 없다. 게다가 화면이 주제를 이미 갖고 있어 자동으로 채워 보낼 수 있으니, 그 관례를 쓰면 **항상 통과하는 검사**가 된다(D-023). 그래서 게시 요청의 `approved: true` 를 뒤집은 `{ acknowledged: true }` 하나만 받는다 — 승인이 아니라 **결과를 가르는 사실 하나에 대한 답**이다.
  - 🔴 **지운 기록을 버리지 않는다**(판단 ③ 채택): `previous_instagram_posts` 에 밀어 넣는다. *"지웠다"* 고 답하고 실제로 안 지웠으면, 그냥 비울 경우 **밖에 게시물이 남아 있다는 사실 자체가 사라진다.** 이 앱이 되돌릴 수도 다시 확인할 수도 없는 동작에 대해 갖는 유일한 기억이다.
  - **저장만 하지 않고 API 로 내보낸다**(`previousInstagramPosts`). 방금 두 라운드에 걸쳐 지운 것이 **읽는 사람 없는 저장 칸**이었다. 읽히지 않는 기록은 조용히 틀리기 시작한다.
  - 잠금은 게시와 **같은 락**을 잡는다 — 게시가 기록을 쓰는 중에 이게 끼어들 수 없다. 없는 기록을 지우면 성공이 아니라 `INSTAGRAM_POST_NOT_RECORDED` 다: *"지울 게 없어서 아무 일도 안 났다"* 와 *"기록을 지웠다"* 는 결과는 같아도 **곧 두 번째 게시를 누를 사람에게는 다른 말**이다.
  - 주입 셋으로 확인했다: 이력 push 를 빼면 2건 빨강 / `acknowledged` 검사를 끄면 1건 빨강 / 되돌리면 초록.
- [x] **게시 잠금을 푸는 문이 화면에 붙었다 (Cowork Round 326, `c1b14fb`)**: 2단계 확인이고, 두 번째 단계가 묻는 것은 결심이 아니라 **결과를 가르는 사실 하나** — 인스타그램에서 지웠는지. 잠금은 **서버 응답의 갱신된 기록으로** 풀린다(로컬 플래그가 아니다). `INSTAGRAM_POST_NOT_RECORDED` 를 `SAFE_ERRORS` 에 채웠다 — 안 채우면 *"요청을 처리하지 못했습니다"* 로 떨어져서, 서버가 성공과 구분해 둔 그 사실이 **화면에서 사라진다.**
  - **단편에도 이력이 있다** (Cowork Round 326 🟠 는 오독이다): `previousInstagramPosts` 는 `domain.ts` 의 Project 에도 `057d00d` 에서 같이 들어갔고, 매퍼가 싣고, 단편 테스트가 그 값을 단언한다(`keeps the post it forgot`). 확인창의 *"지운 뒤에도 이 앱은 그 게시물을 기억합니다"* 는 **단편·회차 양쪽에서 참이다.** 문장을 가를 필요가 없다.
- [x] **🔴 회차 게시가 라이선스 출처 없이 나가고 있었다 (Cowork Round 327, `429aa88`)**: 게시 화면이 `project?.usedAudio` 만 읽었다. 회차는 `usedAudio` 를 오늘부터 갖고 있고 회차 병합 화면은 이미 읽는데, **캡션을 쓰는 화면만 안 읽었다** — CC BY 음원을 깐 회차는 출처 없이 올라가고 `creditMissing` 도 안 걸려 버튼도 안 막혔다. D-003 이 장기에서만 열려 있었다.
  - **아무도 못 잡은 구조적 이유: `InstagramPostScreen.test.tsx` 에 회차 픽스처가 하나도 없었다.** 회차 분기 전체가 무검증이었다. 픽스처가 들어왔으니 이제 이 파일이 두 종류를 같이 본다. 주입: `project?.usedAudio` 로 되돌리면 두 테스트가 빨갛다.
  - 내가 고친 것: 새 테스트 둘의 선택 값이 `episode:long:1` 이었는데 화면의 형식은 **`episode:<projectId>|<n>`** 이라(파이프) 선택 자체가 안 됐다 — `post-checks` 를 못 찾는 실패였다. 값을 맞추자 45개 전부 통과.
  - `:293` 주석의 *"An Episode carries no saved draft and no audio credit — those are short-project features"* 도 같이 고쳤다. **그 문장이 참이던 시절에 쓰였고 지금은 거짓이며, 다음 사람이 코드 대신 그것을 읽는다.**
- [x] **단편의 게시 기록이 뭘 올렸는지 말하지 못했다 (`09aa90c`)**: `caption` 은 첫 게시부터 디스크에 저장됐지만 **API 로 안 나갔다** — 회차 기록은 처음부터 싣고 있었는데. 캡션은 **출처 문구와 AI 고지가 사는 곳**이라, *"이 게시물이 뭐라고 나갔나"* 는 정확히 그게 중요해지는 순간에 묻는 질문이다. `previousInstagramPosts` 도 같이 캡션을 싣는다.
  - **여기서도 정확한 단언 하나가 캡션 없는 모양을 지키고 있었다**: `toEqual({ mediaId, igUserId, publishedAt })`. 어댑터 몸통에서 캡션을 붙잡아 두던 것과 같은 모양이고, 이번 주에 두 번째다.
- [x] **회차가 자기 화면비를 말한다 — 세 화면이 각자 추측하던 것 (Cowork 목록 13·14, `486f050`)**: `LongEpisodeDetail.aspectRatio` 를 회차 자신의 GET 이 프로젝트에서 읽어 채운다. 12번(*"화면비를 바꾸면 만든 이미지가 전부 어긋난다"*)이 이 위에 서기 때문에 먼저 했다 — **추측 위에 경고를 올리면 경고가 추측이 된다.**
  - `narrationAvailable` 과 같은 규칙으로 **선택 필드**다: 회차 자신의 GET 만 채우고, 회차를 곁들여 싣는 응답은 **안 본 값을 주장하지 않는다.**
  - **소프트 실패**: 옆의 `project.json` 을 못 읽으면 화면비만 빠지고 회차는 그대로 답한다. **표시용 필드 하나 때문에 멀쩡히 읽히는 회차를 통째로 잃는 게 더 나쁜 답**이다.
  - 14번도 같이: `errors` 와 `finalVideoPath` — **둘 다 이미 디스크에 있었고 밖으로 안 나왔다.** 실패한 회차가 실패했다는 것만 말하고 이유를 못 말했다. 빈 배열이 아니라 **부재**로 둔다 — 모든 회차에 `errors: []` 를 붙이면 *"확인했고 괜찮다"* 는, 안 써진 필드보다 큰 주장이 된다.
  - 🔴 **`parseStored` 가 또 새 필드를 버렸다**: 이 저장소에서 세 번째다(`instagram_post` 때와 같은 자리). 명명된 필드만 새 객체로 옮겨 담는 모양이라 **필드를 추가할 때마다 두 곳을 고쳐야 하고, 한 곳만 고치면 응답이 조용히 비어서 나간다.** 이번엔 테스트가 먼저 빨개져서 잡혔다.
  - 주입: 세 필드를 다 빼면 2건 빨강, 되돌리면 16건 초록.
- [x] **게시 화면이 전에 뭐가 나갔는지 말한다 (Cowork Round 328, `8b43048`)**: `previousInstagramPosts` 를 **`published` 분기 바깥, 게시 버튼 위에** 뒀다. 이력이 가장 중요해지는 상태는 `published` 가 **사라진 뒤**다 — 기록을 막 지웠고, 버튼이 다시 살아 있고, **한 번 누르면 아직 살아 있을지 모르는 것의 복사본이 하나 더 생기는** 그 순간. `published` 안에 뒀으면 정확히 그 순간에 안 보인다.
  - 캡션도 같이 보여준다(17번을 넣은 이유 그대로: 출처 문구와 AI 고지가 사는 곳이다). 비어 있으면 **"캡션 없이 올라갔습니다"** 라고 적는다 — 빈 줄로 넘기면 오늘 실제로 일어난 일이 기록에서는 아무 일도 아닌 게 된다.
  - **잠금이 아니라 경고**라는 것을 테스트가 단언한다(이력이 떠도 게시 버튼은 살아 있다). 주입으로 확인: 그 블록을 숨기면 2건 빨강, 되돌리면 47건 초록.
  - 하네스가 `caption` 필수화로 픽스처 다섯을 잡았다 — **계약이 조여진 것을 타입이 먼저 알려준 첫 사례**다.
- [x] **회차 영상 검토가 "대본이 지나간 클립" 을 이름으로 말한다 (Cowork 목록 9의 영상 절반, `316b7a8`)**: 장면을 고쳐도 이미 **결제한 클립**에는 아무 신호가 없었다 — 검토 화면에서 승인된 채 최신처럼 보이고, 병합된 회차를 볼 때까지 모른다. 단편의 `scene-staleness.ts` 와 **같은 방법**이다: 지금의 장면으로 프롬프트를 다시 만들어 **생성 당시 기록된 프롬프트와 비교**한다. 저장된 플래그가 아니다 — 플래그는 장면을 바꾼 사람이 지워야 하고, 그건 언젠가 잊는다.
  - 장면 N-1 을 고치면 **N 이 목록에 뜬다**(`promptFor` 가 이전 장면의 연결 단서를 읽는다). 전파 코드 없이 재계산에서 떨어진다 — 단편과 같다. 테스트가 그 경우를 따로 건다.
  - 🟠 **영상만 낸다. `imageStale` 을 빈 배열로 같이 내지 않았다**: 회차 이미지 생성은 **프롬프트를 어디에도 기록하지 않는다.** 계산한 목록 옆에 아무도 계산하지 않은 빈 목록을 놓으면 **화면이 그 빈 값을 믿게 된다** — `errors: []` 를 부재로 둔 것과 같은 이유다. 이미지 경로가 프롬프트를 기록하기 시작하면 그때 필드를 더한다.
  - 재생성한 장면은 **가장 최근 기록**으로 판단한다. 그리고 프롬프트를 아예 다시 만들 수 없는 장면은 목록에서 뺀다 — 그건 **망가진 대본이지 낡은 클립이 아니고**, 여기 올리면 재생성으로 못 고칠 문제에 사람을 결제하러 보낸다.
  - 주입: 비교를 끄면 2건 빨강, 되돌리면 13건 초록.
- [x] **회차 이미지 검토도 "대본이 지나간 이미지" 를 말한다 — 9번 나머지 절반 (`a44ae75`)**: 어제 못 낸 이유가 **비교할 대상이 없어서**였으므로, 먼저 **생성 시점에 프롬프트를 기록**하게 했다(`generated_image_reviews.json` 의 각 장면 행). 그 다음 `GetLongEpisodeImageReviewResponse.staleness.imageStale` 을 붙였다.
  - **프로바이더가 실제로 만든 것에만 기록한다.** 자리표시자 PNG 는 아무것도 기록하지 않고, 따라서 낡았다고 보고되지도 않는다 — 만든 적이 없으니 뒤처질 것도 없다. 이 변경 이전에 만든 이미지도 기록이 없어 목록에 안 뜬다. **그래서 이 목록은 "이것들은 낡은 게 확인됐다" 이지 "나머지는 최신이다" 가 아니다.**
  - 🔴 **`approve` 가 기록을 지울 뻔했다**: 승인은 저장 레코드를 **처음부터 새로 만들어** 명명된 필드만 옮겨 담는다 — `parseStored` 와 **같은 모양이고 이번 주 네 번째다.** 안 옮겼으면 **이 화면에서 사람이 하는 유일한 행동이 낡음의 기준을 지워서, 낡은 이미지를 최신으로 보이게** 만들었다. 그 경우를 테스트가 따로 건다.
  - 주입: 기록을 안 남기면 2건 빨강 / `approve` 의 이월만 빼면 1건 빨강 / 되돌리면 9건 초록.
- [x] **회차 보관함 카드가 출처 문구를 싣는다 — Cowork 목록 2번 (`aad2cba`)**: 단편 카드는 이 두 칸을 처음부터 갖고 있었고 **이유가 "나중에 다시 와서 게시하는 사람이 크레딧을 쓴다"** 였는데, CC BY 음원을 쓴 회차 카드만 아무 말도 안 했다. 회차는 병합 화면부터 `usedAudio` 를 갖고 있었고 **이 행만 못 받고 있었다.**
  - **없으면 `false` 가 아니라 부재로 둔다**: *"음원을 안 썼다"* 와 *"안 봤다"* 가 같게 읽히면 안 되고, **크레딧이 필요 없다고 단언하는 카드**가 이 필드가 막으려는 실패를 정확히 일으킬 수 있는 유일한 길이다.
  - 주입: 두 칸을 빼면 1건 빨강, 되돌리면 32건 초록.
- [x] **회차 병합 화면 테스트의 stub 이 계약보다 적게 답하고 있었다 (같은 커밋)**: Cowork 이 `staleness` 를 필수로 보는 가드를 클라이언트에 붙이자 그 stub 들이 malformed 로 떨어졌다. **stub 이 서버보다 적게 답하면 진짜 응답이 잘못된 응답이 된다** — 가드를 약하게 하는 대신 stub 을 계약에 맞췄다.
- [x] **낡은 클립이 검토 화면에 표시되고, 화면비 추측이 사라졌다 (Cowork Round 329, `6edfff0`)**: 단편의 `StaleBadge` 를 `kind="video"` 그대로 쓴다 — **한 사실에는 한 문구**. 확정 버튼은 그대로 살아 있다(경고지 잠금이 아니다). `approve` 응답에도 staleness 가 실리므로 **확정할 때마다 갱신**한다 — 장면 2를 확정한 뒤 3의 배지가 예전 상태로 남으면 그게 "읽히지 않는 기록" 이다.
  - 🟠 **계약은 필수인데 클라이언트 가드가 `staleness` 를 안 보고 있었다**: 그대로면 없는 응답이 통과해서 **아무 배지도 안 뜨는 채로 조용히 지나간다** — 낡은 클립을 낡지 않았다고 말하는 화면. 가드에 넣었고, 픽스처 여섯이 그래서 깨져 같이 채웠다.
  - 화면비(13번): `useState("9:16")` 를 지우고 **회차 GET → 프로젝트 설정 → 없으면 그대로** 순서로 바꿨다. `ref` 를 둔 이유가 정확하다 — **설정이 늦게 도착해 회차 값을 덮어쓰면, 추측을 지우려던 변경이 추측을 되살린다.**
  - 내가 고친 것: 새 테스트가 `GET /videos/generations/job`(진행 상황)을 안 답해서, 검토를 아예 안 부르고 배지를 못 찾았다. 리뷰는 **job 이 succeeded 를 보고한 뒤에만** 불린다. 주입으로 확인: `staleSceneNumbers` 를 빈 배열로 두면 그 테스트만 빨갛다.
- [x] **회차를 다시 병합해도 이전 컷이 남는다 — Cowork 목록 4번 (`a46568b`)**: 재병합이 완성된 영상을 **제자리에서 덮어썼다.** 이전 컷은 누군가 이미 보고, 승인하고, 게시 직전까지 갔을 수도 있는 것인데 **그냥 사라졌다.** 보관 비용은 로컬 파일 복사 하나다.
  - `"final"` 을 **버전 경로의 target 으로** 넣었다(단편 영상 보관함과 같은 단어). 중요한 규칙 — 덮어쓰기 전에 보관, 최신 순 나열, 복구는 무료이고 그 자체로 되돌릴 수 있음 — 이 전부 같은 규칙이라, 두 번째 구현은 **결제한 파일이 사본 없이 사라질 자리를 하나 더 만드는 일**이다. 이름도 `instagram_reel_v{NNN}.mp4` 로 단편과 같게 뒀다 — 세 번째 명명 규칙은 **아무것도 못 읽는 곳에 사본을 쌓는 것**이고, 그건 이번 주에 회차 장면 클립에서 이미 한 번 있었다.
  - 🔴 **장면 복구와 최종 영상 복구는 반대다**: 장면을 되돌리면 최종 영상을 **비운다**(그 병합이 더 이상 맞지 않는 클립으로 만들어졌으니). 최종 영상을 되돌리면 **그게 곧 병합이므로** 회차는 `completed` 로 남고 경로가 그 컷을 가리킨다. 같게 처리했으면 **방금 고른 컷을 버리는** 동작이 됐다. 되돌리면 정확히 그 테스트가 빨갛다.
  - 보관은 **best-effort** 다: 사본을 못 남기는 것은 나쁘지만, **사본 실패 때문에 사람이 기다리던 병합을 잃는 것이 더 나쁘다.** 첫 병합은 지킬 이전 컷이 없으므로 아무것도 안 만든다(그것도 단언한다).
  - 주입: 재병합 보관을 빼면 1건 빨강 / 최종 복구를 장면 복구와 같게 만들면 1건 빨강 / 되돌리면 28건 초록.
- [x] **낡은 이미지도 검토 화면에 표시된다 (Cowork Round 330, `6846a8c`)**: `StaleBadge` 를 `kind="image"` 로 그대로 쓴다 — 단편·회차·이미지·영상이 **한 배지, 한 문장**. `approve`·`regenerate` 응답의 값을 **응답에서 다시 읽는다**(옛 state 유지가 아니라): 3번을 확정한 뒤 4번 배지가 한 요청 전 상태로 남으면 그게 곧 "읽히지 않는 기록" 이다.
  - 테스트가 **"안 뜨는 것" 을 같이 단언**한다 — 뜨는 것만 보면 전부에 뜨는 배지도 통과한다.
  - 🟠 **스텁이 서버보다 적게 답한 자리가 이번 주에만 세 곳**: `LongEpisodeVideoMergeScreen`(4) → `LongEpisodeImageGenerationScreen`(15) → `longProjectsApi.test.ts`(3, 내가 고침). **가드를 새로 붙일 때 그 응답을 흉내 내는 모든 스텁이 그 변경의 실제 비용**이고, 셋 다 가드를 약하게 하는 대신 스텁을 계약에 맞춰 닫았다.
  - 주입: `staleSceneNumbers` 를 빈 배열로 두면 그 테스트만 빨갛다.
- [x] **장기 프로젝트 설정이 화면비 잠금을 말한다 — Cowork 목록 12번 (`8450597`)**: `GetLongProjectSettingsResponse` 에 `aspectRatioChangeable` 과 **잠근 회차 번호**를 실었다. 서버가 저장에서 이미 거절하고 있었는데 **화면에는 그 사실이 안 나갔다.**
  - **`sceneCountChangeable` 은 안 만들었다 (Cowork 요청과 다름, 이유 있음)**: 장기의 `sceneCount`·`clipDurationSeconds` 는 **새 회차가 시작할 기본값**이고 회차마다 자기 사본을 갖는다 — 잠금은 회차 자신의 설정(`changeable`)에 이미 있다. 이 응답의 `sceneCountChangeable` 은 **언제나 `true`** 일 수밖에 없고, **늘 참인 플래그는 화면이 곧 안 읽게 되는 플래그**다.
  - **잠근 회차 번호를 같이 보낸다**: 맨 `false` 는 *"이제 못 바꿉니다"* 까지만 말하고 **"왜 지금?"** 을 남긴다. 답은 회차 하나이고, 거절 에러가 이미 그 번호를 알고 있었다.
  - **저장과 GET 이 같은 함수를 쓴다**(`episodeThatLocksAspectRatio`). 규칙이 두 벌이면 결제한 작업에 대해 사람에게 **다른 답 두 개**를 주게 되고, 한 번만 갈라져도 늦다.
  - GET 은 **소프트 실패**한다: outline 목록을 못 읽으면 *"안 잠김"* 으로 답한다. 읽기 실패에 *"잠김"* 이라고 답하면 **아직 바꿔도 되는 설정을 빼앗는다.** 저장은 자기 읽기로 여전히 거절한다.
  - 주입: 잠금 조회를 항상 `undefined` 로 만들면 1건 빨강, 되돌리면 15건 초록.
- [x] **회차 재생성이 "무엇을 바꿀지" 를 말할 수 있다 — Cowork 목록 5·6번 (`d03671a`)**: 회차 이미지·영상 재생성은 **승인 말고 실을 게 없었다** — 마음에 안 든 사람은 **같은 프롬프트를 다시 사고 기대하는 것**밖에 못 했다. 단편 이미지 검토와 **회차 나레이션**은 둘 다 이미 지시를 받고 있었으니, 여기만 빠져 있었다.
  - 🔴 **낡음 판정과 충돌할 뻔했다**: 지시가 붙은 프롬프트를 그대로 기록하면 그 장면은 **영원히 "대본보다 뒤처짐"** 으로 뜬다 — 그러면 낡음은 대본이 아니라 **지시를 재고 있는 것**이 된다. 이미지는 **평범한 장면 프롬프트를 기록**하고(단편도 같은 자리에서 정본 프롬프트를 기록한다), 영상은 **`base_prompt` 를 따로 남긴다** — 영상 기록의 `prompt` 는 실제로 보낸 텍스트여야 하고(그걸로 재제출이 재현된다) 낡음은 `base_prompt ?? prompt` 를 본다.
  - 승인 검증과 재생성 검증을 **나눴다**: 승인이 조용히 지시를 받아들이면 **무료 경로에 유료 필드**가 생긴다.
  - 주입: 이미지·영상 양쪽에서 지시 적용을 빼면 2건 빨강, 되돌리면 27건 초록.
- [x] **단편도 결제한 클립을 다시 받아올 수 있다 — Cowork 목록 8번 (`cafd92c`)**: 회차는 바이트를 잃은 버그 이후로 복구를 갖고 있었는데, **같은 방식으로 제출하고 같은 task id 를 기록하는 단편**에는 돌아갈 길이 아예 없었다 — 잃어버린 클립에 닿는 유일한 방법이 **한 번 더 사는 것**이었다. 상태 읽기와 다운로드뿐이고 **생성은 없으므로 원장이 움직이지 않는다.** 못 받아오는 장면은 보고하고 그대로 둔다 — **돈 쓰는 건 사람의 결정이지 이 메서드의 대비책이 아니다.** 자리표시자 크기 이하로 돌아온 응답은 다시 쓰지 않는다(그게 이 복구가 되돌리려는 실패 자체다).
- [x] **회차 클립을 한 번에 다시 살 수 있다 — Cowork 목록 7번 (`f250d51`)**: 12장면짜리는 **열두 번 눌러야** 했고, **열두 번째는 사람이 자기가 뭘 승인하는지 안 읽는 지점**이다. 한 장면과 전체가 **같은 경로**를 쓴다 — 돈을 지키는 규칙에 구현이 두 벌이면 안 된다.
  - 🔴 **생성 중 전체 재구매는 거절한다**: 실패한 한 장면의 재시도는 생성 중에도 열려 있지만, 전체는 **아직 돌고 있는 장면들을 두 번 결제**하게 된다 — 그리고 그 실수가 **한 번의 누름**으로 가능한 유일한 경로다. 처음 쓴 테스트는 이 구분을 못 재고 있었다(기록이 전부 succeeded 라 길이 조건을 빼도 초록이었다). 장면 1을 failed 로 두고 **단건은 통과하고 전체는 거절되는 것**을 같이 단언하도록 고쳤다 — 그제서야 주입이 빨개졌다.
  - 밀려난 클립은 **여섯 개 전부 보관**한다. 일괄 동작이 작업을 잃는 값싼 길이 되면 안 된다.
- [x] **설정 화면이 화면비가 왜 잠겼는지, 누가 잠갔는지 말한다 (Cowork Round 332, `4c03989`)**: *"2화가 이미 이미지를 만들어서"* — 회차 번호가 없으면 사람이 **12개 회차를 뒤지게** 된다. 비용도 같이 말한다(잠긴 이유가 취향이 아니라 결제라서). `aspectRatioChangeable` 은 **true 로 시작**해서, 답이 오는 중에 잠긴 것처럼 보이지 않게 한다 — 그 사이에 사람이 포기한다.
  - 🟠 **스텁이 서버보다 적게 답한 자리가 이번 주 네 번째·다섯 번째**: 새 필수 필드 하나가 **다른 화면 셋의 테스트 11건**을 무너뜨렸다(나레이션·이미지·병합). 그 화면들은 잠금을 읽지도 않는데, `getLongProjectSettings` 가 malformed 로 떨어지면서 설정을 통째로 잃었다. **가드는 매번 옳았고, 매번 고칠 곳은 스텁이었다.**
  - 🔴 **저장 경로가 방금 받은 잠금을 지우고 있었다**: `setState({ settings, loading, error })` 가 상태를 **통째로 교체**해서 새 필드가 사라졌다(타입이 잡았다). 저장은 잠금을 바꿀 수 없으므로(이미지 생성만이 잠근다) **병합으로 고쳤다** — 교체로 뒀으면 **이미지가 이미 있는 프로젝트가 저장 한 번에 풀린 것처럼 보인다.** 이번 주에 네 번 나온 "명명된 필드만 새 객체로 옮겨 담기" 와 **같은 모양이고, 이번엔 화면 쪽이었다.**
- [x] **회차 재생성 지시 칸이 화면에 붙었다 (Cowork Round 333, `710c898`)**: `RegenerateInstructionField` 를 단편과 그대로 공유한다 — *"이번 재생성에만 쓰이고 저장되지 않습니다"* 는 **유료 버튼 옆 텍스트 칸이 뭔가 저장되는 것처럼 보이는 문제**를 막는 문장이고, 두 곳이 같은 문장을 쓴다. 빈 값은 **아예 안 보낸다**(`""` 가 "지시 없음" 의 세 번째 철자가 되지 않게). 확인창을 열 때와 닫을 때 모두 비운다 — 2번에 적은 지시가 3번 요청에 실려 나가면 안 된다.
  - 🔴 **유료 확인 버튼이 여는 버튼과 이름이 같았다**: 행의 *"다시 만들기"* 와 확인창의 *"다시 만들기"* — **하나는 질문을 열고 하나는 돈을 쓰는데** 화면에서 구분이 안 됐다. 단편은 같은 자리에서 *"예, 다시 생성합니다"* 를 쓴다. 회차도 그렇게 맞췄다(테스트가 두 개를 못 고른 것이 이 결함의 증상이었다).
  - 🔴 **테스트가 이미지 화면의 경로를 스텁하고 있었다**: 영상 재생성은 `/scenes/<n>/regenerate` 인데 `/review/<n>/regenerate` 를 깔아서 **요청이 스텁에 안 잡혔다.** 경로를 맞추고, 클라이언트가 지시를 안 실으면 그 테스트만 빨간지 주입으로 확인했다.
- [x] **회차의 지난 클립과 지난 컷을 보관함에서 열 수 있다 — Cowork 목록 3·4의 화면 (`3d43704`)**: 단편 카드 안에 인라인이던 147줄을 `VersionSlots` 하나로 **복사가 아니라 추출**했다 — 복사했으면 *"어느 버전이 현재인가"* 와 되돌리기 경고문이 **갈라질 자리가 둘**이 되고, 갈라진 쪽은 아무도 안 보는 쪽이다. 종류를 가리는 곳은 `listVersionsFor`·`restoreVersionFor`·`versionContentUrlFor` 셋뿐이다.
  - 열림 상태를 `openTarget` 하나로 뒀다: 종류가 둘이면 **패널이 둘 열릴 수 있고**, 그러면 `versions` 상태 하나를 둘이 나눠 쓰게 된다.
  - 프론트 시그니처만 `SceneNumber` 로 좁아서 4번(최종 영상 버전)이 화면에서 닫혀 있었다 — 라우트는 이미 `"final"` 을 받고 있었다.
  - 🔴 **테스트가 라우트 세그먼트를 뒤집어 적고 있었다**: `videos/versions/1` 로 기대했는데 실제는 `videos/1/versions` 다. 고쳤고, **회차를 단편 경로로 읽게 만들면 그 테스트가 빨간지** 주입으로 확인했다 — 그 단언("단편 라우트가 아니라")이 이 화면의 핵심이라서다.
  - 🟠 **`longProjectsApi.ts` 덮어쓰기 확인 요청 — 잃은 것 없다**: 그 파일에 대한 Cowork 의 변경은 세 함수 시그니처 확장뿐이고, 내 쪽은 그 파일 **본문을 편집한 적이 없다**(내가 만진 건 `longProjectsApi.test.ts` 의 스텁). git diff 로 삭제 라인을 대조해 확인했다.
- [x] **회차 이미지가 검토 단계를 지나도 목록에 남는다 — Cowork 목록 22번의 백엔드 (`bfe0e9f`)**: **막고 있던 건 서버였다.** `get()` 이 `assertReviewable` 로 *"지금 `images_review` 여야 한다"* 를 요구해서, 회차가 다음 단계로 넘어가는 순간 목록이 거절됐다 — **파일은 디스크에 그대로 있고 content 라우트는 여전히 한 장씩 서빙하는데**, 화면에 그것들이 있다고 말해 주는 게 없어졌다.
  - **읽기는 검토가 아니다**: `approve`·`regenerate` 는 행위라서 상태 관문을 그대로 둔다. `get()` 은 **그림이 실제로 있는지만** 본다 — `content()` 가 같은 이유로 이미 그렇게 하고 있었다(*"존재하는 그림은 언제든 볼 수 있어야 한다"*).
  - **이미지가 생기기 전 상태에서는 여전히 NOT_ALLOWED 다**: *"아직 없다"* 와 *"이제 없다"* 는 다른 답이고, **둘 중 하나만 뭔가 잘못됐다는 뜻**이다. 그래서 상태 관문을 없애지 않고 **바닥만** 남겼다.
  - 주입: 옛 관문으로 되돌리면 그 테스트만 빨갛다. 결제한 것에 다시 못 닿는 결함이 이번 주 **세 번째**다(회차 지난 클립 · 회차 최종 컷 · 그리고 이것).
- [x] **회차 "모든 장면 다시 만들기" 와 단편 "이미 만든 영상 가져오기" 가 화면에 붙었다 (Cowork Round 335, `6da165e`)**: 7번의 값은 **누르는 횟수가 아니라 총액**이었다 — 장면마다 확인창이 **한 장면 값**을 말하는 동안 **전부 다시 만들면 얼마인지는 아무도 말한 적이 없었다.** `sceneCount={reviews.length}` 로 그 숫자가 처음 화면에 나온다. 확인 버튼은 *"예, 전부 다시 생성합니다"* — 여는 버튼과도, 한 장면짜리와도 다른 말이다.
  - 8번은 확인창을 **안 붙였다**(Cowork 판단, 동의): 무료고 자리표시자 말고는 아무것도 안 덮어쓴다. 확인을 붙이면 **바로 옆 유료 버튼과 같은 문 뒤에 놓는 것**이고, 그러면 두 문이 같아 보인다.
  - 🔴 **테스트가 없이 온 라운드라 내가 셋 썼다**: 유료 경로의 버튼을 테스트 없이 커밋할 수는 없다. (1) 전체 재구매가 `regenerate-all` 로 나가고 지시를 트림해 싣는지 — **그리고 단건 경로(`/scenes/`)로는 절대 안 가는지**, (2) 전체 확인창이 **여섯 장면 값**을 말하는지(`$1.50`, `6장면`), (3) 복구가 가져온 장면 수와 **못 가져온 장면의 이름·이유**를 함께 말하는지. 주입 둘 다 빨갛다.
  - 🟠 **두 확인창이 동시에 열릴 수 있다**: 값이 다른 두 행동(1장면 vs 6장면)의 확인창이 나란히 서 있게 된다. **단편도 같으므로 결함이라기보다 저장소 전체의 현재 규칙**이라, 테스트로 강제하지 않고 관찰만 남긴다.
- [x] **🔴 보관한 회차를 목록·복구할 수 있다 — Cowork 목록 27번, 그리고 28번의 답 (`f5df92e`)**: 보관은 이미 폴더를 옆으로 옮기고 `archiveId` 까지 돌려줬는데 **그 id 가 갈 데가 없었다.** 앱에서 보면 *"복구 가능"* 이 삭제와 구별되지 않았다. `GET .../episodes/archives` 와 `POST .../episodes/archives/:archiveId/restore` 를 만들었다.
  - **28번(확인 문구가 없다)의 답은 27번이다**: 목록에 뜨고 되돌릴 수 있으면 **타이핑 확인이 필요한 종류의 동작이 아니다.** 행동을 안전하게 만드는 건 두 번 묻는 게 아니라 **되돌릴 수 있다는 것**이다.
  - 복구는 **마지막 회차로** 돌아온다. 보관은 언제나 마지막 것만 가져가고 그 사이 프로젝트가 자랐을 수 있는데, 원래 번호로 밀어 넣으면 **누군가를 덮어쓰거나 뒤를 전부 밀어야** 하고 둘 다 아무도 잃겠다고 한 적 없는 작업을 잃는다.
  - 🔴 **보관 중에 개요 두 벌이 갈라져 있었다**: `updateOutline` 은 `episode_outlines.json` 만 쓰고 회차 폴더의 `project.json` 은 안 건드린다 — **줄거리를 고치는 순간 폴더 사본이 낡는다.** 행이 지워지면 폴더가 유일한 사본이 되므로, **둘이 아직 다 있을 때** 보관 시점에 맞춰 적는다. 안 그러면 복구가 **마지막 편집 이전 상태를 조용히** 돌려준다 — 테스트가 정확히 그 줄거리를 단언하고, 맞춤을 빼면 빨갛다.
  - `archivedAt` 은 폴더 **이름에서 되읽는다**(보관이 만든 형식). 안 맞으면 **날짜 없이 목록에 올린다** — 지어내지 않는다. archiveId 는 경로로 합치기 **전에** 한 세그먼트인지 검사한다.
  - 🟢 **내 라우트 커버리지 가드가 나를 잡았다**: 컨트롤러에 `API_ROUTES.x(":projectId")` 호출 형태로 적었더니 **핸들러 없는 클라이언트 라우트 2건**으로 빨개졌다. 이웃과 같은 백틱 형태로 바꿔서 통과 — 가드가 제 일을 했다.
- [x] **확인창은 한 번에 하나만 열린다 (두 화면), 그리고 갤러리가 장면별로 갱신된다 (Cowork Round 336, `b959a3f`)**: 값이 1장면과 6장면인 확인창 둘이 나란히 서면 **읽는 사람이 자기가 어느 패널 안에 있는지부터 알아내야** 한다 — 확인창의 목적과 정반대다. **두 화면 같이** 고쳤다: 한쪽만 고치면 저장소의 규칙이 화면마다 달라지고, 다음 사람은 어느 쪽을 따를지 모른다.
  - 22번 화면: 조회 관문을 `reviewable` 에서 `images_ready` 이후로 넓히고, 갤러리 캐시 무력화를 회차 상태에서 **장면별 `updatedAt`** 으로 바꿨다 — **목록이 없어서 못 하던 것**이라, 서버 고침이 화면의 이 문제를 같이 풀었다. 유료 버튼은 `reviewable` 로 그대로 막는다(서버에 관문이 남아 있으니 화면이 없는 문을 열어 보이면 안 된다).
  - **테스트 셋은 내가 썼다**(2라운드 연속): 확인창 상호배제 두 화면 + 갤러리 장면별 갱신. 주입 셋 다 빨갛다.
  - 🟠 **주입을 되돌릴 때 한 줄을 엉뚱한 함수에 넣었다**: `setRegenerateConfirmScene(null)` 이 초기화 블록으로 들어가서 상호배제가 안 되고 있었고, **방금 쓴 테스트가 그걸 잡았다.** 파일 직접 되돌리기는 git 보다 안전하지만 **되돌린 자리가 원래 자리인지는 따로 확인해야 한다** — 같은 문자열이 여러 번 나오면 첫 번째에 붙는다.
- [x] **회차 이미지 확인창이 실제로 살 것만 견적한다 — Cowork 목록 21번의 백엔드 (`e10ec6c`)**: 확인창은 **장면 수 × 장당 가격**을 말하는데 `generate()` 는 **이미 쓸 만한 그림이 있는 장면을 건너뛰고 값을 안 받는다** — 세 장면이 성공한 뒤의 재시도가 여섯 장 값으로 견적되고 세 장 값이 나갔다.
  - **가격을 부풀리는 건 안전한 방향이 아니다**: 이 앱이 비용을 화면에 띄우는 근거는 **그 숫자를 믿을 수 있다는 것**이고, 너무 높은 줄 아는 숫자는 **살 수 있는 작업을 사람이 포기하게** 만든다.
  - 무료·프로바이더 없는 사전 조회로 만들었다(`GET .../images/generations/preview`): `generate()` 가 장면마다 던지는 **같은 질문을 던지되 행동하지 않는다.** 자격 관문도 `generate()` 와 같게 둬서 **답이 오는 사전 조회는 실제로 돌 수 있는 생성**이다. *"사전 조회가 돈을 쓰면 사전 조회가 아니다"* 를 테스트가 단언한다(fetch 호출 0).
  - 주입: 재사용 판정을 없애면 그 테스트가 빨갛다.
- [x] **20·21·29 화면이 나갔다 (Cowork Round 337, `61ea613`)**: 단편 최종 영상 주소에 캐시 무력화가 붙었다(재병합해도 주소가 같아 **브라우저가 옛 컷을 재생**했고, 사람은 *"병합이 아무것도 안 했다"* 고 읽었다). 보관함 빈 상태가 회차도 센다(회차만 있는 사람에게 *"영상이 없습니다"* 라고 말하고 그 아래에 목록을 그렸다).
  - 🔴 **21번의 개수를 검토 목록에서 셀 수 없다 — 내가 화면을 계약에 연결했다 (역할 밖, 명시함)**: 검토 목록은 **그림이 생긴 뒤에만** 불러오는데, 확인창이 뜨는 단계는 `asset_mapping_approved` 다 — **부분 실패한 재시도가 정확히 그 상태**라, 목록으로 세면 그때마다 *"아직 아무것도 없음"* 으로 읽고 **여섯 장 값을 그대로 부른다.** `e10ec6c` 의 preflight 를 화면이 부르게 했고, 값도 서버 숫자를 그대로 쓴다(화면에서 다시 곱하면 그게 두 번째 사본이다).
  - **preflight 는 확인창을 열 때만 부른다**: 아무도 안 누른 버튼의 값을 미리 살 이유가 없고, 마운트에서 부르면 기존 테스트 열일곱 개의 요청 순서가 밀린다. 실제로 확인창을 여는 세 테스트에만 응답을 더했다.
  - `toHaveBeenCalledTimes(3)` 두 곳을 **"생성 POST 가 없었다"** 로 바꿨다 — 확인창을 여는 것이 값을 물어볼 수는 있어도, 그 단언이 지키려던 사실은 *"아직 아무것도 생성 안 했다"* 다.
  - 주입: `reusableSceneNumbers` 를 안 읽게 하면 그 테스트가 빨갛다.
- [x] **회차 나레이션도 "대본이 지나간 목소리" 를 말한다 — 9번의 마지막 절반 (`998599f`)**: 영상·이미지 검토는 이미 말하고 있었고 **목소리만 안 말했다** — 보는 것이 아니라 **듣는 것**인데. 그래서 대본이 더는 하지 않는 말을 하는 오디오를 사람이 확정할 수 있었다.
  - **비교는 이미 있었다**: `stillGoodAudio()` 가 재생성이 필요한지 정하려고 **녹음된 문장과 지금 문장을 비교**한다. 그 답이 화면으로 안 갔을 뿐이다 — 앱은 알고 있었고 말하지 않았다.
  - 기록 없는 장면은 **목록에 없다**(만든 적 없으니 뒤처질 것도 없다). **디스크에 오디오가 없는 장면도 뺀다** — 그건 *"안 만들어짐"* 이고 검토의 `audio: "none"` 이 이미 말한다. 낡았다고 부르면 **한 번도 안 산 것을 다시 사러** 사람을 보낸다. 자리표시자도 낡은 게 아니다(문장과 맞고, 진짜 음성이 아닐 뿐 — `state` 가 그걸 말한다).
  - 주입: 비교를 끄면 그 테스트가 빨갛다.
  - 🟠 **클라이언트 가드는 아직 이 필드를 안 본다**: 계약상 필수이므로 없는 응답은 malformed 인데 지금은 통과한다. 이번 주에 같은 자리가 다섯 번 나왔으니 **가드와 스텁을 같은 라운드에** 붙이는 게 맞다 — 프론트 몫으로 넘긴다.
- [x] **19·20·23 화면 (Cowork Round 338, `1e6af51`)**: 단편 병합 사전 안내, 최종 영상 캐시 무력화 마무리, 진행 표시 **양방향**.
  - 🔴 **19를 옮기다 단편 문장이 원래 거짓말이었던 게 드러났다**: *"6개 승인 장면 영상을 이어 붙입니다"* 가 실제로는 전체 장면 수였다(4개만 확정된 상태에서도 6이라고 말했다). **막는 게 없던 것보다 나쁘다** — 막는 게 없으면 서버가 거절하고 끝인데, 이건 *여섯 개가 확정됐다*고 말한 뒤 거절당하게 한다.
  - `disabled` 만 두지 않고 `openConfirmation` 안에도 가드를 뒀다 — **`disabled` 는 눌렀을 때 무슨 일이 일어나는지에 대한 주장**이고, 주장만 두고 실제를 안 두면 그게 이번 주 내내 나온 그 모양이다.
  - 23은 **양쪽 다 부족했고 방향이 반대**였다: 회차엔 *"나가도 계속됩니다"* 가 아예 없었고(하필 한 번에 더 비싼 쪽), 단편은 **새로고침하면 실행 중인 것을 잊었다**(`generatePending` 이 로컬 상태). 시계는 **이 화면이 시작한 실행에만** 뜬다 — 도착 시각부터 세면 그 숫자가 **실행의 나이로 읽히고**, 그건 앱이 지어내는 숫자다.
- [x] **🔴 `finalVideoPath` 라는 같은 이름이 두 응답에서 다른 원점을 뜻했다 — 18번 계약 (`58c6cb8`)**: 문자열이 **글자까지 같은데** 단편은 프로젝트 기준, 회차는 회차 기준이다. 데스크톱 브리지는 받은 걸 **프로젝트 폴더 기준으로** 푼다 — 그대로 넘기면 `<projectId>/videos/final/instagram_reel.mp4` 를 열고, 그건 없는 폴더거나 **같은 id 의 단편 프로젝트가 있으면 남의 완성본**이다.
  - `openablePath` 를 **더했다**(뜻을 안 바꿨다): 화면에 보여주는 짧은 쪽은 사람이 읽기 좋고, 뜻을 바꾸면 그 값을 읽는 다른 데가 조용히 틀린다.
  - **화면이 경로를 조립하지 않게** 서버에서 만든다(`episodeProjectRelativePath`). 회차 디렉터리 배치는 이 저장소에 집이 하나뿐이고(`LONG_STORY_DIRECTORY`·`episodeDirectoryName`), **화면이 조립하면 그게 두 번째 사본이자 디스크와 어긋난 걸 가장 늦게 아는 사본**이다.
  - 병합 응답만이 아니라 **`LongEpisodeDetail` 에도 같이 실었다** — 그 쪽에도 `finalVideoPath` 가 있어서 같은 함정이 리로드 경로에 그대로 있었다. 둘은 항상 같이 나가거나 같이 없다.
  - 주입: `openablePath` 를 회차 기준 값으로 두면 그 테스트가 빨갛다.
- [x] **나레이션 낡음이 화면까지 닿았다 — 9번 세 갈래 완결 (Cowork Round 339, `12f7df6`)**: 칩·테두리·문장을 **그 문장이 이미 떠 있는 자리 바로 위에** 붙였다 — *"다르다"* 옆에 *"무엇과"* 가 같이 보여야 사람이 판단할 수 있다. 가드와 스텁 열하나를 같은 라운드에 붙였다.
  - 🔴 **그 화면 주석이 세 커밋에 걸쳐 거짓이 돼 있었다**: *"long projects have no per-scene staleness axis at all"* 은 쓸 때는 참이었고 `316b7a8`·`a44ae75`·`998599f` 를 지나며 거짓이 됐다. **주석은 코드보다 오래 살고 아무도 타입체크해 주지 않는다** — 그대로 뒀으면 다음 사람이 그 문단을 읽고 넘어간다.
  - 화면이 `audio !== "none"` 으로 한 겹 더 거른다(서버가 실수로 넣어도 **한 번도 안 산 것을 다시 사러** 사람을 보내지 않게). 두 군데서 같은 답이 나와야 안전한 종류라는 판단이고, 동의한다.
- [x] **나레이션 재생성 응답이 전체 낡음을 싣는다 (`00b7f67`)**: 없으면 화면이 **이전 목록을 이어받아 방금 만든 장면만 빼는 추론**을 한다 — 맞는 추론이지만 **"낡음" 의 뜻을 정하는 두 번째 자리**이고, 이번 주 내내 갈라진 게 전부 그 자리였다. 서버는 검토를 답하려고 **이미 그 비교를 한다.** 전체 검토를 다시 읽는 대안은 **그 응답에만 있는 `retryEstimate` 를 버린다.**
- [x] **내레이션 링크 이름을 통일했다 (Cowork Round 340, `6ee87b7`)**: 장기가 *"내레이션"*, 단편이 *"내레이션 확인"* 이었다 — **한 곳으로 가는 문에 이름이 둘**이면 나중에 *"그 내레이션 어디였지"* 가 시작된다. 기존 테스트 둘은 `testid` 로 잡고 있어서 안 깨졌고, **`testid` 는 사람이 읽는 게 아니라서** 글자를 단언하는 줄을 더했다.
  - 🔴 **Cowork 이 캡틴D에게 보고한 차이가 틀린 것이었고, 승인을 받은 뒤에 스스로 정정했다**: *"설정을 못 읽으면 단기는 보여주고 장기는 숨긴다"* — 실제로는 **장기는 설정이 프로젝트 응답에 같이 실려 와서 따로 실패할 길이 없다.** 조건문 **모양이 대칭이니 원인도 대칭일 것**이라 넘겨짚고 데이터 출처를 안 따라간 것이다. 고치기 전에 정정한 판단이 옳다 — 틀린 보고 위에서 받은 승인은 승인이 아니다.
  - 🟠 **남은 진짜 차이는 지금 고칠 수 없는 종류**다: 단편은 `scenes.some(문장 있음)` 으로 **읽을 게 있을 때만** 링크하고, 장기 타임라인 요약에는 **장면별 문장이 안 실린다**(회차 스무 개를 부를 수는 없다). 도착 화면이 빈 목록을 제대로 다루므로 깨지지는 않는다. 요약에 `hasNarrationText` 한 칸이면 같아지지만 **캡틴D 범위 밖이라 하지 않는다.**
- [x] **🔴 회차 참고 이미지에 자동 제안이 없다 — 사이클 보고, 대조로 확인함 (착수 대기: 캡틴D 사이클 중)**: 캡틴D — *"작품 기본 설정에서 추가한 대표 캐릭터의 폴더는 자동으로 연결한다고 하지 않았나? 내가 방금 수동으로 연결했는데"*. Cowork 의 진단이 맞다. grep 으로 대조했다:
  - `mappings.service.ts:71` 이 만드는 것은 **`assignment_source: "manual"` 하나뿐**이다. `"suggested"` 를 쓰는 곳은 **저장 기본값**(`mapping-storage.ts:65`)과 **승인을 막는 읽기**(`mappings.service.ts:111`) 둘뿐 — **만드는 쪽이 없는데 막는 쪽만 남았다.**
  - **단편에는 있다**: `syncAutoMappings()` 를 `projects.service.ts` 가 설정 저장 때 세 번 부른다(`auto_cast`·`auto_atmosphere`·`auto_scene_reference`). **장기에는 그 호출이 하나도 없다** — Story Bible 의 `style_asset_link`·`protagonist_asset_link` 는 매핑을 만들지 않는다.
  - 🟢 **단편의 선례가 `"suggested"` 가 아니라 `confirmed`/`user_confirmed: true` 라는 점이 중요하다**: 그 주석의 이유 — *"사람이 설정에서 이미 이름으로 골랐으니, 매핑 검토에서 다시 확인시키는 건 같은 질문을 두 번 하는 것"* — 이 Story Bible 링크에 **그대로** 적용된다. 그러니 회차도 제안이 아니라 **확정으로 심는 것**이 맞다.
  - **20화짜리에서 아픈 이유**: 매 회차 손으로 다시 고르고, 20번이면 한 번은 빠뜨리고, **빠뜨린 걸 아는 시점은 이미 이미지를 산 뒤**다. 단편은 한 번이라 티가 안 나고 장기는 스무 번이라 티가 난다.
  - `ProtagonistAssetCard` 주석의 *"applied to every Episode"* 는 **이름에만 참이고 그림에는 거짓**이다(`protagonistName()` 이 폴더 이름만 읽어 대본 프롬프트에 싣는다). 캡틴D 의 기대가 거기서 나왔다.
- [x] **🔴 철거(`117877a`)에서 같이 빠진 것 전수 조사 — 셋 찾았다 (착수 대기: 캡틴D 사이클 중)**: 자동 연결이 사라진 모양 — **읽는 쪽은 남고 만드는 쪽이 없어진 것** — 을 단서로 훑었다. 백엔드에서 삭제된 소스는 그 커밋 셋뿐이라 범위는 좁다.
  - **① 자동 제안 (보고된 것)**: `"suggested"` 를 만드는 곳이 없다. 단편은 `syncAutoMappings()` 를 설정 저장 때 세 번 부르고, **장기는 0번**이다.
  - **② `"ambiguous"` · `"unmatched"` · `"invalid"` 도 같이 죽었다**: `mappings.service.ts:111` 이 이 셋을 **승인 차단 조건으로 읽는데 만드는 곳이 없다.** 즉 지금 승인을 실제로 막는 건 `"suggested"` 뿐이고 그것도 안 만들어지니 **차단 조건 전체가 아무것도 안 막는다.** 옛 서비스에는 매칭이 이 상태들을 붙였다.
  - **③ 🔴 회차 매핑 검토 무효화가 옛 파일 모양을 읽는다 — 살아 있는 결함**: `assets.repository.ts:517` 의 `invalidateEpisodeMappingReview` 가 `review.candidates` 를 요구하는데, 새 `StoredMappingReview` 에는 **`candidates` 가 없다**(매핑은 `asset_mappings.json` 으로 분리됐다). 그래서 **Asset 버전이 올라가도 승인된 회차 검토가 다시 안 열린다.** 단편 쪽(`:504`)은 `asset_mappings.json` 을 읽어서 정상이다.
    - 🟠 **그 경로의 테스트는 초록이다**: `assets.repository.test.ts:312` 가 `candidates: [...]` 를 **손으로 써 넣는다** — 앱이 더 이상 안 만드는 모양이다. **초록인데 지키는 게 앱이 쓰는 파일이 아니다**(D-023 의 변종).
  - **없어진 게 아니라 원래 없던 것 하나**: `protagonist_asset_link` 는 옛 자동 제안에도 없었다. 다만 `ProtagonistAssetCard` 주석의 *"applied to every Episode"* 가 **이름에만 참**이라 캡틴D의 기대를 만들었다.
  - **정리 후보(손실 아님)**: `episode_scope` 는 저장 허용 키에만 남아 **아무도 읽거나 쓰지 않는다**; Story Bible 컬렉션의 `asset_link` 는 `legacy` 목록으로 내려가 **읽고 버린다**(컬렉션 자체가 `secrets|foreshadowing` 로 줄어든 결과 — 의도된 것).
- [x] **🔴 회차의 승인된 매핑 검토가 Asset 이 바뀌어도 다시 안 열렸다 — 조사 ③ (`8f0aadf`)**: `invalidateEpisodeMappingReview` 가 `review.candidates` 를 요구했는데, 매핑은 철거 때 `asset_mappings.json` 으로 분리돼 **새 검토 레코드에는 그 필드가 없다.** 그래서 회차는 **한 번도 무효화되지 않았고**, 단편만 정상이었다. 사람은 **바뀐 Asset 을 가리키는 승인 상태를 그대로 들고 이미지를 산다.**
  - 🟠 **그 경로 테스트는 내내 초록이었다**: 픽스처가 `candidates` 를 **손으로 써 넣어서**, 앱이 더 이상 만들지 않는 파일 모양을 증명하고 있었다. 픽스처를 **앱이 쓰는 모양**(분리된 `asset_mappings.json` + `candidates` 없는 리뷰)으로 바꾸자 먼저 빨개졌고, 그게 이 결함의 증거다.
  - 두 소유자가 이제 **같은 방식으로 저장**하므로 함수를 하나로 합쳤다 — 소유자별로 다른 것은 상태 키와 두 값뿐이다. 갈라둔 채로 한쪽만 고치면 **다음 저장 형식 변경 때 같은 일이 다시 난다.**
  - 무효화는 모든 단계에서 조용하다: 버전 추가는 이미 성공한 뒤이고, **읽을 수 없는 프로젝트 하나가 그 성공을 실패로 바꾸면 안 된다.**
- [x] **자동 매핑 동기화가 위치를 받는다 — ①의 절반 (`02c8f51`)**: `syncAutoMappings()` 가 `projectId` 를 받아 **스스로 `projectLocation()` 을 만들던 것**을 `MappingLocation` 을 받도록 넓혔다. `MappingOwner extends MappingLocation` 이므로 **회차 소유자를 그대로 넘길 수 있다** — 새 개념이 없다.
  - 두 번째 사본을 안 만드는 게 이 선택의 값이다: **태그별로만 관리하기 · 수동 매핑 비켜 가기 · 같은 Asset 을 두 번 안 싣기**(`collectReferenceImages` 에 중복 제거가 없다) 세 규칙이 전부 이 함수 안에 있고 테스트도 여기 붙어 있다. 회차용을 따로 쓰면 **그 셋이 갈라질 자리가 셋 생기고, 갈라진 결과는 잘못 나간 그림으로만 보인다.**
  - `project_id` 는 이제 `location.id` 다 — 회차는 그 값이 `<projectId>/EpisodeNN` 이라 **파일을 회차 사이에 복사해도 읽을 때 걸린다**(그게 그 id 를 그렇게 정한 이유다).
  - 호출 시점은 아직 안 붙였다: **캡틴D 답 대기** — *"설정집에서 대표 캐릭터를 바꾸면 이미 만든 회차의 연결도 따라 바뀌어야 하는가."*
- [x] **쓰이지 않는 저장 키가 왜 남아 있는지 적었다 (`cda8525`)**: `episode_scope` 는 **아무도 읽거나 쓰지 않지만** 허용 키 목록에 남아 있어야 한다 — 빼면 철거 이전에 쓰인 회차 파일이 `LONG_PROJECT_DATA_INVALID` 가 되고, 그건 무시되는 필드가 아니라 **열리지 않는 프로젝트**다. **목록에 있는 키는 쓰이는 키처럼 보이고**, 그게 이번 철거의 다른 잔재들이 오래 안 보인 이유라서 소리 내어 적었다.
- [x] **스토리 바이블 링크가 "안 만든 회차" 에 닿는다 — ①의 나머지 절반 (`1e37783`)**: 캡틴D 가 세 갈래 중 가운데를 골랐다 — **안 만든 회차만**. 기준은 하나, **돈을 썼느냐**다. 링크 저장 두 곳(주인공·스타일)에서 `syncStoryBibleMappings` 를 부르고, 회차 상태가 `BEFORE_IMAGES_EXIST` 에 있을 때만 심는다.
  - **이미 산 회차를 안 건드리는 이유가 이번 주 내내 고친 그 모양이다**: 매핑만 바뀌면 **기록은 민재라고 하는데 파일에는 이배드가 그려져 있다.** 그림은 따라 바뀌지 않는다 — 이미 산 것이라서.
  - 심는 상태는 짧은 프로젝트의 선례대로 `confirmed`/`user_confirmed: true` 다. **바이블에서 이름으로 고른 사람을 회차마다 또 확인시키면 자동이 아니라 버튼 위치만 옮긴 것**이다.
  - 링크 저장은 절대 실패하지 않는다. 회차 단위와 회차 목록 읽기에서 각각 삼킨다. **바깥쪽 catch 는 일부러 두지 않았다** — 어떤 입력으로도 닿지 않아 D-023 이고, 인자를 만드는 두 줄의 진짜 버그까지 삼킨다.
  - 주입: `BEFORE_IMAGES_EXIST` 필터를 빼면 그림 있는 회차까지 심어져 빨갛고, 회차 단위 `continue` 를 던지게 바꾸면 **깨진 회차 하나가 나머지 회차의 매핑을 다 가져가서** 빨갛다.
- [x] **🟠 조사 ② — 죽은 줄 알았던 승인 차단 조건은 살아 있었다. 지우지 않고 쟀다 (`70360ca`, D-033)**: 이쪽 코드만 보면 `suggested`·`ambiguous`·`invalid` 를 **만드는 줄이 한 줄도 없다.** 지우자는 제안이 맞아 보였다.
  - **생산자는 다른 언어로 쓰여 있었다**: `project_asset_mapping.py:639` 의 자동 매처가 `suggested`/`ambiguous` 를, `:533` 이 `unmatched` 를 쓴다. **그 매처가 아직 포팅이 안 됐고, 그래서 이쪽에 생산자가 없는 것이지 값이 없어진 게 아니다.** `parseStored` 도 status 가 없으면 `suggested` 로 채운다.
  - 지웠다면 **아무도 본 적 없는 자동 추천이 승인을 통과하고, 사람이 고르지 않은 레퍼런스가 이미지 모델에 실려 나간다.**
  - **판별법(D-033)**: *"이 함수를 호출하는 코드가 없다"* 는 삭제 후보다 — 호출 그래프가 답을 준다. *"이 값을 쓰는 코드가 없다"* 는 삭제 후보가 **아니다** — 읽는 쪽이 남아 있는 한 값의 출처가 코드가 아니라 **디스크**일 수 있다. D-032 와 같은 뿌리다.
  - 테스트는 **API 로 만들 수 없는 모양**(status 필드 자체가 없는 파일)을 손으로 써 넣는다. API 가 바로 그걸 못 만드는 쪽이라 그렇게 해야 한다.
- [x] **🔴 회차의 낡음 표시 — 만들 값이 없어서 만들었다 (`07b94bb`)**: 캡틴D 의 *"대신 낡음 표시"* 를 붙이려고 보니 **비교할 기록이 없었고, 없는 것 자체가 결함이었다.**
  - **회차는 레퍼런스를 프롬프트 텍스트가 아니라 바이트로 보낸다.** 주인공을 이배드에서 민재로 바꿔도 **기록된 프롬프트는 한 글자도 안 바뀐다.** `imageStale` 은 프롬프트끼리 비교하므로 **구조적으로 못 본다** — 디스크에 그 사실을 담은 것이 아무것도 없었다.
  - 그래서 생성 시점에 **실제로 어느 파일에서 바이트가 왔는지**를 기록한다. Asset+버전으로, **폴더는 지금 대표 자식 파일 이름으로** — 폴더 자체 버전은 자식이 바뀌어도 안 움직여서 그걸로 이름 붙이면 **대표가 교체된 뒤에도 "안 바뀜"이라고 답한다.**
  - **`imageStale` 에 합치지 않았다**: 둘은 사람에게 다른 말을 한다 — *"대본이 바뀌었다"* 와 *"주인공이 바뀌었다"*. 오는 동작도 다르고(회차 대본 편집 / 바이블·매핑 편집), 합치면 화면이 **둘 중 뭐가 일어났는지 말할 수 없다.**
  - **순서까지 비교한다.** 모델은 이미지를 그 순서로 받고, 순서가 다른 요청은 다른 요청이다. 집합으로 비교하면 재배열을 "안 바뀜"이라고 답한다.
  - 해석은 **한 벌만 있다**: `collectReferenceImages` 와 낡음 재계산이 같은 `resolveReferences` 를 부른다. **돈을 쓰는 쪽과 그걸 설명하는 쪽이 갈라지면, 갈라진 결과는 이미 산 잘못된 그림으로만 보인다**(D-031).
  - 매핑을 못 읽으면 `null` 이지 빈 목록이 아니다. **읽기 오류 하나를 "레퍼런스 없음"으로 계산하면 기록 있는 장면이 전부 낡음으로 떠서, 화면이 오류를 낡음처럼 보여준다. 모르는 건 모르는 것처럼 보여야 한다.**
  - 🔴 **가는 길에 나온 것**: `approve` 가 리뷰를 **이름 붙인 필드로 다시 조립하면서** 새 기록을 떨어뜨렸다 — **이 레포에서 그 모양이 여섯 번째다.** 이월을 붙이고, **승인한 장면 자체**를 단언하도록 테스트를 조였다(옆 장면만 보면 안 잡힌다).
- [x] **🔴 어제 낸 낡음 표시가 캡틴D 가 요청한 바로 그 경우를 못 잡았다 — 이음매를 건너는 테스트가 없어서 안 보였다 (`c86b654`)**: 심기와 표시가 **각각** 테스트를 갖고 있었고 **그 사이를 건너는 테스트는 하나도 없었다.** D-031 그대로다. 사람이 누르는 버튼부터 끝까지 몰아봤다 — 주인공 지정 → 1화만 구매 → 주인공 변경 → **`referenceStale: []`.** 테스트가 빨간 게 맞았다.
  - **구조적으로 못 잡는다**: `referenceStale` 은 *기록된 레퍼런스 vs 지금 쓸 레퍼런스* 인데, 캡틴D 규칙이 **"이미 그린 회차는 안 건드린다"** 다. 안 건드리니 **그 회차는 아무것도 안 바뀌고 두 값이 영원히 같다.** **그 경우에 절대 달라질 수 없는 한 쌍으로 표시를 만든 것이다.**
  - 필요한 비교는 다른 한 쌍이다 — **이 회차의 매핑 vs 설정집이 지금 말하는 것.** `storyBibleLinkDrift` 가 그걸 답하고, 화면 문장을 위해 **이름 둘을 같이 싣는다**(한 번 더 부르지 않게). Asset 이 지워졌으면 이름 자리에 id 가 들어간다 — 못 보여줄 이름보다 인용할 수 있는 id 가 낫다.
  - `referenceStale` 은 남는다. **그쪽도 진짜다** — 폴더 대표 그림 교체·Asset 버전 상승은 그쪽으로 잡히고, 그건 원래 아무것도 못 잡던 것이다.
  - **오류가 아니라 사실로 낸다.** 먼저 그린 회차가 그때 주인공을 들고 있는 건 틀린 게 아니다. 다시 그릴지는 **돈 쓰는 사람의 결정**이다.
  - 🟠 **주입 하나가 처음엔 초록이었다 — 배열 순서 운으로 통과하고 있었다**: 태그 필터를 빼도 `find` 가 우연히 같은 매핑을 집었다. 손으로 넣은 매핑이 **심긴 것보다 앞에 오도록** 테스트를 다시 짜서 비로소 쟀다. **초록인 주입은 가드가 튼튼하다는 뜻이 아니라 아직 아무것도 안 쟀다는 뜻이다.**
- [x] **단편에도 같은 레퍼런스 사각이 있었다 — 짐작이 아니라 읽어서 확인했다 (`f8746f4`)**: 회차 쪽에서 나온 구멍이 단편에도 있는지, **모양이 같으니 원인도 같을 것으로 넘겨짚지 않고** 생성 경로를 읽었다(Round 340 에서 그 짐작이 이미 한 번 틀렸다). **절반만 있었고, 있는 절반이 흔한 쪽이었다.**
  - 단편은 매핑된 Asset **설명 텍스트를 프롬프트에 접어 넣는다.** 그래서 Asset 을 다른 것으로 바꾸면 `imageStale` 이 뜬다 — 그 절반은 멀쩡했다.
  - **못 보는 절반**: 바이트는 매핑이 지금 가리키는 버전에서 오고 **폴더 매핑은 항상 `follow_latest`** 다. 같은 캐릭터를 다시 그리면 **보내는 바이트가 전부 바뀌는데 설명은 한 글자도 안 바뀐다.** 사람의 캐릭터 Asset 은 폴더이므로 이건 예외가 아니라 **보통 경우**다.
  - `referenceContext` 가 없으면 **아예 조용하다.** 그걸 안 넘기는 호출부가 곧 판단할 수 없는 호출부고, 없는 것을 "레퍼런스 없음"으로 계산하면 기록 있는 장면이 전부 낡음으로 뜬다.
  - 🟠 **원래 있던 TODO 는 남겼다**: `scene-edit.service.ts:74` — 네 호출부 중 셋이 컨텍스트를 안 넘겨 그쪽 `imageStale` 이 틀린다. 이번 범위 밖이고, **새 필드가 그 틀린 말을 더 늘리지는 않는다.**
  - 🟠 **기록 쪽 주입이 처음엔 초록이었다**: 테스트가 `image_generation_records` 를 손으로 써 넣어 **읽는 절반만 재고 있었다.** 진짜 생성을 도는 테스트로 단언을 옮겨서 비로소 쟀다 — **손으로 쓴 픽스처는 쓰는 쪽을 증명하지 않는다**(`8f0aadf` 와 같은 교훈).
- [x] **🔴 장면 하나를 편집하면 다른 장면 이미지가 전부 낡음으로 떴다 — TODO 두 개가 말하던 것을 재 보니 진짜였다 (`e02ef92`)**: 주석이 두 군데 있었는데 **아무도 재 본 적이 없어서** 고치기 전에 테스트부터 썼다. 확정 매핑 하나 + 2번 장면만 생성 + **1번 장면 편집 → `imageStale: [2]`.** 건드리지도 않은 장면이다.
  - 이 응답은 **"내 편집이 뭘 망가뜨렸나"** 다. 그러니 화면에서는 **"샷 이름 하나 바꿨더니 이미지를 다시 사야 한다"** 로 읽힌다. 기록된 프롬프트에는 References 블록이 있고 재계산에는 없어 **영원히 안 맞았다.**
  - **넷 중 셋이 `referenceContext` 를 안 넘기고 있었다. 셋이 그렇게 판단한 게 아니다** — 선택 인자라 안 넘겨도 컴파일되니 **아무도 그 결정을 요구받지 않은 것**이다. 그래서 **필수 인자로 바꿨다**: `undefined` 는 이제 *"매핑을 못 읽었다"* 지 *"아무도 생각 안 했다"* 가 아니고, 만드는 법은 `sceneReferenceContext()` 한 곳에만 있다.
  - **인자를 바꾸자마자 컴파일러가 세 호출부를 다 짚었다.** 그게 이 방식의 값이다 — 호출부가 하나 늘어도 같은 일이 안 난다. `long-project-paths.ts` 와 같은 판단(검증은 옆이 아니라 안에).
  - 내레이션·영상 응답도 같은 이유로 틀렸었다. 두 화면 다 `imageStale` 을 지금은 안 그리지만, **안 보는 자리에서 틀린 값은 처음 보는 순간 틀린 값이다.**
- [x] **🟠 바로 앞 커밋에서 같은 함정을 한 층 위로 옮겨 놨었다 (`943261c`)**: 선택 인자를 **"아무도 그 결정을 요구받지 않는다"** 는 이유로 필수로 바꿔 놓고, **같은 커밋에서 생성자에 기본값 없는 선택 의존성 두 개를 만들었다.** DI 로 만든 인스턴스만 매핑을 받고, 직접 만든 것은 조용히 References 블록 없이 재계산한다 — **같은 틀린 목록이 한 층 위로 옮겨 갔을 뿐이다.**
  - `LocalProjectRepository.root` 를 열고 거기서 기본값을 만든다. **그 저장소를 들고 있는 서비스는 프로젝트가 어디 있는지 이미 안다** — 같은 경로를 두 번 받게 만드는 것이 둘 중 하나가 빠지는 방식이다.
  - 테스트는 **모든 호출부가 만드는 그대로**(인자 다섯 개, 저장소 없음) 만든다. 기본값을 맨 선택 인자로 되돌리면 빨갛다.
  - **교훈은 인자에 한정되지 않는다**: "빠뜨려도 컴파일된다" 는 자리는 인자든 생성자든 같은 자리다.
- [x] **🔴 영상이 원본 그림 교체를 못 봤다 — 그리고 그 조사에서 내가 우편함에 틀린 사실을 적은 것을 찾았다 (`f12ac55`)**: Cowork 의 *"영상 화면에도 `referenceStale` 을 그려야 하나"* 에 답하러 갔다가 나왔다. **답(그리지 마라)은 맞았고, 내가 댄 이유가 틀렸다.**
  - 🔴 **회차 코드 한 줄을 보고 양쪽으로 넘겨짚었다**: *"`input_hash` 는 프롬프트의 해시"* 라고 우편함에 적었는데, **단편은 `hash.update(imageBytes)` 로 시작한다.** 회차만 프롬프트뿐이다. **Round 340 에서 Cowork 이 정정한 것과 같은 종류의 실수** — 한쪽을 읽고 양쪽을 말했다.
  - **구멍 자체는 양쪽 다 진짜였다.** 단편의 `input_hash` 는 이미지·프롬프트·모델·비율·길이를 **다 섞어서** *"뭔가 바뀌었다"* 밖에 못 답하고, **그게 그 필드의 일이다**(중복 제출 거절). 낡음은 *"무엇이"* 를 답해야 한다 — **프롬프트가 움직인 것과 그림이 갈린 것은 사람이 누를 버튼이 다르다.**
  - 고치기 전에 테스트부터 썼다: 영상 6개 렌더 → 2번 그림만 제자리 교체 → `videoStale: []`. 빨갛다.
  - 프롬프트 비교가 이미 걸린 장면에는 **중복해서 안 넣는다.** 사람은 *"이 장면이 밀렸다"* 를 알면 되지 *"몇 가지로 밀렸다"* 가 아니다.
  - **같은 모양 세 번째다**: 회차 이미지(레퍼런스) · 단편 이미지(레퍼런스) · 영상 양쪽(원본 그림). **만든 결과가 무엇에서 나왔는지 기록하지 않으면 그 무엇이 바뀐 것을 아무도 못 본다.** 유료 산출물을 새로 만들 때 입력을 같이 적는 것을 기본으로 잡는다.
- [x] **🔴 앞 항목을 되돌렸다 — 못 일어나는 일을 고쳤다 (`b23fe93` 되돌리기, `a6726aa` 이유를 테스트로)**: *"장면 이미지를 다시 만들면 영상이 옛 그림을 들고 있다"* — **첫 줄이 안 된다.** 이미지 재생성은 `images_review` / `waiting_for_video_confirmation` 에서만 허용되고 **영상을 제출하면 둘 다 지나간다**(`IMAGE_REVIEW_NOT_ALLOWED`). **영상은 자기 그림보다 뒤처질 수가 없다.**
  - 🔴 **구멍을 증명한 테스트가 PNG 를 디스크에 직접 썼다. 어떤 코드도 그렇게 안 쓴다.** `8f0aadf` 의 픽스처가 앱이 더 이상 안 만드는 `candidates` 를 손으로 써 넣고 초록이던 것과 **같은 함정을, 두 라운드 전에 인용해 놓고 그대로 밟았다.**
  - **교훈은 "도달 가능성을 확인하라" 보다 좁다**: **상태를 직접 써 넣는 픽스처는 읽는 절반만 증명한다. 쓰는 절반은 반드시 대상 코드에서 나와야 한다.** 빨간 테스트도 같다 — **빨간 것이 곧 진짜 결함은 아니고, 테스트가 만든 상황이 진짜여야 결함이다.**
  - 되돌리기만 하면 다음 사람이 또 만든다. 그래서 **상태 게이트를 테스트로 박았다** — 주석이 아닌 이유는 게이트가 넓어지는 날 주석은 아무 말도 안 하기 때문이다. **그 테스트가 빨개지면 그때는 낡음을 만들 값어치가 있다.**
- [x] **같은 모양 전수 훑기 — 나머지 둘은 이미 막혀 있었다 (고친 것 없음)**: **내레이션**은 목소리가 사용자 설정이 아니라 상수(`OPENAI_TTS_VOICE = "alloy"`)라 변할 수 있는 입력이 문장뿐이고 이미 비교한다. **합본 영상**은 장면 클립을 복원하면 최종 영상이 무효화된다(`final_video_path: null`, 상태도 되돌림) — 단편·회차 **양쪽 다** 그렇고 그 자리 주석이 이유까지 적어 뒀다. **아무것도 안 고친 것이 결과다.**
- [x] **18 · 나레이션 추론 제거 · `openablePath` 리로드 경로 (Cowork, `551d91a`)**: 화면이 `openablePath` 를 **조립하지 않고 통과만** 시킨다. 테스트가 **간 것과 안 간 것을 둘 다** 본다 — 간 것만 보면 **둘 다 보내는 버그가 통과한다.**
  - 가드가 `finalVideoPath` 와 `openablePath` 를 **쌍으로** 본다. **한쪽만 있는 상태가 정확히 위험한 상태**(열 수 있어 보이는데 열면 남의 폴더)이고, 계약이 "둘은 항상 같이" 라는데 하나씩만 보면 **계약이 금지한 조합을 가드가 통과시킨다.**
  - 나레이션 낡음이 서버 목록을 그대로 쓴다. **기존 테스트만 두면 추론으로 되돌려도 초록**이라(1번 지우고 2번 남기는 건 추론도 하던 일) 반대 방향을 새로 썼다 — **재생성 후 만지지도 않은 장면에 표시가 새로 켜진다.** 예전 추론은 **지우기만 했지 켤 수는 없었다.** D-034 와 같은 자리다.
- [x] **🟠 28 — 확인창이 약속하는 "다시 꺼낼 수 있습니다" 에 갈 데가 없다 → 2026-08-30 `6560c22` 로 이미 해결됨, 이 항목이 낡았다 (2026-09-05 확인)**: 문구는 이미 맞게 적혀 있고 **일부러 안 고쳤다** — 무르게 하면 *"되돌릴 수 있으니 확인 문구로 충분하다"* 는 판단의 근거가 같이 무너지고, 화면을 만들면 **캡틴D가 범위에서 뺀 27을 몰래 하는 것**이 된다.
  - 대조로 확인했다: `GET .../episodes/archives`, `POST .../episodes/archives/:archiveId/restore`, `DELETE .../episodes/:n` **셋 다 있고 복구가 실제로 된다**(보관 → 목록 → 복구 → 목록 비었음까지 테스트가 돈다. 승인 없는 요청·경로 탈출도 막는다).
  - **데이터 살아 있음 · 라우트 살아 있고 검증됨 · 화면 없음.** 백엔드는 이미 값을 치렀고 남은 건 화면뿐이다.
  - 🟢 **2026-09-05 재확인: 화면이 있다.** `6560c22`(2026-08-30) 가 `LongProjectDetail` 에 「보관한 회차」 접이식 목록을 붙였다 — 열 때만 조회하고, 되돌리기 버튼·빈 상태·오류 문구가 다 있고, 짝 다섯이 지킨다. 확인창의 *"아래 「보관한 회차」에서"* 는 **같은 화면 아래를 정확히 가리킨다.**
  - 🟠 되돌리기는 **모든 회차가 초안일 때만** 된다. 보관 버튼도 같은 조건이라 **약속한 순간에는 참**이고, 그 뒤 대본을 시작해 조건이 깨지면 목록이 *"작업 중인 회차를 정리한 뒤에 다시 시도해 주세요"* 라고 그 자리에서 말한다. **확인창 문구는 안 고쳤다** — 참인 순간에 조건을 덧붙이는 건 그 시점에 없는 걱정을 만드는 것이고, 조건이 깨진 자리에는 이미 설명이 있다.
  - **아무 코드도 안 고쳤다.** 캡틴D의 "효율적인 방법" 에 대한 답은 *이미 되어 있다* 였다 — 확인하고 항목만 닫는다.
- [x] **커버 사진 — 캡틴D 승인, 계약 나감 (`fbedfb5`)**: Cowork 이 **확인 못 한 것을 추측으로 안 적고 넘긴 것**이 이 항목의 값이었다. 답은 **된다** 이고, 근거는 그쪽이 본 페이지가 아니라 **resumable-uploads 문서 자체**에 있었다 — 컨테이너 생성 요청의 Reels 선택 파라미터 목록에 `thumb_offset` 이 `caption` 과 **같이** 들어 있다. 우리는 그 호출로 caption 을 이미 보내고 그건 도착한다: **같은 목록·같은 호출·이미 작동하는 이웃**이 진짜 게시 없이 확인할 수 있는 최대치다.
  - **예제에 안 나오는 것은 신호가 아니었다** — 그 예제는 선택 파라미터를 하나도 안 보여준다(`caption` 도 없다).
  - `cover_url` 은 안 만들었다: *"the image must be on a public server"* 이고 로컬 파일은 Meta 가 가져갈 데가 없다. **둘 다 주면 `cover_url` 이 이긴다**는 것도 확인했다.
  - **옵셔널인 이유가 `caption` 과 정반대다**: 기본값 0(첫 프레임)이라 **안 보내는 것과 0을 보내는 것이 같은 릴**이다. 빠진 캡션은 영영 없을 캡션이지만 **빠진 커버는 어차피 됐을 커버**다.
  - **0 은 진짜 선택이라 그대로 싣는다.** `if (thumbOffsetMs)` 로 거르면 첫 프레임을 고른 사람의 선택이 사라지고, 그 주입에 테스트가 빨개진다.
  - 음수·소수·NaN 은 **거절**이지 반올림이 아니다 — **사람이 안 고른 프레임이 커버가 되면 기능이 안 되는 것과 구분이 안 되고**, 되돌릴 수 없는 게시 직전 마지막 호출이다.
  - 🟢 **상한은 일부러 안 걸었다**: 영상 길이를 넘는 값을 Meta 가 어떻게 다루는지 문서에 없다. **모르는 것을 아는 척하는 검증을 넣지 않는다.**
- [x] **커버 화면 — 보고 있는 그 화면이 그대로 커버 (Cowork, `4862054`)**: **빨간 채로 낸 라운드**였고, 쓰시는 동안 계약이 나가서 **그 이유가 사라져 초록이 됐다** — 아무것도 안 고쳤다. 21번 때와 같은 순서다: **빨간 테스트가 "서버가 아직 안 받는다" 를 문장보다 정확히 말한다.**
  - 🟢 **"안 고른 것" 은 0 이 아니라 키 자체를 뺀다.** 같은 게시물이 나오지만 뜻이 다르다 — **아무도 안 만진 것**과 **사람이 첫 프레임을 고른 것**. 테스트가 `toBe(undefined)` 가 아니라 `Object.keys` 로 보는 게 핵심이다: 앞엣것은 **키가 있고 값이 undefined 인 요청을 통과시킨다.** 서버도 같은 구분을 지킨다(`!== undefined` 로 보고 **0 은 그대로 싣는다**).
  - **장면 목록이 아니라 재생 위치**로 바꾼 판단: 장면으로 고르면 **사람이 못 본 순간을 이름으로 고르는 것**이고, 미리보기로 장면 생성 이미지를 띄우면 **그건 그 프레임이 아니다** — 영상은 그 그림에서 *움직여서* 만들어졌다. **보여준 것과 나가는 것이 다른 화면**이 하나 더 생길 뻔했다.
  - `currentTime` 이 유한하지 않거나 음수면 **조용히 아무것도 안 한다.** 못 잰 것을 0 으로 적으면 **위에서 나눈 두 뜻이 거기서 다시 섞인다.**
  - 🟢 **캡틴D 질문("왜 이렇게 오래 걸리냐")이 설계를 줄였다**: 처음 잡은 canvas 미리보기 대신 **이미 화면에 있던 플레이어**를 쓰는 것으로 바뀌었고, 그래서 어긋날 자리도 테스트 불가 구간도 없어졌다. **있는 것을 먼저 보는 게 제일 싸다.**
- [x] **🟢 이미지 보관함이 뭘 셌는지 말하게 했다 — 버그가 아닌데 화면이 버그처럼 보이게 했다 (Cowork, `7d67f0e`)**: 캡틴D — *"장기 프로젝트로 만든 사진은 왜 이미지 보관함에 없어"*. **먼저 쟀고, 있었다** — 12장 안에 회차 6장이 이미 들어 있었고 68바이트 자리표시자는 `isPlaceholderImage` 가 정확히 걸러내고 있었다.
  - **그래도 캡틴D 말이 맞았다**: 요약이 *"12장"* 이라고만 하고 **두 덩어리라는 말이 없었다.** 열면 단편 그리드가 먼저 나오고 회차 제목은 네 줄 아래다. 회차 그림을 찾는 사람은 **먼저 나온 그리드를 훑고 없다고 결론내고, 그건 틀린 결론이 아니다** — 화면이 위치를 알려준 적이 없다.
  - **한 종류만 있으면 제목도 분해도 안 붙인다** — 없는 구분에 대한 소음은 **다음번에 진짜 구분이 생겼을 때 안 읽히게 만든다.**
  - 🟢 **이번 주 다른 것들과 반대 방향이다**: 대부분은 **화면이 확인 안 한 것을 주장한** 경우였고 테스트로 잡힌다. 이건 **화면이 확인한 것을 말 안 한 것**이다. 회차 행 렌더링을 보는 테스트 둘이 이미 있었고 **초록이었고, 그래도 사람은 못 찾았다.** D-023 계열과도 다르다 — 테스트가 정확히 맞는 것을 재고 있었는데 **그게 사람이 겪는 것과 다른 질문**이었다.
  - **"기능이 있다" 와 "사람이 그게 있는 줄 안다" 는 다른 상태고, 테스트는 앞엣것만 본다.**
  - 순서도 옳았다: **"버그 아님" 을 먼저 확정하고 화면을 고쳤다.** 반대로 했으면 자리표시자 필터를 의심하다 멀쩡한 것을 건드렸을 것이다.
- [x] **🔴 회차 이미지가 자산 폴더로 등록되지 않았다 — 등록한다 (`2995e44`)**: 캡틴D — *"프로젝트 파일처럼 장기 프로젝트도 에피소드마다 이미지 확인할 수 있도록 폴더 만들어 달라"*. 회차는 `collectReferenceImages` 로 **읽으러만 가고 등록하러는 안 갔다.** 그림은 디스크에 있고 인덱스에는 없어서, **폴더 모양의 기능 전부**(대표 이미지·폴더 설명·다음 회차 참고로 갖다 쓰기)가 붙을 데가 없었다.
  - **경로를 인자로 받게 했다.** `<projectsRoot>/<id>/images` 는 **단편의 모양일 뿐**이고 회차는 `long_story/EpisodeNN/images` 다. 두 번째 코드 경로를 만드는 대신 인자로 바꾸자 **컴파일러가 호출부를 전부 짚었다** — `943261c` 에서 배운 그 방식이다.
  - **키가 프로젝트와 회차를 같이 부른다**(`long/Episode01` = `EpisodeMappingOwner.id` 가 이미 쓰는 형태). 프로젝트만 부르면 **두 회차가 폴더와 장면 키를 공유해서 2화 1번을 승인하면 1화 그림이 잡힌다.** 테스트가 정확히 그걸 본다. 🟢 **스키마 변경도 마이그레이션도 없었다** — 견적 때 읽은 대로 `source_project_id` 는 자유 문자열이고 되돌려 파싱하는 곳이 없다.
  - 🔴 **승인·재생성은 없으면 먼저 심는다**: 둘 다 기록을 찾고 **폴더가 없으면 손상으로 취급**한다. 한 번이라도 심긴 원본에는 맞는 판단이고, **이 기능 전에 생성된 회차에는 틀린 판단**이다 — 그런 회차가 **지금 디스크에 있다**(`projects/12/long_story/Episode01`). 안 넣었으면 **그 회차를 승인하는 순간부터 실패**했을 것이다. 기능을 더한 커밋이 있는 데이터를 깨는 자리는 여기처럼 조용하다.
  - 견적은 하루였고 **형제 함수 둘은 안 넓혀도 됐다**: 승인·교체는 경로를 이미 인자로 받고 **id 문자열만 달라지면 됐다.** 넓혀야 했던 건 등록 하나뿐이다.
  - 주입 둘로 쟀다: 키를 프로젝트만으로 되돌리면 셋이 빨갛고, 없으면-심기를 빼면 옛 회차 승인이 빨갛다.
- [x] **🔴 프로젝트를 보관하면 자산 폴더가 남고 그림만 죽었다 — B 안으로 고쳤다 (`bcd0d00`)**: `project-archive.ts` 에 **자산이라는 단어가 한 번도 안 나왔다.** 순수 디렉터리 이동이고 `stored_path` 는 절대 경로라 이동 뒤 전부 죽는다. **없어지는 것보다 나쁘다** — 없으면 *"아, 보관했지"* 인데 **있는데 그림이 안 뜨면 버그로 읽히고 디버깅당한다.**
  - **목록이 `.archive` 디렉터리를 호출 시점에 읽어서 거른다.** 보관은 디렉터리 이동이고 복구는 되돌리는 이동이니 **그 목록 자체가 이미 답**이다. 인덱스에 표시를 쓰면 **복구가 되돌려야 할 사본이 하나 더 생기고**, 두 쓰기 사이에서 죽으면 둘이 어긋난다. **B 를 고른 이유가 이것이고, 복구 쪽에는 코드가 한 줄도 없다.**
  - **폴더와 자식이 같이 사라진다.** 한쪽만 숨기면 **자식 없는 폴더**나 **주인 없는 그림**이 되고, 그건 고치려던 것과 같은 종류의 거짓말이다.
  - **영구삭제는 인덱스 먼저, 디렉터리 나중이다.** 둘 다 중간에 죽을 수 있고 **이 순서만 안전하게 실패한다**: 기록만 날아가면 다음에 열 때 다시 심긴다(`indexGeneratedProjectImages` 가 그 일을 한다). 반대로 디렉터리만 지워지고 기록이 남으면 **영영 그림을 못 보여줄 항목**이 남는데, 그때는 **보관 상태가 아니라서 숨겨지지도 않는다.**
  - 🟠 **`remove()` 를 일부러 안 썼다**: 그건 다른 프로젝트 매핑이 가리키는 자산을 거절한다. **파일이 있을 때는 맞는 답이고 여기서는 틀린 답**이다 — 바이트는 디렉터리와 함께 가고, 남긴 기록은 **다시는 그림을 못 보여줄 목록 항목**일 뿐이다. 수동 업로드 자산은 `_asset_library_manual` 이라 애초에 안 걸리고, **자기가 심은 기록만 지운다.**
  - 사용자 폴더로 옮겨 둔 생성 이미지도 있을 수 있어서 **남는 폴더의 `child_asset_ids` · `thumbnail_asset_id` 를 같이 고친다.** 안 고치면 없는 id 를 가리키는 폴더가 남는다.
  - **양쪽 프로젝트 다 걸었다.** 회차 자산은 `long/Episode01` 로 **프로젝트와 회차를 같이** 부르므로(`EpisodeMappingOwner.id`) 매칭이 *프로젝트 자신 또는 그 안의 것*이다. 회차 등록(①)이 들어오면 **그날 이 자리를 다시 안 건드려도 된다.**
  - 🟢 **A 를 안 골랐다**: A 는 *보관된 프로젝트의 그림을 보관함 밖에서 계속 쓰고 싶은가* 에 "예" 일 때만 필요하고, 그건 **쓰기를 두 군데로 늘리는 값**을 치른다. 캡틴D가 그렇다고 하시면 그때 A 다.
  - 통합 테스트가 **화면이 보여주는 것과 실제로 열리는 것을 같이 본다** — 따로 보면 양쪽 다 멀쩡해 보이는 게 이 버그의 정체였다.
- [x] **🟠 회차 자산이 기대고 있는 것은 다른 파일의 게이트였다 — 고칠 것은 없었고, 테스트로 못 박았다**: ① 이후 회차 그림의 자산 기록은 `long_story/EpisodeNN` 을 이름으로 든다. 그런데 그 디렉터리는 **`EpisodeTimelineService` 가 옮긴다** — 보관은 `episode_archives/EpisodeNN-<시각>` 으로 옮기고, **복구는 떠난 번호가 아니라 마지막 번호로 되돌린다.** 아무도 기록을 다시 가리키게 하지 않고, 프로젝트 쪽 답(`listExcludingArchivedProjects`)은 `<projectsRoot>/.archive` 만 안다. **`bcd0d00` 이 고친 그 버그의 회차판**으로 보였다.
  - **그런데 지금은 일어날 수 없다**: 회차 보관은 `current()` 가 **모든 회차가 초안(`planned` · `outline_ready`)일 때만** 통과시킨다. 그림이 있는 회차는 보관 자체가 거절된다. **확인하고 나서 아무 코드도 안 고쳤다** — 안 재고 고쳤으면 `bcd0d00` 을 회차용으로 한 벌 더 만들었을 것이고, 그건 있지도 않은 상태를 위한 두 번째 쓰기였다.
  - 🟠 **위험한 건 그 이유가 두 파일 떨어져 있다는 것**이다. `draftStates` 에 상태를 하나 더하는 사람("끝난 회차도 치우게 해줘")은 자산 인덱스를 볼 이유가 없고, **넓혀도 지금은 아무것도 안 빨개진다.** 그래서 그 자리를 재는 통합 테스트를 넣고 `assetSource()` 주석에 이유를 적었다. 주입으로 쟀다 — `draftStates` 에 `images_review` 를 넣으면 빨개지고, 빼면 초록이다.
  - 짝을 같이 뒀다: **초안 회차는 보관되고, 그때는 자산도 없다.** 앞엣것만 있으면 "회차 보관이 아예 안 된다" 로도 통과해서 게이트가 사라진 날을 못 잡는다.
  - 🟢 **재점검에서 나왔다.** 우편함에 새 라운드가 없어서 방금 커밋한 것들을 다시 훑다가 나온 것이고, 이번 주 자기 정정들과 같은 경로다.
- [x] **🔴 보관한 프로젝트를 목록에서만 숨겼다 — 파일 상태 점검은 그것들을 "없는 파일" 로 계속 불렀다**: `bcd0d00` 이 `GET /assets` 를 고쳤는데 **같은 인덱스를 읽는 두 번째 화면을 안 봤다.** `auditFiles()` 는 `load()` 로 인덱스 전체를 훑어서, 보관한 프로젝트의 그림들을 **`missing` · "파일이 존재하지 않습니다"** 로 보고했다.
  - **고치려던 것과 같은 실패를 다른 화면으로 옮긴 것**이다: 사람은 보관함에서 **볼 수도 없는** 자산 이름을 점검 결과에서 읽고, 열 수도 고칠 수도 없는 것을 찾으러 간다. 보관은 "안 내놓는다" 가 답인데 점검만 계속 내놓고 있었다.
  - **D-029 의 모양 그대로다** — 유료 게이트가 아니라 읽기 쪽이지만, *한 곳만 고치고 같은 질문을 하는 나머지를 전수 조사하지 않았다*는 점이 같다. 인덱스를 사람에게 보여주는 자리는 둘이었고 하나만 고쳤다.
  - 고친 방법은 한 줄이다: 점검도 **목록이 내놓는 것과 같은 집합**(`listExcludingArchivedProjects()`)을 훑는다. 계약 변경 없고, "보관됨" 이라는 새 분류를 만들지 않았다 — 그건 화면 절반이 더 필요하고, **안 내놓는다는 답과도 어긋난다.**
  - 테스트 짝: 보관 전에는 셋이 `healthy` 로 잡히고(안 그러면 **아무것도 못 찾아서** 통과할 수 있다), 보관 뒤에는 수동 자산 하나만 남는다. 주입으로 쟀다 — `load()` 로 되돌리면 빨갛다.
- [x] **🔴 "사용 프로젝트" 가 회차를 안 셌다 — 회차가 쓰는 자산을 그냥 지울 수 있었다**: `usageProjects()` 는 `<projectsRoot>/<id>/asset_mappings.json` 만 읽었다. 회차는 **자기 매핑을 `long_story/EpisodeNN/asset_mappings.json`** 에 갖는다. 그래서 회차가 가리키는 자산에 대해 **"쓰는 곳 없음"** 이라고 답했다.
  - 이 답 하나에 **파괴적 동작 넷이 걸려 있다**: 자산 삭제 · 폴더 삭제 · 폴더 자식 삭제 · 소유 파일 삭제. 넷 다 통과시켰다.
  - 🔴 **조용히 돈이 틀어지는 자리다**: 지우면 회차 매핑에는 **아무것도 가리키지 않는 id** 가 남고, 다음 유료 이미지가 **사람이 고른 참고 없이** 생성된다. 읽을 수 없는 참고는 오류가 아니라 **누락으로 세어지기 때문에** 아무도 소리를 안 낸다. 화면은 그 전에 "사용 안 함" 이라고 말했다.
  - 🟠 **같은 파일 안에 이미 맞게 도는 짝이 있었다**: `invalidateDependents()` 는 회차를 **원래부터 걸어 다닌다.** 같은 관계를 묻는 두 함수가 한 파일에 있었고 **하나만 배웠다** — `bcd0d00`(목록만 고치고 점검을 안 본 것)과 같은 주 안에서 같은 모양이 두 번 나왔다.
  - 회차는 **앱의 다른 곳과 같은 이름**(`<projectId>/EpisodeNN`)으로 답한다. 계약 변경 없다 — `usageProjectIds` 는 그대로 `string[]` 이고 화면은 개수와 나열만 쓴다.
  - 테스트 짝: 회차 매핑이 가리키면 `["p2/Episode02"]` 이고 삭제가 `ASSET_IN_USE` 로 막힌다 · 안 가리키면 여전히 지워진다(**전부 "쓰는 중" 이라고 답하는 구현**을 잡는 짝). 주입으로 쟀다.
  - 🟠 **일부러 안 넓힌 것**: 보관된(`.archive`) 프로젝트의 매핑은 여전히 안 센다. 원래도 안 셌고, 보관은 "안 내놓는다" 가 답이라 지금 답과 어긋나지 않는다. 다만 **보관한 프로젝트가 쓰던 자산을 지우면 복구했을 때 깨진다** — 필요해지면 그때 별도 항목으로 다룬다.
- [x] **🟢 보관한 회차를 목록·복구하는 화면이 붙었다 — 확인창이 하던 약속에 드디어 뒷면이 생겼다 (Cowork)**: 회차 보관은 디렉터리를 `long_story/episode_archives/EpisodeNN-<시각>` 으로 옮기는 복구 가능한 동작이고 목록·복구 라우트는 `f5df92e` 로 이미 있었는데, **화면이 없어서 앱 안에서는 삭제와 구별되지 않았다.** 확인창은 그동안 *"지워지는 게 아니라 나중에 다시 꺼낼 수 있습니다"* 라고 말하고 있었고, **꺼낼 데가 없었다.** 28(타이핑 확인을 뺀 판단)의 근거가 이 문장이었으므로, 화면이 생긴 지금에서야 그 판단이 성립한다.
  - **화면이 말해야 할 다섯 가지를 계약과 함께 넘겼고 다섯 다 화면에 있다**(Round 354): ① 복구는 떠난 번호가 아니라 **마지막+1** 로 돌아온다 — 확인창이 누르기 전에 *"7화가 아니라 마지막 회차로 돌아옵니다 · 3화가 됩니다"* 라고 말하고 버튼 글자도 그 번호를 든다. ② 복구도 `current()` 게이트를 지나므로 **모든 회차가 초안일 때만** 되고, 막힐 때는 서버가 거절하기 전에 이유를 먼저 말한다. ③ 상한은 **화면에 숫자를 안 적고** 서버 오류를 그대로 띄운다 — `APP_MAX_LONG_PROJECT_EPISODES` 를 화면에 복사하면 기본값이 바뀌는 날 화면만 옛 숫자를 말한다. ④ `archivedAt` 이 없으면 *"보관 시각 모름"* — 폴더 이름에서 읽어내는 값이라 없을 수 있고, **못 읽은 날짜를 지어내지 않는다.** ⑤ 빈 상태가 *"보관한 적이 없습니다"* 가 아니라 *"표시할 회차가 없습니다"* — 서버가 읽을 수 없는 아카이브를 조용히 건너뛰므로 **화면에는 "없다" 고 말할 자격이 없다.**
  - **여는 순간에 부른다**(마운트가 아니라 `<details>` 토글). 이 화면에 오는 대부분은 보관한 회차를 찾으러 오지 않고, 보관 확인창이 이제 이 자리를 **이름으로** 가리킨다.
  - 🟠 **CLI가 프런트 테스트 한 줄을 고쳤다**: `fireEvent.toggle(...)` 은 Testing Library 에 없는 함수다. 타입체크가 TS2339 로 잡았고 **새 테스트 다섯이 전부 같은 줄에서 죽었다** — 즉 다섯 개가 아무것도 재고 있지 않았다. 브라우저가 하는 순서 그대로(`open = true` 뒤 `toggle` 이벤트)로 바꿨고 **단언은 건드리지 않았다.** D-034(빨간 테스트도 안전 신호가 아니다)의 또 한 사례다.

## 2026-08-30 밤 ~ 08-31 — 실사용 사이클 이후 재점검

이 절부터가 별도 세션이다. 앞의 `## 2026-08-29 …` 절이 08-30 작업까지 계속 받아 왔는데, **그 경계는 확인하지 않아서 옮기지 않았다** — 안 잰 것을 정리해 놓으면 정리된 것처럼 보인다.

시작은 캡틴D의 실사용 사이클이 참고 이미지 연결에서 멈춘 것이고(D-035), 그 뒤로는 **같은 모양을 계통적으로 훑은 기록**이다. 크게 넷이다:

```
못 읽는 파일이 앱과 그 수리 화면을 같이 막는다      연속성 메모 · 연결 검토 기록 · (검토 파일은 근거 있어 안 고침)
낡은 빌드 산출물이 조용히 돈다                      데스크톱 dist · 백엔드 번들 · 프런트/shared · (패키징은 보고만)
돈이 걸린 자리                                      예산 원장 · 영상 시작 잠금 · 보관 번호
데스크톱 셸                                         app.quit 낙하 · 테스트가 두 번 돌던 것
```

규칙으로 굳은 것은 `docs/06_DECISIONS.md` **D-035**(호출자가 알 수 없는 값을 요구하는 검사는 교착이다)와 **D-036**(못 읽는 파일을 낮출지 정하는 세 질문)이다.

- [x] **🔴 보관함에서 「만든 이미지」 폴더를 지우면 그 단편이 검토 화면에 갇혔다 — 없으면 다시 심는다**: 승인과 재생성 둘 다 자산 기록을 찾고 **폴더가 없으면 손상으로 취급**한다. 그런데 그 폴더는 **지울 수 있다** — `usageProjects()` 는 그 폴더에 대해 "쓰는 곳 없음" 이라고 답하고(매핑은 사람이 고른 참고를 가리키지 생성물을 가리키지 않는다), 그래서 아무도 삭제를 막지 않는다. 지운 뒤에는 장면 승인도 재생성도 전부 `IMAGE_REVIEW_STORAGE_ERROR` 였고, **빠져나갈 길이 이미지를 한 번 더 사는 것뿐**이었다.
  - 🟠 **회차에는 이미 이 가드가 있었다**(`indexAssetsIfMissing`, `2995e44`). 거기서는 이유가 *"인덱싱 이전에 생성된 회차"* 였고 여기서는 *"사람이 폴더를 지웠다"* 인데, **같은 상태에 같은 잘못된 판정**이다. 이번 주에 네 번 나온 그 모양이다 — 한쪽 주인만 배우고 형제를 안 훑은 것. 이번엔 방향이 반대여서, **새로 붙인 쪽이 가드를 갖고 원래 있던 쪽이 못 가졌다.**
  - **디스크가 원본이다.** 그림은 `projects/<id>/images/sceneN.png` 에 있고 자산 기록은 그걸 가리키는 파생물이라, 없으면 다시 심는 게 답이다. 반대 방향(삭제를 거절)은 **사람이 자기 보관함을 정리하지 못하게 막는 새 규칙**을 만들고, 이 폴더가 왜 특별한지 화면이 설명할 방법도 없다.
  - **가드는 물어보고 심는다.** 무조건 다시 심으면 `indexGeneratedProjectImages` 가 자식의 `description` 을 장면 글로 덮어쓴다 — 보관함이 생성 자식에게 허용하는 몇 안 되는 편집 중 하나라, **승인할 때마다 사람이 쓴 설명이 조용히 지워진다.**
  - 오류 어휘는 그대로 뒀다: 다시 심는 것도 실패할 수 있고(장면 파일이 없는 경우), 그때는 **전과 같은 `IMAGE_REVIEW_STORAGE_ERROR`** 다. 자산 쪽 오류 코드가 프로젝트 라우트로 새어 나가지 않는다.
  - 주입 둘로 쟀다 — 호출을 빼면 둘이 빨갛고(승인·재생성), 조건을 빼면 설명 보존이 빨갛다.
- [x] **🔴🔴 실사용 사이클이 참고 이미지 연결에서 멈췄다 — 화면이 스스로 빠져나올 수 없는 상태였다 (Cowork 보고)**: 캡틴D — *"연결을 다 했는데 빨간색으로 다음으로 못 가게 하는데 · 지금 대본으로 다시 맞추기를 눌러도 저게 나온다"*. `beginReview` 가 요청의 `scriptRevision` 이 소유자의 현재 값과 같기를 요구했는데, **화면은 그 값을 알 방법이 없다** — 읽을 수 있는 건 *검토 기록에 적힌* 리비전이고, 그 필드를 쓰는 것이 begin 성공 그 자체다. 자세한 근거는 `docs/06_DECISIONS.md` **D-035**.
  - **막히는 경로**: 매핑을 먼저 저장하면 `invalidateReview` 가 파일 없을 때의 기본값으로 기록을 만든다(`script_revision: 0`, 지문 `""`, `mapping_revision: 1`). 회차 대본은 이미 1 이다. 화면은 0 을 보내고, begin 은 거절하고, **기록은 0 그대로라 다음에도 0 을 보낸다.** 승인도 같이 막힌다 — 지문은 begin 만 채운다.
  - **A 안으로 갔다(Cowork 추천과 같음)**: 요구를 뺐다. 요청의 숫자는 **저장된 적이 없고 비교에만 쓰였다** — 기록은 어차피 `owner.scriptRevision` 과 현재 장면들로 쓰인다. 낙관적 검사는 `approveReview` 의 `scriptFingerprint` 가 이미 하고 있고, 그건 화면이 **실제로 받아 들고 있는 값**이라 물을 자격이 있다. B(응답에 소유자의 현재 리비전을 실어 화면이 echo)는 **서버가 방금 알려준 값을 되돌려 받는 검사**라 왕복 한 번 말고는 증명하는 게 없다.
  - 계약: `BeginProjectAssetMappingReviewRequest.scriptRevision` 을 **선택 필드로 바꾸고 무시한다.** 보내던 화면이 그대로 컴파일된다(Cowork 쪽 변경 0). 아무도 안 보내게 되면 그때 지운다.
  - 🔴 **이 검사를 못 박고 있던 테스트가 있었다** — `"will not approve a review begun against a different script revision"`. **교착을 못 박고 있었다.** 막혔던 상태를 그대로 재현하고 풀리는 것을 보는 테스트로 바꿨고, 짝으로 approve 의 지문 검사가 여전히 거절하는 것을 같이 둔다(안 그러면 아무것도 검사 안 하는 구현이 앞엣것을 통과한다).
  - 🟢 **캡틴D 실제 데이터 사본으로 확인했다**(원본 미변경): `projects/12/long_story/Episode02` 의 굳어 있던 `script_revision: 0 · 지문 ""` 가 begin 한 번으로 `script_revision: 1 · 지문 522a7419…` 로 덮여 쓰이고 승인까지 간다. **파일을 손으로 고칠 필요가 없다** — Cowork이 물어본 것이 이것이다.
  - 주입 둘로 쟀다 — 검사를 되돌리면 회복 테스트가 빨갛고, approve 의 지문 검사를 없애면 짝이 빨갛다.
- [x] **🔴 회차 이미지 진행 표시가 정작 첫 실행에는 안 떴다 (Cowork Round 358, `7ee4bc2`)**: 캡틴D가 2화 이미지 생성 중에 — *"지금 되고 있는거야?"* 여섯 줄 전부 `대기 중`, 진행 패널 없음. **6장을 사는 2~5분 내내** 그랬다.
  - **조건이 자기 자신을 기다렸다**: 패널은 `status === generating_images` 를 봤고, 화면이 그 상태를 아는 길은 ① POST 응답 ② 폴링 두 개뿐인데 **POST 는 6장을 다 그린 뒤에 답하고, 폴링 시작 조건이 같은 상태였다.** 서버는 루프 전에 상태를 써 두는데(`episode-images.service.ts:209`) 아무도 그걸 읽으러 가지 않았다.
  - 고친 것은 값 하나다 — `generationPending || status === "generating_images"` 를 패널·시계·장면 줄·폴링 게이트가 함께 본다. **단편이 Round 338 부터 쓰던 모양**이고 회차에만 없었다. 늦게 도착한 폴 응답이 완료 상태를 덮는 경합도 `generationSettled` 로 같이 막았다.
  - 🔴 **CLI가 같은 파일에서 한 줄 더 옮겼다**: `runStartedAt` 을 **요청을 보내는 순간**에 찍는다. 끝에 두면 실행 내내 `null` 이라, 패널이 *"이 화면에 들어오기 전부터 진행 중이던 생성입니다 · 시작한 시각은 알 수 없습니다"* 를 띄웠다 — **두 줄 위에서 자기가 시작한 실행에 대해서.** Cowork의 새 테스트가 정확히 이걸 잡았다(그쪽 하네스는 타입체크+주입이라 초록이었고, **실행해야만 나오는 종류**다 — `D-034` 의 또 한 사례).
  - 🟢 **테스트가 없던 이유가 이 라운드의 값이다**: 기존 테스트는 전부 **이미 돌고 있는 회차를 화면이 발견한 경우**였다. 스텁이 처음부터 `generating_images` 를 답하니 패널이 당연히 떴다. **화면이 시작한 실행을 한 번도 안 봤고, 그게 모든 첫 실행이다.** 새 테스트는 POST 를 진짜처럼 매달아 둔다(`mockReturnValueOnce(new Promise(...))`).
  - 진행률은 **안 세기로 했다**: `getLongEpisodeImagePreview` 가 `asset_mapping_approved` 가 아니면 거절해서 생성 중엔 못 부른다. 세는 척하는 대신 시계와 문장만 둔다 — 근거 없는 진행바는 화면이 못 지키는 주장이다.
  - 주입 둘로 쟀다 — `generationPending` 을 빼면 빨갛고, 시각 찍는 자리를 되돌려도 빨갛다.
- [x] **🟠 "8화부터 써도 되는 비밀" 게이트가 축출에 안 걸리는 것을 아무도 안 재고 있었다 — 고칠 것은 없었고, 테스트로 못 박았다**: 캡틴D가 3화 이후로 가시니 **회차 번호에 걸린 경계**를 먼저 봤다. `buildEpisodeContext` 의 경계 자체는 맞다 — `reveal_available_episode <= episodeNumber` 면 `revealable_information`, 크면 `forbidden_information`, 없거나 정수가 아니면 1(= 1화부터, 스펙 그대로).
  - **위험은 그 옆의 축출 루프였다.** 페이로드가 `maxCharacters` 를 넘으면 오래된 요약 → 오래된 연속성 → 후순위 복선 순으로 버리고, 다 버려도 넘으면 던진다. **`forbidden_information` 은 사다리에 없다 — 그게 맞다.** 그런데 **사다리에 끼워 넣어도 백엔드 1199개가 전부 초록이었다.** 기존 축출 테스트는 *버려지는 것들의 순서*만 보므로, 이것까지 버리는 구현도 통과한다.
  - 🔴 **버려졌을 때가 조용하다**: 다른 섹션은 버려지면 대본이 기억을 좀 잃는다. 이건 버려지면 **"그 반전은 아직 쓰면 안 된다"는 말을 한 번도 들은 적 없는 프롬프트**가 나가고, 8화 반전이 3화에 나온다. 오류가 안 난다 — 대본은 생성되고, 읽으면 멀쩡하고, **장기 프로젝트가 존재하는 이유 그 하나에 대해서만 틀려 있다.**
  - 짝으로 뒀다: **다 버려도 안 맞으면 게이트를 버리는 대신 던진다** · **버려도 되는 것을 버리는 동안 금지 목록은 통째로 남는다.** 뒤엣것만 있으면 **아무것도 안 버리는 구현**이 통과한다.
  - 주입 둘로 쟀다 — 사다리에 넣으면 1개 빨강, 축출을 아예 끄면 4개 빨강.
  - 🟢 **코드는 한 줄도 안 고쳤다.** 재점검에서 나온 것이고, `episode-archive-assets.integration.test.ts` 와 같은 종류다 — **지금 맞게 되어 있는 이유가 다른 곳에 있어서, 그 이유가 사라지는 날 아무것도 안 빨개지는 자리.**
- [x] **🟠 백엔드 테스트가 부하만 걸리면 빨개졌다 — 이름이 매번 바뀌던 그 플레이크의 정체 (`Round 358` 에 적었던 미해결)**: 앞 라운드에서 이름을 못 잡고 넘어간 1건을 **부하 조건에서 재현**했다. 프런트 스위트를 동시에 돌리면서 백엔드를 돌리자 **3회 중 3회, 매번 다른 2~4개**가 빨개졌다.
  - **전부 5,000~5,300ms 에서 죽었다.** 로직 플레이크가 아니라 **5초 기본 타임아웃**이다. 이 스위트는 디스크를 실제로 쓰는 테스트가 많고(D-017 — 픽스처로 상태를 써 넣지 않는다), 무거운 것들은 한가한 윈도우 머신에서도 **1~3.5초**가 정상이다. 천장까지 여유가 **1.4배**였고, 그건 여유가 아니다.
  - 🔴 **이름이 매번 바뀌는 것이 진단이었다.** 한 테스트가 계속 빨간 게 아니라 *그때 느렸던 것*이 빨갰다 — 머신이 바빴다는 신호지 결함의 신호가 아니다. 그리고 **다른 게 돌고 있어서 빨개지는 스위트는 사람에게 "읽지 말고 다시 돌려라" 를 가르친다.** 진짜 실패가 그렇게 통과된다(`D-034` 의 반대 방향 — 빨간 게 안전 신호가 아니듯, **빨간 게 위험 신호가 아니게 되는 것**도 같은 값의 손실이다).
  - `testTimeout: 20_000` 을 백엔드 `vitest.config.mts` 에 뒀다. **새 숫자가 아니다** — 기본값을 이미 넘겨 본 테스트 넷이 각자 인라인으로 고른 값이 20초다. 같은 판단을 **아직 안 물렸을 뿐 똑같이 참이던 자리**에 적용한 것이고, 통과하는 실행은 느려지지 않는다(타임아웃은 실패의 상한일 뿐이다).
  - 재현이 주입을 겸했다: 고치기 전 같은 부하에서 **3회 중 3회 빨강**, 고친 뒤 **3회 중 3회 초록**(1201 통과).
  - 🟢 **숨기지 않은 것이 값이었다.** 앞 라운드에서 "이름 못 잡은 플레이크 1건" 을 회신에 적어 뒀기 때문에 다음 바퀴에 쫓아갈 대상이 남아 있었다. 초록으로 넘겼으면 이건 계속 남았다.
- [x] **🟠 영상 생성 시작이 잠금 밖에 혼자 있었다 — 단편·회차 양쪽 (`이번 라운드`)**: 캡틴D가 3~10화 영상을 계속 사실 거라 **돈이 걸린 자리**부터 봤다. 이 파일과 형제들에서 유료에 닿는 경로는 전부 `withProjectLock` 안에 있는데(`advanceReal`, 복구, 대본, 내레이션, 게시) **`start()` 만 밖에 있었다.** 단편(`local-video-submission.service.ts`)도 같은 모양이었다.
  - **짐작하지 않고 돌려서 쟀다.** 다른 `userRequestId` 로 `start()` 를 동시에 두 번:
    ```
    고치기 전   OK <jobA> | OK <jobB>      디스크에는 6개 기록 · job 1개
    고친 뒤     OK <jobA> | REJ LONG_EPISODE_VIDEOS_NOT_ALLOWED
    ```
  - 🟢 **돈은 안 샜다 — 그리고 그 이유가 `userRequestId` 가 아니다**(`docs/04_INTERNAL_API_CONTRACT.md` 가 명시하는 그대로). 기존 기록을 **상태 게이트보다 먼저** 읽기 때문에, 첫 요청이 `videos_generating` 을 쓴 뒤 도착한 요청은 게이트에서 막혀 쓰기까지 못 가고, 그 전에 도착한 요청은 **빈 파일을 봤으므로 덧붙이지 않고 덮어썼다.** 12개 기록은 이 순서에서 안 나온다. **순서의 우연으로 안전했던 것**이고, 그래서 못 박았다.
  - 🔴 **깨져 있던 건 그 옆이다**: 진 쪽이 **jobId 를 받아 갔는데 그 job 은 디스크에 없다.** 화면은 *"생성을 시작했습니다"* 를 띄운 뒤 그 id 로 물을 때마다 `LONG_EPISODE_VIDEO_JOB_NOT_FOUND` 을 받는다. 잠근 뒤에는 진 쪽이 기다렸다가 **게이트에서 정직하게 거절**당한다.
  - **D-029 그대로 양쪽을 같이 훑었다** — 유료 호출을 감싸는 게이트는 한 곳만 고치지 않는다. 단편 쪽은 새 오류 코드를 안 만들고 같은 디렉터리가 이미 쓰는 `PROJECT_LOCKED`(`videoWorkflowLocked`)을 쓴다. **계약 변경 없다.**
  - 짝으로 뒀다: **동시 둘은 하나만 통과하고 진 쪽은 거절** · **같은 `userRequestId` 를 두 번 눌러도 같은 job 을 돌려준다.** 뒤엣것이 없으면 **직렬화가 사람의 재시도를 거절로 바꾸는 구현**이 통과한다.
  - 주입 둘로 쟀다 — 회차 잠금을 빼면 1개 빨강, 단편 잠금을 빼면 1개 빨강.
- [x] **🟠 회차 목록이 "이어쓰기 메모가 저장돼 있는가" 를 말할 수 있게 됐다 — 계약 하나 (Cowork Round 361)**: 메모는 **손으로만** 쓰이고 자동으로 쓰이지 않는데, 뒤 회차 대본 프롬프트는 앞 회차 메모를 전부 읽고 **없는 것은 조용히 건너뛴다**. 그래서 메모 없는 회차는 그 뒤 모든 대본에 아무것도 기여하지 않고, **그걸 알아내는 유일한 방법이 완성된 대본을 읽는 것 — 결제한 뒤**였다. (실제로 캡틴D의 `12/Episode01` 에 메모가 없다.)
  - 계약: `LongEpisodeOutline.continuitySaved?: boolean`. **옵셔널이고, 없으면 "여기서 판정 못 함" 이지 "메모 없음" 이 아니다.** 화면이 부재를 「메모 없음」으로 그리면 확인하지 않은 것을 주장하는 것이고, 그게 이번 주 내내 고친 그 모양이다.
  - **`outlines()` 안이 아니라 `project()` 에서 붙인다.** 보관·회차수 변경 경로도 `outlines()` 를 부르는데 그쪽은 회차마다 stat 할 이유가 없다.
  - 🟠 **주석을 사실에 맞게 낮췄다**: 처음엔 *"ENOENT 외의 실패는 undefined"* 라고 적었는데, **윈도우는 디렉터리가 아닌 경로 아래를 물어도 ENOENT 를 준다**(실제로 돌려서 확인했다). 그 경우는 어차피 읽을 메모가 없으므로 `false` 가 정직하다. 권한 오류 같은 나머지만 `undefined` 다.
  - 테스트가 **회차 셋을 한 번에** 본다(`[true, false, false]`). 한 줄만 보면 **모든 회차에 같은 답을 주는 구현**이 통과하는데, 이건 이 기능을 틀리기 가장 쉬운 모양이다. 주입 둘 — 회차별이 아니게 만들면 빨강, 아예 안 붙이면 빨강.
- [x] **🟢 프런트 스위트의 느린 테스트 시간을 재서 Cowork에 넘겼다**: 그쪽 하네스는 타입체크뿐이라 실행 시간을 못 잰다. 상위: **3238ms · 1527ms · 1221ms**, 그 아래로 576ms 로 뚝 떨어진다. **천장 5초까지 배율 1.54배** — 백엔드가 1.4배였던 것과 사실상 같다. 숫자만 넘기고 판단과 변경은 그쪽 몫으로 뒀다(`apps/frontend` 는 Cowork 구역).
- [x] **🔴 이어쓰기 메모 파일 하나가 깨지면 유료 단계와 그것을 고칠 화면이 **둘 다** 막혔다 — 그리고 제가 한 시간 전에 넣은 필드가 거기다 거짓말을 하고 있었다**: `continuitySaved` 를 붙이면서 *"뒤 회차 대본이 앞 회차 메모를 읽고 없는 건 조용히 건너뛴다"* 는 걸 알게 됐고, **깨진 건 어떻게 되는지** 돌려서 쟀다.
  ```
  2화 대본 생성    THREW LONG_PROJECT_JSON_MALFORMED
  1화 연속성 화면  THREW LONG_PROJECT_JSON_MALFORMED
  타임라인        continuitySaved: true
  ```
  - 🔴 **앱 안에 빠져나갈 길이 없었다.** 대본이 막히는데, 그 메모를 다시 쓸 수 있는 **유일한 화면도 같은 이유로 안 열린다.** `beginReview` 교착(D-035)과 같은 모양이 다른 파일에서 한 번 더 나온 것이다.
  - **메모는 설계상 선택이다** — 자동으로 쓰이지 않는다. 그러니 **깨진 메모는 없는 메모와 같게 낮아져야** 한다. 스펙이 대표 캐릭터 링크에 대해 이미 그렇게 적어 뒀고(*"보관함 파일 하나가 유료 단계를 막지 않는다"*), 같은 파일의 `protagonistName()` 이 그 모양으로 되어 있다. 이쪽만 안 배웠다.
  - **화면은 열린다**: 못 읽는 메모는 `memory: null` 로 온다. 그 화면은 null 을 이미 다룰 줄 안다 — 개요로 미리 채우고 *"미리 채웠다"* 고 말하며, **저장이 곧 수리**다.
  - 🔴 **`continuitySaved` 는 `stat` 이 아니라 읽어서 판정한다.** 파일이 있는데 못 읽으면 **저장된 메모가 아니다** — 대본 프롬프트가 없는 것과 똑같이 건너뛰므로. 처음 구현이 `stat` 이라 **화면이 확인하지 않은 것을 주장**하고 있었다. 이번 주 내내 고친 그 모양을, **고치는 커밋 안에서 내가 새로 만들었다.**
  - 엔진에서는 조용히 건너뛰고 **사람에게는 화면이 말한다** — `continuitySaved: false` 가 그 근거고, Cowork이 붙일 *"1화 메모가 없어서 참고되지 않습니다"* 가 그 자리다. 조용함과 침묵은 다르다.
  - 상태 코드가 아니라 **오류 코드**로 판정한다(`isLongProjectError`). `LONG_PROJECT_JSON_MALFORMED` 와 `LONG_PROJECT_STORAGE_ERROR` 가 **둘 다 500** 인데 *"읽을 게 없다"* 는 뜻인 건 하나뿐이다.
  - 🟠 **이 교착을 못 박고 있던 단언이 있었다** — `"rejects malformed memory..."` 안의 `get` 이 `LONG_PROJECT_JSON_MALFORMED` 로 거절되는 것을 기대했다. 바꾸고 그 자리에 **깨진 파일 위에서 화면이 열리고 저장으로 고쳐지는 것**을 보는 테스트를 넣었다.
  - 짝: **못 읽는 메모는 건너뛰고 대본은 나온다** · **읽히는 메모는 여전히 프롬프트에 들어간다**(아래 순서 테스트). 뒤엣것이 없으면 **모든 메모를 무시하는 구현**이 앞엣것을 통과한다.
  - 주입 셋으로 쟀다 — `stat` 으로 되돌리면 빨강, 대본 쪽 코드 목록을 줄이면 빨강, 화면 쪽을 줄이면 빨강.
- [x] **🟢 "앞 회차 메모가 없어서 이 대본은 그 회차를 모른 채 쓰입니다" 를 유료 버튼 앞에서 말한다 (Cowork Round 364)**: 어제 올린 `continuitySaved` 가 화면에 붙었다. **결제 전에**, 대본 생성 버튼 바로 위다 — 지금까지는 대본을 다 만들고 읽어봐야 앞 회차가 빠진 걸 알았고 그때는 이미 결제된 뒤였다.
  - **막지 않는다.** 메모를 건너뛰는 건 허용된 일이고 일부러 그러기도 한다. 사실 + 빠져나갈 길만 적고 버튼은 그대로 둔다. 색도 sky다 — amber는 이 앱에서 "손봐야 한다" 자리라, **문장이 뭐라 하든 색이 먼저 읽힌다.**
  - **깨진 메모와 없는 메모를 화면에서 구분하지 않는다.** 사람이 할 일이 같다(그 회차 메모 화면에서 저장). 서버가 둘 다 `false` 로 답하는 것과 같은 이유고, 문구는 두 경우 다 참이다.
  - `continuitySaved === false` 만 센다 — **`undefined` 는 안 센다.** 옵셔널을 "모름" 으로 두기로 한 계약이 화면에서 그대로 지켜졌고, 그 자리를 보는 테스트가 따로 있다.
  - 🟠 **2화 이상일 때만 프로젝트를 한 번 더 부른다**(1화는 앞이 없다). 실패하면 **조용하다** — 못 읽은 것은 "메모 없음" 이 아니라 모르는 것이다.
  - 🟠 **회차 목록 표시는 보류**다. 유료 버튼 앞은 물어볼 것도 없지만(돈 + 조용히 틀림), 목록은 매번 눈에 띄는 자리라 **일부러 건너뛰는 사람에게는 잔소리**가 된다. 캡틴D 답을 기다린다.
- [x] **🔴 연결 검토 기록이 깨지면 검토 화면과 「다시 맞추기」가 같이 막혔다 — D-035 의 세 번째 얼굴**: 앞 라운드에서 고친 것과 **같은 계열을 계통적으로 훑다가** 나왔다. 돌려서 쟀다:
  ```
  asset_mapping_review.json 깨짐   review() ✗  beginReview() ✗   list() ○
  asset_mappings.json 깨짐         review() ○  beginReview() ○   list() ✗
  ```
  - **`beginReview` 는 그 기록을 카운터 하나 올리려고만 읽는다.** 하는 일이 *"옛 기준을 버리고 새로 쓰는 것"* 인데, 옛 기준이 안 읽히면 못 하게 되어 있었다. **캡틴D가 막혔던 그 버튼이 이번엔 다른 이유로 또 안 눌린다.**
  - **두 파일의 성격이 정반대라 답도 반대다** — `docs/06_DECISIONS.md` **D-036** 에 규칙으로 적었다. 검토 기록은 **파생물**(카운터·지문·상태)이라 없는 것으로 낮추고, `asset_mappings.json` 은 **사람이 고른 참고**라 낮추지 않는다. 뒤엣것을 낮추면 **다음 유료 이미지가 참고 없이 생성되고 아무도 소리를 안 낸다.**
  - **낮춘 값이 제한이지 허용이 아니다**: 기본값 `waiting` 이고, 승인은 여전히 현재 대본과 비교해 거절한다. 테스트가 그걸 같이 본다 — **잃어버린 승인은 다시 하는 것이지 가정되는 것이 아니다.**
  - 🟠 **`malformedReview()` 에 이제 호출자가 없다.** 프런트에 그 코드의 문구가 있어서(`mappingsApi.ts:43`) 지우지 않고 보고했다 — 지우면 공유 오류 어휘가 줄고 그쪽 파일도 같이 손봐야 한다.
  - 주입 둘로 쟀다 — 검토 기록을 다시 던지게 하면 빨강, 사람의 선택까지 삼키게 하면 빨강. **각각 다른 절반을 잡는다.**
- [x] **🟠 프런트 스위트도 20초로 올렸다 (Cowork Round 367) — 다만 부하 재현은 실패했고, 그 사실을 적는다**: 백엔드에서 한 것과 같은 변경을 `apps/frontend/vite.config.ts` 에 넣었다. 근거는 내가 잰 숫자였다(가장 느린 것 3238ms → 천장까지 **1.54배**, 백엔드 1.4배와 같은 자리).
  - 🔴 **그런데 재현이 안 됐다.** 백엔드 스위트를 동시에 돌리며 프런트를 3회, 더 세게(백엔드 + 프런트 한 벌 더 + 백엔드 빌드) 2회 — **고치기 전에도 5회 전부 초록**이었다. 백엔드는 같은 조건에서 3회 중 3회 빨갰다.
  - **배율은 같았는데 분포가 다르다.** 백엔드는 1~3.5초 구간에 **여러 개**가 몰려 있어서 조금만 느려져도 여러 개가 동시에 천장을 넘었다. 프런트는 1초 넘는 게 **셋뿐**이고 그 아래로 뚝 떨어진다(576ms). 같은 최댓값이어도 **천장 근처의 개체 수**가 다르면 부하에 대한 반응이 다르다.
  - 🟠 **내가 넘긴 "1.54배" 라는 요약이 그 차이를 지웠다.** 최댓값 비율만 말하고 분포를 말하지 않아서, 양쪽 다 같은 문제로 읽혔다. 숫자는 맞았고 **그 숫자로부터 끌어낸 결론이 과했다.**
  - **그래도 되돌리지 않는다**: 타임아웃은 **실패의 상한**이라 통과하는 실행을 늦추지 않고, 이 머신에서 안 났다는 것이 느린 CI나 다른 사람 노트북에서 안 난다는 뜻이 아니다. **다만 "고쳤다" 가 아니라 "예방" 으로 기록한다** — 안 재고 고친 것을 고쳤다고 적으면 다음 사람이 그걸 근거로 삼는다.
- [x] **🟠 D-036 을 계속 훑다가 반례를 만났다 — 검토 기록은 낮추지 않는다. 코드 변경 0**: 같은 계열의 나머지 보조 파일을 전부 돌려서 쟀다.
  ```
  video_generation_records.json 깨짐   progress ✗  start ✗    ← 유료 원장. 정확히 맞다(다시 안 산다)
  generated_image_reviews.json 깨짐    get ✗  approve ✗       ← 막다른 길. 낮추려 했다
  ```
  - 🔴 **낮추려다 기존 테스트 둘에 막혔고, 이름이 곧 반박이었다**: *"rejects damaged review JSON **without treating it as a pending decision**"* · *"does not replace image bytes when existing review metadata is malformed"*.
  - **`pending` 은 중립이 아니다.** 앞으로 나아가는 것에는 제한이지만 **재생성에는 아무것도 안 막고**, 재생성은 **현재 이미지를 덮어쓰고 유료일 수 있다.** 낮춘 값이 어떤 동작에는 제한이고 다른 동작에는 허용이다 — 내가 D-036 에 쓴 "제한이면 안전하다" 가 **동작별로 갈린다**는 걸 못 봤다.
  - **되돌렸다.** D-036 에 **세 번째 질문**을 추가했다 — *낮춘 값 위에서 파괴적이거나 돈 나가는 동작이 도는가.* **"파생물" 은 필요조건이지 충분조건이 아니다.**
  - 🟠 **막다른 길은 알면서 남긴다**: 검토 기록이 깨지면 화면이 안 열리고 승인으로 고칠 수도 없다. 그래도 **고장난 상태 위에서 파괴적 동작이 도는 것보다 큰 소리로 거절하는 편이 낫다**는 기존 판단이 내 것보다 낫다. 수리 경로가 필요하다고 판단되면 별도 항목으로 다룬다.
  - 🟢 **이 항목의 값은 규칙이 하루 만에 반례를 만났다는 것**이다. 앞의 세 건은 낮추는 게 맞았고 이건 아니다.
- [x] **🟠 못 읽는 파일 앞에서 화면이 나가는 문을 알려준다 — 두 파일에 정반대 문장 (Cowork Round 369)**: 서버가 큰 소리로 거절하기로 한 자리(D-036)에서, 화면은 빨간 줄만 있고 **막다른 길이라는 말도 나가는 문도 없었다.** 사람이 할 수 있는 게 새로고침을 다시 누르는 것뿐이었다.
  ```
  asset_mapping_review.json   지워도 안전   없으면 "대기 중" 새 기록으로 읽히고, 연결은 그대로 남는다
  asset_mappings.json         지우면 손실   없으면 "연결 없음" 으로 읽히고, 되돌릴 버튼이 없다
  ```
  - **두 번째가 없으면 첫 번째가 위험하다** — JSON 하나 지워서 화면을 고친 사람은 **옆에 있는 JSON 에도 같은 걸 한다.**
  - 🟢 **세 번째 테스트가 이 변경의 핵심**이다: `ASSET_MAPPING_STORAGE_ERROR` 에는 **둘 다 안 뜬다.** 이게 없으면 앞의 둘은 *"항상 뜬다"* 로도 통과하고, **디스크가 잠깐 바빴을 뿐인데 멀쩡한 파일을 지우라고 말하게 된다.**
  - 🔴 **CLI 확인: 검토 파일 쪽 안내는 지금 도달 불가다.** `ASSET_MAPPING_REVIEW_MALFORMED` 는 `eef4a38` 이후 **producer 가 없고**(그 커밋이 못 읽는 검토 기록을 새 기록으로 낮췄다), `ASSET_MAPPING_REVIEW_INVALID` 는 **읽기가 아니라 `saveReview` 의 내부 불변식 위반**에서만 나온다 — 파일을 지워도 안 풀린다. **매핑 파일 쪽 안내(지우지 마세요)는 도달 가능하고 문구도 정확하다**(`load()` ENOENT → `[]`, 되돌릴 경로 없음). 지우지 않고 보고했다 — 화면이 무엇을 말할지는 그쪽 결정이다.
- [x] **🔴🔴 예산 원장이 못 읽히면 "이번 달 0원" 으로 낮아졌다 — 다 쓴 예산이 조용히 다시 열렸다**: D-036 의 세 번째 질문(*낮춘 값 위에서 무엇이 도는가*)을 **판돈이 가장 큰 파일**에 적용했다. `openai-budget.ts` · `runway-budget.ts` 의 `load()` 가 **모든 실패를 `catch { return []; }`** 로 삼켰고, 여기서 `[]` 는 **"이번 달 아무것도 안 썼다"** 이며 그 위에서 도는 것은 **유료 Provider 호출**이다.
  - **돌려서 쟀다** — $10 한도에 $10 을 다 쓴 상태에서:
    ```
    원장 깨뜨림  →  spentThisMonth: 0
                 →  preflight($9.50): 통과   ← 다 쓴 예산이 다시 열린다
                 →  record() 한 번:  그달 기록 20건이 1건으로 덮인다   ← 증거까지 사라진다
    ```
  - **ENOENT 만 `[]` 로 남긴다**(파일이 없는 건 정직한 첫 실행이다). 파싱 실패·권한 오류·배열이 아님은 전부 **거절**한다. **얼마를 썼는지 모르는 채로는 안 쓴다** — 이게 유일하게 안전한 방향이고, 제품 규칙(*"모든 유료 요청은 공통 Budget 실행 경계를 통과한다"*)이 이미 가리키는 쪽이다.
  - 🟠 **`record()` 도 거절한다.** 안 그러면 읽고-실패하고-그래도 쓰는 것이 되는데, **그게 바로 기록을 덮어쓴 그 동작**이다. 던지면 바이트가 디스크에 그대로 남아 사람이 볼 수 있다. 대신 **이미 나간 돈 한 건의 기록을 잃는다** — 그래도 그달 전체를 잃는 것보다 낫다.
  - 🟢 **표시용 읽기는 갈랐다**: `costsByScene` 는 **사후 표시 전용**이고 그 숫자로 뭘 사지 않는다. 못 읽으면 `{}` 를 돌려줘서 **영상 검토 화면이 열 하나를 잃을 뿐 닫히지 않는다.** D-036 을 정확히 적용하면 같은 파일 안에서도 답이 갈린다.
  - 🔴 **기존 테스트 둘을 바꿨다** — `"...tolerates a malformed usage file"`. **지난 항목과 달리 이번엔 근거가 어디에도 없었다**: 이름이 주장이 아니라 동작 서술이고, 주석도 문서도 없다. 그리고 그 동작이 돈을 새게 하는 것을 쟀다. **근거가 적힌 결정은 존중하고, 안 적힌 동작은 재본다** — 이 둘을 같이 다루면 안 된다.
  - 짝: **못 읽으면 거절하고 바이트를 안 건드린다** · **없으면 여전히 0 이다**(뒤엣것이 없으면 첫 실행이 아예 못 쓴다). 주입 둘 — 되돌리면 1개 빨강, ENOENT 처리를 빼면 8개 전부 빨강.
- [x] **🔴 데스크톱 셸이 "서버를 못 켰다" 고 말한 뒤 그 서버로 창을 열었다 — `app.quit()` 뒤에 `return` 이 없었다**: 이번 세션에 한 번도 안 본 영역(`apps/desktop`)을 훑었다. 캡틴D가 매일 쓰는 껍데기다.
  - **`app.quit()` 는 앱에 닫아 달라고 부탁하고 즉시 돌아온다.** 이 함수를 멈추지 않는다. 그래서 오류 대화상자를 띄운 **바로 다음 줄**이 `BrowserWindow` 를 만들고 방금 실패했다고 알린 그 백엔드로 `loadURL` 했다 — 사람이 읽은 대화상자 뒤에 **크로미움의 "이 페이지에 연결할 수 없음"** 이 깔린다. 게다가 **종료 중에 창이 생기면 종료가 취소될 수 있어서**, 없는 백엔드를 향해 앱이 계속 떠 있게 된다.
  - 🟠 **`main.ts` 에는 테스트가 하나도 없다.** 그래서 **뭔가 이미 잘못됐을 때만 지나가는 그 한 경로**에 `return` 하나가 빠진 채 있을 수 있었다.
  - **결정만 뽑아서 잴 수 있게 했다**(`production-startup.ts`) — 같은 디렉터리의 `instagram-login-window.ts` 가 **정확히 그 이유로 그 모양**이다. Electron 접착부(창 생성·대화상자·진짜 quit)는 `main.ts` 에 남기고 주입한다.
  - 짝: **준비 안 되면 창을 안 연다**(호출 순서가 `["dialog", "quit"]` 뿐) · **준비되면 백엔드 포트로 연다.** 뒤엣것이 없으면 **창을 아예 안 여는 구현**이 앞엣것을 통과한다.
  - 주입 둘로 쟀다 — `return` 을 빼면 1개 빨강, 창을 아예 안 열게 해도 1개 빨강.
  - 🔴 **정정**: 그때 "데스크톱 스위트 48 → 50" 이라고 적었는데 **실제는 50 → 52** 다. 기준선을 재지 않고 *"내가 둘 더했으니 앞은 48이었겠지"* 로 역산해서 적었다. **안 잰 숫자를 잰 것처럼 적은 것**이고, 이번 주 내내 남의 코드에서 지적한 바로 그 모양이다. 커밋 메시지(`a2bd916`)에도 같은 숫자가 남아 있다 — 히스토리는 안 고치고 여기 적는다.
- [x] **🔴 보관 번호가 다시 001 부터 시작해 결제한 클립을 덮어쓸 수 있었다 — 단편·회차 양쪽**: 한 건씩 찾던 것을 그만두고 **전수 조사**로 바꿨다 — 삼켜서 기본값을 내는 자리(`catch { return [] / null / false / 0 }`)를 저장소 전체에서 35곳 뽑아 *"낮춘 값 위에서 무엇이 도는가"*(D-036)로 분류했다. 대부분은 `false`/`null` 이 **"못 쓴다"** 라서 제한적이고 안전하다. 하나가 아니었다.
  ```ts
  const versions = await this.historyVersions(...);              // readdir 실패 → []
  await this.binary(this.historyFile(..., (versions.at(-1) ?? 0) + 1), bytes);   // → v001
  ```
  - `archive()` 는 **밀려나는 클립을 `history/` 에 다음 번호로 복사**한다. `readdir` 이 ENOENT 아닌 이유로 실패하면(윈도우에서 흔한 잠금·권한·I/O) 목록이 비고 **번호가 001 로 되돌아가 이미 있는 `v001` 을 덮어쓴다.** 그 클립은 Runway 에서 산 것이다.
  - 🟢 **같은 동작의 이미지 쪽은 원래부터 맞게 되어 있었다**: `episode-images.service.ts` 의 재생성은 `mkdir` 후 `readdir` 을 **던지는 try 안에서** 한다. **한 질문에 구현이 둘이었고 하나만 덮어쓸 수 있었다** — D-029 의 모양이다.
  - ENOENT 는 그대로 `[]`(첫 보관이다). 그 외는 거절한다. 양쪽 다 고쳤다.
  - 🔴 **정직하게 적는다 — 새로 생긴 분기는 못 쟀다.** `readdir` 이 ENOENT 아닌 이유로 실패하면서 **쓰기는 성공하는** 상황을 이식 가능하게 만들 방법이 없다(디렉터리를 파일로 바꾸면 옛 코드도 쓰기에서 실패해 구분이 안 된다). 주입할 이음매를 새로 내는 것은 **테스트만을 위한 추상**이라 안 했다. 근거는 **저장소 안의 올바른 형제**(이미지 쪽)와 D-036 이다. 잰 것은 **ENOENT 쪽 절반**뿐이다 — 그쪽까지 던지게 하면 기존 테스트 8개가 빨갛다.
  - 🟠 **플레이크 후속**: 주입 복원 직후 한 번 1건이 빨갰는데 이후 **7회(단독 4 · 부하 3) 전부 초록**이었다. 소스를 덮어쓰는 중에 vitest 가 읽은 것으로 보이며, **내 주입 방식의 부작용이지 저장소 결함으로 볼 근거는 없다.** `b98657f`(타임아웃)로 다 설명되지 않는다는 것만 남겨둔다.
- [x] **🔴 데스크톱 테스트가 매번 두 번 돌고 있었다 — `dist` 의 컴파일 사본까지 주워서**: 앞 항목의 "48 → 50" 정정을 쫓다가 나왔다. **숫자가 안 맞는 걸 그냥 넘기지 않은 게 이 항목의 전부다.**
  ```
  node --test        인자 없이 실행 → src/*.test.ts 와 dist/*.test.js 를 둘 다 찾는다
  test() 26개        보고되는 수 52
  빌드 전/후         48 / 52 로 달라진다   ← 내 두 측정이 어긋난 진짜 이유
  ```
  - 🔴 **두 벌이 따로 돈다.** `dist/production-startup.js` 한 줄만 고치고 **소스는 그대로 두자 스위트가 빨개졌다.** 즉 **낡은 `dist` 가 아무도 안 쓴 코드로 스위트를 빨갛게 만들 수 있고, 반대로 이미 사라진 코드로 초록을 유지할 수도 있다.** 이 저장소가 계속 경계하는 *"초록이 무엇을 뜻하는지 모르는 상태"* 다.
  - **테스트를 타입체크에 넣는 것은 그대로 둔다** — 근거가 있다(`D-030`). 대신 **빌드 산출물에서만** 뺐다: `tsconfig.build.json` 이 `src/**/*.test.ts` 를 제외하고, `build` 만 그걸 쓴다. `typecheck` 는 원래 설정 그대로다.
  - 덤으로 **패키징된 앱이 자기 테스트를 싣지 않는다.**
  - 주입 둘로 쟀다 — 테스트 파일 안에 타입 오류를 넣으면 `typecheck` 가 잡고(D-030 이 지켜진다), 소스에 오류를 넣으면 `build` 가 거절한다. 스위트는 **26 으로 안정**됐다.
- [x] **🔴 `dev:desktop` 이 6일 묵은 백엔드를 띄우고 있었다 — 그 안에 캡틴D를 막았던 코드가 그대로 있었다**: 앞 항목(데스크톱 `dist` 사본)에서 배운 *"낡은 산출물이 조용히 돈다"* 를 같은 질문으로 한 칸 더 밀었다.
  ```
  apps/backend/dist-bundle/main.cjs   08-25 빌드
  백엔드 소스                          08-30 까지 계속 바뀜
  npm run dev:desktop                 desktop 만 빌드한다 — 번들은 안 만든다
  ```
  - **번들 안에 `"scriptRevision must match the current project script revision"` 이 남아 있었다** — `5a869d9` 로 지운, 캡틴D의 사이클을 막았던 바로 그 검사다. 즉 그날 데스크톱 셸을 켰으면 **고친 코드가 안 돌고 화면은 아무 말도 안 했을 것**이다.
  - 🟢 **캡틴D는 브라우저 쪽(`dev:backend` + `dev:frontend`)을 쓰셔서 실제로는 안 물리셨다.** `dev:backend` 는 소스를 watch 한다. 다만 *"앱을 껐다 켜세요"* 라는 내 안내는 **셸을 쓰는 경우에는 틀린 말이었다** — 껐다 켜도 번들은 그대로다.
  - 루트 `dev:desktop` 이 **번들부터 다시 만든다**. 몇 초 더 걸리는 값으로 셸이 항상 지금 소스를 띄운다. `docs/03_TEAM_WORKFLOW.md` 의 개발 서버 절에 이유와 함께 적었다.
  - 확인 방법도 남겨 둔다: **고친 커밋이 지운 문자열이 번들에 남아 있는지 보면 된다.** 다시 만든 뒤 그 문자열은 사라졌고 새 `load()` 가 번들 안에 그대로 들어 있다. 🟠 한글 문자열로 찾는 건 esbuild 가 비ASCII를 이스케이프해서 신뢰할 수 없다 — **ASCII 문자열로 확인한다.**
- [x] **🟠 앞 항목의 내 수정이 절반만 덮고 있었다 — `dev:desktop` 은 프런트엔드와 shared 도 산출물에서 읽는다**: 백엔드 번들만 다시 만들게 해놓고 **같은 구조의 나머지를 안 봤다.**
  ```
  frontendStaticDirectory()   apps/frontend/dist     ← dev:desktop 이 안 만든다
  백엔드 번들이 품는 shared    packages/shared/dist   ← 안 만든다
  ```
  - **지금 신선한 건 우연이다** — 내가 검증할 때마다 루트 `build` 를 돌리기 때문이다. 그 습관이 없는 사람에게는 백엔드 번들과 **정확히 같은 함정**이다.
  - `dev:desktop` 이 이제 **shared → frontend → backend package → desktop** 순으로 만든다. 체인을 실제로 돌려 확인했다.
  - 🟢 **한 번 고친 자리를 다시 본 데서 나왔다.** 앞 항목을 쓸 때 나는 *"번들이 낡았다"* 만 보고 *"셸이 산출물에서 읽는 게 그것뿐인가"* 를 묻지 않았다. **D-029 를 남의 코드에는 적용하고 내 수정에는 안 적용한 것**이다.
- [x] **🟠 보고만 함 → 2026-09-05 고침(`487d896`, 이 파일 끝의 항목) — 패키징도 아무것도 안 만들고 산출물을 그대로 싣는다**: `electron-builder` 설정이 `../backend/dist-bundle` 과 `../frontend/dist` 를 **그대로 복사**하는데, `package` · `package:installer` 어느 쪽도 그것들을 빌드하지 않는다. 그러면 **설치 프로그램이 그 순간 트리에 있던 낡은 코드를 그대로 싣는다** — 방금 6일 묵은 번들에서 확인한 그 실패가 사용자 손에 가는 형태다.
  - ~~**고치지 않았다.** 패키징·배포는 사용자가 순서를 정하기로 한 영역이라 먼저 손대지 않는다.~~ → **고쳤다.** 스크립트를 고치는 것과 패키징을 실행하는 것은 다른 일이고, 실행은 여전히 사용자 몫으로 뒀다(`electron-builder` 는 안 돌렸다). `build:release` 사슬 + 썩지 않는 짝은 이 파일 끝의 항목에 있다.
- [x] **🟢 캡틴D의 실제 완성 산출물을 확인했다 — 결함 없음. 코드 변경 0**: 합성 데이터로만 보던 마지막 단계를 **실제 파일**로 봤다.
  ```
  12/Episode01  completed · final_video_path 있음 · instagram_reel.mp4 12.2MB (08-29)
  12/Episode02  completed · final_video_path 있음 · instagram_reel.mp4 13.1MB (08-31)
  장면 클립      회차당 6개, 1.4~3.1MB — 자리표시자가 아니라 진짜 Runway 출력이다
  ```
  - **병합은 검증한다**: 임시 파일에 쓰고 `stat.size > 0` 을 확인한 뒤 **원자적 rename** 이다. 실패하면 `finally` 가 임시 파일을 지운다. 빈 결과가 최종본 자리에 앉을 수 없다.
  - **장면 수가 줄어든 재병합도 안전하다**: `concat.txt` 를 이번 장면 목록에서 새로 만들므로, 옛 12장면 병합이 남긴 `scene7.mp4` 같은 잔재가 섞이지 않는다.
- [x] **🟠 제안만 — 병합 중간 산출물이 영구히 남는다**: `videos/final/normalized/` 에 정규화된 장면 클립과 `concat.txt` 가 남는데, **읽는 코드가 없다** — 병합할 때마다 새로 만들어 덮어쓴다. 순수 스크래치다.
  - **닫혔다** (`7800224`): `ffmpeg-merge.service.ts` 가 최종 파일 이름 바꾸기에 성공한 **뒤에만** 그 폴더를 지운다 — 실패 경로에서는 남겨 두는데, 그때는 스크래치가 아니라 **무엇이 어디까지 됐는지 아는 유일한 단서**다. 실디스크 확인: 3·4화에는 없고, 1·2화에는 그 수정 이전의 잔재가 남아 있다.
  - 이 항목이 열린 채 남아 있던 것 자체가 **문서가 코드에 대해 거짓말한 자리**다(D-047 과 같은 부류). 이번 계약↔실응답 감사 끝에 확인하고 닫았다.
  ```
  Episode01  12MB    Episode02  13MB     ← 완성본과 거의 같은 크기가 회차마다 한 벌 더
  ```
  10화짜리면 약 125MB, 단편까지 합치면 더 늘어난다. **로컬 PC 앱이고 전부 사용자 폴더 안이다.**
  - **안 지웠다.** 파일을 지우는 것은 파괴적이고, 이 제품은 삭제에 보수적이며(*"기존 CapCut 파일은 자동 삭제하지 않는다"*), 기록된 결정이 없다. **병합 성공 직후 지우는 한 줄**이면 되지만 판단이 필요하다 — 원하면 그때 한다.
- [x] **🟢 캡틴D가 다음에 걸을 3화를 실제 데이터 사본으로 병합까지 완주시켰다 — 결함 없음. 코드 변경 0, 유료 0**: 앞 바퀴에서 산출물만 봤으니 이번엔 **경로 전체**를 태웠다. Provider 설정도 예산도 안 붙여서 전 단계가 로컬 fake다.
  ```
  script.generate → approve → mapping.begin → approve
  → images.generate → approve x6 → videos.preview → start → run → approve x6 → merge
  결과: Episode03 status = completed
  ```
  실제 설정집과 개요로 6장면 대본이 나왔고(제목 `삭제된 사람들`), **막는 게이트가 하나도 없다.** 원본은 안 건드렸다(사본에서 실행, 끝나고 `Episode03` 디렉터리가 원본에 없는 것 확인).
  - 🟢 **Cowork이 붙인 경고의 전제도 실제 데이터에서 참이다**: 3화 프롬프트의 `recentContinuity` 가 **`[2]`** 다 — 2화 메모는 들어가고 **1화만 빠진다.** 즉 유료 버튼 위 문장이 *"1화의 이어쓰기 메모가 없어서…"* 라고 말하면 그건 **정확한 사실**이다.
  - 🔴 **하마터면 없는 결함을 보고할 뻔했다.** 처음엔 저장된 컨텍스트를 `recent_continuity`(snake_case)로 찾아 `[]` 를 보고 *"2화 메모도 안 들어간다"* 로 읽었다. 저장되는 건 `continuityContext()` 의 **camelCase 객체**이고, 기존 테스트가 이미 그 키를 쓰고 있었다.
  - 🟠 **이번 세션에 같은 실수를 세 번 했다** — esbuild 이스케이프 때문에 한글이 안 잡힌 것, 데스크톱 테스트 수가 흔들린 것, 그리고 이 키 대소문자. 전부 **"도구가 못 찾은 것"을 "대상이 없는 것"으로 읽을 뻔한** 경우다. **찾는 쪽을 먼저 의심한다** — 특히 결과가 "없음" 일 때.
- [x] **🟢 예산 원장 거절이 유료 경로에서 실제로 어떻게 되는지 쟀다 — 추론만 하고 안 잰 자리였다. 코드 변경 0**: `8e4b207` 에서 원장을 못 읽으면 던지게 해놓고, *"호출자가 어떤 오류로 바꾸고 요청은 안 보낸다"* 를 **읽고 추론만 했다.** 실제 유료 경로(키 연결 + 원장 깨뜨림 + `fetch` 스텁)로 태웠다.
  ```
  generate        REFUSED  LONG_PROJECT_STORAGE_ERROR
  fetch 호출      0회                      ← 유료 요청이 안 나간다
  회차 상태       asset_mapping_approved    ← 재시도 지점, 깨진 generating 이 아니다
  원장 바이트     그대로                    ← 덮어쓰지 않는다
  ```
  **중요한 절반은 맞게 돈다.** 이제 추론이 아니라 측정이다.
  - 🟠 **다만 사람이 보는 문구가 일반적이다**: *"장기 프로젝트 저장소에 접근하지 못했습니다."* 내가 쓴 구체적 이유(*"사용액을 확인하지 못해 유료 요청을 보내지 않습니다"*)는 **설계상 사람에게 못 닿는다** — 프런트가 **코드 → 고정 라벨**로 바꾸고 **서버 메시지는 일부러 버린다**(경로 유출 방지, 옳은 규칙이다).
  - 🔴 **그래서 전용 코드를 지금 올리지 않았다.** 매핑되지 않은 코드는 `CLIENT_UNKNOWN_ERROR` 로 떨어지고 그 문구가 **"잠시 후 다시 시도해 주세요"** 다 — 파일을 고치기 전에는 **절대 성공하지 않는 일에 재시도를 권하는** 셈이라 지금보다 나빠진다. **화면 라벨과 같이 나가야 하는 변경**이고, 그 요청은 이미 우편함에 있다(Round 371).
  - 🟢 **막연했던 열린 질문에 근거가 붙었다** — *"예산 원장 오류 코드가 필요한가"* 가 이제 *"없으면 사람이 보는 문구가 이것이고, 코드만 먼저 넣으면 저것이 된다"* 가 됐다.
- [x] **🟢 이번 세션 수정이 셸이 실제로 fork 하는 번들 안에 전부 있는지 확인했다. 코드 변경 0**: `dev:desktop` 체인을 고친 뒤 **그 체인이 만든 산출물이 실제로 맞는지**는 문자열 하나로만 봤었다. 여덟 개 마커로 다시 봤다.
  ```
  없어야 하는 것   "scriptRevision must match"            사라짐 ✓   (실사용을 막았던 검사)
  있어야 하는 것   BudgetLedgerUnreadableError            ✓
                   videos-start (시작 잠금 키)             ✓
                   continuitySaved                        ✓
                   isAbsentOrUnreadableMemo               ✓
                   indexAssetsIfMissing                   ✓
                   freshReview (검토 기록 폴백)            ✓
                   historyDirectory (보관 번호 경로)       ✓
  ```
  - **테스트로는 안 만들었다.** 번들이 있어야만 도는 검사라 없을 때 빨개지고, `dev:desktop` 체인이 이미 신선도를 보장한다. **한 번 확인하고 방법을 문서에 남기는 것**(`docs/03`)이 맞는 값이다.
  - 🟠 **네 바퀴째 프로덕션 코드 변경이 0 이다.** 결함을 못 찾아서가 아니라 **훑은 계열이 닫혀서**다(못 읽는 파일 · 낡은 산출물 · 돈 경로 · 셸). 억지로 바꾸는 것보다 확인한 것을 적는 편이 낫다고 판단했고, 그 판단 자체를 여기 남긴다 — 다음 사람이 "왜 갑자기 조용한가" 를 안 묻도록.
- [x] **🟠 예산 원장을 못 읽는 거절이 자기 이름을 갖게 됐다 — `BUDGET_LEDGER_UNREADABLE` (Cowork Round 382 와 짝)**: `8e4b207` 이후 그 거절은 **일반 저장소 오류**로 보였고, 사람은 원인을 못 들었다. 378 에서 잰 세 줄이 결론을 정했다 — **코드만 먼저 넣으면 클라이언트 기본 문구(`잠시 후 다시 시도해 주세요`)로 떨어져 지금보다 나쁘다.**
  - **그래서 Cowork이 라벨을 먼저 올렸고, 이 커밋이 코드를 올린다.** 라벨은 코드가 없으면 죽은 표일 뿐이지만, 코드는 라벨이 없으면 **재시도를 권하는 살아 있는 오답**이다. 먼저 나가도 되는 건 라벨뿐이었다.
  - 🔴 **라벨이 있는 경로에만 내보낸다.** 프런트에서 예산 오류표를 가진 모듈은 여섯인데 라벨이 붙은 건 둘(`longProjectsApi` · `imageReviewApi`)이다. 나머지 넷(`imageGenerationApi` · `narrationApi` · `storyPromptApi` · `videoSubmissionApi`)에서 새 코드를 내보내면 **그 화면들이 오늘보다 나빠진다.** 그래서 그 둘이 덮는 여섯 서비스에만 붙였고 나머지는 오늘 그대로다 — **어디도 나빠지지 않고 둘은 정확해진다.**
  - 판정은 한 곳에서 한다(`providers/budget-ledger.ts`). **잊은 경로는 시끄럽게 실패하지 않고 "잠시 후 다시" 라고 말한다** — 그게 확실히 틀린 유일한 답이라 함수 이름을 붙여 뒀다.
  - 짝: **못 읽으면 전용 코드** · **진짜 초과면 여전히 초과 코드.** 주입 둘 — 분기를 빼면 1개 빨강, 모든 거절에 원장 코드를 주면 3개 빨강. 🟠 **처음엔 테스트 없이 붙였다가 주입이 안 잡혀서 알았다** — 수동으로만 쟀던 것을 테스트로 옮겼다.
- [x] **🔴 셸이 페이지를 못 열 때도 멈춘다 (Cowork Round 382 요청)**: `a2bd916` 이 고친 것과 **같은 사고의 다른 순간**이다 — 백엔드가 `/health` 에 답한 뒤 페이지가 뜨기 전에 사라진 경우. `createProductionWindow` 는 `void` 로 불리므로 그 거절은 **아무도 안 받았고**, 사람에게는 **설명 없는 빈 창**이 남았다.
  - **같은 대화상자, 새 문구 없음.** 사람이 보기에 두 경우는 하나다 — *"서버가 없다"*. 새 문장을 만들면 **한 가지 일에 설명이 둘** 생긴다(Cowork 판단이고 동의한다).
  - 주입: 처리를 되돌리면 데스크톱 2개 빨강.
- [x] **🟢 370 · 382 — 도달 불가한 안내와 그 테스트를 지웠다 (Cowork)**: `ASSET_MAPPING_REVIEW_MALFORMED` 는 producer 가 0 이고, `ASSET_MAPPING_REVIEW_INVALID` 는 **저장 길에서 서버 자기 불변식이 깨진 것**이라 *"파일을 지우세요"* 가 **틀린 안내**였다 — 해가 없는 게 아니었다. 테스트도 같이 지웠다: **서버가 안 보내는 응답을 스텁이 만들어 내서** 초록이었다. 매핑 파일 쪽 안내(*지우지 마세요*)는 그대로다.
- [x] **🟠 `BUDGET_LEDGER_UNREADABLE` 가 여섯 모듈 전부에 닿는다 + `budget_ledger_unreadable` 장면 사유 (Cowork Round 384 와 짝)**: 라벨이 여섯 모듈에 다 붙어서, 남은 서비스 넷(단편 이미지 생성 · 대본 · 내레이션 둘)에도 코드를 내보낸다. **이제 유료 경로 어디서 거절되든 사람은 같은 한 문장을 읽는다.**
  - 🔴 **영상 워크플로는 오류 코드가 아니라 장면 실패 사유다** — 내가 잰 대로 원장 오류는 거기서 코드도 사유도 아니었고 그냥 되던져졌다. `budget_exceeded` 재사용은 **돈에 대한 거짓말**이라 새 사유 `budget_ledger_unreadable` 을 쓴다: 초과한 게 아니라 **얼마 썼는지 모르는 상태**고, 요청은 안 나갔고, 고치러 갈 곳이 한도가 아니라 파일이다.
  - 🟠 **배경 타이머로 오는 같은 실패는 여전히 삼켜진다.** 사유를 붙여도 아무도 안 본다 — 별개 문제로 두고 이번에 안 묶었다(Cowork 판단, 동의).
- [x] **🟢 캡틴D 결정 — 회차 목록 "메모 없음" 표시는 안 한다**: 유료 버튼 앞 안내로 충분하다. 근거는 내가 적었던 것 그대로다 — **유료 버튼 앞 문장은 한 번 읽히고 사라지지만, 목록 표시는 안 고칠 사람에게 영원히 남는다.** 캡틴D 반응도 *"그때 채울게"* 였다. 이 건 닫는다.
- [x] **🟢 캡틴D 결정 — 병합 중간 산출물을 지운다. 단 성공한 뒤에만**: `videos/final/normalized/` 는 **캐시지 산출물이 아니다**(읽는 코드가 없고 매번 새로 만든다 — Cowork의 한 줄이 판단을 정했다). 최종 파일이 생긴 뒤에 지운다.
  - 🔴 **실패한 병합에서는 남긴다.** 그때는 캐시가 아니라 **그 실행이 실제로 무엇을 만들었는지 볼 수 있는 유일한 기록**이다. 사람은 다시 만들 수 있는 것을 잃는 게 아니라 **왜 실패했는지 볼 방법**을 잃는다. `try` 밖에 둔 이유가 그것이고 주석에 적었다.
  - 🟠 **테스트 셋이 이 잔해에 기대고 있었다** — 병합이 끝난 뒤 `normalized/*.ass` 를 읽어 자막을 검사했다. **재는 것은 그대로 두고 읽는 시점만** ffmpeg 호출 순간으로 옮겼다(러너가 스냅샷한다).
  - 🔴 **새로 쓴 테스트 하나가 거짓 초록이었다**: `MediaToolError` 를 import 안 하고 썼는데 `rejects.toBeTruthy()` 가 **ReferenceError 도 받아들여서** 통과했다. import 하고 `toBeInstanceOf` 로 바꿨다 — **"뭔가 던졌다" 는 단언은 아무것도 안 잰다.**
  - 주입 둘 — 청소를 빼면 1개 빨강, `finally` 안에 넣으면(실패해도 지움) 1개 빨강.
- [x] **🔴 캡틴D 보고 — 1화 사진이 보관함에 없다. 복구가 "그 회차가 다시는 안 하는 동작"에만 걸려 있었다 (Cowork Round 386)**: 실제 인덱스로 확인했다 — `12/Episode01` 은 **폴더도 자식도 아예 없고**, 2화는 폴더 1 + 자식 6이다. (화면에 넷만 보인 건 보관된 프로젝트 `2` 가 목록에서 숨겨져서다.)
  - **`indexAssetsIfMissing` 은 정확히 이걸 위해 있었는데 승인·재생성에서만 불렸다.** 1화는 `completed` 다 — **둘 다 다시는 안 일어난다.** 그 회차에서는 복구가 영원히 안 돈다.
  - 🟠 **단편도 같은 구멍이다.** Cowork이 본 `local-image-generation.service.ts` 가 아니라 `image-review.service.ts` 에 가드가 있고(오늘 `8ae64f2` 로 넣은 것), **똑같이 그 두 동작에만** 걸려 있다.
  - **① 읽을 때도 고친다**: 회차 `get()` 과 단편 `getStatus()` 에서 부른다. **화면을 여는 것만으로 복구된다.** 🔴 실패는 삼킨다 — 인덱싱은 장면 파일을 전부 읽고 하나라도 없으면 거절하는데, **검토를 보여주는 게 일인 GET 이 곁다리 수리가 안 됐다고 실패하기 시작하면 고치려던 것보다 나쁘다.**
  - **② 일괄 채우기**(`POST /assets/backfill-generated-images`): 회차와 단편을 모두 훑고 **이미 폴더가 있는 것은 건드리지 않는다**(레거시 이전과 같은 규칙 — 두 번 돌려도 안전하다). ①만으로는 1화가 안 고쳐진다 — **끝난 회차의 이미지 화면을 굳이 열 이유가 없기 때문**이고, *"사람이 정확한 순서로 눌러야 고쳐지는 버그"* 는 고쳐진 게 아니다.
  - **무엇이 존재하는지는 「만든 이미지」 목록과 같은 walker 로 정한다** — 어떤 회차가 진짜인지에 대한 두 번째 의견을 만들지 않는다.
  - 🟢 **캡틴D 실제 데이터 사본으로 확인했다**(원본 미변경): `scanned 3 · registered 1 · skipped 2 · failed 0`, `12/Episode01` 이 폴더 1 + 자식 6 으로 생겼고, **두 번째 실행은 `registered 0 · skipped 3`** 이다.
  - 짝 넷, 주입 넷 — 등록/건너뜀 각각, 읽기 복구/이미 있으면 안 건드림 각각. **읽기에서 무조건 다시 심으면 사람이 쓴 설명이 열 때마다 지워진다**(오늘 `stat` 으로 한 번 저지른 그 실수와 같은 모양이라 짝으로 박았다).
  - 🟠 **짝 하나는 전제가 틀려서 갈아엎었다**: 처음엔 *"장면 파일이 없어도 GET 은 열린다"* 를 쓰려 했는데 `assertImagesOnDisk` 가 **내 복구보다 먼저** 거절한다. 도달 불가한 짝 대신 도달 가능한 것으로 바꿨다.
- [x] **🟢 "만들어 둔 장면 사진 등록" 버튼이 붙었다 — 캡틴D는 한 번 누르면 된다 (Cowork Round 388, `befbbd8` 의 짝)**: 관리 도구 패널에 파일 상태 점검과 레거시 이전 사이로 들어갔다. 문구가 **회차와 단편을 같이** 말한다(`scanned` 가 둘을 합친 수라서).
  - 🔴 **`failed` 는 재시도를 권하지 않는다**: *"다시 눌러도 같은 결과이니 그 회차의 사진 파일을 확인해 주세요."* 숫자만 있으면 **재시도로 지워지는 것처럼 읽힌다** — 오늘 예산 원장 라벨에서 한 판단과 같은 자리다. 깨끗한 실행에서는 그 줄이 사라지는 것까지 테스트가 본다(안 그러면 **아무것도 아닌 일에 대한 영구 경고**가 된다).
  - **목록 새로고침은 `registered > 0` 일 때만.** 버튼이 *"여러 번 눌러도 안전하다"* 고 말하니 사람은 실제로 두 번 누르고, **두 번째에 다시 그리면 그 사람이 잡고 있던 선택이 날아간다.** 레거시 이전의 같은 규칙이다.
  - **"사진 파일은 그대로 두고 목록에만 올립니다"** 를 붙였다 — 관리 도구 버튼 앞에서 사람이 먼저 걱정하는 건 *"내 사진을 어디로 옮기나"* 다.
  - 🟠 **CLI가 라우트를 HTTP 로 못 박았다**: 서비스 테스트는 *등록한다* 를 증명하지만 **버튼이 그 URL 에 닿는지는 증명하지 않는다.** 이 저장소는 라우트 순서가 두 번 틀렸고 두 번 다 서비스 테스트에 안 보였다. 실제로 앱을 띄워 `POST` 해서 201 과 `{scanned 2, registered 2, skipped 0, failed 0}`, 두 번째 실행 `registered 0 · skipped 2` 를 확인했다.
- [x] **🟢 캡틴D 화면에서 1화 폴더 복구 확인 — 버튼 한 번으로 끝났다**: `12/Episode01 generated images` 가 자식 6과 함께 나왔고, **사본으로 미리 잰 숫자(`registered 1`)와 실제가 같다.** 미리 재둔 것이 그대로 맞은 셈이라, 캡틴D는 눌러보는 것 말고 확인할 게 없었다.
- [x] **🟠 "만든 이미지" 가 맨 아래에 있던 건 결정이 아니라 사고였다 (Cowork Round 390)**: 캡틴D — *"만든 이미지 UI가 맨 아래라 보기 힘들다"*.
  ```
  <div grid 2열>
    왼쪽  에셋 목록 (max-h 560px, 스크롤)
    오른쪽 상세
    <GeneratedImagesSection />   ← 2열 그리드의 세 번째 자식
  </div>
  ```
  **세 번째 자식이라 2행 1열로 감겼다** — 560px 스크롤 목록 아래, 그것도 **320px 폭 칸 안에서** `sm:grid-cols-4` 갤러리를 그리고 있었다. 그리드 밖·관리 도구 위로 옮겼다.
  - 순서의 근거: **이건 자주 하는 "보기" 고, 관리 도구는 가끔 하는 "수리"** 다. 접힌 `<details>` 라 안 펴면 한 줄이다.
  - 🟢 **코드는 한 줄 이동인데 값은 거기 있지 않다** — *"왜 아래에 있었는가"* 의 답이 **의도가 아니라 사고**였다는 것이다. **아무도 거기 두기로 결정한 적이 없다.**
  - 테스트가 **픽셀이 아니라 문서 순서**를 본다(`compareDocumentPosition`): *만든 이미지가 에셋 목록보다, 그리고 관리 도구 토글보다 앞선다.* 높이나 좌표를 재는 규칙은 **다시 맨 아래로 밀려도 통과**할 수 있다.
- [x] **📣 명언 카드 — 캡틴D가 B 안으로 착수 결정. ① 정지 이미지 병합 경로 + 계약 (`ProjectSummary.photoCard`)**: *"싼 쪽 대신 안 거짓말하는 쪽"* 으로 정하셨다. A(상태를 흉내내 `VideosApproved` 로 세팅하고 리뷰 파일을 승인으로 써 주기)가 3~4배 싸지만, **오늘 하루가 통째로 그 반례집**이다 — 상태가 실제와 다른 것을 말하고 나중에 그 위에서 뭔가 돈다.
  - 🔴 **`probe` 미지수를 쟀다(일회성 측정, 스위트에 안 넣었다)**: PNG 는 `ffprobe` 에서 **`codec_type: "video"` 로 통과하고 `format.duration` 이 없어서 거절된다.** 즉 **스트림 검사가 아니라 길이 검사에서 걸린다.** probe 는 옳다 — 정지 이미지는 자기 길이가 없다. 그래서 **probe 를 무르게 하지 않고**, 정지 장면은 그 검사를 아예 안 타고 길이를 인자로 받는다.
  - ① 은 **새 함수가 아니라 입력 한 종류**다: `MergeSceneInput.stillDurationSeconds`. 있으면 `-loop 1 -t N -i` 로 열고 켄번즈를 앞에 붙이며, **그 뒤 전부(자막 굽기 · 오디오 매핑 · 인코더 · concat · 원자적 rename)는 클립과 같은 체인**이다.
  - 켄번즈는 **일부러 작게** 잡았다(2배로 키운 뒤 1.15까지, 중앙 고정). 이건 **읽는 카드**라 그림이 달려들면 읽기 어려워진다.
  - 계약: **`ProjectType` 을 셋으로 늘리지 않았다.** 사진 카드는 저장·병합·게시·음원·저작권 고지가 전부 단편과 같고, 새 타입을 만들면 **그 다섯을 새 주인에게 다시 붙이는 일**이 된다. 필요한 건 파이프라인이 갈라질 사실 하나라 `ProjectSummary.photoCard?: boolean` 이다. 화면은 이걸로 **의미 없는 선택(커버 프레임)** 을 감춘다 — 5초 슬로 줌에서는 어느 지점이나 같은 그림이다.
  - 짝: **정지는 loop+zoom** · **클립은 여전히 loop 도 zoom 도 없다.** 뒤엣것이 없으면 **전부 정지로 취급하는 구현**이 통과한다. 주입 둘 — 무시하면 1개, 전부 정지로 보면 2개 빨강.
  - 🔴 **②B(장면 1개 단편을 낳기)는 아직이다.** 계약을 먼저 낸 것은 Cowork이 화면을 시작하려면 그게 필요해서고, **없는 응답 모양을 짐작해서 그리는 것**을 막기 위해서다.
- [x] **🔴 계약이 게시 화면까지 안 닿았다 — 같은 필드를 영상 보관함 행에도 (Cowork Round 394)**: `ProjectSummary.photoCard` 를 올렸는데, **게시 화면은 프로젝트를 `VideoLibraryProjectSummary` 에서 고른다.** 그 타입에는 없었으니 그 화면은 사진 카드인지 알 방법이 없었다.
  - **그 행은 이미 화면이 판단해야 하는 값을 그렇게 나른다** — `aspectRatio`(썸네일 비율) · `attributionRequired`(저작권 고지). **같은 성격이고 같은 자리**다.
  - 🟢 **Cowork이 안 고른 두 길이 둘 다 옳게 기각됐다**: 게시 화면에서 상세를 따로 부르는 것(요청이 늘고, 두 모양만 알게 해둔 화면이 셋을 알게 됨)과 **"5초짜리면 사진 카드겠지"**(길이로 종류를 알아내는 것 — 오늘 하루 지운 그 모양). **짐작으로 우회하지 않고 보고한 게 값이다.**
  - **저장 자리는 `lore_context.photo_card`** 다. `narration_enabled` 가 사는 곳이라 **엄격한 저장 키 목록을 안 건드린다.** 없으면 API 필드를 **`false` 로 보내지 않고 생략**한다 — 사진 카드를 모르는 독자는 전과 똑같이 동작한다.
  - 🟠 **앞 커밋에서 계약만 올리고 아무도 안 채웠던 것을 이번에 실체화했다.** 그건 의도한 중간 상태였고(Cowork이 화면을 시작하려면 모양이 필요했다) 회신에도 그렇게 적었지만, **"채우는 곳이 없는 계약" 을 오래 두면 그 자체가 거짓말이 된다.**
  - 짝: **사진 카드는 행에 표시가 있고** · **보통 프로젝트는 없다.** 뒤엣것이 없으면 **모든 행에 표시하는 구현**이 통과하고, 그러면 화면이 **모든 프로젝트에서 커버 프레임 선택을 감춘다.** 주입 둘 다 잡힌다.
- [x] **📣 명언 카드 ②B — 사진 카드를 낳는 엔드포인트와, 병합이 그 종류를 아는 것 (`POST /photo-cards`)**: 새 주인을 만들지 않았다. 게시·게시 기록·음원·자막·저작권 고지가 전부 프로젝트에 걸려 있어서, 제3의 소유자는 **그 다섯을 다시 붙이는 일**이 된다. 평범한 단편을 만들고 `lore_context.photo_card` 로 표시하며, 병합이 그 사실 하나로 갈라진다.
  - 🔴 **"유료 0" 은 한 줄에 걸려 있다**: 이미지 생성은 **프로젝트 자신의 기록이 이미 그 파일을 가리킬 때만** 장면을 건너뛴다. 사진을 자리에 복사만 하고 `generated_images` 를 안 쓰면, **"공짜" 라고 말해놓고 누군가 생성 화면을 여는 순간 이미지 값을 치른다.** 기록은 바이트가 놓인 **뒤에** 쓴다 — 없는 파일을 가리키는 기록은 반대 방향의 같은 거짓말이다.
  - **게이트는 같고, 검사는 갈린다.** 상태 조건(`VideosApproved`/`Failed` = *재료가 정해졌다 · 실패해서 재시도만 남았다*)은 두 종류가 공유하고, **무엇을 확인하는지**가 다르다. 카드는 클립도 장면 리뷰도 없으므로 **승인된 리뷰 파일을 요구하지 않는다** — 요구하면 *"여섯 장면을 검토했다"* 고 쓰는 파일을 만들어야 하고, **거짓말을 해야 통과하는 게이트는 게이트가 아니다.** 리뷰 파일을 안 쓰는 것이 결정이라는 걸 이름 붙은 no-op 으로 남겼다.
  - **probe 는 건너뛴다**(정지 이미지는 자기 길이가 없다). `MIN_SCENE_COUNT` 는 안 건드렸다 — 카드는 이야기가 아니고, 낮추면 **모든 단편이 장면 하나로** 만들어질 수 있게 된다.
  - 내레이션은 끄고 자막은 켠다: **문장은 그림의 글자이고, 그걸 읽어주는 건 아무도 안 시킨 유료 호출**이다.
  - 짝 넷, 주입 셋 — **기록을 안 쓰면 빨강**(유료 구멍) · **병합이 종류를 모르면 빨강** · **전부 카드로 치면 빨강**(보통 프로젝트는 여전히 클립과 리뷰를 요구해야 한다). `fetch` 스텁은 **불리면 터지게** 뒀다 — 유료 호출이 조용히 성공하는 테스트는 아무것도 안 잰다(Cowork 제안).
  - 🟠 **기존 테스트가 새 라우트를 잡았다**: `devProxy.test.ts` 가 *"공유 계약이 낼 수 있는 모든 최상위 접두사를 프록시한다"* 를 본다. `/photo-cards` 가 빠져서 **브라우저 개발 모드에서 백엔드 대신 Vite 로 갔을 것**이다. `apps/frontend/vite.config.ts` 는 Cowork 구역이지만 **그 테스트가 요구하는 기계적 한 줄**이라 넣고 보고했다.
- [x] **💸 이미 값을 치른 영상이 매 틱마다 버려지던 것 (D-037)**: 장면이 도는 중에 Runway 원장이 읽히지 않게 되면, 작업이 성공해 **바이트를 내려받은 뒤** `budget.record` 가 던지면서 결과가 통째로 풀렸다. 기록은 `running` 그대로라 **백그라운드 타이머가 5초마다 다시 내려받고 다시 버렸고, 화면은 내내 "생성 중"** 이었다.
  - **이미 나간 값의 기록은 결과를 파괴하지 않는다.** `spendUnrecorded` 를 달아 내보내고, 워크플로가 **경고**로 사람에게 알린다("영상은 그대로 있고, 이번 달 합계만 모자랍니다 — 다시 만들지 마세요"). 다시 만드는 것이 이 상황을 유일하게 더 나쁘게 만드는 행동이라 문구가 그걸 막는다.
  - 🔴 **그 경고가 갈 길도 막혀 있었다**: `getProgress` 가 **재시도 비용 한 줄** 때문에 원장을 읽어서, 같은 실패로 **응답 전체가 500** 이 됐다. 보여주기용 숫자는 빠지고 응답은 산다(그 필드는 원래 선택적 — Runway 아닌 작업엔 없다).
  - **살지 말지 정하는 읽기는 그대로 던진다**(`preflight`, D-036). 그래서 이미 산 장면 1 은 남고 아직 안 산 장면 2 는 `budget_ledger_unreadable` 로 거절된다.
  - 🟠 기존 `.catch(() => undefined)` 둘은 **반대쪽 실수**였다 — 결과는 지키고 사실을 조용히 잃었다. 같은 헬퍼로 모으면서 둘 다 보이게 됐다.
  - 짝 넷, 주입 넷 전부 빨강. 🟢 **0원은 값이 아니다** 규칙은 처음에 **반환값을 버려서 안 재지고 있었고**, 주입이 초록으로 남아 알았다 — 연결하고 다시 재서 빨강.
- [x] **💸 같은 결함의 OpenAI 쪽 다섯 군데 — 유료로 산 것이 자기 장부질에 사라지던 것 (D-037 확장)**: 이야기·이미지 생성·이미지 재생성·내레이션 생성·내레이션 재생성. 전부 `finally { await budget.record(...) }` 안이라 **한 겹 더 나빴다** — 성공 경로에서는 산 것을 버리고, 실패 경로에서는 **제공자의 진짜 오류를 대신했다**(거부당한 프롬프트가 "기록 파일을 고치세요" 로 보고될 참).
  - 공용 `recordSpend` / `spendUnrecordedWarning` 을 `providers/budget-ledger.ts` 에 두고 Runway 쪽 문구도 그리로 모았다 — 같은 말을 한 곳에서만 쓴다.
  - **갈라지는 지점은 그대로다**: 이미 산 장면은 남고, 다음 장면은 자기 `preflight` 가 같은 파일을 읽고 거절한다(D-036). 그래서 **경고는 오류 경로에도 붙는다** — 안 붙이면 중간에 깨진 실행에서 이미 산 것이 통째로 언급되지 않는다.
  - **표시용 숫자는 일이 끝난 뒤에만 물러선다.** 작업 전 `preview` 의 예산 칸은 그대로 던진다(아직 잃을 것이 없고, 예산을 안 그리면 "공짜인가 보다" 로 읽힐 수 있다).
  - 🟢 **`decision-doc-references` 가드가 지난 커밋의 실수를 잡았다** — D-037 제목을 `##` 로 써서 문서 형식(`### D-0NN · 제목`)을 안 지켰고, 그때는 소스에 참조가 없어 안 걸렸다.
  - 🟢 **`finally` 가 세운 플래그는 `try` 안의 `return` 객체에 안 실린다**(객체가 먼저 만들어진다). 주석에는 실린다고 적어놓고 안 실렸고, **문장을 확인하는 짝 하나만** 잡았다.
  - 짝 다섯, 주입 넷 전부 빨강(결과 파괴 · 경고 누락 · finally 플래그 유실 · 표시 숫자가 응답을 죽임).
- [x] **💸 회차(Episode)·장편 쪽 마지막 여섯 자리 — D-037 사슬을 끝까지 (`long-projects/`)**: 회차 이미지 생성·재생성, 회차 내레이션 생성·재생성, 회차 대본 생성, 장편 개요 생성. 전부 같은 `finally { await budget.record(...) }` 였다.
  - **회차는 경고를 두 곳에서 읽는다** — 회차 자신의 기록과 **개요 목록의 그 행**. 한 곳에만 쓰면 다른 화면에서 안 보인다(복구 서비스가 이미 둘 다 쓰는 이유). `episode-warnings.ts` 의 `persistEpisodeWarning` 이 둘을 함께 쓰고, **절대 던지지 않는다** — 메모를 잃는 것이 일을 잃는 것이 되면 이 변경 자체가 무의미해진다. 응답은 메모리상 회차로 만들어지므로 사람은 어느 쪽이든 본다.
  - **대본은 순서가 중요하다**: 경고를 먼저 목록 행에 쓰고, `save()` 가 그 행을 다시 읽어 상태를 찍는다. 반대로 하면 **써놓자마자 덮인다**(주입 D 로 확인).
  - 🟠 **개요에는 계약이 없어서 손실만 막았다**: 장편 프로젝트에는 자기 경고 통로가 없고(`LongEpisodeOutline.warnings` 는 있지만 `LongProjectSummary` 에는 없음), 개요는 특정 회차에 대한 것이 아니라 **문장을 놓을 정직한 자리가 없다.** 필드를 더하는 건 공유 계약 변경이고 그리는 화면과 함께 가야 해서, **못 미루는 절반(개요가 살아남는 것)만** 했다. 짝도 경고를 안 본다고 명시했다.
  - 짝 넷, 주입 넷 전부 빨강(결과 파괴 · 목록 행 누락 · 오류 경로 누락 · 대본 경고 덮어쓰기).
- [x] **💸 회차 영상 쪽 — D-037 의 세 구멍이 그대로 남아 있던 자리 (`episode-videos.service.ts`)**: 짧은 프로젝트 영상과 같은 `advanceRunwayScene` 을 쓰면서, 그 결과가 실어 나르는 `spendUnrecorded` 를 안 받고 있었다.
  - **원장 실패를 던지기만 했다.** 폴은 오류를 보지만 **백그라운드 타이머는 전부 삼킨다**(`.catch(() => undefined)`). 그래서 틱에서는 거절이 사라지고, **움직일 수 없는 작업을 상대로 타이머가 계속 돌았다.** 기록하면 둘 다에 닿는다.
  - 🟢 **프론트는 이미 그 문장을 갖고 있었다** — `longProjectsApi.ts` 가 `budget_ledger_unreadable` 를 회차 장면 오류로 매핑한다. **백엔드가 그걸 한 번도 만들어 준 적이 없었다.**
  - 이미 값을 치른 클립은 남고, 회차 경고 두 곳(상세·목록 행)에 적힌다.
  - `budgetPreview` 가 `progressFor` 안에서 매 폴마다 원장을 읽어, 원장이 깨지면 **멀쩡한 작업의 진행 응답 전체가 500** 이 됐다 — *"클립은 있고 합계가 모자랍니다"* 를 실어 나를 바로 그 응답이다.
  - 짝 하나, 주입 셋 전부 빨강(던지기만 함 · 경고 누락 · 표시 숫자가 폴을 죽임).
- [x] **🔴 뿌리가 옮겨지면 보관함 전체가 사라지던 것 (D-038)**: 색인의 `stored_path` 가 절대경로인데, 데스크톱은 데이터 뿌리를 옮긴다(개발 `apps/backend` → 패키징 `userData`, 첫 실행에 디렉터리 이동). **실제 보관함을 옮긴 뿌리에서 재니 비-폴더 Asset 27개가 전부 "파일 없음"** — 바이트는 새 뿌리 아래 같은 상대 위치에 그대로 있는데도.
  - 🔴 **돈이 걸린 쪽은 조용하다**: `collectReferenceImages` 는 못 푸는 참조를 **omitted 로 세지도 않고** 버린다(지워진 Asset 이면 그게 옳다). 뿌리가 옮겨지면 그 논리가 뒤집혀 **확인한 캐릭터 참조 0개로 유료 이미지 생성이 돌고 아무 말도 안 한다.**
  - 고침: 적힌 절대경로가 실패하면 **마지막 `projects/`·`asset_library/` 조각부터 현재 뿌리에 다시 붙여** 한 번 더 찾는다. 두 이름은 필드에서 가져온다. **격리 검사는 모든 후보에 그대로** — 찾는 범위를 넓힐 뿐 읽는 범위는 아니다.
  - 실물 재측정: **27 missing → 27 healthy** (실사용 데이터 복사본, 옮긴 뿌리).
  - 짝 둘, 주입 셋. 🟢 그중 하나가 **초록으로 남아서 반대편 짝이 자기 주장을 안 재고 있다는 걸 드러냈다** — 가짜 파일 이름을 써서 "이름만으로 찾는" 구현도 통과했다. 진짜 이름으로 바꾸고 빨강.
- [x] **🔴 뿌리가 옮겨지면 이미지 여섯 장을 다시 산다 (D-038 확장 — 색인 밖의 절대경로들)**: 실사용 데이터에서 절대경로를 담은 자리를 전부 셌더니 `generated_images` · `generated_video_paths` · `output_path` · 리뷰의 `image_path` 가 나왔다.
  - 🔴 **`generated_images` 가 안 맞으면 오류가 아니라 "아직 안 만들었다" 로 읽힌다** — 생성이 그 줄로 재사용을 판정하기 때문에 **여섯 장을 다시 산다.** 명언 카드의 "유료 0" 도 같은 줄이다. 병합은 이미 값을 치른 클립을 못 찾는다.
  - 실물 측정(옛 뿌리가 사라진 복사본, 실제 프로젝트): **images 0/6 · clips 0/6 → 6/6 · 6/6**.
  - 규칙은 `projects/re-rooted-path.ts` 한 곳(보관함도 같은 것을 쓴다), 적용은 **프로젝트를 읽는 지점 한 곳**. 다음 `save()` 가 고쳐진 경로를 되써서 파일이 한 번에 낫는다.
  - 🟢 `projects.no-provider-calls` 가드가 **제 주석의 제공자 이름을 잡았다** — 가드를 무르지 않고 문구를 고쳤다.
  - 🟢 주입 하나가 초록으로 남아 *"안쪽 앵커가 이긴다"* 를 **아무도 안 재고 있었다**는 걸 드러냈다. 코드를 `projects/` 아래 두는 실제 배치를 짝으로 넣고 빨강. **두 라운드 연속 같은 교훈.**
  - 짝 셋, 주입 셋 전부 빨강.
- [x] **🔴 뿌리 이동에 깨지던 마지막 두 자리 — 둘 다 유료 호출의 참조 이미지 (D-038 마무리)**: `lore_context.previous_scene_link.image_path`(앞 장면 이미지, 유료 Scene 1 생성의 참조)와 `versions[].stored_path`(고정 버전 참조).
  - 첫째는 **최상위 배열이 아닌 유일한 자리**라 앞 판에서 빠졌다. 둘째는 **옛 해석기의 사본**이라 `resolveContentPath` 만 고쳤을 때 안 따라왔다 — **다른 참조는 다 복구되는데 고정 버전만 조용히 안 풀리는** 최악의 모양이었다(화면은 정상으로 보인다).
  - 세 자리 모두 같은 침묵: `stat` 실패 → 참조가 빠지고 **omitted 로도 안 세어짐** → 고른 참조 없이 만들어진 그림에 값을 치르고 아무 말도 못 듣는다.
  - 확인하고 **안 고친 것 둘**: 회차(`long_story/`) 저장 파일에는 절대경로가 아예 없다(매번 `files()` 로 파생). `generated_image_reviews.json` 의 `image_path` 는 **일부러 역참조하지 않는다** — 리뷰는 항상 `imagePath()` 로 파생하고, 그 주석이 이미 "저장된 절대경로는 믿을 수 없다" 고 적어두고 있었다.
  - 짝 둘, 주입 둘 전부 빨강.
- [x] **🟠 돈을 지키는 가드들이 덮는 범위가 낡아 있었다 (D-039)**: 정적 가드가 실제로 빨개지는지 쟀다. 목록 안 파일은 빨강(가드는 작동한다), **같은 디렉터리의 목록 밖 파일은 초록** — `image-reference-selection.ts`(유료 호출에 실을 것을 조립하는 파일)에 `fetch` 를 넣어도 images 80개 전부 통과, `subtitle-file.ts`(병합 중 도는 파일)도 videos 178개 전부 통과.
  - 고침: **디렉터리 스캔 + 명시적 허용목록**(어댑터). 나중에 생긴 파일이 기본으로 덮이고, 허용목록에 이름을 더하는 건 일부러 하는 일이 된다.
  - `long-projects/`(36개 파일)에는 정적 스윕이 **아예 없었다** — 하나 더했다. 기존 두 가드는 `fetch` 를 스텁하고 실제 흐름을 도는 더 강한 종류지만 **그 흐름이 닿는 코드만** 덮으므로, 없애지 않고 더했다.
  - 🟠 규칙은 디렉터리마다 다르게 뒀다. `videos/` 는 `spawn`·FFmpeg 을 금지하지 않는다(병합이 사는 곳이다). 어디서나 금지되는 건 **네트워크 클라이언트**뿐이다.
  - 주입 넷 전부 빨강 — 넷 다 전에는 초록이던 자리다. 어댑터는 그대로 통과.
- [x] **💸 "유료 요청 앞에는 예산 검사가 있다" 를 아무도 안 지키고 있었다 (D-039 확장)**: 돈 쪽 전체가 얹혀 있는 규칙인데, 기존 검사는 전부 **어느 한 서비스의 동작**만 본다. 내일 새 유료 호출 자리가 생기면 **검사 없이 제공자에 닿아도 모든 스위트가 초록**이다.
  - 세어보니 지금은 전부 맞았고, 두 자리는 **일부러** 검사가 없다(`getRunwayTask`·`downloadRunwayOutput` — 이미 값을 치른 작업의 조회·수령이라 추가 과금이 없고, 여기 검사를 걸면 예산 소진 시 **이미 산 결과물을 못 가져온다**, D-037).
  - 가드 두 겹: ① 과금 함수를 부르는 파일은 `preflight` 도 부른다 ② **어댑터 수출 함수는 전부 과금/비과금으로 분류되어야 한다** — 새 어댑터 함수는 어느 쪽인지 말할 때까지 빨강. 손으로 관리하는 "유료 호출 목록" 이야말로 낡는 그것이다.
  - 🟢 첫 실행의 **오탐이 규칙을 정확하게 만들었다**: 주석 속 `createRunwayImageToVideoTask()` 언급을 호출로 셌다. 통째로 주석인 줄만 걷어낸다(진짜 코드 줄은 절대 그렇지 않으므로 호출을 숨길 수 없다).
  - 주입 넷 전부 빨강: 검사 없는 새 호출 자리 · 기존 자리에서 `preflight` 제거 · 분류 안 된 새 어댑터 수출 · 주석 오탐 방지 제거.
- [x] **💸 제일 비싼 버튼 셋만 잠금이 없었다 (D-040)**: 유료 호출 자리와 `withProjectLock` 사용처를 대조하니 **이미지 생성(6장) · 회차 이미지 생성(6장) · 이야기 승인**만 빠져 있었다. 형제(내레이션 생성/재생성, 이미지 재생성, 회차 대본/내레이션, 개요, 영상)는 전부 잠그고 있었고, 내레이션 주석은 그 논리를 이미 정확히 적어두고 있었다 — **더 비싼 쪽에 안 갔을 뿐이다.**
  - 셋 다 check-then-act: 동시에 도착한 두 누름이 둘 다 게이트를 통과하고 장면마다 "아직 없음" 을 본다 → **한 번 요청한 실행에 장면당 두 번 값을 치른다.**
  - 즉시 거절(`timeoutMs: 0`). 줄 세우면 생성 한 판을 통째로 기다린 뒤에 "전부 재사용" 을 받는다.
  - 🟢 **짝이 공유 잠금의 결함을 잡았다**: `Date.now() > deadline` 은 `timeoutMs: 0` 일 때 그 밀리초 동안 거짓이라 "즉시 거절" 이 "한 번 쉬었다 재시도" 였다. `>=` 로 고쳤다 — 이미 나가 있던 `timeoutMs: 0` 사용처(내레이션·개요)에도 있던 결함이다.
  - 🟠 **프론트 보고**: `PROJECT_LOCKED` 문장이 `imagesApi`·`storyApi` 에는 아직 없다(계약이 아니라 문구, Cowork 구역이라 안 건드림).
  - 짝 셋, 주입 넷 전부 빨강.
- [x] **🟢 규칙 대 실제 사용처 대조 3회차 — 이번엔 결함이 없었고, 그 사실을 고정했다**: 405·406 이 결함을 낸 같은 방식으로 세 가지를 더 대조했다.
  - **원자적 쓰기**: 지속 상태 JSON 쓰기 40여 곳이 **전부** `atomicWriteUtf8File` 을 지나간다. 예외 둘은 의도된 것 — 헬퍼 자신과, **배타적 생성이 곧 잠금인** `project-lock.ts`(원자적 rename 은 덮어쓰므로 잠금이 될 수 없다).
  - **보관(archive)**: 디렉터리 이동이라 보관 중에는 저장된 절대경로가 안 맞지만, **복원하면 다시 맞고 보관 중에는 내용을 서빙하지 않는다**(요약만 나열, 삭제는 주제 문자열 확인). 왕복 안전 — 결함 없음.
  - **`archiveFinal` 의 번호 되돌아감**: 이론상 `readdir` 실패 시 v001 로 되돌아가 기존 보관본을 덮지만, 실제로 도달 가능한 실패는 ENOENT(첫 보관)뿐이고 그건 올바른 처리다. **못 재는 변경은 넣지 않았다** — 보고만 한다.
  - 원자적 쓰기 규칙은 **가드로 고정**했다(D-039 의 교훈: 규칙은 누군가 그 파일에 대해 적어둔 자리에서만 진짜다). 허용목록의 파일이 사라지거나 더는 쓰지 않으면 **그 목록 자체가 빨개진다** — 이유가 자기 파일보다 오래 살 수 없다.
  - 주입 넷 전부 빨강: 새 파일이 상태 JSON 을 평범하게 씀 · 기존 원자적 쓰기를 되돌림 · 허용목록에 사라진 파일 · 주석 줄 처리 제거(오탐 복귀).
- [x] **🔴 아직 대본이 없는 회차를 열면 "장편 프로젝트를 찾을 수 없습니다" 라고 답했다**: 실사용 데이터 **복사본** 위에 진짜 AppModule 을 띄우고 화면이 부르는 라우트를 그대로 불러서 찾았다.
  - 같은 숨결에 **회차 2 상세는 200, 같은 회차의 이미지 검토는 404 "장편 프로젝트를 찾을 수 없습니다"** 였다. 사람은 방금 보고 있던 것을 찾으러 가게 된다.
  - 원인: 개요에는 있지만 한 번도 대본을 쓴 적 없는 회차는 **디렉터리 자체가 없어서** 회차 기록 읽기가 ENOENT 이고, `json()` 이 그걸 `longNotFound()` 로 보고했다. `episode-narration` 은 **이미 올바르게** 처리하고 있었고("아직 대본이 없다"는 저장 실패도 없는 프로젝트도 아니다), 이미지·영상·병합 셋만 안 갔다.
  - 고침 뒤 실물 재측정: 404 `LONG_PROJECT_NOT_FOUND` → **409 `LONG_EPISODE_IMAGES_NOT_ALLOWED`**, 즉 **대본이 있는 회차가 잘못된 상태일 때 받는 답과 같아졌다** — 메시지가 회차의 진행 정도에 따라 달라지지 않는다.
  - 🟠 `episode-continuity` 는 **일부러 안 건드렸다**: 거기서는 그 404 를 "다음 회차가 없다"는 뜻으로 **의도적으로 잡아 쓴다**(`nextEpisode: null`). 바꾸면 그 경로가 깨진다.
  - 짝은 잰 것과 같은 모양으로 — **HTTP 통합**에서 개요만 승인된 회차 2에 세 라우트를 부른다. 주입 셋 전부 빨강.
- [x] **🔴 대본 없는 회차의 연속성 메모도 "장편 프로젝트를 찾을 수 없습니다" 였다 — 지난 라운드에 "일부러 안 건드렸다"고 한 그 자리**: 프로브를 넓히니 그게 **실제로 사람에게 도달한다**는 게 나왔다(같은 회차: 상세 200, 연속성 메모 404).
  - 지난 라운드에 미뤄둔 이유는 `save()` 가 그 404 를 **"다음 회차가 없다"는 뜻으로 의도적으로 잡아 쓰기** 때문이었다. 그 안쪽 조회는 그대로 두고 **요청된 회차의 조회만** `episodeOrNull` 로 갈랐다 — 두 자리를 구분하면 둘 다 옳게 된다.
  - `get()` 은 **열린다**: `{ memory: null, canSave: false }`. 이 화면의 자기 주석이 이미 그 이유를 적어두고 있었다 — *"고치려는 그 파일 때문에 못 여는 유일한 화면"* 이 되면 안 된다. 그 논리가 **못 읽는 메모**에는 적용됐고 **아직 기록이 없는 회차**에는 안 갔던 것이다.
  - `save()` 는 여전히 거절하되 **상태로** 거절한다(`LONG_EPISODE_CONTINUITY_NOT_ALLOWED`), 없는 프로젝트로가 아니라.
  - 🟠 **"없음" 이 "존재하지 않음" 을 삼키지 않게**: 개요에 없는 회차 번호(99)는 그대로 `LONG_EPISODE_NOT_FOUND` 다. 반대편 짝이 그걸 잡는다.
  - 실물 재측정: 실사용 데이터 전체에서 **`LONG_PROJECT_NOT_FOUND` 가 하나도 안 나온다.** 짝 하나(HTTP), 주입 셋 전부 빨강.
  - 🟢 프로브의 "Cannot GET" 40여 건은 **내 경로 추측 오류**였다(그 라우트들은 GET 이 아니다). 실제 코드 오류만 걸러 보고한다.
- [x] **📣 명언 카드 화면과 계약 정리 (Cowork Round 410 통합)**: 화면·api 모듈·커버 프레임 감추기·`PROJECT_LOCKED` 문구 둘이 들어왔다. Cowork 이 테스트를 못 돌려서 여기서 돌렸다 — **Frontend 1175 통과(+12)**.
  - 🟢 **리포의 헬퍼 주석이 그 실패를 미리 적어두고 있었다**: 폴더 픽스처를 `makeAsset({ isFolder: true })` 로 만들면 **비-폴더 디지스트가 남아 응답 검증이 목록 전체를 거부**하고, 화면에는 배너만 뜬다. `testUtils` 가 `makeAssetFolder` 위에 정확히 그렇게 적어놨다. 한 단어 차이로 스위트가 빨강/초록이었다.
  - **300자 한계를 `PHOTO_CARD_QUOTE_MAX_LENGTH` 로 shared 에 냈다**(Cowork 요청). 화면은 세는 칸이 필요하고 서버는 거절해야 하는데, **두 곳에 적힌 숫자는 갈라지고 그 갈라짐은 301자에 도달하기 전까지 안 보인다.**
  - 🔴 **그리고 그 상수를 아무도 안 재고 있었다**: 서버 검사를 상수에서 떼어놓는 주입이 **초록으로 통과**했다. 짝을 상수로 써서(숫자가 아니라) 양방향으로 재게 했다 — 한 글자 넘으면 거절, 딱 맞으면 통과.
  - 🟠 **`VideoLibraryProjectSummary.photoCard` 를 지웠다**: Cowork 이 394 의 자기 진단을 정정했다 — 게시 화면은 목록에서 고른 **뒤에 상세를 이미 부르고**, `photoCard` 는 `ProjectSummary` 에 있으므로 **처음부터 화면에 있었다.** 아무도 안 읽는 계약 필드는 화면이 필요로 한다는 거짓 주장이다. 짝은 **없다는 것**을 못박게 바꿨다 — 같은 근거로 다시 더해지지 않게.
  - 주입 넷 전부 빨강(폴더 픽스처 되돌림 · 보관함 행에 필드 복원 · 한계값 양방향 어긋남).
- [x] **💸 진행 응답이 "이 작업은 유료인가" 를 직접 말한다 (D-041, Cowork 발견)**: 화면이 `retryEstimate` 의 **부재**를 "돈 안 나감" 의 증거로 쓰고 있었고, D-037 이 그 부재에 두 번째 원인(원장 못 읽음)을 만들면서 **돌고 있는 유료 작업에 "비용 없이 만들어집니다" 라고 말하게 됐다.**
  - `paidProvider: boolean` 을 단편·회차 진행 응답에 냈다. **선택이 아니라 필수** — 선택으로 두면 "없으면 무료" 를 다시 읽게 된다. 회차 화면은 시작 직후 자기 진행 상태를 만들어 쓰므로 **시작 응답에도 같은 값**을 실어 추측을 없앴다.
  - 짝: **원장이 안 읽혀 비용 줄이 사라져도 `paidProvider` 는 참**. 주입으로 다시 비용 줄에서 유도하게 하면 빨강.
- [x] **💸 `LongProjectSummary.warnings` 를 냈고, 399 에서 미뤄둔 개요 경고가 갈 곳이 생겼다**: Cowork 이 *"그리는 화면이 있다 — `LongProjectDetail` 이고 그게 프로젝트 단위 화면"* 이라고 답했다. 개요는 **한 번의 유료 호출이 모든 회차를 만드는 것**이라 그 비용은 프로젝트 것이다.
  - 399 의 짝에 *"경고는 일부러 안 본다"* 고 적어뒀던 것을 **보게** 바꿨다. 저장·재적재까지 짝이 본다(주입: 안 붙임 · 재적재 때 안 읽음 → 둘 다 빨강).
  - 🟠 프론트 세 곳(픽스처 둘 · 회차 화면 한 줄)은 **필수 필드가 기계적으로 강제**한 것이라 적용하고 회신에 크게 적었다.
- [x] **🔴 끝난 회차의 자산 매핑 화면이 500 이었다 — 실사용 프로젝트 두 회차 전부**: 프로브를 **추측 대신 컨트롤러의 `@Get` 데코레이터에서 전수로** 뽑아 부르게 바꿨더니(선언된 49개 → 202 URL) 나왔다.
  - `episode-mapping-owner.ts` 의 상태 목록만 **`interrupted` 에서 멈춰 있었다** — `rendering`·`completed`·`failed` 셋이 없다. 다른 서비스는 18개 전부 갖고 있고, **`LONG_EPISODE_STATUSES` 는 shared 에 이미 있었다.**
  - 이건 **게이트가 아니라 모양 검사**다("이게 잘 만들어진 회차 기록인가"). 타입이 허용하는 건 전부 통과해야 하므로 **손으로 베낀 목록은 다음 상태가 추가되는 날 결함이 된다.** 이미 그랬다.
  - **끝난 회차는 이 화면을 여는 가장 흔한 때**다 — 다음 화를 쓰기 전에 어느 캐릭터를 썼는지 보거나, 이미지가 왜 이상한지 볼 때.
  - 실물 재측정: **500 네 건 → 0**. 짝은 셋을 더하는 대신 **shared 목록 전체를 도는 루프**로 썼다 — 다음에 추가되는 상태가 그날 바로 덮인다. 반대편 짝: 상태 아닌 값은 여전히 거절.
  - 🟢 **선언된 GET 라우트 49개 중 없는 것 0개** — 라우트 배선 자체는 건강하다. 못 채운 파라미터 셋(`:trackId`·`:versionId`)은 실데이터에 그 항목이 없어서다.
- [x] **🟠 회차 상태 목록은 이제 하나뿐이고, 하나뿐이라는 걸 가드가 지킨다 (414 후속)**: 414 가 고친 건 **한 자리**였고, 같은 모양이 더 있는지 전수로 봤다.
  - **전체 복사본 둘이 더 있었다**(`episode-continuity.service.ts` 의 `states`, `long-projects.service.ts` 의 개요 행 검증). 둘 다 **모양 검사**이고 둘 다 오늘은 맞았지만, 414 가 정확히 "오늘은 맞았던 복사본" 이었다. shared 로 바꿨다. 세 서비스(`episode-videos`·`episode-narration`·`episode-video-merge`)는 **이미** shared 를 쓰고 있었다.
  - **게이트는 안 건드렸다.** 4~7개짜리 짧은 목록 여섯은 *"이 상태들에서만 이미지를 만들 수 있다"* 같은 결정이고, 좁은 게 요점이다. **게이트와 모양 검사는 소스에서 똑같이 생겼다** — 그래서 가드의 규칙은 의도가 아니라 크기다(12개 이상이면 복사본).
  - 반대편 짝: **게이트가 몇 개는 적을 수 있어야 한다.** 문턱을 1 로 낮추는 주입이 빨강 — 없으면 "모든 게이트 금지" 가 통과한다.
  - 🟠 **보고만 함**: `images/1/content` 는 *"아직 안 만듦"* 과 *"만들었는데 깨짐"* 을 `LONG_EPISODE_IMAGES_INVALID` 하나로 말한다. 다만 화면이 그 URL 을 만드는 건 이미지가 있다고 믿을 때뿐이라 **실사용 도달을 재현하지 못했다** — 못 재는 변경은 넣지 않는다.
  - 🟢 프로브의 거절 137건을 코드별로 읽었다. `404 PROJECT_NOT_FOUND` 40건은 **내 프로브가 장편 id 를 단편 라우트에 넣은 교차곱**이고, 나머지는 실제 상태와 맞았다.
  - 주입 셋 전부 빨강.
- [x] **🔴 명언 카드가 자기 장면 수를 잃어버리고 있었다 — 설정이 "6장면 30초" 라고 답했다**: 캡틴D가 곧 쓸 기능이라 **실제 보관함 그림으로 복사본에 카드를 하나 만들어** 끝까지 불러봤다.
  - 저장은 맞았다(`lore_context.scene_count: 1`). **읽는 쪽이 그 1을 유효하지 않다고 보고 기본값 6으로 조용히 바꿨다** — `MIN_SCENE_COUNT` 이 2이기 때문이다.
  - 화면의 틀린 숫자보다 나쁜 건 **`scenesFor()` 가 이 값에서 센다**는 것이다. "이 프로젝트의 장면들" 을 도는 모든 것이 **없는 다섯 장면을 돌았다**.
  - **바닥은 옮기고 게이트는 안 옮겼다**: 명언 카드는 사람이 구성하는 게 아니라 **한 장과 한 문장 그 자체**라 1이 맞다. 보통 단편을 장면 하나로 만드는 것은 여전히 거절한다(이전 판단 유지).
  - 🟠 **왕복이 반쪽이면 덫이 된다**: 장면 수는 프로젝트에 장면이 생기면 잠기므로, 읽은 값 그대로 저장해야 한다. 읽기만 옮겼으면 **아무도 안 고른 그 숫자가 유일하게 저장 못 하는 값**이 된다. 쓰기 바닥도 같이 옮겼고 주입이 그걸 잡는다.
  - 실물 재측정: 실제 그림으로 만든 카드가 **`scenes=6` → `scenes=1`**, 30초 → 5초. 유료 호출 0(어떤 것이든 던지게 두고 쟀다).
  - 🟢 같은 프로브에서 확인만 하고 지나간 것: 카드 생성 201, `generated_images` 가 복사본을 가리키고 실제로 존재, 이미지 1.8MB 실물 PNG 서빙, 자막 켜짐·내레이션 꺼짐.
  - 주입 셋 전부 빨강.
- [x] **🔴 명언 카드 병합이 5초 대신 625초짜리 79MB 파일을 만들었다 (D-042)**: 캡틴D가 다음에 누를 버튼이라 **실제 그림으로 만든 카드를 복사본에서 진짜로 병합**해봤다. **201 이 돌아왔고 아무것도 실패하지 않았다** — 9분 26초 뒤에 10분짜리 영상이 나왔을 뿐이다.
  - `zoompan` 의 `d` 는 **입력 프레임 하나당 출력 프레임 수**이지 길이가 아니다. `-loop 1 -t 5` 가 25fps 로 125 프레임을 만들고, `d=150` 이 그 하나하나를 150 프레임으로 늘려 18,750 프레임(625초)이 됐다.
  - 고침: `d=1` · 입력에 `-framerate 30` · 줌을 `on` 의 함수로 · 확대 2× → 1.2×(줌이 1.15 까지만 가므로 2배는 못 쓰는 여유에 네 배의 픽셀).
  - **565.8초 → 1.9초 · 79MB → 0.7MB · 625초 → 5.02초**(실사용 그림, 복사본).
  - 🔴 **기존 짝이 그 오해를 못박고 있었다**: `toContain("d=150") // five seconds at 30fps` — 주석이 규칙을 틀리게 적어놓았고 짝이 그걸 지켰다.
  - 그래서 짝을 둘로: **인자 짝**(어디서나 돌며 그 실수를 못박음)과 **실제 FFmpeg 짝**(요청한 길이대로 나오는지 잼, FFmpeg 없으면 건너뜀). 두 번째가 첫 번째를 자의적이지 않게 만든다.
  - 주입 셋 전부 빨강. 보통 클립 병합은 영향 없다(`stillDurationSeconds` 가 없으면 zoompan 자체가 없다).
- [x] **🟢 병합 산출물을 더 재봤다 — 이번엔 결함이 없었고, 대신 아무도 안 재던 것을 재게 했다**: D-042 를 고친 뒤 같은 방식으로 산출물의 다른 성질들을 봤다.
  - **문장이 실제로 그림에 박히는지**는 아무도 안 재고 있었다. 기존 짝은 전부 **인자**를 본다(체인에 `subtitles=` 가 있다, `.ass` 가 이렇게 쓰인다). **글꼴 디렉터리가 옮겨지거나, 경로 이스케이프가 어떤 플랫폼에서 깨지거나, libass 가 없으면 FFmpeg 은 아무것도 안 그리고 0 으로 끝나고 병합은 성공을 보고한다.**
  - 그래서 같은 정지 이미지를 **문장 있이/없이 두 번 렌더해 프레임을 비교**하는 짝을 넣었다(SSIM + 하단·중앙 띠 크기). 주입 둘 다 빨강이고, 그중 **하나는 인자 짝이 통과하는 자리**다(필터는 남기고 글자만 투명하게).
  - 확인만 하고 지나간 것: 한글이 두부 없이 렌더된다 · 자막은 **하단에 한 번만** 박힌다(중앙에 한 줄 더 보인다고 읽었던 건 **내가 이미지를 잘못 본 것**이고, 띠를 잘라 재서 1.5KB(단색) 대 32.8KB(글자)로 확인했다) · 실사용 12화의 클립 6개는 5.04초씩, 기존 최종본은 30.22초/12.2MB 로 정합하다.
  - 🟠 **보고만 함 — 한 번 합치고 나면 음악을 못 바꾼다**: 병합 게이트는 `videos_approved`/`failed` 뿐이고 **단편·회차 양쪽이 대칭**이며 주석도 있다(의도된 설계). 그런데 음악은 병합에서 고르고, 병합하면 `completed` 가 된다. 되돌아가는 길은 **장면 버전 복원**뿐인데 실사용 데이터에는 그 버전이 없다. 결함이 아니라 **제품 결정**이라 캡틴D 몫으로 남긴다.
- [x] **🟢 음악이 실제로 파일에 들어가는지도 아무도 안 재고 있었다 (D-042 계열 두 번째)**: `mixBackgroundMusic` 의 기존 짝 다섯은 **전부 인자**를 본다 — `-stream_loop -1`, `atrim`, `afade` 둘, `volume`, `amix`.
  - **그 다섯이 전부 참인 채로 완성 파일이 원본의 무음 트랙을 실을 수 있다.** 필터는 만들어지고, ffmpeg 은 돌고, 엉뚱한 스트림이 매핑된다. 들리지 않는 실패라 눈으로도 안 잡힌다.
  - 그래서 **일부러 무음인 영상** 아래에 톤을 깔고 결과를 쟀다 — 무음이 기준이라 그 위의 소리는 음악에서만 올 수 있다. 세 성질: 음악이 들어갔는가 · **3초 음원이 9초에도 들리는가**(`-stream_loop -1` 의 목적) · 첫 0.2초가 본문보다 훨씬 조용한가(페이드인).
  - 실측: 무음 -91dB → 섞은 뒤 -33.9dB · 8~9.5초 -36.4dB · 첫 0.2초 -57.3dB. **결함은 없었다.**
  - 🔴 **주입 A 가 이 짝의 존재 이유다**: `-map "[aout]"` 를 `-map "0:a:0"` 로 바꾸면 **필터 문자열이 한 글자도 안 변해서 인자 짝 다섯이 전부 통과**하고, 새 짝만 빨개진다. 주입 셋 전부 빨강.
- [x] **🔴 16:9 명언 카드가 세로로 나왔다 — 그 파일의 주석이 이 결함을 과거형으로 적어두고 있었다**: 네 조합(9:16·16:9 × 5초·10초)을 만들어 병합하고 산출물을 쟀다. **길이는 다 맞았고 비율은 넷 다 1080x1920 이었다.**
  - 원인: 카드가 비율을 **`style_profile.aspect`** 에 썼다. `projects/project-aspect.ts` 는 **정확히 그 필드 때문에 만들어진 파일**이다 — 읽는 곳 다섯이 전부 그걸 읽었는데 **아무것도 그 필드를 쓴 적이 없어서** 가로형으로 설정한 프로젝트가 세로로 만들어지고 합쳐지고 표시됐다. 그 주석이 그렇게 적혀 있다. **나는 반대편에서 같은 결함을 다시 냈다**: 이번엔 쓰는 쪽만 있고 읽는 쪽이 없다.
  - 고침: 화면이 저장하는 자리(`lore_context.style_notes.aspect`)에 쓴다. 실물 재측정: **16:9 → 1920x1080**, 9:16 → 1080x1920, 길이 5.02/10.02초.
  - 짝 둘: 저장 자리를 **모든 렌더러가 쓰는 그 헬퍼로** 확인하고(저장한 필드를 되읽는 짝이었다면 **영상이 틀린 모양으로 나오는 동안에도 통과**했을 것이다), **실제 FFmpeg 으로 파일의 해상도**를 잰다. 둘 사이에 "값은 맞는데 영상은 세로" 가 숨을 자리가 없다 — 그게 방금 발견된 상태다.
  - 주입 셋 전부 빨강(옛 필드로 되돌림 · 가로/세로 뒤집기 · 저장 자리는 맞고 값만 고정).
- [x] **🟢 회차 병합의 장면 순서도 아무도 안 재고 있었다 (D-042 계열 세 번째)**: 실사용 12화 Episode01 의 클립 6개를 복사본에서 실제로 합치고, **5초 창마다 어느 원본 장면과 가장 닮았는지** 쟀다.
  - **결함은 없었다**: 30.22초 · 1080x1920 · 창 6개가 장면 1~6과 순서대로(맞는 짝 SSIM 0.72~0.995, 나머지 ~0.10).
  - 🔴 **순서는 이 파일의 모든 인자 짝이 통과시키는 성질이다.** concat 목록은 만들어지고, ffmpeg 은 돌고, 길이는 그대로 더해진다. 뒤집힌 릴도 바이트 수까지 그럴듯하다 — **사람이 자기 영상을 보고 나서야 안다.**
  - 짝: **색이 멀리 떨어진 1초 클립 여섯**을 합치고 초마다 **가운데 픽셀 한 개**를 읽어 순서를 확인한다. 이미지 유사도가 아니라 색으로 재는 이유는, **평평한 두 프레임은 색이 달라도 구조 유사도가 높게 나오기** 때문이다 — 재는 대상이 실제로 다른 값이어야 한다.
  - 주입 셋 전부 빨강. **그중 둘(목록 뒤집기 · 장면 두 개 맞바꾸기)은 길이·개수·인자가 전부 그대로**라 새 짝 하나만 잡는다.
- [x] **🟢 이미지 재생성이 보관하는 게 "이전 그림" 인지도 아무도 안 재고 있었다 (D-042 계열 네 번째)**: 회차 쪽 짝은 `fs.access` 로 **파일이 있는지만** 봤다. 아카이브에 **새 그림을 써도 그 확인은 통과**하고, 그러면 사람이 되돌아가려던 **값 치른 이전 그림이 사라진다** — 그 자리에 있는 건 방금 그걸 대체한 것의 복사본이다.
  - **실제로 다른 두 그림**으로 재야 한다: local-fake 경로에서는 이전/새 이미지가 같은 플레이스홀더라 바이트 비교가 어느 쪽이 쓰였는지 구분하지 못한다. 그래서 제공자 스텁이 첫 생성과 재생성에 **서로 다른 PNG** 를 주도록 두고 쟀다.
  - **결함은 없었다** — 코드는 이전 바이트를 읽어 보관한다. 주입 셋 전부 빨강이고, **그중 둘(아카이브에 새 그림 쓰기 · 현재 그림을 안 바꾸기)은 파일이 여전히 생겨서 기존 확인이 통과**한다.
- [x] **🟠 잠금 하트비트 테스트가 부하에서 한 번 깜빡였다 — 못 재현해서 고치지 않고 천장만 올렸다**: 전체 스위트 한 번에서 *"the holder never refreshed its lock"* 로 빨개졌다. **단독 3회·FFmpeg 테스트와 나란히 2회·전체 재실행 1회, 네 번 다 통과** — 재현 못 했다.
  - 그 5초는 **조건 대기의 천장**일 뿐이고(빠른 실행은 첫·둘째 바퀴에 빠져나온다), 실제 FFmpeg 테스트 여럿이 스위트에 합류한 직후에 나왔다. 30초로 올리고 **못 재현했다는 사실을 주석에 적었다** — 잠금이 아니라 기계 부하 이야기인 빨강은, 느린 실패보다 나쁘다.
- [x] **🔴 예산 게이트 짝 하나가 매달 1일에 스스로 깨지는 시한폭탄이었다 — 오늘 터졌다**: *"surfaces a budget-exceeded preflight as a failed scene"* 가 **아무것도 안 바꿨는데** 빨개졌다. 처음엔 내가 넣은 실제 FFmpeg 테스트들 때문에 부하로 깜빡인 줄 알았는데, **단독으로도 실패**했다.
  - 원인: 그 짝은 소진액을 **`2026-08-23` 로 적고** 현재 월 예산이 소진됐다고 단언한다. 예산은 **현재 UTC 월**만 센다. 실행 시각이 UTC 로 9월에 들어선 순간(로컬 09:29 = UTC 00:29) 8월 기록은 안 세어지고, 게이트가 안 걸린다.
  - **8월인 동안에는 통과했고, 스스로 실패했다.** 그리고 눈에 띄는 수리(날짜를 9월로 바꾸기)는 **다음 달 1일용으로 다시 장전**한다.
  - 고침: 같은 파일의 형제 둘이 이미 하는 대로 **시계를 고정**했다(`vi.setSystemTime`). 주입 B(시계 고정 제거)가 **오늘 그 폭탄을 그대로 재현**한다.
  - 확인만 함: `providers/*-budget.test.ts` 의 하드코딩 날짜들은 `spentThisMonth(now)` 에 시각을 **명시로 넘겨** 시간 독립적이다. 서비스를 지나는 셋 중 나머지 둘도 이미 시계를 고정하고 있었다.
- [x] **🟢 최종 영상이 내레이션을 실제로 담는지도 아무도 안 재고 있었다 (D-042 계열 다섯 번째)**: 기존 짝 둘은 인자만 본다(`apad`·파일명·`anullsrc`).
  - **길이가 절반의 요점이다**: `-shortest` 는 먼저 끝나는 입력에서 끊으므로, **2초 내레이션이 5초 장면을 2초로 잘라낼 수 있다.** `apad` 가 그걸 막는데, 막았는지는 파일만 말해준다.
  - 실측: 5.02초 유지 · 앞 1.5초 -21.6dB(목소리) · 3~5초 -91dB(패딩) · 내레이션 없으면 전체 -91dB. **결함은 없었다.**
  - 주입 셋 전부 빨강. **첫째(`-map "[aout]"` → `"0:a:0"`)는 필터 문자열이 그대로라 기존 인자 짝 둘이 전부 통과한다.**

- [x] **🔴 유료 프롬프트가 빈 라벨을 달고 나갔다 — 실사용 8개 전부**: 실사용 프로젝트 복사본을 **끝까지 렌더해서 셌다**. `대사 스타일:` 이 8/8 에서 빈칸, `피해야 할 요소:` 4/8, 시각적 스타일·색감·조명·카메라 느낌 각 3/8, 전체 줄거리 1/8. 전부 돈 나가는 요청이다.
  - **인자에서는 안 보인다.** 값은 있고, 그 값이 빈 문자열이다. `??` 는 그걸 "없음" 으로 치지 않아서 대체값이 안 걸린다.
  - 🟠 **그 규칙은 이미 그 파일 주석에 적혀 있었다** — 절 제목 아래가 통째로 `$변수` 인 세 자리에만 적용됐다. 템플릿 대부분은 `라벨: $변수` 한 줄짜리이고, 깨지고 있던 곳이 정확히 거기다.
  - 같은 자리에서 하나 더: `세계관: AUTONOMOUS_SETTING` — **상수의 이름이 한국어 문장에 실려** 나갔다. 파이썬은 `자율` 을 보낸다.
  - 짝은 템플릿에서 라벨을 뽑는다(손으로 베낀 목록은 줄이 하나 늘면 그날 상한다, D-039). 주입 넷 전부 **새 짝만** 잡고 기존 제목 짝은 초록 — D-042 가 요구하는 모양이다. 고친 뒤 재측정: 8/8 빈칸 0, 누출 없음. → `docs/06_DECISIONS.md` **D-043**
- [x] **🟠 "cwd 에 의존하면 안 된다" 는 이름의 describe 안에서 테스트가 cwd 에 의존했다**: `apps/backend` 에서 띄우면 통과, 리포 루트에서 띄우면 `ENOENT: C:\dev\prompts\...`. **어느 디렉터리에서 스위트를 띄웠는지가 검사가 돌았는지를 결정**했다. 프로덕션 `promptsRoot()` 와 같은 기준(`import.meta.url`)으로 맞췄고 양쪽 cwd 26/26. → **D-044**
- [x] **회차 연속성 메모가 실제로 보내는 프롬프트에 실리는지**: 캡틴D가 곧 할 3화 작성의 유료 입력이다. 읽는 쪽과 템플릿은 짝이 있었고 **그 사이 이음매만 없었다**. 5화 기준으로 짝을 썼다 — 3화에서는 앞 두 회차가 둘 다 "최근" 이라 **압축 요약 경로를 아예 안 타고**, 그걸 통째로 버리는 주입이 초록으로 통과한다(재측정으로 확인). 주입 넷 전부 빨강. **결함 없음 — 메모는 프롬프트에 실린다.**
- [x] **시계 의존 짝 훑기**: 월이 넘어간 직후(09-01)에 예산 관련 4개 파일 49/49 초록. 지난번 고침이 버텼고 **형제 폭탄은 없다.** 나머지 `new Date()` 자리는 전부 상대시간이거나 임의 타임스탬프다.

- [x] **🔴 회차 이미지가 참고 사진을 보내면서 그게 누구인지는 안 보냈다**: 단편은 생성·재생성 둘 다 `describeReferenceMappingsForScene` 블록을 프롬프트에 넣는다. **회차는 두 자리 다 안 넣었다** — 바로 다음 줄에서 같은 매핑으로 사진 바이트는 올리면서. 실제로 나간 multipart 몸통의 `prompt` 를 읽어 쟀고, 이름·역할·설명 셋 다 없었다.
  - **보내는 것과 기록하는 것을 나눴다.** 이 파일의 기존 판단(재생성 일회성 지시는 보내되 기록 안 함)과 같은 이유다 — 기록에 넣으면 Asset 설명만 고쳐도 대본이 바뀐 것처럼 읽히고, 그건 `referenceStale` 이 이미 이름으로 재는 일이다.
  - 🔴 **재생성 경로는 짝이 아예 없었다**: 생성만 고치고 재생성을 두는 주입에 장기 프로젝트 319개가 전부 초록이었다. 검토 화면에서 제일 자주 눌리는 버튼이다. 짝을 그쪽까지 늘렸다. → **D-045**
- [x] **형제 훑기 결과 — 이미지·모션 템플릿에는 같은 결함이 없다**: `prompts/image/scene_generation.txt` 와 `prompts/templates/motion_generation.txt` 는 **TS 가 읽지 않는다**(파이썬 베이스라인 전용). TS 는 `image-prompt.ts` 에서 프롬프트를 만들고 **빈 값을 애초에 버린다**(`.filter(([, value]) => value)`) — 빈 라벨이 구조상 생기지 않는다. story 템플릿만 `renderTemplate` 를 탄다.
- [x] **Cowork 두 건 받아 돌려줌**: `LongProjectSummary.warnings` → `LongProjectDetail`(요약 표 위), `paidProvider` → 유료 안내 두 문장 복구. 🟠 옛 픽스처 하나가 `paidProvider` 없이 유료 문장을 요구해 빨갛길래 **한 줄(`paidProvider: true`)만** 넣고 주석으로 밝혔다 — 지울지는 그쪽 판단.

- [x] **🔴 병합 거절 사유가 거짓말이었다 (단편·회차 둘 다)**: Cowork 이 *"다시 열면 버튼이 나오니 재병합 됩니다"* 라고 화면을 읽어 보고했고, **두 번 눌러서** 재봤다. 1차 후 `COMPLETED`, 2차는 `409 VIDEO_MERGE_NOT_ALLOWED — "requires six approved scene videos"`. **여섯 장면은 전부 승인돼 있다.** 사람은 이미 끝낸 일을 하라는 안내를 받는다. 회차도 같은 문구.
  - 두 상태를 가르는 코드를 따로 뒀다. **게이트는 그대로** — 재병합 허용 여부는 제품 결정(캡틴D 몫)이고, 고친 것은 *거절한다* 가 아니라 *사유가 거짓이다* 쪽이다.
  - 🟠 화면은 코드로 문장을 고르고 모르는 코드는 일반 문장으로 떨어진다 — 거짓 대신 모호로 바뀌었고, 정확한 두 문장은 Cowork 에게 넘겼다.
  - 🔴 새 짝의 한쪽이 **없는 값으로 통과**하고 있었다(`WorkflowState.Draft` → 런타임 `undefined`). vitest 는 타입을 안 보고 `nest build` 가 잡았다. → **D-046**

- [x] **427 의 나머지 반쪽 — 화면이 두 문장을 갖고, 성공 못 할 버튼을 감춘다 (Cowork Round 428)**: `VIDEO_MERGE_ALREADY_COMPLETED` · `LONG_EPISODE_MERGE_ALREADY_COMPLETED` 문구가 들어갔고, 회차 병합 화면은 이미 완성된 회차에서 버튼 대신 사실을 보여준다. 🟠 단편은 원래부터 버튼이 안 나왔다 — **427 에 제가 "화면이 버튼을 다시 준다"고 적은 것은 절반만 맞았다**(`VideoMergeScreen.tsx:87` 이 완료 상태를 복원한다). 그쪽 보고를 확인 없이 받아 적은 자리다.

- [x] **🔴 음원 업로드는 한 번도 성공한 적이 없었다 — 결함이 셋이었고, 셋 다 같은 빈틈에 있었다 (Cowork Round 428 + CLI Round 429)**: Cowork 이 첫째(프런트가 파일 부분을 `"file"` 로, 서버는 `FileInterceptor("audio")` 로 읽음)를 고쳤다. **HTTP 로 실제 multipart 를 보내 보니 그래도 400 이었다.**
  - **둘째 — `attributionRequired` 가 문자열로 도착한다.** multipart 에는 타입이 없어서 전 필드가 텍스트다. 서버는 `typeof !== "boolean"` 으로 거절했고, **앱이 보내는 모든 업로드가 여기서 죽었다.** `"true"`/`"false"` 두 낱말만 받는다 — `Boolean("false")` 는 `true` 라, 느슨하게 읽으면 **출처 표기가 필요한 음원을 필요 없는 것으로 저장**한다.
  - **셋째 — 한국어 파일명이 거절됐다.** Multer 는 파일명 바이트를 Latin-1 로 준다. 한글 UTF-8 연속 바이트는 U+0080~U+009F 에 떨어지고 그게 C1 제어문자 범위다. 보관함 쪽은 **원래부터 이 복구를 하고 있었는데**, 음원 쪽은 *"audio has no mojibake-repair need"* 라는 주석과 함께 검사만 베껴 갔다. **이 앱의 기본 언어가 한국어다** — 예외가 아니라 보통의 업로드였다. 구현을 `assets/upload-filename.ts` 하나로 합쳤다.
  - 🔴 **셋 다 초록 위에서 살아 있었다**: 프런트 테스트는 자기가 만든 FormData 를 확인하고, 서비스 테스트는 `upload()` 에 **HTTP 로는 만들어질 수 없는** 객체(진짜 boolean, 정상 파일명)를 직접 넘긴다. 양 끝이 각자 초록이고 **가운데를 아무도 안 건넜다**(D-031). 새 `audio-upload.integration.test.ts` 가 실제 Nest 인스턴스에 진짜 multipart 를 쏜다.
  - 주입 셋 전부 빨강 — 필드 이름 되돌리면 5개, 문자열 boolean 파싱 빼면 3개, mojibake 복구 끄면 4개(보관함 쪽 기존 짝 1개 포함).
  - 🟠 Cowork 구역에서 한 줄: `AudioLibraryScreen.test.tsx` 가 방금 지워진 `AUDIO_FORMAT_UNSUPPORTED` 를 계속 쓰고 있어 빨갰다 — 서버가 실제로 보내는 `AUDIO_FILE_INVALID` 로 바꿨다(문구 단언은 그대로 통과).
- [x] **파일 항목 이름을 shared 상수로 냈다 (Cowork 요청)**: `AUDIO_UPLOAD_FILE_FIELD` · `ASSET_UPLOAD_FILE_FIELD`. 라우트나 본문 필드와 같은 요청 계약이라 `api.ts` 에 둔다. 백엔드 인터셉터 4곳이 이미 읽는다 — **이번 결함은 이 상수가 있었으면 애초에 안 생겼다.**
- [x] **🟠 영상 재시도 견적이 실제보다 적다 — Cowork 의심이 맞다, 재서 확인했다**: 실패한 5번을 다시 시도하면 **6번까지 산다.** 실패한 장면은 파이프라인을 멈추고(`runway-workflow-support.ts:135`), 그 실패를 지우면 **작업 전체가 재개**되기 때문이다 — 단편의 `run()` 도 회차의 `run()` 도 runway 경로에서는 `requestedScenes` 를 무시하고 `advanceReal` 로 넘긴다(`local-video-workflow.service.ts:532`, `episode-videos.service.ts:363`). 재확인 없이 다음 장면이 나간다.
  - 캡틴D 3화 상태(1~4 완료 · 5 실패 · 6 대기)를 그대로 재현해 **제출 횟수로 쟀다**: 재시도 후 `/v1/image_to_video` 2회, 원장 총액 $1.75(= 7 × $0.25, 5번의 실패 시도분 포함). **화면은 $0.25 라고 말한다.**
  - 규칙: **선택한 장면 ∪ 아직 succeeded 가 아닌 장면.** 검토 상태에서의 재생성은 나머지가 전부 성공이라 그대로 1이 되고, 실패 재시도만 늘어난다. 진행 응답의 `sceneNumbers` − `completedSceneNumbers` 로 화면이 바로 계산할 수 있어 계약 변경 없이 된다 — 계산은 Cowork 이 맡는다(Round 429 로 넘김).

- [x] **🚨 배경음악만으로 병합한 프로젝트가 목록에서 사라졌다 — 쓸 수는 있고 읽을 수는 없는 값이었다 (Cowork Round 436)**: 캡틴D의 명언 카드가 **병합 성공 직후 화면에서 사라졌다.** 파일은 멀쩡했다(4.8MB 정상). 읽기만 안 됐다.
  - `"bgm"` 은 **병합이 받는 정식 모드**이고(`video-merge.service.ts:77`, `usesBgm`), 저장 스키마의 허용 목록에는 없었다(`USED_AUDIO_MODES` 에 셋만). **쓰고 나면 다시 못 여는 파일**이 만들어진다 — `GET /projects/<id>` 는 `PROJECT_DATA_INVALID`, 목록은 그 프로젝트를 통째로 뺀다. 오류 문구조차 `"bgm"` 을 안 세고 있었다.
  - **목록 하나에서 타입을 파생**시켰다(`export const USED_AUDIO_MODES = [...] as const` → `mode: (typeof …)[number]`). 문구도 같은 배열을 읽는다.
  - 🔴 **양쪽 다 테스트가 있었고 가운데가 없었다** — 병합 테스트는 `merge()` 의 **메모리 결과**를 보고, 스키마 테스트는 읽는 쪽만 본다. 네 모드를 **병합하고 다시 열어 보는** 왕복 짝을 넣었다(`projects.list()` 에 그대로 남는 것까지). 음원 업로드와 같은 모양이다(D-031).
  - **회차는 안 걸린다** — Episode 는 이 스키마를 안 타고 `episode-detail.ts:113` 이 네 모드를 다 받는다. Cowork 이 확인 부탁한 자리이고, 스키마의 다른 값 목록도 훑었다(어긋난 곳 없음).
  - ❗ **두 번째 결함: 조용히 건너뛰던 것.** `list()` 는 못 읽는 항목을 말없이 뺀다 — 파이썬 `MemoryManager.list_projects()` 와 같은 동작이라 **건너뛰는 것 자체는 맞다**(하나 망가졌다고 나머지를 화면에서 지울 수 없다). 조용한 게 틀렸다. 몇 개를 왜 건너뛰었는지 이유와 함께 로그로 남긴다 — 캡틴D의 첫 마디가 *"어디 간거야"* 였고, 그때 저장소만 이유를 알고 있었다.
  - 주입으로 쟀다 — 목록에서 `"bgm"` 을 빼면 새 왕복 짝이 빨갛다.
- [x] **Cowork 431~433 프런트 묶음 (검증·커밋만 CLI)**: 재시도 견적을 측정된 규칙(`{고른 장면} ∪ {아직 succeeded 아닌 장면}`)으로 고쳤고(화면 둘), 명언 카드가 병합 화면에서 영구히 막히던 것을 풀었고(카드의 장면 1개는 정지 사진이라 `videoReview` 가 승인될 일이 없는데 그 승인을 요구했다 — 빠져나갈 길이 유료 호출뿐이었다), 업로드 파일 항목 이름 4곳을 429 의 shared 상수로 바꿨고, 카드 이름 중복을 누르기 전에 화면에서 먼저 막는다.
- [x] **🔴 완성된 명언 카드를 두고 "저장하지 못했습니다" 라고 답했다 (Cowork Round 432)**: 캡틴D가 만들기를 두 번 누르셨고, **첫 번째는 성공해 있었다.** 두 번째가 `PHOTO_CARD_STORAGE_ERROR` 로 왔다 — `catch { throw photoCardStorageError(); }` 가 저장소의 `PROJECT_ALREADY_EXISTS` 를 통째로 지웠다. 화면에는 *"같은 이름이 이미 있습니다"* 라는 정확한 문구가 **이미 있었고, 아무도 그 코드를 보내지 않아 도달 불가능한 줄**이었다.
  - 그 코드는 그대로 통과시킨다(409). 나머지 두 자리(사진 복사·기록 저장)는 여전히 같은 코드로 뭉치되 **이유를 로그로 남긴다** — 지금까지는 서버조차 셋 중 무엇이 실패했는지 몰랐다.
  - 짝은 **HTTP 로 진짜 두 번 POST 한다**(`photo-card.http.integration.test.ts`). 서비스 테스트는 이 서비스가 던지는 예외를 보는데, 그게 감싼 쪽이라 둘 다 초록이었다 — 음원 업로드와 같은 모양(D-031). 두 번째 거절이 **첫 카드를 건드리지 않는 것**까지 같이 잰다.
  - 주입으로 쟀다 — 통과 조건을 되돌리면 빨갛다.
- [x] **`retryEstimate.pendingSceneCount` 를 계약에 넣었다 (Cowork Round 431 요청)**: 재시도가 사는 장면 수의 규칙은 **백엔드의 멈춤 동작에서 나오는 사실**인데, 화면 둘이 각자 `sceneNumbers − completedSceneNumbers` 로 유도하고 있었다 — 방금 파일 항목 이름이 어긋난 것과 같은 종류다. 필수 필드로 뒀다(`paidProvider` 와 같은 논리 — 돈에 대한 사실은 선택 필드로 두지 않는다). 화면은 `max(pendingSceneCount, 고른 수)` 로 곱할 수를 얻는다(도달 가능한 상태가 둘뿐이라 그 max 가 정확히 합집합 크기다 — 계약 주석에 근거를 적었다).
- [x] **🔴 앱의 어떤 재생기에서도 구간 이동이 안 됐다 — 헤더가 없었다 (Cowork Round 430, 캡틴D가 게시 화면에서 직접 요청)**: 파일을 흘려보내는 라우트 **12개** 전부가 항상 200 에 전체 본문을 주고 `Accept-Ranges` 를 안 보냈다. 브라우저는 구간을 **요청할 방법 자체가 없다** — 재생은 되고 이동만 안 되는 그 조합이 여기서 나온다.
  - 그리고 이것 때문에 기능 하나가 반쯤 죽어 있었다: 게시 화면의 **"지금 이 장면을 커버로"** 는 재생기의 현재 위치를 읽는데, **위치를 고를 방법이 없었다.** 설계가 전제한 조작이 서버에서 막혀 있었다.
  - `streamStoredFile()` 하나로 모았다(`http/range-stream.ts`) — 12개가 같은 블록을 각자 복사하고 있었고, **하나만 고치면 영상 검토는 그대로 막혀 있다**(Cowork 이 짚은 그대로). 없는 파일을 거절하는 어휘는 라우트마다 그대로 뒀다.
  - `Accept-Ranges: bytes` 를 200 에도 항상 보낸다(그게 "요청해도 된다"를 알리는 유일한 수단이다) · `Range` 는 206 + `Content-Range` · 파일 끝을 넘는 범위는 416 + `bytes */size` · **못 알아듣는 Range 는 무시하고 200 전체**(RFC 7233 이 허용하고, 부분 응답을 지어내는 것보다 안전하다).
  - 짝은 **실제 소켓으로 헤더를 보낸다**(두 라이브러리, 서로 다른 컨트롤러). 헬퍼를 직접 부르는 짝은 그 헬퍼를 안 부르는 라우트에서도 초록이다.
  - 주입 둘 다 빨강 — Range 를 무시하면 3개, `Accept-Ranges` 를 빼면 1개.
- [x] **📣 명언 카드 자막이 릴스 UI 에 덮여 있었다 — 카드 전용 배치를 줬다 (캡틴D 요청, Cowork Round 434/435 시안)**: 자막은 모든 프로젝트가 같은 `sceneSubtitleAss()` 를 썼고, 아래 여백 `height*0.042` 는 릴스의 캡션·계정명·버튼이 덮는 구역 안이다. **글자가 안 보이는 건 기억 이전의 문제다.**
  - 카드일 때만 갈라진다. 분기 신호는 이미 있던 `stillDurationSeconds`(카드 경로에서만 채워진다) — 새 필드 없음. **6장면 영상 자막은 그대로 아래** 다(가운데로 올리면 장면 액션을 가린다).
  - 배치: 블록 세로 중심 **0.40**, 본문 `height*0.027`(1920 → 52px), 사자성어는 **본문에서 파생**(`*1.4` → 73px — 손잡이 하나면 안 맞는 조합이 안 나온다), `n5\pos` 로 줄마다 중심 배치, 좌우 여백 `width*0.07`, Outline 4/Shadow 2. **캡틴D가 시안 두 단계를 보고 작은 쪽을 고른 값이다.**
  - **줄바꿈이 없으면 사자성어 줄이 없는 것**으로 친다 — 첫 줄이 사자성어라는 보장이 없고(사람이 직접 친 글이다), 두 덩어리를 가정하면 한 줄짜리 카드가 통째로 명조로 나온다.
  - 🔤 `fonts/NotoSerifKR-VariableFont_wght.ttf`(23.8MB, SIL OFL) 를 넣었다. **없으면 libass 가 조용히 시스템 폰트로 떨어진다** — 만든 사람 컴퓨터에서만 맞고 다른 데선 다르게 나오는, 오류가 안 나는 종류다. 그래서 짝이 **폰트 파일의 name 테이블에서 패밀리 이름을 직접 읽어** 스타일이 부르는 이름과 같은지 본다.
  - 🟢 **실제 렌더로 다시 쟀다**: 기존 실 FFmpeg 짝이 *"아래 띠에 글자가 있다"* 를 단언하고 있었고 **그게 통과하던 것이 결함이었다.** 0.40 지점 띠로 뒤집었다 — 지금은 그 띠가 빈 프레임의 3배 이상이고 아래 띠는 빈 프레임 수준이다.
  - 주입 셋 — 카드 분기를 "scene" 으로 되돌리면 1개, 세리프 파일을 치우면 1개, (배치는 실 렌더 짝이 잡는다).
  - ⏳ **아직 안 한 것**: 캡틴D의 *"내가 프로그램에서 조정할 수 있게"* (435). 계약 제안을 Round 437 로 냈고 Cowork 답 대기다 — 지금 값은 기본값이고, 조절은 그 다음이다.
- [x] **Cowork 438 프런트 (검증·커밋만 CLI)**: Range 가 들어가서 게시 화면의 blob 우회(영상 전체를 받아 objectURL 로 넘기던 것)를 걷어냈고 — Cowork 이 캡틴D 서버에 `Range: bytes=1000-1999` 를 직접 쏴 `206 · Content-Range: bytes 1000-1999/4857176` 을 확인한 뒤였다 — 그것 때문에 빨갛던 프런트 2개가 사라졌다(1187 통과). 재시도 견적의 유도식도 `max(pendingSceneCount, 고른 수)` 로 교체됐고, **서버 값이 화면 유도값을 이기는지** 재는 짝이 추가됐다.
- [x] **📣 명언 카드 자막을 캡틴D가 직접 조절한다 — 계약과 서버 절반 (Cowork Round 435 합의, 438 승인)**: 손잡이 둘(`subtitleLayout.scale` 본문 크기 · `center` 블록 세로 중심), 사자성어는 `*1.4` 파생 그대로. 숫자와 **허용 범위까지 `packages/shared`** 에 뒀다 — 화면의 슬라이더 양 끝과 서버의 거절이 같은 값이어야 한다.
  - **저장은 병합이 한다.** 별도 라우트 없이 병합 요청에 실린 값을 렌더 뒤에 `lore_context` 에 적는다 — 써 본 적 없는 설정이 남아 다음 영상을 조용히 바꾸는 일이 없고, 같은 카드를 다시 병합하면 화면이 `Project.subtitleLayout` 으로 지금 모습 그대로 시작한다.
  - **범위 밖은 거절한다, 자르지 않는다**(`INVALID_REQUEST`). 조용히 자르면 화면이 보낸 값과 나온 영상이 다른데 **아무도 그걸 말해주지 않는다** — 436 이 정확히 그 모양이었다. 단편(일반 프로젝트)에 이 필드가 오면 **무시하지 않고 거절**한다: 무시하면 화면이 없는 손잡이를 있다고 믿는다.
  - 한쪽만 도는 실패가 서로 다르다 — 렌더에만 닿고 저장이 안 되면 **다음 병합이 조용히 되돌리고**, 저장만 되고 렌더에 안 닿으면 **화면이 영상과 다른 숫자를 보여준다.** 그래서 짝이 `.ass` 와 다시 연 프로젝트를 **둘 다** 본다. 주입 둘 다 빨강.
  - 남은 절반은 Cowork 이 붙인다(조절 + 미리보기). 서버는 준비됐다.
- [x] **🔴 명언 카드는 평생 한 번만 병합됐다 — 그래서 방금 만든 조절 기능에 두 번째로는 닿을 수 없었다 (Cowork Round 440)**: 병합 게이트가 `Completed` 를 거절하고, 카드에는 되돌릴 장면 영상도 복원할 버전도 없다. **자막을 조금 키우려면 카드를 새 이름으로 다시 만드는 수밖에 없었다** — 캡틴D의 카드는 지금도 옛 자막(아래 4%)으로 만들어져 있고, 439 의 새 기본값조차 적용할 방법이 없었다.
  - **카드에 한해 재병합을 연다**(Cowork 제안 1번). 게이트가 지키는 것은 "끝난 작업을 덮어쓰지 않는다" 인데 **카드에는 그 대상이 없다** — 유료 클립도 승인도 없고, 이전 최종 영상은 `archiveExistingFinal()` 이 이미 보관한다. 일반 프로젝트는 그대로 거절한다(그건 여전히 제품 결정이다).
  - **게시된 카드는 예외이고, 별도 코드다**(`VIDEO_MERGE_ALREADY_PUBLISHED`). 게시물이 만들어진 파일이 조용히 다른 파일로 바뀌고 양쪽 어디에도 그 사실이 안 남는다. "이미 렌더됨" 과 같은 코드로 묶으면 사람을 다른 데로 보낸다 — 이쪽의 길은 재시도가 아니라 **새 카드**다.
  - 주입 둘 다 빨강 — 재병합을 막으면 2개, 게시 예외를 빼면 1개.
- [x] **미리보기와 렌더가 같은 산술을 두 번 갖지 않게 했다 (Cowork Round 440 이 직접 요청)**: 카드 자막 기하(본문·제목 크기, 줄 간격, 블록 중심, 여백)를 `packages/shared` 의 `photoCardSubtitleGeometry()` 로 옮겼다. FFmpeg 이 굽는 값과 화면이 그리는 값이 **한 함수**다 — 복사본이면 미리보기가 **틀린 채로 맞아 보인다**(사람에게 만들어진 적 없는 영상의 그림을 보여준다). 줄 나누기 규칙(`splitPhotoCardSubtitle`)도 같이 옮겼다 — "첫 줄이 제목인가"는 서식이 아니라 규칙이다.
- [x] **🟠 436 과 같은 모양을 계통적으로 훑었다 — 결함은 없었고, 우연히 일치하고 있었다**: "쓰는 쪽 목록과 읽는 쪽 목록이 손으로 두 번 적힌 자리" 를 전수 조사했다. 네 곳 나왔고 **네 곳 다 지금은 값이 같다** — 즉 아무것도 안 깨져 있었고, 깨지는 날 아무도 못 잡는 자리였다.
  ```
  AssetType             shared 유니온        vs  assets.service.ts TYPES · asset-storage.ts TYPES   (사본 셋)
  AssetStatus           shared 유니온        vs  asset-storage.ts STATUSES
  licenseKind           shared 유니온        vs  audio-library.service.ts LICENSE_KINDS
  InstagramContainerStatus  같은 파일 유니온  vs  KNOWN_STATUSES
  ```
  - 전부 **배열 하나에서 타입을 파생**시키는 436 의 모양으로 바꿨다. 유니온과 `Set` 을 따로 적으면 **한 방향(서버가 모르는 값)** 은 컴파일러가 못 잡는다 — 436 이 정확히 그 방향이었다.
  - 반대 방향(계약이 내주는 값을 서버가 조용히 거절하는 것)은 컴파일이 아니라 **실제 요청**으로만 잡힌다. `AUDIO_LICENSE_KINDS` 와 `ASSET_TYPES` 를 **전부 HTTP 로 걸어보는 짝**을 넣었다(각 5개). 주입(서버 목록에서 하나 빼기)에 그 값 하나만 정확히 빨갛다.
  - 나머지 `new Set([...])` 은 전부 요청 키 허용 목록이라 짝이 없는 지역 값이다 — 같은 위험이 아니다.
- [x] **Cowork 442 프런트 + 외곽선 상수 (검증·커밋 CLI, 상수는 내 쪽)**: 미리보기가 `splitPhotoCardSubtitle()` · `photoCardSubtitleGeometry()` 를 부른다 — 복사본이 사라졌고, 이제 미리보기와 렌더가 **같은 함수**를 쓴다. 완료된 카드에 "자막 고쳐서 다시 만들기" 가 열렸고(게시된 카드는 버튼 없이 이유와 대안을 말한다), 신호는 `photoCard`/`instagramPost` 뿐이라 새 필드가 없다.
  - 🟠 Cowork 이 남은 복사본 하나를 **스스로 신고했다** — 외곽선(Outline 4 / Shadow 2)을 CSS `text-shadow` 로 흉내 내는 부분. **흉내는 그대로 두는 게 맞다**(libass 는 글자 윤곽선을 그리고 CSS 는 그림자를 쌓을 뿐이라, 미리보기 크기에서 4px 을 그대로 그리면 글자마다 검은 상자가 된다). 다만 **숫자는 shared 로 뺐다** — 값이 바뀌는 날 미리보기가 조용히 옛 디자인을 설명하고 있는 것이 문제였지, 흉내 자체가 문제가 아니다.
  - 🟢 캡틴D 카드 `명언_불광불급` 은 `instagramPost: null` 이다(Cowork 이 응답에서 확인). **게시 전이라 자막 고쳐서 그대로 다시 만들 수 있다.**
- [x] **Cowork 444 (검증·커밋 CLI)**: 미리보기가 외곽선 숫자도 shared 상수에서 읽는다 — 흉내는 그대로, 값은 한 군데. 그림자 오프셋을 외곽선 폭에서 따로 떼어낸 것도 같이 들어왔다. 🟢 **캡틴D 서버에서 화면 흐름을 직접 밟아 확인**했다(다시 만들기 버튼 → 미리보기 52px·40% 기본값 → 오디오·병합 복귀, 콘솔 오류 0). 병합 버튼은 캡틴D 몫이라 누르지 않았다.
- [x] **🔴 미리보기와 실제 렌더가 글자 폭에서 어긋나 있었다 — 재서 숫자를 냈다 (Cowork Round 446 질문)**: Cowork 이 미리보기를 실물 1080 프레임으로 그리고 축소하자(445 제안) **좌우로 넘치는 것**이 보였고, "실제 ffmpeg 은 접느냐 잘리느냐" 를 물었다. **렌더해서 쟀다.**
  ```
  띄어쓰기 있는 본문  → 접는다 (줄 수가 늘고 블록이 세로로 자란다)
  띄어쓰기 없는 사자성어/긴 한글 → 안 접는다. 프레임 밖으로 그냥 나간다 (x=0·x=1040 에 잉크 확인)
  ```
  - 🔴 **그리고 더 큰 것이 나왔다: ASS `Fontsize` 는 CSS `font-size` 가 아니다.** libass 는 폰트 자체의 세로 메트릭으로 크기를 잡아서, 같은 숫자로 그린 글자가 **CSS 쪽이 1.5배쯤 넓다.** 그래서 미리보기는 실제보다 **일찍 접히고**, 실제로는 없는 넘침을 경고한다 — 445 에서 준 세로 표도 그만큼 어긋난다.
  - **글자 10개와 16개를 렌더해 차이로 쟀다**(글자 옆여백과 외곽선이 상쇄된다): 제목 **0.662**, 본문 **0.625**. 두 폰트가 서로 다르다 — 하나로 뭉치면 한쪽이 틀린다.
  - `PHOTO_CARD_SUBTITLE_CSS_RATIO` 로 shared 에 냈고, **짝이 실제 렌더로 그 숫자를 다시 잰다**(`subtitle-font-metrics.test.ts`). 폰트 파일이 바뀌면 빨개진다 — 눈으로 고칠 값이 아니라 재는 값이다. 이진 탐색으로 5.4초.
  - 주입: 비율을 1.0 으로 되돌리면(= 지금 미리보기가 하는 것) 빨갛다.
- [x] **Cowork 448 (검증·커밋 CLI)**: 미리보기가 `PHOTO_CARD_SUBTITLE_CSS_RATIO` 를 제목·본문 각각 적용한다 — **크기만 그리기용으로 환산**하고 슬라이더가 말하는 숫자는 ASS 값 그대로다(저장되고 렌더가 받는 값이 그것이라, 화면이 CSS 숫자를 말하면 사람이 다른 것을 본다). 🟢 캡틴D 서버에서 최대 크기까지 올려 **거짓 넘침 경보가 사라진 것**을 확인했다 — 446 에서 결함으로 올라온 좌우 잘림은 **미리보기 쪽 결함이었지 렌더 결함이 아니었다**(Cowork 이 스스로 정정). 넘침 검사 자체는 남겼다: 렌더가 붙은 글자를 안 접는다는 건 실측된 사실이라 더 긴 사자성어에서는 진짜로 걸린다.
- [x] **🔴 게시가 "지금 디스크에 있는 영상" 이 아니라 "호출이 도착했을 때의 영상" 을 올릴 수 있었다 — 재병합을 열면서 내가 넓힌 자리다**: 게시는 **잠금을 잡기 전에** 파일 바이트를 읽고 있었다. 그 사이 병합이 파일을 갈아치우면 **인스타그램에는 이전 컷이 올라가고 디스크에는 새 컷이 남는다** — 그리고 기록은 둘 다에 대해 "게시됨" 이라고 말한다. 되돌릴 수 없는 유일한 동작에서.
  - 병합은 **잠금을 아예 안 잡고 있었다.** 잠금은 키별이라 같은 키를 잡아야 서로 배제된다 — 병합·게시·최종본 버전 복원이 모두 같은 파일 이야기이므로 `FINAL_VIDEO_LOCK_KEY` 하나로 모았다(단편·회차 양쪽).
  - 게시는 이제 **잠금 안에서 읽고**, 상태가 `Rendering` 이면 `INSTAGRAM_VIDEO_RENDERING` 으로 거절한다(죽은 렌더가 남긴 바이트는 아무도 고른 적 없는 영상이다). "영상이 없다" 와 **다른 코드**다 — 그 문장은 사람을 병합하러 보내는데, 병합은 지금 돌고 있는 그것이다.
  - 병합은 다른 쪽이 잡고 있으면 **기다리지 않고 거절**한다(`VIDEO_MERGE_BUSY` · `LONG_EPISODE_MERGE_BUSY`). 몇 분짜리 업로드 뒤에 줄 서는 버튼은 멈춘 것처럼 보이고, 거절 시점에는 아무것도 안 바뀐 상태다. 거절 뒤 `Rendering` 상태를 되돌려 카드가 갇히지 않게 했다.
  - 🔴 **첫 번째 짝은 잘못된 이유로 초록이었다.** "잠금 안에서 읽는다" 를 재려고 잠금을 잡은 채 파일을 바꿨는데, 주입(잠금 전 읽기로 되돌리기)에도 **통과했다** — 두 경로가 경쟁해서 우연히 새 바이트를 읽은 것이다. 50ms 를 넣어 순서를 고정하니 주입이 빨개진다. **D-023 이 말하는 초록 넷 중 하나를 그대로 밟았다.**
  - 주입 셋 — 잠금 전 읽기 1개 · `Rendering` 가드 제거 1개 · (병합 거절은 새 짝이 직접 잡는다).
- [x] **Cowork 450 (검증·커밋 CLI)**: 449 의 새 코드 셋에 화면 문구가 붙었다. 셋 다 **"실패" 라는 낱말을 빼고** *"잠시 뒤에 다시 눌러 주세요"* 로 썼다 — 아무것도 안 바뀐 상태의 거절이라 원인을 찾아 나서게 만들면 안 된다는 판단이고, 맞다. `— 게시 중이거나 새로 만드는 중입니다` 로 **무엇을 기다리는지**까지 말한다. 짝이 `INSTAGRAM_VIDEO_RENDERING` 문구가 `INSTAGRAM_VIDEO_UNAVAILABLE` 과 다르고 *"합쳐"* 를 안 말하는 것까지 잠근다 — 코드를 나눈 이유를 문구 수준에서 지킨다.
- [x] **🔴 유료 내레이션을 덮어쓰다 실패하면 이전 것도 같이 사라졌다 — 형제 중 재생성만 원자적이지 않았다**: 생성은 임시파일→rename(윈도우 rename 재시도까지) 인데, **재생성만 목적지에 곧장 쓰고 나중에 검사**했다. 쓰기가 실패하면 그 장면은 **새 것도 옛 것도 없이** 남고, 둘 다 TTS 유료다. 회차 내레이션·회차 이미지·단편 이미지는 전부 원자적이었다 — 덮어쓰는 경로 하나만 아니었다.
  - 생성 쪽 원자적 writer 를 `writeNarration()` 으로 내어 **재생성이 그걸 쓴다**(주입된 writer 를 두 경로가 공유한다). 검사는 **바이트에 대해 먼저** 한다 — 디스크의 파일에게 묻던 "안에 바이트가 있냐" 를, 이미 있는 것을 갈아치우기 전에 묻는다.
  - 짝: 쓰기가 실패하면 **이전 take 가 그대로 남고** 프로젝트 기록도 그 파일을 계속 가리킨다. 주입(곧장 쓰기로 되돌리기)에 빨강.
- [x] **🔴 회차 최종본 보관이 "못 읽으면 없는 것" 으로 번호를 다시 매겼다 (D-036 의 안 훑린 형제)**: `readdir` 이 어떤 이유로 실패하든 빈 목록이 되어 **번호가 v001 부터 다시 시작**하고, 이미 있던 보관본 위에 덮어썼다 — 그 보관본은 **유료 Runway 클립으로 병합한 컷**이다. 단편 쪽 목록은 이 이유로 이미 고쳐져 있었고(`video-library.service.ts`), 회차만 관대한 사본을 들고 있었다. ENOENT 만 "첫 보관" 이고 나머지는 던진다. 쓰기도 임시파일→rename 으로 바꿨다.
  - 🔴 **첫 짝은 잘못된 이유로 초록이었다.** `history` 자리에 파일을 놓아 readdir 을 실패시켰더니 **그 뒤 쓰기도 같이 실패**해서, 결함이 있든 없든 병합이 거절된다 — 주입이 통과했다. 목록 읽기를 **주입 가능한 이음매**로 빼서(디렉터리는 멀쩡한 채) 다시 쟀고, 그제야 주입이 빨개진다. **오늘 두 번째로 밟은 같은 함정이다**(D-023).
- [x] **🟠 전수 검사들의 바닥값이 실제보다 한참 낮았다 — 결함은 없고, 눈이 멀어도 초록일 자리였다 (Cowork Round 452 가 자기 쪽에서 먼저 찾음)**: Cowork 이 프런트 가드의 바닥을 60→80(실제 88)으로 올린 것과 같은 자리를 백엔드에서 훑었다.
  ```
  episode-status-list        50  → 140   (실제 158)   long-projects 36개가 통째로 빠져도 통과했다
  atomic-write-coverage      50  → 140   (실제 158)   같은 walker, 같은 슬랙
  long-projects.no-network   20  → 30    (실제 36)    디렉터리 3분의 1이 사라져도 통과
  money-guard-tests          100 → 220   (실제 ~240)  워크스페이스 하나가 통째로 빠져도 통과 — 유료 호출 앞 가드를 세는 walker다
  fake-timer-restoration     200        (실제 240)    그대로 뒀다 — 주요 루트 하나가 빠지면 이미 걸린다
  ```
  - 전부 **실제보다 낮게** 뒀다(Cowork 의 판단과 같음): 파일 몇 개 지웠다고 빨개지면 그 줄이 오히려 무시당한다.
  - 🟠 처음에 money-guard 를 450 으로 잡았다가 **실제로 세어 보니 240**이었다 — 저장소 전체 `.ts` 를 세고 그 walker 가 테스트만 센다는 걸 안 봤다. 짐작한 숫자를 넣고 초록을 확인하는 게 아니라, **재고 넣는다.**
  - 주입: 스윕에서 `long-projects` 를 통째로 빼면 빨갛다(전에는 초록이었다).
- [x] **Cowork 452 (검증·커밋 CLI)**: 프런트 `no-provider-or-storage-access` 가드의 바닥 60 → 80(실제 88). 🟠 그리고 **못 한 것을 밝혔다** — 게시 화면이 명언 카드를 잡는지 브라우저로 확인하려다 메뉴 클릭이 안 먹혀 실패했고, "확인했다" 고 말하지 않았다.
- [x] **명언 카드가 게시까지 실제로 가는지 처음으로 쟀다 (Cowork 452/454 가 화면으로는 못 본 절반)**: 카드는 "한 가지 사실만 더 붙은 단편" 이라 **각 단계가 앞 단계는 카드를 처리한다고 믿고** 쓰였고, 안 그랬던 한 곳(병합 화면 게이트)은 **사람이 버튼을 눌러서** 나왔다(432). Cowork 이 게시 화면을 브라우저로 밟아보려다 도구가 사이드바를 못 눌러 실패했고 **"확인했다" 고 말하지 않았다** — 그 절반 중 **테스트가 실제로 잴 수 있는 쪽**(라우트)을 이번에 쟀다.
  - 만들기 → 병합 → **영상 보관함 목록에 뜨는지**(게시 화면이 목록을 만드는 그 응답) → 게시까지 한 흐름으로 간다. 올라간 바이트가 **그 카드의 렌더 결과와 같은지**, 기록이 프로젝트에 남는지까지 본다. 유료 호출 0(Graph 는 스텁, FFmpeg 은 가짜).
  - 짝 하나 더: **게시되는 순간 재병합이 막힌다** — 카드 재병합을 연 규칙의 나머지 반쪽이다.
- [x] **🟠 내가 넣은 로그가 매 목록 조회마다 울고 있었다**: 436 에서 넣은 "건너뛴 프로젝트" 경고가 **프로젝트가 아닌 폴더**(`_asset_library_manual`, `.archive`)까지 경고했다 — 앱이 스스로 거기 두는 것들이다. **항상 떠 있는 경고는 읽히지 않게 되고**, 그러면 진짜 손상이 왔을 때도 안 읽힌다. `PROJECT_NOT_FOUND`·`UNSAFE_PROJECT_ID` 는 "프로젝트가 아니다" 라 조용히 넘기고, 나머지(JSON 손상·스키마 거부·읽기 실패)만 남긴다.
  - 테스트 출력에서 발견했다 — 새 통합 짝을 돌리다 로그에 뜬 걸 보고 알았다. 짝으로 못 박았다(주입: 전부 경고하기 → 빨강).
- [x] **📣 음악 시작 지점 — 캡틴D 승인(456: *"3번은 만들어줘"*), 서버 절반 완료**: `MergeAudioSettings.startSeconds`(기본 0). 곡은 릴스보다 길어서 2분 9초를 올려도 **앞 30초만** 쓰였고, 원하는 부분은 대개 앞이 아니다. **시작만** 받는다 — 끝은 영상 길이가 정한다.
  - `-ss` 를 **`-i` 앞, `-stream_loop` 앞**에 둔다. 뒤에 두면 처음부터 디코드해서 버리는 같은 그림의 느린 버전이고, 루프 뒤에 두면 **두 번째 바퀴부터 곡 첫머리로 돌아온다.**
  - **범위 밖은 거절하고 자르지 않는다**(`AUDIO_START_OUT_OF_RANGE`, `details.durationSeconds` 에 트랙 길이). 사람이 필요한 문장은 *"이 곡은 2분 9초까지입니다"* 이고 `INVALID_REQUEST` 로는 그 말을 못 한다(Cowork Round 456 요청).
  - **회차에도 같은 필드·같은 코드**로 넣었다 — 캡틴D는 회차에 음악을 깐다. 단편만 되면 정작 쓰실 데서 안 된다.
  - 🟢 **실제로 렌더해서 들었다**: 앞 5초 무음 + 뒤 5초 톤인 트랙을 만들어, 시작 0 은 첫 2초가 무음(-91dB), 시작 5 는 같은 자리가 **30dB 이상 크다.** 인자만 보는 짝은 `-ss` 가 잘못된 자리에 있어도 통과한다(주입으로 확인 — 인자 짝은 초록, 렌더 짝은 빨강).
  - 🟠 짝을 만들다 **fixture 가 3분 멈췄다**: `-t 5` 를 `-i anullsrc` **뒤에** 둬서 그 옵션이 다음 입력에 걸렸고, 무한 무음이 concat 을 영원히 기다리게 했다. `d=5` 로 소스 자체를 끝냈다.
  - 🔴 **주입을 되돌리다 `git checkout` 으로 단편 쪽 작업을 통째로 날렸다.** 백업 파일이 있었는데 그걸 안 쓰고 되돌리기 명령을 썼다 — 다시 넣었고, 앞으로 주입 복구는 백업 파일로만 한다.
- [x] **음악 시작 지점, 화면 절반 (Cowork 458+460, 검증·커밋 CLI)**: 음원을 고르면 재생기와 **"여기부터"** 가 나온다 — 들어보고 그 자리에서 누르는 조작이고, 커버 프레임과 같은 모양이다(숫자 입력으로는 2분짜리 곡에서 몇 초가 좋은지 알 방법이 없다). `MergeAudioFieldset` 하나라 단편·회차가 같은 것을 쓴다. **0 은 안 보낸다**(서버 기본값과 같아서, 실어 보내면 "누가 0 을 골랐다" 로 읽힌다) · **트랙을 바꾸면 시작 지점을 잊는다**(안 그러면 1분짜리 곡에 1분 20초가 남아 **아무도 요청한 적 없는 거절**을 받는다) · `currentTime` 이 유한하지 않으면 0 으로 기록하지 않는다.
  - `AUDIO_START_OUT_OF_RANGE` 문구가 `details.durationSeconds` 를 읽어 *"이 곡은 2분 8초까지입니다"* 로 만든다 — **`details` 를 읽는 유일한 자리**이고, 그 예외를 주석에 예외라고 적었다(서버 메시지는 경로를 실을 수 있어 화면에 안 내보낸다는 원칙은 그대로).
  - 🔴 **458 은 커밋을 거절했다**: 시작 지점 props 를 넣는 hunk 에서 **완료된 회차의 안내문과 버튼 감춤이 통째로 사라져** 있었다 — 427/432 가 고친 것이 되돌아간 상태였고, 커밋된 프런트 짝 하나가 그걸 잡았다(1213 중 1 실패). 한 파일만 빼고 커밋하지 않았다: 반만 올라가면 다음 라운드가 그 위에 쌓인다.
  - 🟢 **원인은 Cowork 이 스스로 찾아 460 에 적었다** — 파일을 올릴 때 "가져온 뒤로 안 바뀌었으면 통과" 가드에 **가져온 시점이 아니라 방금 조회한 현재 수정시각**을 넣어, 옛 사본이 새 파일을 덮었다. **가드가 실패한 게 아니라 가드가 보는 값을 만들어 넣은 것** — 오늘 이쪽에서 두 번 나온 *"짝이 잘못된 이유로 초록"* 과 같은 종류다. 앞으로 stage 응답의 값만 쓰기로 했다.
  - 📣 캡틴D 인스타 새 계정(`greendog2012__`) 연결 완료 — 앱이 두 계정을 다 잡고, 게시할 때 고를 수 있다.
- [x] **📣 파이썬 소스·테스트 삭제 (캡틴D 요청, 2026-09-02)**: `app/` 52개 · `tests/` 38개, 합쳐 3MB. **최적화가 아니라는 것을 먼저 재서 보고했다** — 설치 프로그램에 안 들어가고 실행 중에도 안 읽히므로 앱은 1바이트도 안 가벼워지고, 205MB 는 히스토리에 남아 새 클론도 그대로 받는다.
  - **남긴 것**: `prompts/`(실행 중 읽힌다 — `story/story_generation.txt`, 설치 프로그램에 복사됨) · 루트 `learning_data/`(베이스라인 데이터, D-032 그대로) · `run_ui.bat`·`requirements.txt`(캡틴D 판단 대기 — `run_ui.bat` 은 이제 없는 모듈을 띄운다).
  - 지우기 전 확인 다섯: 커밋 안 된 작업 없음 · 파이썬 아닌 파일 없음 · 코드/설정 참조 0(ts·tsx·json·bat·yml 전수) · 다른 `.py` 없음 · 문서 규칙 2곳(같은 커밋에서 갱신).
  - **`AGENTS.md` 를 같은 커밋에서 고친 것이 절반이다** — *"app/, tests/, prompts/ 를 보존한다"* 를 그대로 두면 저장소가 자기 자신에 대해 거짓말을 한다(D-018). 원본을 다시 볼 경로도 적었다: `git log --diff-filter=D -- app`. → **D-047**
  - 검증: typecheck 통과 · backend 1340 · frontend 1213 · shared 32 · desktop 27 · build 통과 — **아무것도 이 폴더들을 안 보고 있었다.**
- [x] **📣 `run_ui.bat` · `requirements.txt` 도 삭제 (캡틴D 요청) — 그리고 `README.md` 가 거짓말을 하고 있는 걸 그때 봤다**: 앞엣것은 없는 모듈(`python -m app.ui`)을 띄우는 죽은 스크립트였고, 뒤엣것은 읽는 것이 없어졌다.
  - 🔴 **README 를 앞 커밋에서 안 봤다.** 구조 표에 `app/`·`tests/`, 개발 환경에 *"Python 3.12+"*, 그리고 **"아직 구현되지 않음" 목록에 이미 실사용 중인 것들**(마이그레이션 자체·프로젝트 저장·Provider 연결·승인/예산 게이트·영상 검토와 병합)이 그대로 있었다. **저장소를 처음 여는 사람이 제일 먼저 읽는 문서**가 캡틴D 가 오늘 쓴 기능을 "없다" 고 말하고 있었다.
  - 사실대로 다시 썼다 — 동작하는 것(단편·회차·명언 카드·내레이션/자막/음악·게이트와 원장·게시·보관함·데스크톱 셸)과 아직 아닌 것(NSIS 설치 프로그램·서버 배포/계정). 구조 표에는 **`prompts/`·`fonts/` 가 왜 실행에 필요한지**를 같이 적었다.
  - 교훈은 D-047 에 붙였다: **지운 파일을 좇을 때는 그 파일을 언급하는 곳이 아니라 그 파일이 있다는 전제 위에 쓰인 곳까지 봐야 한다** — 앞엣것은 grep 이 찾아주고 뒤엣것은 안 찾아준다.
- [x] **📣 루트 `learning_data/` 도 삭제 (캡틴D 요청) — D-032 가 접었던 ②를, 그 금지를 캡틴D 가 직접 풀어서 실행**: 198개 파일 205MB(파이썬 시절 프로젝트 9개 · mp4 12 · png 80, 마지막 실제 작업 2026-08-02). **전부 git 추적 상태라 되살릴 수 있다**(`git checkout <커밋> -- learning_data`).
  - 지우기 전 확인: 루트 쪽을 읽는 코드·테스트 **0건**(테스트의 `learning_data` 경로는 전부 임시 폴더고, 실행 경로는 cwd 기준 `apps/backend`) · 패키징에도 없음 · 살아 있는 데이터(`apps/backend/learning_data`)는 **다른 경로라 무관**.
  - **D-032 는 지우지 않고 주석을 달았다** — 그때 ②를 접은 이유가 *"AGENTS.md 가 금지"* 였고 그 금지가 풀린 것이지, 판단이 틀렸던 게 아니다(D-018: 한 시점에 참이었던 것을 계속 참인 것처럼 표시하지 않는다).
  - 🟠 **그 결정에서 살아남는 교훈은 ①이다**: `learning_data` 위치는 여전히 **작업 디렉터리**가 정한다. 저장소 루트에서 백엔드를 띄우면 이제 **빈 트리를 새로 만들고**, 사람은 자기 프로젝트가 사라진 화면을 본다. 폴더가 하나가 됐다고 함정이 없어진 게 아니라 **틀렸을 때 열어볼 두 번째 후보가 없어졌다.**
  - 앞 커밋의 교훈(D-047)을 적용해 **"그 폴더가 있다는 전제 위에 쓰인 곳"** 을 먼저 훑었다: 코드 주석 2곳(`projects.module.ts`·`assets.module.ts`) · README 구조 표 · AGENTS.md · D-032 — 전부 같은 커밋에서 갱신했다.
  - 검증: typecheck · backend 1340 · frontend 1213 · build 통과 · 실서버 `/health` ok · `apps/backend/learning_data` 프로젝트 목록 그대로.
- [x] **🔴 주인공·그림체 자동 연결이 "먼저 고른 사람" 에게는 한 번도 안 됐다 (Cowork Round 463 — A 는 틀렸고 B 가 맞았다)**: 캡틴D가 스크린샷과 함께 *"대표 이미지는 자동으로 연결되게 하는 게 낫지 않아?"* 라고 물었다. **이미 그렇게 만들어져 있는데 순서가 거꾸로였다.**
  - ❌ **A(배선이 끊겼다)는 사실이 아니다.** `long-projects.module.ts` 는 `StoryBibleService` 에 `mappings` 와 `assets` 를 **제대로 주입한다** — Cowork 이 import 줄(33행)을 보고 팩토리(48행)를 못 본 것이다. 곁다리로 지적한 *"assets 가 항상 undefined"* 도 같은 이유로 사실이 아니다. **고치기 전에 확인해 달라고 먼저 적어준 덕에, 없는 결함을 고치지 않았다.**
  - ✅ **B(순서)는 사실이다.** 씨앗은 **바이블을 저장할 때만** 뿌려지고, 그때 **이미 있는 `Episode\d+` 폴더**만 훑는다. 그런데 회차 폴더는 **대본을 쓸 때 처음 생긴다**(`episode-scripts.service.ts` 의 `save()` 안 mkdir 이 유일한 생성 지점). 그래서 화면이 권하는 순서 — 프로젝트 → **주인공·그림체 고르기** → 1화 대본 — 를 그대로 따르면 **아무것도 안 뿌려진다.** 화면은 *"이 목록에 자동으로 올라옵니다"* 라고 말하고 있었고, **그 말을 믿고 먼저 고른 사람에게만 거짓말**이었다.
  - **씨앗 지점을 회차 폴더가 생기는 순간에 하나 더 뒀다.** 대본 저장이 끝난 뒤 바이블 링크를 읽어 그 회차에 심는다. 실패해도 대본 저장을 막지 않는다(바이블 쪽과 같은 이유 — 사람이 요청한 건 대본이고, 못 심은 매핑은 손으로 만들 수 있다).
  - 링크를 꺼내는 규칙(`basic.style_asset_link.asset_id`)이 두 곳에 생길 뻔해서 `linksFromBible()` · `readStoryBibleLinks()` 로 하나만 뒀다 — **"에셋 아이디가 어디 있나" 의 사본 둘이 이 기능의 양 끝을 갈라놓는 방식**이다.
  - 짝은 **화면이 권하는 순서 그대로** 간다: 회차 0개 상태에서 링크 저장 → 대본 생성 → 그 회차 매핑에 `auto_protagonist`·`auto_style` 이 있다. 주입(새 씨앗 지점 제거)에 빨갛다.
- [x] **🟠 배선 다툼을 git 이 끝냈고, 그 다툼 자체가 테스트 하나를 만들었다 (Cowork Round 465)**: 그쪽이 *"당신 반박은 지금 파일을 보고 있다"* 며 되받았다 — 자기 사본이 낡았을 가능성도 스스로 배제 못 한다고 적으면서. **한 줄로 끝났다**: `git show 2607cc6:…module.ts` 의 7061바이트 파일(그쪽이 본 바로 그 크기)에 **이미 셋 다 주입돼 있다.** 2인자 배선은 `git log -S` 로 보면 **이 기능이 만들어진 커밋(1e37783, 08-30 09:01) 이전에만** 존재했다 — 그쪽 사본이 나흘 낡았던 것이다.
  - 🟢 **그래도 그쪽 결론이 맞다**: *"이 다툼 자체가 배선 테스트가 있어야 한다는 근거"*. 이 기능의 모든 짝이 `new StoryBibleService(root, assets, mappings)` 로 **모듈이 넣어줘야 할 것을 손으로 넣고** 있었다 — 동작은 덮이고 배선은 안 덮인다. **선택 의존성이 조용히 기능을 끄는 모양**은 손으로 만든 짝이 절대 못 본다(D-023).
  - 실제 `AppModule` 에서 꺼낸 `StoryBibleService` 로 링크를 저장하고 회차 매핑을 확인하는 짝을 넣었다. **주입은 그쪽이 신고한 그 배선(2인자)** 이다 — 새 짝만 빨갛고 기존 여섯은 초록이다. 없던 결함이었지만, **그 결함이 진짜였다면 아무도 못 봤을 것**이라는 사실은 그대로 남는다.
- [x] **📣 "연결됨" 을 다시 누르면 취소된다 (캡틴D 요청, Cowork Round 466 · 검증·커밋 CLI)**: 후보 목록의 버튼이 **상태를 알려주기만 하던 것에서 상태를 바꾸는 것**이 됐다 — `연결됨` → PATCH `exclude`, `제외됨` → PATCH `confirm`. 아래 카드가 쓰던 `decide` 를 그대로 쓴다(새 호출 경로 없음).
  - 🟢 **삭제가 아니라 "제외" 로 한 것이 이 라운드의 핵심이고, 근거를 확인했다**: `project-asset-mapping-sync.ts:59` 가 **excluded 인 에셋을 다시 안 심는다.** 삭제였으면 아무 기록도 안 남아, **463~464 에서 방금 고친 자동 씨앗이 사용자의 취소를 조용히 되돌린다** — 다음 바이블 저장이나 다음 회차 대본에서 도로 붙는다. Cowork 이 스스로 그 함정을 보고 방향을 바꿨고, 짝에 *"DELETE 는 안 나간다"* 를 못으로 박았다.
  - 곁다리로 *"아래 목록에서 확인을 누르면 다시 씁니다"* 안내를 지웠다 — 그 행은 제외되는 순간 기본 필터에 가려져서 **없는 곳을 가리키고 있었다.**
  - 🟠 **Cowork 이 vitest 를 못 돌려서 요청한 주입을 대신 돌렸다**: `alreadyLinked ? "exclude" : "confirm"` 을 `"confirm"` 고정으로 바꾸면 왕복 짝이 빨갛다(28개 중 1개). 거절(409) 짝이 쓰는 `candidate-link-error-<assetId>` 도 실제로 붙어 있는 것을 확인했다.
- [x] **🔴 "이 에피소드는 주인공 연결 없음으로 만들어졌습니다" 가 거짓말이었다 — 손으로 연결한 것을 안 셌다 (Cowork Round 468)**: 캡틴D가 4화 이미지를 다 뽑고 나서 그 문장을 보고 화를 내셨다 — *"이미지 연결됨이었는데 연결이 안 되어서 나왔는데?"*. **그림에는 들어갔다.** 스크린샷 3번 장면 캡슐에 `LEEBAD 001` 이 있다.
  ```
  생성이 참고를 고르는 규칙   status === "confirmed" && enabled && 장면 범위      ← assignment_source 를 안 본다
  드리프트가 물어본 것         assignment_source === "auto" && match_reason === 태그 ← 손으로 연결한 건 못 찾는다
  ```
  - **비교 대상을 태그가 아니라 에셋 아이디로 바꿨다**(Cowork 제안). 질문은 *"이 회차가 지금 이야기의 그 사람으로 그려졌나"* 이고, **누가 붙였는지는 그 질문과 상관이 없다** — 생성이 안 보는 필드를 화면만 보고 있었다.
  - 차이가 **실제로 있을 때**는 여전히 태그가 소유한 매핑을 회차 쪽 답으로 쓴다. 손으로 넣은 인물은 장면의 아무나일 수 있어서, 그걸 "이 회차의 주인공" 이라고 이름 붙이면 **거짓 경보를 거짓 답으로 바꾸는 것**이다.
  - 🟠 **463 이전부터 있던 버그다.** 그때는 `auto` 매핑이 아예 안 생겼으니 **주인공 링크를 건 모든 프로젝트가 이 배너를 보고 있었다.** 씨앗이 도는 지금은 새 회차만 조용해지고, 손으로 연결한 사람은 계속 봤을 것이다.
  - 짝 둘: 손으로 연결한 에셋이 설정집 주인공과 같으면 **비어 있다** · 회차가 안 가진 주인공은 **여전히 보고하고**, 회차 쪽 이름은 손으로 넣은 인물이 아니라 링크가 소유한 매핑이다. 주입(예전 규칙 복원)에 첫째가 빨갛다.
- [x] **캡틴D 질문에 측정으로 답했다 — "지금 다시 생성 누르면 이미지가 포함된 채로 전달되나?"**: 코드상 답은 예였지만(`collectReferenceImages` 는 `assignment_source` 를 안 본다), **바이트가 실제로 나가는지는 아무도 안 재고 있었다** — 기존 짝은 프롬프트 텍스트에 이름·설명이 들어가는지만 봤다.
  - 손으로 연결한 매핑(`mappings.create` = `assignment_source: "manual"`, 화면 버튼이 쓰는 그것)으로 **재생성 요청이 `/images/edits` 이고 `image[]` 부분을 실제로 싣는지** 잰다. 주입(재생성에서 참고 바이트를 빼고 일반 생성 호출로 바꾸기)에 빨갛다.
  - 이 질문이 중요한 이유: 유료 버튼이고, **텍스트만 나가면 모델이 말로만 인물을 그린다.** 468 의 화면 거짓말과 같은 자리에서 나온 질문이라 같이 못 박았다.
- [x] **🔴🔴 유료 이미지 6장이 참고 사진 없이 나갔다 — 화면은 "연결됨" 이라고 그리고 있었다 (Cowork Round 469, 468 의 자기 진단 철회)**: 캡틴D가 *"연결된 이미지는 저게 아닌데 다시 확인해봐"* 라고 하셨고, 그분이 맞았다. **실데이터로 확인했다**(Cowork 은 그 경로를 못 읽는다):
  ```
  Episode04/generated_image_reviews.json   reference_sources: []   여섯 장면 전부 (15:57:20)
  Episode04/asset_mappings.json            enabled: false · status: "confirmed" · source: manual
  ```
  `reference_sources` 는 생성 시점의 `references.sources` 를 **그대로** 적는다 — **비어 있다 = 참고 없이 나갔다.** 폴더(이배드)는 자식 5장·대표 이미지·실물 파일이 다 있고 `scene_scope` 도 `all` 이라, 남는 원인은 하나뿐이다.
  - **`update()` 가 대칭이 아니었다**: `exclude` 는 `enabled = false` 를 놓고, `confirm` 은 **되살리지 않았다.** 그래서 제외→확인 왕복이 `status: "confirmed" + enabled: false` 에 착지한다. **화면은 `status` 로 배지를 그리고, `enabled` 를 읽는 코드는 모델에 뭘 보여줄지 정하는 필터 하나뿐이다** — 사람에겐 연결됐다고 하고 생성은 조용히 건너뛴다.
  - **확인은 이제 `enabled = true` 를 같이 놓는다.** 확정됐는데 꺼져 있는 매핑은 이 앱이 뜻하는 상태가 아니므로 그 경로로는 도달 불가능하게 했다. 일부러 끄는 것은 `{ enabled: false }` 라는 **다른 문장**으로 그대로 남는다.
  - 🟠 **왕복 자체는 예전부터 있던 결함이고, 466 의 토글 버튼이 그것을 한 번에 밟게 만들었다** — Cowork 이 자기 변경이 원인 노출을 앞당겼다고 먼저 밝혔다. 프런트도 `confirm` 에 `enabled: true` 를 명시로 실어 보낸다(서버가 고쳐져도 화면이 절반만 되살리지 않도록).
  - 🔴 **468 의 "배너가 거짓말" 진단은 틀렸다** — Cowork 이 *"이름이 프롬프트에 있으니 사진도 갔다"* 를 증거로 삼았는데, 이름은 **글로** 간다. 그 배너는 오히려 **맞게 경고하고 있었다.** (다만 7793b6d 의 수정 자체는 유효하다: 그것은 `enabled` 인 수동 연결만 드리프트에서 빼므로, 이번처럼 꺼져 있는 매핑은 여전히 보고된다.)
  - 짝 셋: 제외→확인 왕복이 켜진 채 끝난다 · 일부러 끄는 것은 그대로 된다 · 프런트가 `enabled: true` 를 싣는다. 주입(확인에서 `enabled` 복원 제거)에 빨갛다.
- [x] **이미지 생성 진행 상황을 장면별로 볼 수 있게 했다 (`GET .../images/generations/progress`, 캡틴D 요청 · Cowork Round 468 B)**: 생성 중 화면이 여섯 줄 전부 **만드는 중**이라고 그렸다. 루프는 `for (const scene of sceneNumbersFor(...))` 순차라 **어느 순간에도 그려지는 장면은 하나**다 — 모호한 게 아니라 틀린 표시였다.
  - **새 상태를 저장하지 않는다. 디스크가 답을 갖고 있다.** 각 장면은 쓰이고 `validImage` 를 통과한 뒤에야 다음으로 넘어가고, 이미 있는 그림은 건너뛴다. 그래서 `generate()`·`preview()` 가 던지는 것과 **같은 질문**으로 끝난다. 별도 작업 기록을 두면 언젠가 파일과 어긋나고, 그날 화면은 **없는 그림을 있다고 말한다.**
  - **기존 라우트로는 답할 수 없었다**: `get()` 은 `generating_images` 를 아예 안 읽는 상태로 두고(그 뒤엔 `assertImagesOnDisk` 가 전부 있어야 통과) — **둘 다 검토 화면으로선 옳다.** 이 라우트의 존재 이유가 정확히 "아직 다 없을 때 답하는 것" 이라 아무것도 단언하지 않는다.
  - `currentSceneNumber` 는 **`generating_images` 일 때만** 나간다. 안 돌 때도 다음 빈 장면을 말하면, 아무도 시작하지 않은 장면을 "지금 만드는 중" 이라고 하는 **같은 거짓말의 반대 방향**이다.
  - `completedSceneNumbers` 는 **"이번에 산 장면" 이 아니다** — 재실행은 이전 실행 그림을 첫 순간부터 완료로 센다(루프도 실제로 건너뛰므로 그림에 대해선 참이다). 비용은 `generatableSceneNumbers` 가 답한다. 타입 주석에 못 박았다.
  - `stat` 이 아니라 `validImage` 로 센다 — 반쯤 쓰인 파일이 "완료" 로 읽히면 표시가 **한 박자 앞서 나간다.**
  - 이름은 영상 쪽 그대로다(`sceneNumbers`·`completedSceneNumbers`·`currentSceneNumber`) — 두 화면이 같은 말을 쓴다.
  - 짝 셋. 하나는 **실제로 루프 안에서 멈춰 세워 잰다**: 3번 장면의 프로바이더 호출을 붙잡아 둔 채 `progress()` 를 읽어 `[1,2]`·`current 3` 을 확인하고, 같은 순간 `get()` 이 거절하는 것까지 본다(유료 0, `fetch` 는 스텁). 나머지 둘은 반쯤 쓰인 파일·아직 아무것도 없는 회차. 주입 둘(`stat` 로 바꾸기 · `generating_images` 조건 빼기)에 각각 빨갛다.
  - 🟠 화면 배선은 Cowork 이 붙인다. 단편(`images.controller.ts`)에도 같은 구멍이 있고, 급한 건 회차 쪽이라 여기까지 했다.
- [x] **🔴 이어받기 사진이 한 번도 안 갔다 — 회차가 *끝날수록* 참고로 못 쓰였다 (Cowork Round 473, 캡틴D 질문)**: *"이 내용이 다음 에피소드에도 전달되는거지? 마지막 사진이랑 같이"* — **글은 갔고 사진은 안 갔다.** 실서버가 셋 다 `available:false` 였다(2→3, 3→4, 4→5).
  - **원인은 상태 목록 하나다.** `COMPLETED_IMAGE_STATES` 가 `videos_approved` 에서 끊겨 있어 **`rendering`·`completed` 를 몰랐다.** 실데이터로 확인: 2·3·4화 전부 `state:"completed"` · 리뷰 6개 전부 `approved` · `scene6.png` 정상(2.6MB). **나머지 조건은 다 통과하는데 목록에서만 떨어졌다** — 회차가 **더 끝나 있을수록** 이어받기가 안 되는 구조였다.
  - 🟠 **Cowork 이 4화를 `waiting_for_video_confirmation` 로 본 건 그 시점 값이고, 지금은 `completed` 다.** 그래서 "4화는 그 설명이 안 된다" 던 가설이 뒤집혔다 — **두 원인이 아니라 하나다.**
  - **같은 사실에 대한 목록이 셋이었다**(`COMPLETED_IMAGE_STATES` · `BEFORE_IMAGES_EXIST` · `eligible`). 앞의 둘을 공유 목록 하나로 합쳤다: `LONG_EPISODE_STATUSES_BEFORE_IMAGES` + `longEpisodeHasImages()`. **부정형으로 한 번만 적는다** — "그림이 있는 상태" 를 열거하면 나중에 상태가 추가될 때마다 조용히 틀리고, **틀리는 방향이 유료 생성에서 참고가 빠지는 쪽**이다. 부정형이면 새 상태는 기본적으로 "그림 있음" 이 되고, 어차피 리뷰·파일을 따로 본다.
  - 🟠 `episode-continuity.service.ts` 의 `eligible` 은 **합치지 않았다** — 그건 "이어쓰기 메모를 쓸 만큼 진행됐나" 라는 **다른 질문**이고, 그 파일 주석이 이미 *"둘은 닮았고 반대를 뜻한다"* 고 경고하고 있다.
  - 짝 둘: 늦은 상태 여섯 개(`rendering`·`completed`·`interrupted`·`failed` 포함) 전부에서 이어받는다 · **상태가 아무리 끝나 보여도 장면이 다 승인 안 됐으면 여전히 거절한다**(문을 넓힌 게 그림 없는 회차를 통과시키면 안 된다). 주입(예전 누락 복원)에 빨갛다.
  - **실서버 확인**: 고친 뒤 2→3, 3→4, 4→5 **전부 `available:true`**.
- [x] **이어받기가 "없다" 와 "못 읽었다" 를 한 문장으로 뭉개지 않는다 (Cowork Round 473 의 나머지 요청)**: `previousReference()` 의 `catch { return { available:false } }` 하나가 **모든 실패를 같은 false 로 되돌렸다.** 화면은 그걸 *"이전 에피소드의 마지막 장면 자료가 아직 없어서…"* 로 옮겼고 — **캡틴D는 그 문장을 세 회차 내내 보셨는데, 그 회차들은 끝나 있었고 그림도 디스크에 있었다.** 이유를 대는데 이유가 틀린 것은 이유를 안 대는 것보다 나쁘다.
  - `unavailableReason` 셋으로 갈랐다: `not_finished`(진짜로 아직 없음 — 예전 문장이 유일하게 맞던 경우) · `image_unreadable`(리뷰는 전부 승인인데 파일이 없거나 PNG 가 아님 — **기록과 디스크가 서로 다른 말을 한다**) · `unreadable`(기록 자체를 못 읽음 — 답이 아니라 자백).
  - **여전히 안 던진다.** 앞 회차를 못 읽는다고 이미지 화면이 안 열리는 건 더 나쁜 답이다. 다만 **이유를 아는 척하지 않는다.**
  - 마지막 그림 읽기를 자체 try 로 뺐다 — 안 그러면 파일이 없는 게 바깥 catch 로 흘러가 "아직 안 끝났음" 으로 되돌아온다.
  - 짝: 망가진 앞 회차가 `unreadable` 로 나온다 · 승인 다 됐는데 파일이 깨지면 `image_unreadable`. 주입(둘을 다시 `not_finished` 하나로)에 빨갛다.
  - 🟠 **화면 문구는 Cowork 몫이다** — 이유가 오면 문구를 좁히겠다고 473 에 적혀 있다. 곁다리로 지적한 *"이어받아도 1번 장면에만 들어간다"* 는 의도한 동작이라 그대로 뒀다(이어짐은 첫 장면에서 만들어진다).
- [x] **🔴 "마지막 에피소드였습니다" — 10화짜리 작품의 4화에서 뜬다. 거짓이다 (Cowork Round 474, 캡틴D)**: 이어쓰기 메모 저장은 됐고(`continuitySaved: true`) 잃은 것은 없다. **문장만 틀렸다** — 5~10화가 아웃라인으로 남아 있다.
  - **원인은 회차 폴더가 생기는 시점이다.** `save()` 가 `project.json` 만 보고 **404 를 전부 "다음 화 없음" 으로** 읽었다. 그 폴더는 `episode-scripts.service.ts` 의 `save()` 가 유일한 생성 지점이라, **아웃라인만 있고 대본 전인 회차는 파일이 없다.** 그리고 **메모는 다음 화 대본을 쓰기 *전에* 쓰는 것**이라 — 화면이 권하는 순서로 작업하는 사람은 **항상** 이 경우에 걸린다. **저 문장은 거의 항상 틀렸다.**
  - 🟠 **이 전제가 세 번째로 물렸다**(463 · 464 · 474). 그래서 이번엔 **읽는 자리를 하나로 모았다**: `episode-outline-entry.ts` 의 `parseEpisodeOutlineEntry()` 를 프로젝트 목록과 이어쓰기 저장이 **같이** 쓴다 — 두 화면이 "계획된 회차" 를 다르게 그릴 수 없다.
  - **404 두 개를 구분한다**: 아웃라인에 없는 번호 → `null`(진짜 마지막) · 아웃라인은 있고 기록 없음 → **그 아웃라인**(`status:"outline_ready"`) · 기록 있음 → 예전처럼 detail. **`episodeOrNull` 이 같은 파일에서 이미 이 구분을 하고 있었는데 저장 경로만 안 쓰고 있었다.**
  - 계약을 `nextEpisode: LongEpisodeOutline | null` 로 좁혔다(detail 은 부분집합이라 시작된 회차는 그대로 다 실려 나간다). **화면 문구·버튼은 손댈 게 없었다** — 이미 `longEpisodeStatusLabel(saved.status)` 를 쓰고 있어서 *"에피소드 5(으)로 이어서 진행할 수 있습니다 (아웃라인 준비됨)"* 로 바로 맞는 말이 된다. 프런트 응답 검사만 `isLongEpisodeDetail` → `isLongEpisodeOutline` 로 바꿨다 — **안 바꿨으면 서버가 진실을 보내도 화면이 그걸 malformed 로 버린다.**
  - 짝 셋: 대본 전 다음 화를 아웃라인으로 지목한다 · **진짜 마지막 회차에서는 여전히 `null`**(문을 넓힌 게 없는 6화를 열자고 하면 안 된다) · 화면이 **detail 필드 없는 응답**을 받아 5화를 이름으로 부르고 "열기" 를 내놓는다. 주입 둘(아웃라인 대체 제거 · 검사기 되돌리기)에 각각 빨갛다.
  - **실데이터 확인**: `12` 의 4화 → `{episodeNumber:5, title:"수호자의 유산", status:"outline_ready"}`.
- [x] **동시에 재생성하면 앞의 기록이 사라진다 — 그림은 최신인데 화면은 낡았다고 말한다 (Cowork Round 472)**: 캡틴D가 4·5·6번을 동시에 누르셨고, 그림 여섯 장은 다 제대로 나왔는데 **4·5 번에 `참고 이미지 바뀜` 이 붙었다.**
  - **잃어버린 갱신이다.** 장면별 리뷰가 **한 파일 한 배열**에 들어 있는데 `regenerate()` 가 그 배열을 **읽고 → 30초짜리 유료 호출 → 배열 전체를 도로 쓴다.** 셋이 같이 출발하면 셋 다 *출발 전* 배열을 들고 있어서, **마지막에 끝난 하나가 앞의 둘이 쓴 기록을 지운다.** 그림 파일은 각자 제 경로라 살아남았고 **`prompt`·`reference_sources` 만 잃었다** — 그래서 멀쩡한 그림이 낡았다고 표시된다.
  - `putReview()` 하나로 모았다: **락 안에서 지금 디스크에 있는 배열을 다시 읽고, 그 장면 한 칸만 갈아 끼운다.** 새 항목은 **그때 읽은 값**에서 계산한다(그래서 값이 아니라 함수를 받는다). `approve()` 도 같은 문을 쓴다 — 창이 좁을 뿐 같은 구조였다.
  - 🟠 **유료 호출을 직렬화하지 않았다.** 락을 호출 전체에 걸면 "셋 동시" 를 일부러 누른 사람을 거절하게 된다. 작업도 배열도 장면 단위라 **파일을 통째로 잡을 이유가 없다.**
  - 짝: 세 장면의 프로바이더 호출이 **셋 다 시작할 때까지 아무도 안 끝나게** 붙잡아 둔 채 동시에 재생성한다 — 셋 다 `regeneration_count:1` 과 `prompt` 를 지킨다. 건드리지 않은 1·2·3 도 그대로다(병합이 파일을 통째로 가져가는 것도 손실이다). 주입(예전처럼 유료 호출 전에 읽은 배열을 도로 쓰기)에 **"scene 4 lost its regeneration count"** 로 빨갛다 — 캡틴D가 본 그 증상이다.
  - 🟢 **Cowork 이 "유료 2장이 샜다" 던 보고를 스스로 정정했다** — 새로고침하니 4·5도 바뀌어 있었고 $0.60 은 정확히 여섯 장 값이었다. **한 푼도 안 샜다.** 갱신 안 된 화면을 증거로 삼은 것이고, 본인이 그렇게 적었다.
- [x] **"확정 완료" 를 되돌리는 입구를 만들었다 (`POST .../images/review/:sceneNumber/unapprove`, 캡틴D 요청 · Cowork Round 472)**: 전에는 **불가능했다** — `approval()` 이 `{approved:true}` 정확히 하나만 받고 라우트도 approve 뿐이었다.
  - **확정이 쓴 세 곳을 전부 되돌린다**: 리뷰 → `pending` · 에셋 보관함 자식 → `status:"generated", approved:false` 과 폴더 `approved:false` · 마지막 승인이라 `waiting_for_video_confirmation` 로 갔던 회차 → `images_review`. **하나라도 남기면 기록과 파일이 서로 다른 말을 하기 시작한다.**
  - 🟢 **approve/unapprove 를 두 함수로 두지 않았다.** `approveGeneratedProjectImage` 를 `setGeneratedProjectImageApproval(…, approved, folderApproved)` 하나로 합쳤다. **거울처럼 유지해야 하는 짝이 어긋나는 것** — 그게 이번 라운드에 유료 6장을 참고 없이 내보낸 `update()` 의 모양이다(469). **하나면 어긋날 수 없다.**
  - 🟢 **영상 이후 거절은 새 규칙이 필요 없었다.** 게이트를 재생성과 같은 `assertReviewable(…, true)` 로 뒀더니 `images_review`·`waiting_for_video_confirmation` 만 통과한다 — **모든 영상 상태가 자동으로 거절된다.** Cowork 이 걸린다고 한 자리("영상까지 사고 나서 이미지 확정을 취소하면 기록은 검토 대기인데 디스크에는 그 그림으로 산 유료 영상")가 그대로 막힌다.
  - `{ approved: false }` 를 명시로 받는다. 빈 몸은 **실수로 보낼 수 있는 요청**이고, 사람이 이미 서명한 것을 되돌리는 요청은 말로 그렇게 말해야 한다. `{approved:true}` 를 이 라우트에 보내면 거절된다.
  - `regeneration_count`·`prompt`·`reference_sources` 는 **손대지 않는다** — 마음이 바뀐 것은 그 그림이 무엇으로 그려졌는지와 무관하다. 지웠으면 취소한 장면이 "잰 적 없음" 으로 보이고 낡음 뱃지가 조용해진다.
  - 🟢 **왕복 짝을 먼저 썼다 — Cowork 이 그렇게 부탁했고, 이유도 밝혔다**(466 에서 왕복 확인 없이 왕복을 쉽게 만든 대가가 유료 6장이었다). 확정 → 취소 → 확정이 **세 곳 전부** 제자리로 온다. 주입 둘(보관함 되돌리기 제거 · 회차 상태 되돌리기 제거)에 각각 빨갛다. 그 밖에 짝 셋: 기록 보존 · 영상 이후 거절 · 몸 검사 세 가지.
  - 🟠 **버튼은 Cowork 이 붙인다** — 라우트가 정해지면 매핑 토글과 같은 꼴로 붙이겠다고 472 에 적혀 있다.
- [x] **캐시 무력화는 새 필드가 필요 없었다 (Cowork Round 472 의 `contentVersion` 요청)**: 화면은 **이미 장면별 `updatedAt` 으로 깨고 있었다** — 짝 이름이 *"busts the picture cache per scene, not per Episode stage"* 다.
  - 그러면 캡틴D가 옛 그림을 본 이유는 **빠진 필드가 아니라 바로 위의 잃어버린 갱신**이다. 덮인 항목은 `updatedAt` 까지 되돌려 놓으므로, 브라우저는 재생성 **이전** 그림을 계속 내놓는다.
  - `contentVersion` 을 넣었다가 **뺐다**: 이미 없어진 문제를 위해 계약에 필수 필드를 새로 세우는 일이고, **보관함 복원을 건너면 버전 숫자는 반복될 수 있는데 시각은 안 그렇다.** 대신 동시 재생성 짝에 *"각 장면이 손대지 않은 장면보다 나중 시각을 갖는다"* 를 박았다 — 캐시가 무엇에 걸려 있는지가 짝에 남는다.
- [x] **확정 취소 버튼 (Cowork Round 477 이 화면을 붙였고, 검증·주입은 여기서)**: 라우트(`b974a51`)에 화면이 붙었다. `검토 대기 → 확정 완료 → 검토 대기` 토글이고, 확정 상태에서 밑에 *"한 번 더 누르면 확정을 풉니다"* 가 뜬다.
  - 🟢 **Cowork 이 `approve`/`unapprove` 를 `setSceneApproval` 한 함수로 묶었다** — 백엔드에서 `setGeneratedProjectImageApproval` 로 합친 것과 **같은 이유를 스스로 대면서**. 거울 짝을 둘로 두면 469 의 `update()` 가 된다. "응답이 곧 새 진실" 규칙도 한 곳에서만 적용된다.
  - 🟢 **영상 산 회차에서 버튼을 숨기지 않고 거절을 배너로 보여주는 판단 — 동의한다.** 근거를 여기 남긴다: **말없이 사라지는 컨트롤은 아무 말도 안 한다.** 오늘 이 화면이 겪은 것이 전부 "화면이 틀린 이유를 대는" 문제였고, 이유를 아예 안 대는 것은 그 해결이 아니다. 게다가 거절 조건은 **회차 상태**라 화면이 스스로 판정하려면 상태 목록 사본이 하나 더 생긴다 — 오늘 473 에서 목록 셋을 둘로 줄인 그 자리다. **서버가 판정하고 화면이 옮긴다.**
  - 주입 둘 확인: 삼항을 `approveLongEpisodeImageReview` 고정으로 → **왕복 짝이 경로에서 빨갛다**(Cowork 이 부탁한 그것). 응답 전에 배지를 미리 뒤집기 → **거절 짝이 빨갛다**(거절된 취소가 성공한 취소처럼 보이면 안 된다).
  - 🟠 **`longProjectsApi.ts` 는 CRLF, 옆의 두 파일은 LF다** — Cowork 이 신고한 대로 저장소 안에서 섞여 있다. 이번 diff 는 그쪽 세 덩어리만 나오는 게 맞다. 지금 고칠 일은 아니지만 기록해 둔다.
- [x] **🔴 게시한 커버 프레임이 어디에도 안 남는다 (Cowork Round 476, 캡틴D: *"캡션 사진 지정한 부분으로 안 나오는데 오류 아니야?"*)**: Cowork 이 화면→Meta 본문까지 경로를 끝까지 짚었고 **끊긴 데가 없었다.** 그래서 조사가 거기서 멈췄다 — **디스크에 무엇을 보냈는지가 안 적혀 있어서** 셋을 구분할 수가 없다: 안 보냈다 · `0` 을 보냈다 · 제대로 보냈는데 무시됐다. **셋 다 같은 릴스가 나온다.**
  - `instagram_post` 에 `thumb_offset_ms` 를 적는다. **단편·회차 두 경로 모두** — 한쪽만 꿰면 D-031 의 그 모양이다.
  - **`null` 과 없음을 구분한다.** `null` = 이번 게시가 커버를 안 보냈다 · 없음 = 이 기록보다 오래된 게시라 아무도 모른다. **둘 다 `0` 으로 적는 건 앱이 묻지도 않은 질문에 답을 지어내는 것**이고, 화면이 *"측정 불가는 0이 아니다"* 로 이미 거부하는 그 실수다.
  - 🔴 **적어도 돌아오지 않았다 — 저장 스키마가 필드 단위로 다시 짓고 있었다.** `instagramPostAt()` 이 네 필드만 이름 대어 새 객체를 만들어 반환하므로 **쓰기는 디스크까지 갔는데 읽기가 버렸고, 아무 데서도 손실을 보고하지 않는다.** 파서에 필드를 더했다(옛 게시는 필드가 없으니 **필수로 두지 않았다** — 그것 때문에 프로젝트가 안 열리면 더 나쁜 답이다).
  - 짝 셋: `3500`·`0`·안 보냄이 각각 `3500`·`0`·`null` 로 **디스크에서 다시 읽힌다** · 회차 경로도 같다(응답만 아는 답은 새로고침에 사라진다) · 기존 정확 단언에 `thumbOffsetMs: null` 을 넣었다. 주입 둘(파서에서 필드 빼기 · `?? null` 을 `?? 0` 으로)에 각각 빨갛다.
  - 🟢 **Cowork 질문 답 — 게시 화면 재생기는 탐색 가능하다.** 실서버 확인: `Range: bytes=1000-2000` → `206` · `Content-Range: bytes 1000-2000/12958820` · `Accept-Ranges: bytes`. 437 의 `range-stream.ts` 통합에 이 경로(`episodes/:n/videos/final/content`)도 들어가 있다. **그러면 ②(탐색 실패로 0)는 가능성이 낮고 ①(안 누름)이 남는다** — 다만 **이제는 추측할 필요 없이 다음 게시의 기록을 읽으면 된다.**
  - 🟠 **`0` 을 그냥 받을지는 Cowork 몫으로 남긴다** — 되묻거나 "첫 장면과 같습니다" 라고 화면이 말해 주는 것. 본인이 *"그 전에 기록이 먼저"* 라고 적었고 맞다.
- [x] **🔴 커버가 두 번 다 첫 장면으로 나갔다 — 기록이 그 이유를 답했다 (캡틴D, 476 의 후속)**: 476 에서 넣은 기록을 **바로 다음 게시에서 읽었고, 그것으로 끝났다.**
  ```
  mediaId 18628974520028631 · 2026-09-04T06:40:32.911Z · thumbOffsetMs: null
  ```
  **`null` = 앱이 커버 지점을 아예 안 보냈다.** `0` 도 아니다. `coverField()` 는 유한한 0 이상 숫자면 무조건 싣기 때문에, **화면의 `coverOffsetMs` 가 게시 시점에 `null` 이었다** — 즉 *"지금 이 장면을 커버로"* 가 눌리지 않았다. **476 의 세 갈래 중 ①이 확정됐고, 추측은 한 줄도 필요 없었다.** 기록을 넣은 그 다음 게시에서 값을 회수했다.
  - 🟠 **그런데 "사용자가 안 눌렀다" 로 끝낼 일이 아니다.** 커버 컨트롤은 **왼쪽 열**(재생기 옆)에 있고, 안 골랐을 때의 안내는 *"커버는 첫 장면입니다"* 라는 **회색 작은 글씨**다. 되돌릴 수 없는 게시를 확정하는 패널은 **오른쪽 열**에 있고, 거기서는 커버를 **한 마디도 안 했다.** 계정 이름을 그 패널에 늘 적는 이유(*"잘못 나간 게시물은 본 사람에게서 지워지지 않는다"*)가 커버에도 그대로 적용된다 — **게시 후에 바꿀 수 없는 두 번째 것**이다.
  - 확인 패널이 **양쪽 방향 모두** 말한다: 고른 경우 `커버는 12.3초 지점입니다`, 안 고른 경우 `커버는 첫 장면으로 나갑니다` + 어떻게 고르는지. **안 고른 쪽을 호박색으로 두되 "빠뜨렸다" 가 아니라 상태로 읽히게 적었다** — 첫 장면은 멀쩡한 선택이고, 다만 **모르고 하는 선택이면 안 된다.**
  - 사진 카드는 모든 프레임이 같으므로 이 줄도 안 나온다(컨트롤이 숨는 조건과 같다).
  - 짝: 확인 패널이 안 고른 상태에서 "첫 장면" 을, 고른 뒤에는 "12.3초" 를 말하고 **"첫 장면" 을 더는 말하지 않는다.** 주입(안 골랐을 때 패널이 조용해지게)에 빨갛다.
  - 🟢 **이 화면은 Cowork 담당이지만 이건 되돌릴 수 없는 행위의 확인 문구라 여기서 고쳤다.** 478 에 넘긴 *"`0` 을 그냥 받을지"* 는 여전히 그쪽 몫이다 — 다만 이번 건은 `0` 문제가 아니었다.
- [x] **🔴 회차가 "지운 게시물" 기록을 잃고 있었다 — 다음 대본 저장에서 디스크에서 지워진다 (커버 기록을 읽다가 발견)**: 캡틴D의 4화 `project.json` 에 `previous_instagram_posts` 가 **3건** 있는데 API 는 `null` 이었다. 그 필드의 주석이 스스로 이렇게 적고 있다: *"되돌릴 수도 다시 확인할 수도 없는 행위에 대해 이 앱이 가진 유일한 기억이므로, 디스크에만 쓰지 않고 화면까지 들고 나간다 — 아무도 안 읽는 기록은 조용히 관리가 끊긴다."* **약속을 코드가 안 지키고 있었다.**
  - **두 군데가 끊겨 있었다.**
    1. `episode-scripts.service.ts` 의 `parseStored()` 가 **이름 댄 필드만 새 객체로 다시 지어서** 반환한다. 그리고 `save()` 가 그 객체를 그대로 쓴다 → **표시 누락이 아니라 다음 대본 저장에서 디스크의 기록이 지워진다.** 실데이터로 확인: 네 회차 전부에서 `mapping_revision`(= `episode-mapping-owner.ts` 가 쓰는 값)도 같이 떨어지고 있었다.
    2. `toApi()` 가 **`toEpisodeDetail` 이 흡수하지 못한 여섯 번째 사본**인데, 그 필드만 몰랐다. 그 매퍼 주석이 예언한 그대로다 — *"여섯 중 다섯을 찾은 사람은 어떤 화면에서는 맞고 어떤 화면에서는 틀린 응답을 낸다."*
  - **필드를 하나 더 나열하는 대신 부류를 막았다**: `parseStored` 가 `...d` 를 먼저 펼치고 **검증한 값을 그 위에 덮는다.** 검증은 그대로고(검사한 필드가 나중에 쓰이므로 스프레드가 약화시킬 수 없다), **이 서비스가 이해하는 것은 검증하고 이해 못 하는 것은 옮긴다.** 다른 모듈의 기록을 이 파서가 없앨 일이 아니다 — 게다가 그 삭제는 **관계없는 저장에서 조용히** 일어난다.
  - 🟠 `toApi` 는 남겼다. 아웃라인이 여섯 개 텍스트 필드의 편집 가능한 진실이고(제목을 나중에 고칠 수 있다), 대본은 이 서비스의 검증 파서를 타야 한다 — **일부러 다른 것**이라 주석에 적었다. 다만 **필드를 덜 아는 것은 허용되지 않는다.**
  - 짝 둘: 대본 저장이 `previous_instagram_posts`·`mapping_revision`·모르는 필드를 지킨다(그리고 자기 필드는 여전히 검증된다) · `get()` 이 지운 게시물을 보고한다. 주입 둘(스프레드 제거 · `toApi` 에서 필드 제거)에 각각 빨갛다.
  - **실서버 확인**: `GET .../episodes/4` → `previousInstagramPosts` **3건**.
  - 🟢 오늘 같은 부류가 셋이었다 — `instagramPostAt`(476) · `parseStored` · `toApi`. **저장 스키마가 화이트리스트로 다시 짓는 방식이면, 기록에 필드를 더할 때 쓰는 쪽·읽는 쪽·매핑 쪽 셋을 다 봐야 한다.**
- [x] **명언 카드 캡션이 같은 문장을 두 번 쓴다 (Cowork Round 480 이 고쳤고, 검증·주입·보강은 여기서)**: 포토 카드는 글귀를 **`topic` 과 `scenes[0].narration` 두 군데**에 저장하는데 캡션 제안이 그 둘을 이어 붙였다. 사용자가 매번 한 벌씩 손으로 지우고 게시하고 있었다.
  - Cowork 의 두 겹(카드 가지 + `sameText` 동등성 가드) 판단에 동의한다. 근거도 본인이 정확히 적었다 — 가드만 두면 **두 사본이 어긋나는 날** 다시 두 벌이 되고, 카드 가지만 두면 **제목을 그대로 읽는 한 장면짜리 단편**이 남는다.
  - 🔴 **그런데 주입 ①(카드 가지 삭제)이 안 물었다 — 55개 전부 통과했다.** 카드는 두 사본이 바이트까지 같아서 **`sameText` 가 카드 짝까지 대신 만족시킨다.** 즉 **카드 가지를 붙들고 있는 짝이 하나도 없었다.**
    - Cowork 이 그 가지의 존재 이유로 든 바로 그 경우를 짝으로 넣었다: **글귀만 고치고 카드를 다시 안 그려 두 사본이 어긋난 카드.** 그때 캡션은 `topic`(사람이 쓴 쪽)을 따라야 하고 그려진 옛 사본은 안 나와야 한다. 주입 ①에 이제 빨갛다.
    - 주입 ②(`sameText` 를 항상 거짓으로)는 원래대로 둘째 짝을 문다.
  - 🟢 **Cowork 질문 답 — `narration` 에 글귀를 복사하는 자리는 `photo-card.service.ts:70` 이고, 지우면 안 된다.** 그 사본은 떠도는 중복이 아니라 **자막 원본**이다: 카드는 `subtitles_enabled: true` 로 만들어지고 `video-merge.service.ts:160` 이 `sceneValue(scene, "narration")` 을 자막 텍스트로 굽는다. 즉 `narration` 이 **말하는 글과 자막 글 두 뜻**을 겸하고 있고, `narrationAvailable:false` 는 **디스크의 오디오 파일** 얘기일 뿐이다. 같은 사본을 읽는 다른 화면은 없다 — 캡션 제안은 `suggestCaptionBody` 하나뿐이고, 회차물은 `suggestEpisodeCaptionBody` 로 갈라져 있다.
- [x] **🔴 회차물의 미술 방향이 유료 이미지에 한 번도 안 갔다 (Cowork Round 475·479 가 모양을 정하고, 백엔드는 여기서)**: 단편은 처음부터 `Style:` 줄을 보냈는데 **회차는 그 자리에 `""` 를 넘겼다.** 그래서 회차 그림은 **장면 글 + 참고 사진** 만으로 그려졌고, 사람이 그림체를 뭐라고 적든 유료 호출에 한 글자도 안 갔다. `styleLineFor` 주석의 한 절(*"LongProjectSettings has no equivalent visual-style fields today"*)이 **그 자체로 이 기능 구멍**이었다.
  - **`LongProjectSettings` 에 평평한 네 칸**: `visualStyle`·`color`·`lighting`·`avoid`. 단편의 중첩 `styleNotes`(일곱 칸)를 재사용하지 않은 것은 Cowork 판단대로다 — 넷은 다른 데로 가므로 회차물에 만들면 **아무 일도 안 하는 칸**이 남는다.
  - 🟢 **`avoid` 는 넣었다 — Cowork 이 못 찾은 것이다.** `image-prompt.ts:78-81` 에 `Avoid:` 를 만드는 코드가 실재한다(`video-preview.service.ts:84` 주석이 맞다). 그것 없이 두면 **회차물의 스타일 줄만 이유 없이 절반짜리**가 된다.
  - 🔴 **포맷터를 공유한다**: `styleLineFrom(parts)` 하나가 문장을 만들고, `styleLineFor`(단편, `style_profile` 대체값 포함)는 **그것을 부르는 얇은 어댑터**가 됐다. 그릇은 달라도 문장은 한 곳에서만 만들어진다 — 두 벌이면 언젠가 한쪽 구분자만 바뀌고 **두 그림체가 갈라지는데 아무도 못 본다.**
  - **회차 쪽 배선은 세 자리 전부**: 생성 루프(장면마다가 아니라 **한 회차에 한 번** 해석 — 그게 장면 간 일관성을 만든다) · 재생성 · 낡음 계산. 한 곳만 꿰면 D-031 의 그 모양이다.
  - 🟢 **오늘까지의 동작을 안 바꾼다.** 네 칸이 다 비면 `styleLineFrom` 이 `""` 를 돌려주고 프롬프트가 **바이트까지 같다.** 캡틴D가 칸을 채우기 전까지 1~4화는 아무것도 안 변하고 낡음 표시도 안 뜬다.
  - 🟠 **낡음에 Style 을 넣는 쪽으로 갔다 — Cowork 제안 그대로다.** 처음 채우는 순간 기존 회차가 한꺼번에 빨개지지만 **그건 참인 경고**다. 반대로 했으면 사람이 그림체를 바꾸고 **여섯 장면이 조용한 걸 보고 아무것도 안 바뀐 줄 안다** — 돈이 드는 방향의 거짓말이다.
  - 🔴 **저장 스키마 양쪽 다** 손봤다(오늘 세 번 겪은 자리): 쓰기(`setStored`) · 읽기(`toSettings`, 옛 프로젝트는 `""`) · 알려진 필드 집합 · 그리고 **`parseStored` 가 `settings({...})` 로 다시 지으면서 네 칸을 안 넘기고 있던 것**까지. 입력 타입에서는 **선택**으로 뒀다 — 없음과 `""` 가 같은 뜻이라, 이 칸을 모르는 호출자가 그대로 동작한다.
  - 짝 셋: 미술 방향이 **생성·재생성 요청 본문에 실제로 실리고 기록된다** · 방향을 처음 쓰면 기존 여섯 장면이 낡음으로 뜬다 · **안 쓰면 `Style:` 도 `Avoid:` 도 프롬프트에 없다.** 주입 셋(생성 배선 제거 · 낡음 배선 제거 · 포맷터에서 `Avoid` 제거)에 각각 빨갛다.
  - 🟠 **작품 기본 설정 화면 네 칸은 Cowork 이 붙인다.** 이 넷이 **그림에만 가고 대본에는 안 간다**는 것을 화면에 적겠다고 479 에 적혀 있다 — `tone`·`notes` 와 나란히 놓이면 구분이 안 되고, **그 오해가 이 결함을 낳았다.**
- [x] **단편도 이미지 생성 진행을 장면별로 볼 수 있다 (`GET /projects/:projectId/images/generations/progress`, Cowork Round 468 이 같이 신고한 나머지 절반)**: 회차 쪽(`f3d9bb3`)을 먼저 한 건 돈이 그쪽으로 나가고 있어서였고, **단편은 같은 루프에 같은 사각지대**였다 — 화면이 읽을 수 있는 건 워크플로 상태 하나뿐이라 여섯 줄이 동시에 **만드는 중**이었다.
  - **판정 기준은 그 루프가 건너뛸 때 쓰는 질문 그대로다**: `generated_images[n-1]` 이 그 파일을 가리키고 **그 파일이 PNG 로 읽히면** 완료. 회차와 달리 단편은 기록이 파일과 나란히 있고, **루프 안에서 장면마다 저장**되므로 둘 다 같이 전진한다. 진행만을 위한 별도 기록은 두지 않았다 — 언젠가 파일과 어긋나고 그날 화면은 없는 그림을 있다고 한다.
  - `stat` 이 아니라 `validPng`. 루프는 바이트를 쓰고 나서 검증하므로 **있는데 안 읽히는 파일은 지금 쓰이는 중**이고, 그걸 완료로 세면 표시가 한 박자 앞서 나간다.
  - `currentSceneNumber` 는 `GENERATING_IMAGES` 일 때만. 이름은 `LongEpisodeImageProgress`(→ `LongEpisodeVideoProgress`)와 같아서 **세 화면이 같은 말을 쓴다.**
  - 짝 셋. 하나는 **3번 장면의 프로바이더 호출을 붙잡아 둔 채** 읽어 `[1,2]`·`current 3` 을 확인한다(유료 0, `fetch` 스텁). 나머지 둘은 반쯤 쓰인 파일 · 아직 아무것도 없는 프로젝트. 주입 둘(`validPng` 제거 · 상태 조건 제거)에 각각 빨갛다.
  - 🟠 화면 배선은 Cowork 몫이다.
- [x] **🔴 영상 화질 — 절반은 우리 ffmpeg 이 만든 손실이었다 (Cowork Round 481 이 실파일로 측정, 패치·재측정은 여기서)**: 캡틴D의 *"영상 퀄리티가 낮은데 프롬프트 문제냐 영상 AI 문제냐"* 에 대한 답. **프롬프트가 아니다.**
  - `ffmpeg-merge.service.ts` 가 인코딩 옵션을 **하나도 안 주고 있었다** — x264 기본값(CRF 23 / preset medium)이다. Runway 가 이미 압축한 것을 **2.25배로 늘려 놓고 기본값으로 또 압축**하는 자리다.
  - **`X264_QUALITY = ["-crf","18","-preset","slow"]`** 를 이름 붙여 두 인코드 분기(내레이션 있음/없음)에 같이 넘긴다. 인코더 설정 사본이 둘이면 **한쪽이 조용히 기본값에 남는다.**
  - 업스케일 보간을 **`flags=lanczos`** 로(기본 bicubic).
  - **`-movflags +faststart` 는 두 곳 다** 붙였다 — Cowork 은 "뒤가 앞을 덮으니 한 곳만" 이라 했지만 반대다: BGM 믹스가 `-c:v copy` 로 **나중에 컨테이너를 다시 쓰므로**, concat 에만 붙이면 **BGM 있는 회차는 전부 잃는다.** 둘 다 붙이면 두 경로 모두 남는다.
  - **실측 (4화 실파일, 스크래치에서 A/B, 유료 0 · 원본 안 건드림)**:
    ```
                          해상도      용량       Mbps   bits/px
    Runway 원본 6장면 합계  720x1280  13,198,767  3.49    0.126
    지금 배포된 최종본      1080x1920 12,958,820  3.43    0.055
    옛 설정 재현            1080x1920 12,465,561  3.30    0.053
    새 설정                 1080x1920 24,422,360  6.46    0.104   ← 원본의 83%
    ```
    **SSIM(1장면, 무손실 기준 대비)**: 옛 `0.98585` → 새 `0.99105`. **우리 재인코딩이 만든 손실이 37% 감소**(1−SSIM 0.01415 → 0.00895).
    **용량은 2배**(Cowork 추정 35~45MB 보다 작다, 24MB). **인코딩 시간 4.9초 → 8.3초** — 유료 생성 몇 분 뒤에 한 번 도는 자리라 무시할 만하다.
  - 🟠 **정직하게: 720p 를 1080p 로 만들어 주지 않는다.** 천장은 여전히 Runway 의 720p 다. 다만 지금까지는 **그 천장에 한참 못 미치고 있었다.**
  - 짝 셋: 두 분기 모두 품질 옵션과 lanczos 를 싣는다 · 최종 파일을 쓰는 **두 단계 모두** faststart 를 붙인다. 주입 셋(CRF 제거 · lanczos 제거 · faststart 제거)에 각각 빨갛다. **필터만 단언하면 인코더가 기본값으로 돌아가도 초록**이라, 설정 자체를 못 박았다.
  - 🟠 **원인 ②(모델이 `gen4_turbo` 로 박혀 있고 그 등급의 세로 최대가 720:1280)는 손대지 않았다** — 캡틴D의 돈이 드는 결정이고, Cowork 도 그렇게 남겼다. ①이 무료라 먼저다.
  - 🟢 **원인 ③ 프롬프트는 문제가 아니다**(Cowork 확인). 다만 ①② 뒤에 볼 것 둘을 남겨 뒀다: 프롬프트가 전부 한국어인 것, `Pacing` 섹션이 한/영 섞여 깨져 있고 Runway 가이드가 피하라는 추상 표현인 것.
- [x] **주석에 근거 없이 적은 문장을 재서 고쳤다 (082459a 의 후속)**: `X264_QUALITY` 주석에 *"정지 이미지 카드는 압축이 거의 공짜라 양쪽 다 거의 안 움직인다"* 고 적었는데 **재보지 않고 쓴 문장이었고, 틀렸다.**
  - 실측(명언 카드 실파일, 앱의 실제 `kenBurns` 필터로): **4,556,559 B → 10,135,319 B (2.2배)** · 0.0586 → 0.1303 bits/px · 인코딩 3.1초 → 4.1초.
  - **회차(2.0배)와 거의 같은 배율이다.** 이유: 느린 줌이 계속 도니 **매 프레임이 앞 프레임과 다르다** — 정지 사진이 아니라 저속 모션이고, CRF 18 에서 모션은 값을 치른다.
  - 주석을 실측값으로 바꿨다(회차 12.5→24.4MB, 카드 4.6→10.1MB, 인코딩 4.9→8.3초). **설정은 그대로 하나로 뒀다** — 카드용 두 번째 값을 두면 이 저장소가 하루 종일 고친 그 모양이 된다.
  - 🟠 첫 시도는 내가 만든 `zoompan` 이 앱 것과 달라 1.7GB 짜리가 나왔다. **앱의 실제 필터로 다시 재기 전에는 아무 숫자도 보고하지 않았다.**
- [x] **🔴 내 `git add -A` 가 Cowork 의 진행 중 프런트 12개 파일을 `87300f5` 에 같이 쓸어 담았다 — 커밋 메시지는 ffmpeg 주석만 설명한다**: 되돌리기(force push)는 안 했다. 이미 push 된 히스토리를 혼자 다시 쓰는 것이 더 나쁘고, 내용 자체는 유효하다. **대신 즉시 검증했고, 거기서 빨간 짝이 하나 나왔다.**
  - **앞으로**: 이 저장소는 Cowork 이 작업 트리로 넘겨주는 구조라 **`git add -A` 를 쓰면 안 된다.** 내가 바꾼 경로만 명시해서 담는다.
  - 🟢 **Cowork 의 변경 자체는 옳다**: 이어받기 조회가 *실패한 것*과 *물어봤더니 없는 것*이 둘 다 `null` 로 뭉개져, 500 이나 끊긴 연결이 **"이전 에피소드의 마지막 장면 자료가 아직 없어서"** 라는 단정으로 나가고 있었다. 물어보지도 못한 화면이 단정한 것이다. `continuityReferenceFailed` 로 갈라 호박색 배너를 따로 뒀다.
  - 🔴 **다만 1화에서 무너진다**: 1화는 **정의상 이전 회차가 없으므로** 조회가 실패해도 답이 안 바뀐다. 그런데 실패하면 *"확인하지 못했습니다"* 가 뜨고 *"첫 에피소드라…"* 가 사라졌다 — **답이 정해져 있는 질문에 의심을 만들어 내는 것**이다. `episodeNumber > 1` 로 막았다.
  - 🟠 **그 짝은 원래부터 잘못된 이유로 초록이었다**: 픽스처가 `previousEpisodeNumber: 0` 을 보내는데 **응답 검사기가 `> 0` 을 요구해 거절**하고 있었다. 즉 이 짝은 늘 실패 경로를 지나갔고, 예전엔 폴백 렌더링이 우연히 같아서 초록이었다. 실서버가 1화에 실제로 보내는 값(`reference: null`)으로 고쳤다.
  - 🔴 **그러자 이번엔 내 가드를 재는 짝이 없어졌다**(정상 응답이라 실패 경로를 안 지난다). **1화 + 조회 500** 짝을 따로 넣었다 — 주입(가드 제거)에 빨갛다. **처음엔 주입이 안 물어서 알았다.**
- [x] **화면이 "모른다"를 "없다"로 말하던 자리 다섯 (Cowork Round 484 가 고쳤고, 검증·주입은 여기서)**: 캡틴D의 *"UI 깔끔하게, 기능 안정화 확인"* 요청으로 프론트를 훑어 **같은 결함 다섯 개**를 찾아냈다 — 이번 주에 고친 것들과 정확히 같은 모양이다.
  ```
  ① VideoWorkflowScreen        읽지도 못한 작업을 "무료" 라고 말함 (progress?.paidProvider 의 ?. 하나로)
  ② LongEpisodeImageGeneration 연속성 조회 실패를 "이전 회차에 자료 없음" 으로
  ③ LongEpisodeVideoWorkflow   못 물어본 걸 "작업 없음" 으로 읽고 유료 미리보기를 엶
  ④ LongEpisodeScript          못 확인한 걸 침묵으로 답함 (아래에 유료 버튼)
  ⑤ LongEpisodeNarrationReview 아직 안 읽은 회차를 "대본 검토를 지났다" 고 단정
  ```
  - **주입 다섯 전부 확인**: 각 파일의 새 가지를 없애면 해당 짝이 빨갛다. ③의 짝이 문장이 아니라 **요청 수**를 세는 것도 맞는 판단이다 — 에러를 띄우면서 동시에 다시 사라고 권하는 화면은 문장만 보는 짝을 통과한다.
  - 🟠 **①~⑤ 는 내 `git add -A` 가 `87300f5` 에 이미 쓸어 담았다**(그 커밋 메시지는 ffmpeg 얘기만 한다). 되돌리지 않고 검증으로 갚았고, 거기서 ②의 1화 구멍을 찾아 `5cc4d10` 으로 고쳤다.
- [x] **🔴 484 가 넘긴 백엔드 질문에 구체적 답 하나 — `storyBibleLinkDrift` 가 같은 결함을 갖고 있었다**: *"없음과 못 읽음을 라우트가 구분하는가"* 를 훑어보니, **드리프트 계산이 모든 읽기 실패를 빈 배열로 되돌리고 있었다.** 화면은 빈 배열을 **침묵**으로 그린다.
  - **그 침묵 바로 위가 유료 재생성 버튼이고**, 이 목록은 *"이 회차는 지금 이야기와 다른 인물로 그려졌다"* 를 말할 수 있는 **유일한 문장**이다 — 이번 주 캡틴D에게 필요했던 바로 그것. 즉 `story_bible.json` 이 깨지면 **그 경고가 조용히 꺼진다.**
  - `{ links, unreadable }` 로 갈랐고 응답에 `storyBibleLinkDriftUnreadable?: true` 를 실었다. **없는 바이블은 실패가 아니다** — 링크를 안 건 프로젝트는 회차가 어긋날 대상 자체가 없으므로 `unreadable: false` 인 빈 목록으로 남는다(`ENOENT` 로 구분).
  - 짝: 깨진 파일 → `unreadable: true` · 지운 파일 → `unreadable: false`. 주입(모든 실패를 다시 `false` 로)에 빨갛다. 기존 짝 둘도 **"비어 있고 읽혔다"** 를 같이 단언하도록 고쳤다 — 예전 형태는 그 둘을 구분하지 못한다.
  - 🟠 **화면 문구는 Cowork 몫이다.** 플래그가 갔다.
- [x] **작품 기본 설정 그림체 칸 넷 + 이미지 생성 진행 표시 화면 (Cowork Round 485, 검증·주입·보강은 여기서)**: `4228795`(칸 넷) · `66aef83`·`f3d9bb3`(진행 라우트 둘)에 화면이 붙었다.
  - 🟢 **화면 맨 위 문장을 같이 고친 판단이 옳다**: *"여기 적은 내용은 회차 나누기와 대본 생성 때 AI에게 전달됩니다"* 는 칸 넷이 들어오는 순간 거짓이 된다 — 그 넷은 **그 화면에서 유일하게 대본으로 안 가는 칸**이다. `톤`·`메모` 가 몇 센티 위에 있고 그것들은 대본으로 간다. **그 오해가 이 기능이 없던 이유였다.** `avoid` 에 *"영상 쪽에는 안 간다"* 를 적은 것도 맞다 — 세 칸은 같은 샷을 설명하는데 이 한 칸만 그림에서 멈추는 건 놀라운 일이고, 모르면 돈으로 배운다.
  - 🔴 **왕복 짝이 한 칸만 재고 있었다.** *"칸만 그리고 안 보내면 같은 구멍"* 이라며 넣은 짝인데, **편집하는 칸이 `color` 하나**라 나머지 셋은 통과만 본다. `visualStyle` 의 `onChange` 를 죽여도 초록이었다. **넷 다 입력하도록 고쳤고, 이제 어느 칸을 죽여도 빨갛다.** 각 칸이 따로 배선돼 있으니 짝도 칸마다 봐야 한다.
  - 🔴 **단편 진행 짝이 진행 응답 도착 전에 통과하고 있었다.** 3번 장면의 「만드는 중」을 기다렸는데, **그 문구는 폴백에서도 즉시 나온다**(폴링 첫 틱은 3초 뒤). 그래서 그 뒤 단언들이 진행 이전 상태에 대고 돌았다. **`completedSceneNumbers` 로만 도달 가능한 「완료」를 기다리도록** 고쳤다.
  - 🟢 **단편 쪽 진짜 버그를 찾아냈다**: 화면이 `getProject` 를 폴링하며 `generatedImagePath` 를 세고 있었는데 **`toApiProject` 가 그 배열을 장면에 매핑하지 않는다** — 즉 **바가 런 내내 0/6 에 붙어 있었다.** 그 파일 주석이 그 사실을 이미 적고 있었는데 아무도 연결하지 않았다.
  - 🟠 **실패한 폴링이 "아무것도 시작 안 됨"으로 그려지지 않는다** — 양쪽 화면 모두 배치 단위 답(`만드는 중`)을 유지한다. 주입(각각 `대기 중`/`waiting` 으로 바꾸기)에 빨갛다. 멈춘 런처럼 보이는 화면이 **유료 버튼을 두 번 누르게 만든다.**
  - 회차 폴링 대상을 `getLongEpisode` → `getLongEpisodeImageProgress` 로 바꿨는데 **요청 수는 그대로다** — 계약에 `episode` 를 같이 실어 둔 이유가 그것이다.
- [x] **UI 정리 + 설정집 못 읽음 문구 (Cowork Round 486, 검증·주입은 여기서)**: 캡틴D의 *"불필요한 거 없이 깔끔하게, 안정화 확인"* 요청으로 프론트를 훑은 결과.
  - **설정집 못 읽음**(`a235188` 의 플래그에 화면이 붙었다): 드리프트 섹션의 하늘색이 아니라 **amber** — 차이는 확정된 정보이고 **못 읽은 파일은 열린 질문**이다. 기존 짝("Episode agrees" 일 때 침묵)에 **`drift-unknown` 도 없어야 한다**는 줄을 보탠 것이 중요하다. 그게 없으면 그 짝은 **침묵 두 종류를 여전히 구분 못 한다.**
  - 🔴 **아무 데도 안 가는 버튼**: `StoryPromptScreen` 이 *"프로젝트 설정을 먼저 고치는 편이 낫습니다"* 라고 말하고 버튼을 두는데, **유일한 마운트가 `onOpenSettings` 를 안 넘겼다.** prop 이 optional 이라 아무 데서도 실패하지 않았다.
    - 🟢 **짝을 하나 더 쓰는 대신 prop 을 필수로 바꾼 판단이 맞다** — 주입으로 확인했다: 마운트에서 그 줄을 빼면 **`TS2741` 로 컴파일이 거부한다.** optional 이었던 이유가 *"so the screen still renders standalone in tests"* 였는데, **테스트 편의가 실사용자의 유일한 경로를 비워 뒀다.**
  - 🔴 **`VideoMergeScreen` 이 `loadState` 를 쓰기만 하고 안 읽었다** → 프로젝트 읽기 실패 시 **스피너도 오류도 없이** 병합 화면이 그려지고, 사람은 병합을 눌러 서버 거절을 본다. 버튼을 막지 않은 것도 맞다(그 화면 자신의 규칙: *"a button disabled on a guess is worse than one that fails honestly"*).
  - 네비 「보관함」이 넷이었다 → 마지막 것은 라이브러리가 아니라 **복구/완전 삭제**라 **「보관한 프로젝트」**로. `명언 카드` 가 `이미지 보관함` 과 같은 아이콘이라 따옴표 아이콘을 새로 넣었다 — 아이콘 줄은 읽히기 전에 모양으로 훑힌다.
  - 죽은 라벨표(`MAPPING_REVIEW_STATUS_LABEL` 등)를 지웠다. **이미 갈라져 있었다**(죽은 쪽 `확정됨`/`매칭 안 됨`, 화면 `확인됨`/`매칭 안됨`). 사람이 읽는 화면 쪽을 남겼다. 🟠 `확인됨` vs `확정됨` 은 **정리가 아니라 말 고르기**라 캡틴D 몫으로 남겼다 — `확정` 은 이미지·영상 화면에서 "이걸로 승인한다" 를 뜻한다.
- [x] **🔴 내 `git checkout --` 이 Cowork 의 `App.tsx` 486 변경을 지웠다 — 두 번째 같은 실수다**: 주입을 되돌리려고 쓴 `git checkout -- App.tsx` 가 **커밋 안 된 그쪽 작업까지** 되돌렸다. 백업을 안 떠 뒀다.
  - 라운드에 적힌 내용으로 셋 다 복원했다: 네비 라벨 · 명언 카드 아이콘 · `onOpenSettings` 배선. **아이콘 path 는 내가 새로 그렸으니 그쪽이 봐야 한다.**
  - **규칙**: 커밋 안 된 남의 작업이 트리에 있을 때 **`git checkout --` 를 주입 되돌리기에 쓰지 않는다.** 편집 전 사본을 스크래치에 뜨고 그 사본으로 되돌린다(앞서 세 파일은 그렇게 했고 그것들은 무사했다).
- [x] **죽은 코드 넷 제거 (Cowork 이 판단을 물은 것)**: `BudgetLine.breakdown`(8곳 호출, 아무도 안 넘겨서 렌더가 도달 불가) · `StatusChip` tone `"active"`(21곳 호출, 아무도 안 씀) · `LONG_EPISODE_OPTIONAL_FIELD_KEYS` · `LoginWindowHandle`. 전부 프로덕션 importer 0 을 직접 확인했다.
  - 🟠 `LONG_EPISODE_OPTIONAL_FIELD_KEYS` 는 **자기 자신만 검사하는 짝**이 살려두고 있었다 — 그 짝도 같이 지웠다. 죽은 상수가 쓰인 대로라고 단언하는 짝은 아무것도 증명하지 않는다.
  - 🟠 **`ProviderCredentialCard` 의 `disabled`·`onPendingChange` 는 안 지웠다.** 나머지 넷과 달리 **컴포넌트 안에서 실제로 읽힌다**(`if (disabled || …)`, `onPendingChange(true)`). 지우면 선언이 아니라 **동작이 사라진다** — 이 컴포넌트를 재사용 가능하게 둘지에 대한 설계 판단이라 넘긴다.
- [x] **살아 있는 앱을 화면마다 열어 본 결과 — "완료된 것이 고장 난 것처럼 보이는" 자리 둘 (Cowork Round 487)**: 캡틴D가 서버를 열어 두고 검증을 부탁하셔서 네비 10개·화면 22개를 실제로 열었다. **전부 렌더되고 콘솔 에러 없다.** 다만 둘.
  - **완료된 회차의 영상 화면에 빨간 오류**: `review()` 는 `videos_review`/`videos_approved` 에만 답하므로 `completed` 회차에서는 거절이 **정상적인 답**인데, 그 거절이 progress 읽기와 **같은 catch** 에 잡혀 **화면 자신의 실패**로 그려졌다. 이제 검토 목록만 없는 것으로 두고, 문장은 **거절이 아니라 `job.episode.status` 에서** 뽑는다.
  - **완료된 단편이 "6개 중 0개 확정됨"**: `/projects/1` 의 장면에 `videoReview` 필드가 **아예 없어서** `undefined !== "approved"` 로 여섯 개가 미확정으로 세어졌다 — **없는 것이 아니오로 읽힌 것.** `blocked` 바로 위 주석이 이미 답을 적고 있었다(*"Unknown stays unblocked"*). 이제 **모든 장면이 답했을 때만** 숫자를 만들고 아니면 `null` 이다.
    - 🟠 짝이 셋인 이유: 두 번째("아무 장면도 리뷰를 안 달았으면 확정 얘기를 아예 안 한다")만 있으면 **"아무것도 안 세는" 쪽으로 도망가도 통과**한다. 세 번째가 그 도피로를 막는다. 주입으로 확인했다.
- [x] **③ 명언 카드가 영상 보관함에서 「장면 0/1」로 보인다 — 행에 `photoCard` 를 싣는다**: 포토 카드는 장면 영상이 없는 게 정상인데 그 줄이 **덜 끝난 일**로 읽히고 바로 위 「최종 영상 있음」과 부딪힌다.
  - 🔴 **이건 예전에 일부러 뺐고 짝으로 못 박혀 있었다** — *"게시 화면이 이 목록에서 고른 뒤 그 프로젝트를 불러오고, `photoCard` 는 이미 모든 `ProjectSummary` 에 있다. 같은 논리로 두 번 다시 추가되지 않게 핀."*
  - **그 전제가 이 화면에는 안 맞는다.** `VideoLibraryScreen` 은 **프로젝트를 아예 안 불러온다**(`getProject` 호출 0). 그리고 문제의 `장면 {videosReadyCount}/{sceneCount}` 이 **바로 그 행에서** 그려진다. 게시 화면에 대한 그 판단은 여전히 옳고, 라이브러리 화면을 덮지 않았을 뿐이다.
  - **핀을 지우지 않고 반대 방향으로 갱신했다** — 왜 바뀌었는지를 그 자리에 적었다. 화면이 `finalVideoAvailable && videosReadyCount === 0 && sceneCount === 1` 로 추론하게 두는 건 이 저장소가 일주일 내내 걷어낸 모양이다.
- [x] **④ 대본 없는 회차의 매핑 라우트가 "장기 프로젝트를 찾을 수 없습니다"**: 프로젝트 12는 멀쩡하고 5화가 아웃라인에만 있을 뿐인데 404 `LONG_PROJECT_NOT_FOUND` 가 나갔다 — **없지 않은 것을 찾아 나서게 만드는 답**이다.
  - `episode-videos.service.ts` 의 `loadEpisode` 가 자기 라우트에서 이미 같은 정정을 했고 주석까지 그대로 들어맞는다. 매핑 라우트를 `LONG_EPISODE_MAPPING_NOT_ALLOWED` 로 맞췄다 — **대본은 있는데 상태가 안 맞는 회차가 이미 받는 코드**라, 두 경우가 이제 같은 말을 한다. 주입(옛 404 복원)에 빨갛다.
- [x] **476 커버 `0` — 볼 것이 없어서 닫는다**: `instagramPublishApi.ts` 가 이미 `0` 은 선택으로 보내고 `null` 은 필드를 통째로 뺀다. 확인창도 두 경우를 다르게 쓴다(8d6f25d). Cowork 확인, 동의.
- [x] **🔴 `Scene.imageReview`·`videoReview` 는 계약이 지어낸 필드다 — 아무것도 안 쓴다 (487 ②의 후속으로 파고든 결과)**: Cowork 은 *"옛 프로젝트에서 매퍼가 빼고 보낸다"* 로 봤고 나도 처음엔 그렇게 받았다. **틀렸다. 모든 프로젝트에 항상 없다.**
  ```
  이 필드를 장면에 쓰는 프로덕션 코드   0곳
  값이 들어 있는 곳                     프런트 테스트 픽스처 넷뿐
  캡틴D 프로젝트 1                      장면 6개 중 0개가 보유
  ```
  - 가능하게 만든 것은 `project.mapper.ts` 의 **`as unknown as Scene`** 이다 — 저장된 장면을 그대로 펼치고 `Scene` 이라고 단언한다. **required 두 칸이 한 번도 존재한 적 없이 required 로 남아 있었다.**
  - **실제 대가**: `VideoMergeScreen` 이 이 필드로 확정 수를 세니 **모든 프로젝트에서 0** 이었고, 최종 영상이 있는 사람에게 *"그 영상을 만든 여섯 장면을 가서 확정하라"* 고 했다(487 ②). Cowork 의 수정으로 **이제 안 센다** — 그게 맞는 동작이고, 동시에 **영원히 못 센다는 뜻**이다.
  - 🟠 **그래서 Cowork 의 셋째 짝("모든 장면이 답했으면 여전히 세고 막는다")은 실데이터로는 도달 불가능한 경우를 못 박고 있다.** 픽스처가 서버가 만들 수 없는 값을 공급한다. 그 짝이 막으려던 도피로("아예 안 세기")는 진짜 위험이었으니 짝 자체는 옳고, **다만 지금은 픽스처만이 그 초록을 만든다.**
  - **진짜 출처는 있다**: `GET /projects/:id/videos/generations/:jobId/review` — `Project.currentVideoJobId` 로 닿고, **`LongEpisodeVideoMergeScreen` 이 이미 그걸로 센다**(`review.reviews.filter(status === "approved")`). 실서버 확인: 프로젝트 1은 `COMPLETED` 라 그 라우트가 거절하는데 **그것도 맞다** — 끝난 프로젝트는 확정할 것이 없다.
  - **계약에서 지우는 건 화면 변경 뒤다**(지금 지우면 그 화면이 컴파일 안 된다). 대신 **사실을 계약 그 자리에 적었다** — 다음 사람이 이 두 칸을 읽고 답을 기대하지 않도록.
- [x] **`Scene.imagePrompt` 도 같은 가짜 required 였다 — 지웠다**: `videoReview` 를 파다가 같은 `as unknown as Scene` 뒤에서 셋째를 찾았다.
  ```
  toApiScene 이 매핑하는 것   motion_prompts[index] → motionPrompt   ✅
  안 하는 것                  image_prompts[index]  → imagePrompt    ❌
  실서버 /projects/1          scenes[0] 에 imagePrompt 없음
  프로덕션 읽는 곳            0곳 · 프롬프트를 보여주는 화면도 0곳
  ```
  - **디스크에는 `image_prompts` 6개가 실제로 있다.** 즉 "출처가 없다" 가 아니라 **배선이 없고 아무도 안 찾는다.** 그리고 낡음 계산은 이 필드가 아니라 `image_generation_records[].prompt` 를 쓴다 — **작동하는 메커니즘이 따로 있고 이 칸은 그 옆에서 놀고 있었다.**
  - 앞의 둘과 달리 **막는 화면이 없어서 바로 지웠다.** 계약에서 빼고, 픽스처 열 군데를 정리했다.
  - 🟠 **다섯 군데는 컴파일러가 못 잡았다** — 타입 없는 헬퍼가 만드는 객체라 초과 속성 검사가 안 걸린다. **지어낸 값이 짝에 남으면 다음 사람이 다시 믿는다.** 손으로 찾아 지웠다.
- [x] **회차 장면 필드 이름표가 두 벌이었다 — 한 벌로 합치고 계약에 못 박았다**: `Scene.imagePrompt` 를 지우다가 같은 부류를 하나 더 찾았다. `snakeKeys`·`camelKeys` 가 `episode-script-format.ts` 와 `episode-scripts.service.ts` 에 **바이트까지 같게** 두 벌씩 있었다.
  - **둘이 합쳐 앱이 내보내는 모든 `LongEpisodeScene` 을 만든다**, 그것도 `as unknown as` 캐스트를 통해서 — **결과를 검사할 수단이 없다.** 그래서 계약에 필드를 하나 더하면 **두 곳을 다 찾아야** 했고, 하나만 찾은 사람은 *"어떤 경로에서는 온전하고 어떤 경로에서는 한 칸 빠진 대본"* 을 낸다. `toEpisodeDetail` 주석이 사본 다섯에 대해 이미 적어 둔 그 문장이다.
  - 🟢 **지금은 빠진 필드가 없었다** — 두 벌이 아직 일치했다. **고친 것은 결함이 아니라 그 결함이 생길 자리다.**
  - 짝을 **다른 사본이 아니라 계약에 대고** 쓴다: 17개 이름을 손으로 적어 두고 `camelKeys` 와 비교한다. 같은 상수에서 유도하면 **자기 자신과 같다는 단언**이 된다(오늘 아침 지운 `LONG_EPISODE_OPTIONAL_FIELD_KEYS` 짝이 정확히 그것이었다). 그리고 `snakeKeys` 는 **위치로 짝지어 읽히므로** 인덱스 정렬까지 본다.
  - 주입(공유 목록에서 `continuityHint` 제거)에 빨갛다.
- [x] **여섯 번째 사본이 또 한 칸 모자랐다 — `openablePath` (계약이 "같이 없거나 같이 있다" 고 적어 둔 짝)**: `LongEpisodeDetail` 을 실응답과 대조하다가 나왔다.
  ```
  GET /long-projects/12/episodes/4   finalVideoPath ✅   openablePath ❌
  계약(api.ts:275)                   "Absent whenever `finalVideoPath` is."
  ```
  - 이유는 486 에서 적은 그것이다: `episode-scripts.service.ts` 의 `toApi` 가 **`toEpisodeDetail` 이 흡수하지 못한 여섯 번째 사본**이고, 그것만 이 칸을 몰랐다. `episode-detail.ts` 주석이 왜 둘이 같이 가야 하는지 적고 있다 — **같은 파일을 다른 기준점에서 부른 두 문자열**이라, 표시용을 데스크톱 브리지에 넘기면 **엉뚱한 프로젝트 안의 경로**를 가리킨다.
  - 🟠 **이 사본이 한 칸 모자란 게 두 번째다**(첫 번째는 `previousInstagramPosts`, 486). 사본으로 남는 이유는 그대로 유효하다(아웃라인이 여섯 텍스트 칸의 진실, 대본은 이 서비스의 검증 파서) — **다만 필드를 덜 아는 것은 허용되지 않는다.** 두 번 겹쳤으니 다음에 또 나오면 합치는 쪽을 봐야 한다.
  - 짝: `final_video_path` 가 있는 회차의 `get()` 이 **둘 다** 낸다. 주입(openablePath 제거)에 빨갛다. **실서버 확인**: 4화가 이제 `long_story/Episode04/videos/final/instagram_reel.mp4` 를 같이 낸다.
  - 🟠 **다만 `openablePath` 는 아직 아무도 안 읽는다** — "탐색기에서 열기" 버튼은 **단편 전용**이고(`InstagramPostScreen` 주석), 회차 병합 화면은 경로를 **글자로만** 보여준다. 지금 고친 것은 **계약과 코드가 서로 다른 말을 하던 것**이지 사용자에게 보이는 기능이 아니다. 회차에도 그 버튼을 둘지는 제품 판단이라 캡틴D/Cowork 몫으로 남긴다 — **둔다면 필드는 이미 정직하게 나간다.**
- [x] **"세 번째가 나오면 합친다" 를 기다리는 대신 짝으로 잡히게 했다**: `toApi`(회차 상세의 여섯 번째 사본)가 필드를 모른 게 두 번이었다(`previousInstagramPosts`, `openablePath`). 세 번째를 사람 눈이 아니라 스위트가 잡는다.
  - **키 집합을 비교한다** — 값이 아니라. 두 사본은 **값에 대해서는 일부러 다르다**(아웃라인이 여섯 텍스트 칸의 진실, 대본은 이 서비스의 검증 파서). 값을 단언하면 그 차이를 깨거나, 아니면 아무것도 못 잡는다.
  - **동등이 아니라 부분집합**이다: 이 라우트는 공유 매퍼가 알 수 없는 둘을 **더** 낸다(`aspectRatio` 는 작품 설정에서, `narrationAvailable` 은 디스크 읽기에서). **더 아는 건 괜찮고, 덜 아는 게 두 번 문제였다.**
  - 모든 선택 필드를 채운 회차로 돌린다(최종 영상 · 게시물 · 지운 게시물 · 사용 음원 · 오류). 주입(`usedAudio` 제거)에 **`expected [ 'usedAudio' ] to deeply equal []`** 로 빨갛다.
  - 🟠 **합치는 것 자체는 아직 안 했다.** 사본으로 남는 이유는 유효하고, 이 짝이 그 이유를 지키면서 대가만 없앤다. **정말 합쳐야 할 때는 이 짝이 초록인 채로 옮길 수 있다.**
- [x] **2차 화면 감사 일곱 + 병합 화면을 review 엔드포인트로 (Cowork Round 492, 검증·짝 이전은 여기서)**: 484 의 다섯과 같은 계열 — **"모른다" 를 "안다" 로 바꿔 말하던 자리들**을 화면을 클릭하며 일곱 개 더 찾았다.
  ```
  InstagramPostScreen        초안 읽기 실패 → 빈 초안으로 덮어씀 · 재생 안 된 영상을 "세로 아님" 으로 단정 · 계정 문구 순서
  ShortProjectSettingsScreen 조회 실패를 전부 "지워진 폴더" 로 · 대표 있음/이름 없음을 null 하나에
  MappingReviewScreen        목록 못 읽었는데 후보 버튼이 살아 있음
  LongProjectOutlineScreen   상태 못 읽었는데 미리보기·승인 버튼을 그림
  ```
  - 🔴 **`castRole` 픽스처를 고치자 진짜 화면 버그가 드러났다**(Cowork 발견): **지워진 폴더가 대표일 때** 아래 행은 *"지워진 폴더 · 제거해 주세요"* 라고 맞게 말하는데 위 힌트는 *"이름을 불러오지 못해"* — **조회는 성공했다.** 기다리라는 뜻의 문장이 기다려도 안 풀리는 상태에 붙어 있었고, 그대로 두면 **다음 유료 대본이 폴더 번호를 주인공 이름으로 받는다**(`castLeadName ?? settings.character`). 화면이 이미 갖고 있던 `namesLoaded` 를 위로 올려 `folderGone` 으로 갈랐다.
  - 🟠 **`castRole: "representative"` 는 계약에 없는 값이었다**(넷). 다만 그중 셋은 **단언이 대표 여부를 안 본다** — 이번 주 세 번 나온 *"잘못된 이유로 초록"*(단언이 약함) 과는 다른 부류라 그렇게 세지 않는다. 그래도 넷 다 고쳤다: 계약에 없는 값이 픽스처에 남으면 다음 사람이 그걸 보고 또 쓴다.
- [x] **`VideoMergeScreen` 이 확정 수를 review 엔드포인트에서 센다 — 489 ③ 이 풀렸다**: `Project.currentVideoJobId` 로 `/videos/generations/:jobId/review` 를 읽고, **거절되면 아무 말도 안 한다**(끝난 프로젝트는 확정할 게 없으니 모르는 게 맞다).
  - 🔴 **기존 짝 일곱이 깨졌다 — 그 일곱이 `scene.videoReview` 로 의도를 표현하고 있었기 때문이다.** 그 필드는 내가 지울 가짜 required 라, 하네스가 그 값을 **review 응답으로 옮기게** 했다: 짝은 여전히 `videoReview` 로 상태를 말하고, 하네스가 그것을 화면이 실제로 묻는 답으로 바꾼다. **짝이 fetch 대본이 아니라 자기가 서술하는 상태로 읽힌다.**
  - 하네스 기본 잡 id 를 **별도 값**(`job_default`)으로 뒀다 — 그쪽 새 짝 셋이 `job_1` 을 직접 답하므로 겹치면 안 된다. "잡이 없을 때" 짝은 `currentVideoJobId: undefined` 를 **명시**하게 했다: 하네스 기본값에 기대면 그 짝이 자기가 말하는 상태를 안 재게 된다.
  - `LongProjectOutlineScreen` 짝 하나도 같은 이유로 고쳤다 — 픽스처가 **모든 라우트를 404** 로 만들어서, 새 가드가 프로젝트 읽기 단계에서 멈추자 **이름이 말하는 그 미리보기 요청까지 가지도 못했다.** 미리보기만 실패하도록 바꿨다.
- [x] **`Scene.imageReview` · `videoReview` 를 계약에서 지웠다 — 489 의 마지막 조각**: Cowork 이 `VideoMergeScreen` 을 review 엔드포인트로 옮기면서 **읽는 곳이 0이 됐고**, 그러면 지울 수 있다.
  - 이 둘은 **어떤 응답에도 있던 적이 없다**(489·490). `project.mapper.ts` 가 저장된 장면을 펼치고 `as unknown as Scene` 으로 단언해서, **존재한 적 없는 두 칸이 required 로** 남아 있었다. 대가는 실재했다 — 병합 화면이 이 필드로 세어 **모든 프로젝트에서 0개 확정**이었고, 최종 영상을 가진 사람에게 그 영상을 만든 여섯 장면을 확정하라고 했다.
  - 🟠 **짝이 이 필드로 상태를 말하고 있었다.** 하네스가 그 값을 review 응답으로 옮기게 하는 중간 단계를 거친 뒤, **짝이 승인된 장면을 번호로 직접 말하도록** 바꿨다 — 그게 라우트가 실제로 보고하는 것이다. 지어낸 필드를 통해 상태를 말하면, 그 필드를 지울 때 짝이 무엇을 재는지 아무도 모른다.
  - 🔴 **픽스처 여덟 곳 중 컴파일러가 잡은 건 하나뿐이었다** — 나머지는 타입 없는 헬퍼가 만드는 객체라 초과 속성 검사가 안 걸린다. 어제 `imagePrompt` 와 **정확히 같은 자리**다. 손으로 찾아 지웠다.
  - 🟠 Cowork 이 492 ④ 에서 제안한 것(`stubFetchByRoute` 값에 타입을 걸거나 타입 붙은 픽스처 헬퍼를 `testUtils` 에 두기)이 **이 부류의 근본 원인**이다. 이번 주 네 번째다(가짜 required 셋 · `imagePrompt` · `castRole` · 이번). 아직 안 했다.
- [x] **막힌 화면이 "상태를 확인해 주세요" 라고만 하던 자리 셋 (Cowork Round 493)**: 대본이 아직 없는 회차(5화, `outline_ready`)를 열어 보고 찾은 부류 — **막혔다고는 말하는데 무엇을 하면 풀리는지는 말하지 않는 화면.** 셋 다 화면이 답을 갖고 있으면서 사람을 딴 데로 보냈다.
  - **영상 화면**: *"에피소드 상태를 확인해 주세요"* — 어디서 확인하라는 말이 없고, **대본이 없는 회차와 진짜로 멈춘 회차에 똑같이** 나온다. 거절이 `LONG_EPISODE_VIDEOS_NOT_ALLOWED` 일 때만 회차를 한 번 더 읽어 **단계를 서버 문장 아래에 붙인다.** 그 조회가 실패하면 **아무 말도 더 하지 않는다** — 모르는 단계를 지어내느니 원래 거절만 남긴다(짝 있음).
  - **이미지 화면**: `isBefore(…, "asset_mapping_approved")` 가 다섯 상태를 다 잡는데 문장은 전부 **매핑**을 가리켰다. 🔴 **`outline_ready` 회차를 매핑 화면으로 보내면 그 화면은 열리지도 않는다**(대본 없는 회차의 매핑 라우트 — 487 에서 내가 고친 그것). **못 가는 단계를 시키는 것은 아무 말 안 하는 것과 같은 실패다.** 3분기로 갈랐다.
  - 🟠 **기존 짝 하나가 잘못된 이유로 초록이었다**(Cowork 발견): *"매핑 승인을 요구한다"* 는 이름의 짝이 픽스처로 `planned` 를 썼다 — 매핑을 요구할 자리가 아니다. 존재 여부만 보고 문구는 안 봐서 통과했다. `waiting_for_asset_mapping_review` 로 바꾸고 문구까지 보게 했다.
  - `STATUS_ORDER` 를 `utils/longEpisodeLabels.ts` 로 올렸다 — **두 화면이 각자 워크플로 순서를 갖는 건 "무엇 다음에 무엇" 을 두고 갈라지는 방법**이다. 이번 주에 목록 사본으로 겪은 것과 같은 부류.
  - 대본 화면의 `이전 기록 0개` → `이전 대본 초안 0개`. 바로 아래 줄이 **앞 회차에서 물려받는 "기록"** 을 말해서, 위가 0이면 *물려받을 게 없다* 로 읽혔다 — 다른 사실이고 대개 거짓이다. **숫자는 늘 맞았고 이름이 없었을 뿐이다.**
  - 새 짝 6개 + 기존 짝 픽스처 교정 2개 전부 통과 확인. 특히 *"says nothing extra when the step itself could not be read"* 는 성공 라우트를 하나도 안 주는 형태라 **화면이 예상 밖 요청을 하나라도 하면 빨개지는데**, 초록이다 — 요청 수 계산이 맞다.
- [x] **🔴 세 번째로 내 커밋이 Cowork 의 작업을 쓸어 담았다 — 이번엔 `git add apps/frontend`**: `d762730` 에 493 의 7파일이 통째로 들어갔다. 앞선 둘은 `git add -A`(`87300f5`, `bfc9090`)였다.
  - **경로로 담아도 디렉터리면 같은 일이 난다.** 규칙을 좁혔다: **내가 실제로 고친 파일만 하나씩 명시**하고, 커밋 전 `git diff --cached` 를 읽는다. 주입 되돌리기는 `git checkout --` 대신 **편집 전 스크래치 사본**으로 한다(그것으로 그쪽 `App.tsx` 를 한 번 날렸다).
  - 🟢 다행히 세 번 다 스위트가 같이 돌아 **검증은 됐다.** 잘못된 것은 **귀속**이다 — 커밋 메시지가 그쪽 작업을 설명하지 않는다.
- [x] **🔴 프롬프트 재설계 ② — 5초 안에 "움직임" 을 셋 시키던 라벨을 고쳤다 (캡틴D 승인, Cowork Round 492 가 제안)**: 캡틴D의 *"부분부분 어색한 파트가 껴있어"* 에 대해 사장님이 원인 후보 셋 중 **③ 프롬프트**를 고르셨고 전부 승인하셨다.
  - **대본 템플릿은 자세를 요구한다**: `start_motion` = *"장면 시작 순간의 자세·시선·이동 상태"*, `end_motion` = *"마지막 1초에 도달해야 할 자세"*. 그런데 프롬프트 라벨은 **움직임**이었다: `Opening movement` · `Main action` · `Ending movement`.
  - **모델은 라벨을 읽는다.** 5초짜리 샷에 movement 가 셋이면 시작하고 멈추고 다시 시작하는 그림이 된다 — 사장님이 말한 그 증상이다. `Starts at` / `Action` / `Ends at` 로 바꿨다: **자세 둘 사이에 동작 하나.** `Continuity cue` 가 앞 장면의 `end_motion` 을 그대로 물려주는 구조와도 맞는다 — "앞 컷이 끝난 자세에서 시작" 이 라벨에 드러난다.
- [x] **🔴 그 라벨 변경이 기존 클립 24개에 거짓 배지를 달 뻔했다 — 낡음 계산을 먼저 고쳤다**: 낡음은 **렌더된 프롬프트 전체**를 비교하고 있었다. 라벨을 바꾸면 캡틴D의 회차 넷 24장면이 전부 배지를 단다:
  > 장면 내용이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다.
  - **장면 내용은 안 바뀌었다.** 확인하지 않은 원인을 단정하는 문장 — 이번 주 내내 걷어낸 바로 그 결함을 내가 만들 뻔했다. 실기록으로 확인했다(4화 기록에 옛 라벨이 그대로 들어 있다).
  - `describesSameScene()` 하나로 **값만 비교하고 라벨·머리말·꼬리말은 안 본다.** 단편·회차 두 낡음 경로가 같이 쓴다. 섹션이 내용을 얻거나 잃으면 여전히 잡힌다(값이 움직이므로), **이름만 바뀌면 안 잡힌다**(사람이 쓴 것 중 달라진 게 없으므로).
  - 🟠 **대가를 적어 둔다**: 라벨만 바뀐 클립은 보고되지 않는다. 그게 정직한 읽기다 — 디스크의 클립은 **같은 장면**에서 나왔고, 새 라벨이 더 낫게 그릴지는 **여기서 어떤 비교로도 알 수 없다.** 다시 뽑아야만 알 수 있고 그건 사람의 돈이다.
  - 짝 둘, 양방향: 라벨만 바뀌면 안 잡고 · 장면이 실제로 편집되면 잡는다. 주입 둘(전체 비교로 되돌리기 · 전부 같다고 하기)에 각각 빨갛다.
  - 🔴 **정정: "캡틴D의 클립 24개" 는 내가 과장한 숫자다.** 그 회차 넷은 전부 `completed` 이고, 회차 낡음을 계산하는 유일한 자리(`review()`)는 `videos_review`·`videos_approved` 에서만 답한다 — **그 24개는 애초에 배지를 달 수 없다.** 확인 안 하고 최악을 말했다.
  - **그래도 수정 자체는 유효하다**: 낡음이 실제로 보이는 자리는 **진행 중인 회차**(리뷰 상태)와 **단편**(이미지 검토·내레이션 검토·장면 편집·영상 작업 네 화면이 `computeSceneStaleness` 를 쓴다)이다. 거기서는 라벨 변경이 그대로 거짓 배지가 됐을 것이다.
  - 🔴 **효과는 유료 회차를 하나 다시 뽑기 전에는 아무도 모른다.** 나는 유료 버튼을 안 누른다.

## 2026-09-05 — 계약·가드·데스크톱 훑기 (CLI 라운드 494~521)

이 아래는 전부 2026-09-05 작업이다. 제목을 붙이는 이유: 바로 위 제목이 **08-30 밤**인데 그 아래로 1,036줄이
쌓여 있었다. `CLAUDE.md` 는 매 세션 이 파일로 현재 상태를 읽으라고 하는데, 그러면 오늘 것이 닷새 전 날짜
아래 묻힌다. **내용은 하나도 옮기지 않았다** — 내 것이 시작하는 자리에만 제목을 넣었다. 그 위의 경계는
남의 작업이라 추측하지 않았다.

무엇을 찾았는지는 아래 항목들이 각각 말한다. 한 줄로 줄이면: **돈에 닿는 필드 세 자리**(유료 실행이 "비용
없음" 이라고 말할 수 있었다), **확인하지 않은 원인을 단정한 화면 세 곳**, **계약의 손글씨 사본 열 곳**,
그리고 **아무도 안 보던 데스크톱 층**(반쯤 복사된 데이터 폴더가 사라진 프로젝트처럼 보였고, 그 실패가 앱을
아예 안 뜨게 했다).

- [x] **픽스처가 지어낸 필드를 만들 수 있던 이유를 막았다 (Cowork Round 492 ④ 가 근본 원인이라 지목한 것)**: 이번 주에 **네 번** 같은 사고가 났다 — 가짜 required 셋(`imageReview`·`videoReview`·`imagePrompt`)이 계약에서 지워진 뒤에도 픽스처에 살아남았고, `castRole` 은 **어떤 코드도 인정하지 않는 값**을 썼다.
  - **팩토리에 타입은 이미 붙어 있었다.** 문제는 그 위치다: 초과 속성 검사는 **타입에 직접 대입되는 리터럴**에만 걸리는데, `.map((n) => ({…}))` 의 리터럴은 **먼저 추론되고 나중에 할당 가능한지만** 본다. 그래서 `function sixScenes(): Scene[]` 안의 리터럴에 없는 필드를 넣어도 **오류 0** 이었다 — 실제로 넣어 보고 확인했다.
  - 콜백에 반환 타입을 붙였다(`.map((number): Scene => ({…}))`). 같은 프로브가 이제 **`TS2353` 로 거부된다** — 세 팩토리 각각 확인했다.
  - 🟠 **손으로 찾던 것을 컴파일러가 찾게 됐다.** `imagePrompt` 를 지울 때 픽스처 열 곳 중 **다섯**, `imageReview`/`videoReview` 때는 여덟 중 **일곱**을 컴파일러가 못 잡아 손으로 뒤졌다. 그 자리들이 이제 막힌다.
  - 🟠 리뷰·미리보기 팩토리에도 같은 구멍이 있지만 사고가 난 자리는 `Scene` 이라 거기부터 했다. 나머지는 같은 방법으로 언제든 좁힐 수 있다.
- [x] **"뒤처졌다" 는 맞고 "장면 내용이 바뀌었다" 는 틀린 자리를 갈랐다**: 이미지 구식 판정은 프롬프트 전체 비교인데, 배지는 *장면 내용이 바뀐 뒤로* 라고 **단정**했다. 그림 방향 네 칸(`visual_style`·`color`·`lighting`·`avoid`)은 **프로젝트 전체**라서 저장 한 번이 모든 장면의 프롬프트를 한 줄씩 바꾼다 — 아무도 장면을 열지 않았는데 전 장면이 "내용 바뀜" 이 된다.
  - **실제 데이터로 쟀다:** 프로젝트 1은 기록된 프롬프트 6개가 **전부 Style 줄을 갖고 있고**, 프로젝트 12의 2~4화는 **18개가 하나도 안 갖고 있다**. 즉 짧은 프로젝트는 스타일 칸을 **고치는 순간**, 에피소드는 **처음 채우는 순간** 24장이 한꺼번에 넘어간다.
  - `imagePromptDrift()` 가 이유를 셋으로 나눈다(`current`/`style`/`scene`). 양쪽 스타일 줄을 뺀 채 비교하므로 **줄이 생긴 경우·바뀐 경우·없어진 경우가 전부 같은 자리**로 간다.
  - 계약에 `styleStale` 추가(짧은 프로젝트 `SceneStaleness`, 에피소드 `LongEpisodeImageStaleness`). 한 장면은 **둘 중 한 곳에만** 들어간다.
  - 배지에 `style` 종류 추가 — `그림 방향 바뀜 · 이미지 다시 필요`, 설명은 `… 장면 내용은 그대로입니다.`
  - 🟠 **기존 짝 하나가 틀린 쪽을 못박고 있었다.** `"reports pictures as behind once a direction they were not drawn with is written"` 는 의도(경고는 떠야 한다)는 옳은데 `imageStale` 을 단언했다. 이름과 단언을 바꾸고 **`imageStale` 이 비어 있는지까지** 보게 했다.
  - 🟢 **주입 검증 양방향:** 항상 `"scene"` 으로 만들면 새 짝 둘이 빨개지고, 항상 `"style"` 로 만들면 장면 편집 짝 넷이 빨개진다. 배지 문구를 `내용 바뀜` 으로 되돌리면 프런트 짝 둘이 빨개진다.
  - 🟠 **장면 편집 화면의 저장 요약에는 안 넣었다** — 거긴 "내 편집이 무엇을 망가뜨렸나" 이고, 장면 편집은 스타일 줄을 건드릴 수 없다. 배지는 붙였다.
- [x] **응답 가드가 계약이 요구하는 목록을 다 보게 했다** (492 ④의 나머지 절반): 위에서 `styleStale` 을 계약에 넣었는데, **가드 두 곳이 그걸 안 보면서 타입만 단정**하고 있었다. 타입 술어는 "이 값은 이 타입이다" 라고 컴파일러에게 말하므로, **안 보는 필드는 화면에서 배열 타입인데 값은 `undefined`** 가 된다 — 이미지 화면은 재생성 뒤 그 목록에 `.filter` 를 건다.
  - `isSceneStaleness` 는 원래부터 **다섯 중 셋**만 보고 있었다(`referenceStale` 도 빠져 있었다). 둘 다 채웠다.
  - 🟢 **가드가 물린다는 증거:** 조이고 나서 프런트 짝 **19개가 한꺼번에 빨개졌다** — 그만큼의 픽스처가 필수 목록을 빼먹고도 통과하고 있었다는 뜻이다.
  - 짧은 프로젝트 이미지 화면 경로에는 **가드가 아예 없다**(`imageReviewApi`). 거기 픽스처는 조여도 조용했을 것이다 — 그래서 픽스처를 리터럴이 아니라 **타입 붙은 헬퍼**(`episodeImageStaleness()` / `sceneStaleness()`)로 바꿨다. 리터럴 서른몇 개가 헬퍼 하나로 모였고, 다음에 필드가 늘면 **컴파일 오류 하나**로 끝난다.
  - 🟢 주입: 두 가드에서 검사를 빼면 새 짝 둘이 빨개진다.
- [x] **짧은 프로젝트의 세 리뷰 클라이언트도 `staleness`·`budget` 을 검증한다**: 에피소드 쪽은 처음부터 둘 다 검증했고 **이유까지 적혀 있었다**("틀린 예산 숫자를 보여 주는 건 안 보여 주는 것보다 나쁘다", "가드가 안 보는 목록은 화면에서 `undefined`"). 짧은 프로젝트의 이미지·내레이션·영상 클라이언트는 **셋 다 아무것도 안 봤다** — 그런데 그 화면들이 정확히 그 경고대로 예산을 출력하고 staleness 목록에 `.filter` 를 건다.
  - 두 필드는 계약상 **선택**이므로 질문은 "있느냐" 가 아니라 **"있다면 그 모양이냐"** 다. `undefined` 는 통과시키고, **있으면서 모양이 틀린 것**만 거절한다.
  - 클라이언트마다 복사하지 않고 `api/contractGuards.ts` 한 자리에 뒀다 — 이 저장소가 이번 주 내내 만난 반대 결과(검사 네 벌, 그중 하나가 한 필드 뒤처짐, 아무도 보고하지 않음)를 피하려고. `styleStale` 이 추가된 바로 그날 가드 **두 곳**이 그걸 안 보고 있던 게 발견됐다.
  - 🟠 **내레이션 클라이언트의 기존 테스트는 거절을 삼키고 있었다**(`.catch(() => undefined)`, 라우트만 확인). 그래서 거기엔 짝을 새로 넣었다 — 없었으면 검사를 빼도 아무도 몰랐다.
  - 🟢 주입: 공용 가드에서 목록 검사를 빼면 짝 셋이 빨개지고, 두 클라이언트에서 호출을 빼면 각자의 짝이 빨개진다.
- [x] **그림 방향이 "저장한 대로" 프롬프트에 닿는지 확인했다 (479의 마지막 이음매)**: 기존 짝들은 양쪽을 각각 확인하면서, 반대편은 **손으로 쓴 픽스처**로 대신하고 있었다 — 에피소드 테스트는 `visual_style` 을 project.json 에 직접 써넣고, 짧은 프로젝트 테스트는 `lore_context.style_notes` 를 직접 대입한다. **읽는 쪽은 증명되고 쓰는 쪽은 증명되지 않는다.**
  - 두 저장기 모두 **화이트리스트로 다시 짜는** 모양이다(이 저장소에서 필드를 세 번 조용히 떨어뜨린 그 모양). 짧은 프로젝트 쪽은 거기에 **키 이름까지 바꾼다**(`visualStyle` → `visual_style`).
  - 손으로 쓴 중간을 걷어낸 짝 둘을 넣었다: 설정 서비스로 저장 → 생성 → 프롬프트에 `Style:`/`Avoid:` 가 있는지.
  - 🟢 주입: 에피소드 저장기(`setStored`)에서 네 필드를 빼면 **새 짝만** 빨개진다 — 그 자리는 지금까지 아무도 안 보고 있었다는 뜻이다. 짧은 프로젝트의 이름 바꾸기를 빼면 새 짝과 기존 매핑 짝이 **둘 다** 빨개진다(그건 이미 지켜지고 있었다).
- [x] **영상도 같은 거짓 원인이 있었다 — 다만 짧은 프로젝트에만 있었다**: 영상 프롬프트의 **첫 줄**이 `Create one continuous cinematic {클립 길이}-second {화면 방향} …` 인데, 둘 다 **프로젝트 전체 설정**이다. 그런데 `describesSameScene` 의 주석은 *"고정된 접두·접미는 비교하지 않는다"* 고 적혀 있었다 — **접두는 고정이 아니다.**
  - 🟢 **먼저 실행해서 확인했다:** 장면 두 개를 생성해 두고 **클립 길이만** 5→10 으로 바꾸니 `videoStale` 이 `[]` → `[1,2]` 가 됐다. 디스크에는 그 줄을 가진 기록된 영상 프롬프트가 **36개** 있다.
  - `videoPromptDrift()` 가 `current`/`format`/`scene` 을 가른다. 계약에 `videoFormatStale`, 배지에 `format` 종류(`영상 길이·방향 바뀜`).
  - 🔴 **에피소드는 도달 불가능하다 — 그래서 넣었다가 도로 뺐다.** 에피소드의 클립 길이는 **자기 스냅샷**(`duration_seconds`)이고 그걸 고치는 유일한 경로는 **대본이 있으면 거부**한다(영상에는 승인된 대본이 필수다). 화면 방향은 살아 있는 설정에서 읽지만 **비율 변경은 이미지 이전 단계를 지난 회차가 하나라도 있으면 잠긴다.** 채워질 수 없는 목록을 계약에 남기지 않고, **이유를 `LongEpisodeVideoStaleness` 주석에 적었다** — 다음 사람이 다시 넣지 않도록.
  - 🟠 영상 배지는 **짝이 아예 없었다**. 두 문장 다 이번에 처음 고정됐다.
  - 🟢 주입: 항상 `"scene"` 이면 새 짝 하나, 항상 `"format"` 이면 장면 편집 짝 다섯이 빨개진다. 배지 문구를 `내용 바뀜` 으로 되돌리면 프런트 짝이 빨개진다.
- [x] **커버가 원하는 데로 안 됐다는 보고를 끝까지 따라갔다 — 앱 쪽은 전부 맞다**: 실제 기록과 파일로 확인했다.
  - 4화 게시 기록에 `thumb_offset_ms = 20502` 가 **실제로 들어 있다**(2026-09-04 06:51 게시). 값이 안 갔던 게 아니다.
  - 그 영상은 `ffprobe` 로 **30.22초** — 20.5초는 범위 안이다.
  - 미리보기가 재생하는 파일과 업로드되는 파일이 **같은 파일**이다(`videos/final/instagram_reel.mp4`). 고른 시점이 다른 타임라인을 가리킬 여지가 없다.
  - Meta 문서 확인: `thumb_offset` 은 **릴스에 적용되고 단위는 밀리초**다. **`cover_url` 을 같이 보낼 때만 무시된다** — 우리는 안 보낸다.
  - 어댑터 짝도 이미 있다(컨테이너 본문에 `thumb_offset`, 서비스 본문, 기록까지).
  - 🟠 **그래서 남은 원인은 인스타그램 쪽이고, 이 앱은 그걸 볼 수 없다.** 게시된 미디어를 되읽지 않으므로 **커버가 맞은 경우와 틀린 경우가 여기서는 똑같이 보인다.** 확인 패널은 커버를 *보고*하는 게 아니라 *약속*한다.
  - 어댑터 주석에 확인된 사실과 **`cover_url` 함정**을 적었다 — 나중에 커버 이미지 기능을 얹으면 프레임 선택이 조용히 무력화된다.
- [x] **"이미지 이전 상태" 목록의 네 번째 사본을 접었다 (Cowork 493 ③의 백엔드 절반)**: `longEpisodeHasImages` 주석에 *"그런 목록이 셋 있었다"* 고 적어 놨는데, **넷이었다** — `episode-story-bible-mapping-sync.ts` 가 일주일 뒤에 같은 목록을 다시 적어 놓고 있었다. 공용 헬퍼로 바꾸고 주석을 사실대로 고쳤다.
  - 🟠 **비슷한 이름 하나는 일부러 다르다.** `long-projects.service.ts` 의 목록은 한 항목이 짧은데(`generating_images` 없음) **다른 질문**에 답한다 — "그림이 있는가" 가 아니라 **"생성이 시작됐는가"** 다(이미 돈을 쓰는 중이면 비율을 잠가야 한다). 이름을 `BEFORE_IMAGE_GENERATION_STARTS` 로 바꾸고 **합치지 말라고** 양쪽 주석에 적었다.
  - 🔴 **`generating_images` 상태에 짝이 하나도 없었다.** 공용 목록에서 그 항목만 빼도 두 앱 어디도 빨개지지 않았다 — 호출자 셋이 전부 답을 바꾸는데도.
  - 🟠 **내 예상이 틀려서 고쳤다.** "생성 중인 회차는 건드리면 안 된다" 고 짝을 쓰다가, 실제로는 **건드려도 안전**하다는 걸 확인했다: 생성은 시작 시점에 매핑을 한 번 읽고 프로젝트 락을 잡으므로 진행 중인 그림에는 닿지 않는다. 제외하면 오히려 **Story Bible 연결이 조용히 안 닿는다.** 짝을 현재 동작을 고정하는 쪽으로 바꾸고 이유를 적었다.
  - 🔴 **검증 방법 자체의 오류도 하나 찾았다:** `packages/shared` 는 `dist` 로 해석되므로, **거기 주입한 뒤 빌드하지 않으면 백엔드 테스트는 옛 사본을 본다.** 두 번 "주입이 안 문다" 고 볼 뻔했다. shared 에 주입할 때는 `npm run build --workspace @ai-animation-studio/shared` 를 먼저 돌린다.
- [x] **프런트의 워크플로 순서가 정본의 손글씨 사본이었다 (502의 이어짐)**: 백엔드에는 *"상태 목록을 통째로 다시 적은 파일"* 을 막는 감시가 있고(임계값 12), 그 이유까지 적혀 있다 — `interrupted` 에서 멈춘 사본 하나가 **완성된 회차의 매핑 라우트 두 개를 500으로** 만든 적이 있다. **프런트에는 그 감시가 없다.** 그래서 `LONG_EPISODE_STATUS_ORDER` 가 18개 중 **16개를 손으로 적은 채** 아무에게도 안 보였다.
  - 정본에서 **파생**하도록 바꿨다(off-the-line 둘만 제외). 상태가 늘면 **저절로** 들어온다.
  - 🟠 파생은 "빠짐" 은 막지만 **"엉뚱한 자리에 끼워 넣음"** 은 못 막는다. 그래서 순서를 **한 곳에만** 적어 두는 짝을 넣었다 — 워크플로가 바뀌면 그 한 줄이 빨개진다.
  - `LONG_EPISODE_STATUSES` 주석에 **순서가 의미를 갖는다**고 명시했다(끝에 붙이지 말 것).
  - 🟢 주입: 새 상태를 목록 끝에 붙이면 짝 **둘**이 빨개진다. 전에는 조용히 빠졌다.
  - 이 파일에는 짝이 아예 없었다 — 라벨·`isBefore` 경계(자기 자신은 before 아님, 멈춘 실행은 어디에도 속하지 않음)도 이번에 처음 고정됐다.
- [x] **프런트에 남은 정본 사본을 훑어서 지웠다 (503의 이어짐)**: 백엔드에만 있는 감시를 프런트에 그대로 옮기는 대신, **먼저 재 봤다** — 공용 계약의 상수 배열들을 프런트 소스 전부와 대조했다.
  - 나온 것: `longProjectsApi.ts` 가 **18개 상태를 통째로** 손으로 적은 `Set` 을 응답 가드로 쓰고 있었고, `audioLibraryApi.ts` 가 **라이선스 5종**을 다시 적고 있었다. 둘 다 **읽는 쪽 가드**다 — 계약에 값이 하나 늘면 **멀쩡한 응답을 "서버 응답을 확인할 수 없습니다" 로 거절**한다.
  - 둘 다 공용 상수에서 만들도록 바꾸고, **계약이 허용하는 모든 값이 클라이언트를 통과하는지** 보는 짝을 넣었다. (2엔트리 게이트 `OUTLINE_STATUSES` 는 사본이 아니라 결정이라 그대로 뒀다.)
  - `LongProjectDetail.tsx` 의 "다음 화면" 스위치는 사본이 아니라 상태별 매핑이었는데, `default: return null` 이 오늘은 **도달 불가능**하고 상태가 늘면 **버튼이 조용히 사라진다** — 주석이 말하는 *"이 회차는 고장 난 것처럼 보인다"* 가 그대로 돌아온다. `never` 로 막아 **컴파일 오류**가 되게 했다.
  - 🟢 주입: 각 가드에서 계약 값 하나를 빼면 새 짝 둘이 빨개진다. 공용 목록에 상태를 하나 더하면 **컴파일이 두 곳에서 멈춘다**(스위치, 라벨 표).
- [x] **백엔드에도 같은 측정을 돌려 저장 파서의 사본 넷을 지웠다**: 계약의 값 집합을 백엔드 소스 전부와 대조했다. 나온 것은 전부 **디스크를 읽는 쪽**이다.
  - `mapping-storage.ts` 가 매핑 상태 6종·배정 출처 4종·버전 정책 3종을 **각각 통째로** 다시 적고 있었다. `legacy-reference-migration.service.ts` 는 에셋 종류 5종을 다시 적었다.
  - **근본 원인은 계약에 런타임 배열이 없어서였다** — 유니온 타입만 있으니 읽는 쪽은 손으로 적을 수밖에 없다. `asset.ts` 의 `ASSET_TYPES` 가 쓰는 방식(배열이 원본, 타입은 파생)을 `mapping.ts` 의 세 유니온에도 적용했다.
  - 🔴 **실패 방향이 비싼 쪽이다.** 값이 하나 늘면 기능이 빠지는 게 아니라 **그 값을 가진 저장 파일이 통째로 안 읽힌다** — 병합이 쓴 값을 자기 저장 스키마가 되읽지 못해 프로젝트가 목록에서 사라진 그 사고와 같은 모양이다(Cowork Round 436). 마이그레이션 쪽은 더 조용하다: 거부가 아니라 **`general_reference` 로 잘못 옮긴다.**
  - 계약이 허용하는 **모든 값이 왕복하는지** 보는 짝을 넣었다. 🟢 주입: 읽는 쪽에서 값 하나를 빼면 빨개진다.
  - 🟠 짝 주석에 `D-436` 이라고 적었다가 **`decision-doc-references` 감시에 걸렸다** — 그건 결정 문서 번호가 아니라 라운드 번호다. 저장소가 스스로를 지킨 자리.
  - 2~4엔트리 게이트(`OUTLINE_STATUSES`, `ATMOSPHERE_ASSET_TYPES`, `SCENE_REFERENCE_ASSET_TYPES`)는 사본이 아니라 **결정**이라 그대로 뒀다.
- [x] **손으로 찾던 사본을 감시가 찾게 했다 — 그리고 감시가 다섯 개를 더 찾았다**: 오늘 두 앱에서 사본 6개를 손으로 찾았으니, 다시 생기지 않게 **양쪽에 감시**를 세웠다(백엔드엔 에피소드 상태 하나만 보는 감시가 있었고, 프런트엔 아예 없었다).
  - 계약의 **모든** 값 집합(5개 이상)을 소스 전부와 대조한다. **파일 전체가 아니라 대괄호 하나 안에서** 센다 — 다섯 곳에 흩어 쓴 파일은 목록을 적은 게 아니고, 한 리터럴에 모은 파일은 적은 것이다. 파일 단위로 세면 스위치 셋과 좁은 게이트 둘이 오탐으로 걸렸다.
  - 🔴 **세우자마자 다섯 개를 더 찾았다** — 제 손 sweep 이 `api.ts` 의 배열만 봐서 놓친 것들이다:
    - `assetsApi.ts` — 에셋 종류 5종 **과** 상태 6종(응답 가드)
    - `mappingsApi.ts` — 매핑 상태 6종(응답 가드)
    - `AssetLibraryScreen.tsx` · `AudioLibraryScreen.tsx` — 종류/라이선스 옵션 목록
    - `LongProjectDetail.tsx` — 단계별 누적 집합 **셋**
  - 화면 쪽 둘은 `Record<...>` 로 바꿔 **컴파일러가 라벨 누락을 잡게** 했다. 옵션 배열은 계약 배열에서 파생한다.
  - `LongProjectDetail` 의 누적 집합 셋은 **워크플로 순서에서 파생**하게 했다(동일함을 먼저 계산해 확인). 손글씨였을 때는 상태가 늘면 셋 다에서 빠져 **숫자가 거꾸로 줄어든다** — 그 패널 주석이 피하려고 만든 실패 그대로다.
  - 🟠 게이트 하나(`BEFORE_IMAGE_GENERATION_STARTS`)는 7개 중 6개라 비율로는 구분이 안 된다. `atomic-write-coverage` 가 쓰는 방식대로 **이유를 붙인 예외**로 두고, **예외가 이유보다 오래 살지 못하게** 하는 짝도 같이 넣었다.
  - 🟢 주입: 사본을 되돌리면 각 앱의 감시가 빨개진다.
- [x] **서버가 셋으로 갈라 준 원인을 화면이 버리고 있었다 — 내가 만들고 안 붙인 것**: 선택 필드 106개를 훑어 *"백엔드가 쓰는데 프런트가 안 읽는 것"* 을 재 봤다. 여섯 개가 나왔고 그중 `unavailableReason` 이 제일 나빴다.
  - 연속성 참고가 없을 때 화면은 셋 다 **"이전 에피소드의 마지막 장면 자료가 아직 없어서"** 라고 단정했다. 서버는 이미 세 가지를 구분해서 보낸다:
    - `not_finished` — 아직 거기까지 안 갔다 → 그 문장이 맞다
    - `image_unreadable` — **끝났는데 그림 파일을 못 읽는다** → "아직 없다" 는 **틀린 말**이다
    - `unreadable` — **기록 자체를 못 읽는다** → 답이 아니라 **모른다**는 뜻인데 아는 척한다
  - 세 문장으로 갈랐고, 뒤 둘은 색도 다르게 했다(회색=아는 부재, 호박색=확인 못 함). 옆에 이미 있는 "확인하지 못했습니다" 줄과 같은 태도다.
  - 가드가 `unavailableReason` 을 **검사하지 않고 있었다** — 계약에 없는 값이 와도 통과해서 화면이 그 값에 대해 문장을 골랐다. 셋 중 하나가 아니면 이제 거절한다.
  - 🟢 주입: 세 문장을 하나로 되돌리면 짝 둘이, 가드에서 검사를 빼면 짝 하나가 빨개진다.
  - 🟠 남은 다섯(`completedAt`·`fadeSeconds`·`generatedVideoPath`·`openablePath`·`volume`)은 아직 안 봤다 — 죽은 필드인지 안 붙인 화면인지 하나씩 확인해야 한다.
- [x] **선택 필드도 감시가 보게 했다 — 507을 찾아낸 방법을 손에서 떼어 냈다**: 필수 필드는 컴파일러가 지키고 선택 필드는 아무도 안 지킨다. 계약이 선언한 선택 필드 중 **어느 화면도 읽지 않는 것**이 있으면 빨개진다.
  - 🟢 주입: 프런트에서 `unavailableReason` 을 읽지 않게 되돌리면 **그 이름 하나만** 잡아낸다 — 오늘 손으로 찾은 결함을 그대로 재현한다.
  - 판정은 **일부러 느슨하다**(이름이 소스 어딘가에 나오기만 하면 통과). 우연히 겹치면 감시가 약해질 뿐이고, 강하게 만들면 오탐이 난다. 잡으려는 건 **어디에도 없는 필드**다.
  - 예외 다섯, 이유별로 구분해서 적었다:
    - **결정**: `completedAt`(응답이 아니라 저장 레코드), `generatedVideoPath`(화면은 경로가 아니라 콘텐츠 URL로 재생한다)
    - **아직 안 한 것**: `openablePath`(에피소드 병합 화면에 폴더 열기 버튼이 없다 — 짧은 프로젝트엔 있다), `volume`·`fadeSeconds`(서버는 받고 기본값까지 문서화돼 있는데 조절 수단이 없다)
  - **예외가 이유보다 오래 살지 못하게** 하는 짝도 같이 넣었다 — 누가 그 화면을 붙이면 예외가 빨개진다.
  - 🟠 `\b` 를 템플릿 리터럴에 쓰면 **백스페이스 문자**가 된다. 처음에 그렇게 써서 101개가 전부 "안 읽힘" 으로 나왔다. 정규식을 버리고 부분 문자열로 바꿨다.
- [x] **에피소드 병합 화면에 폴더 열기 버튼을 붙였다 (508에서 "안 한 일" 로 판정한 것)**: 짧은 프로젝트에는 병합 화면이 생긴 날부터 있던 버튼인데, 에피소드는 **경로를 보여 주기만** 했다 — 캡틴D는 에피소드를 훨씬 많이 만드신다.
  - 계약이 이미 그 자리를 만들어 놨다: `openablePath` 는 *"화면이 그대로 넘긴다"* 고 적혀 있고(에피소드 디렉터리 구조는 한 곳에만 있어야 하므로 화면이 경로를 조립하면 그게 두 번째 사본이 된다), **아무도 안 넘기고 있었다.**
  - 🟠 **여는 값이 무엇이냐가 중요하다.** `finalVideoPath`(에피소드 기준, 화면 표시용)와 `openablePath`(프로젝트 루트 기준, 브리지가 받는 값)는 **다르다**. 표시용을 넘기면 **아무것도 안 열리는데 버튼은 성공한 것처럼 보인다.** 짝이 인자까지 확인한다.
  - 🟠 그 화면 테스트 픽스처가 **필수 필드 `openablePath` 를 빼먹고** 있었다 — `jsonResponse` 에 넘긴 본문은 `unknown` 이라 아무도 말해 주지 않았다. 495·497에서 막은 그 구멍의 남은 절반(라우트별 응답 타입)이 아직 없다는 증거다.
  - 🟢 508의 예외 목록에서 `openablePath` 를 **뺐다**. 예외가 이유보다 오래 살지 못하게 하는 짝이 그걸 요구한다.
  - 🟠 살아 있는 앱에서 버튼 위치·문구는 Cowork 확인이 필요하다. 짧은 프로젝트와 같은 모양으로 맞췄다.
- [x] **응답 픽스처 팩토리에 계약 타입을 붙였다 (492 ④의 남은 절반, 값싼 형태)**: 라우트 키(`"POST /..."`)와 응답 타입을 잇는 건 동적 문자열이라 정적으로 못 한다. 그런데 **테스트마다 이미 응답 팩토리가 있었고, 절반은 타입이 안 붙어 있었다** — 구멍이 난 자리는 전부 안 붙은 쪽이다.
  - 붙이자마자 **서버가 만들 수 없는 픽스처 셋**이 드러났다:
    - 에피소드 병합·내레이션 화면의 `episode()` 가 **필수 `updatedAt` 없음**
    - 연속성 화면의 `nextEpisode` 가 **계약에 없는 필드 셋**(`approved`·`scriptRevision`·`scriptHistoryCount`)을 지어냄 — 그건 `LongEpisodeDetail` 의 것이지 `LongEpisodeOutline` 의 것이 아니다
    - 상태 인자가 `string` 이라 아무 문자열이나 받던 자리 둘
  - 🟢 주입: 509에서 손으로 찾은 그 결함(`openablePath` 를 픽스처에서 뺌)이 이제 **컴파일 오류**다.
  - 🟠 아직 `jsonResponse(200, { ... })` 에 인라인으로 쓰는 본문은 여전히 `unknown` 이다. 팩토리를 통하는 것만 지켜진다 — 완전한 해법(라우트별 응답 타입)은 프런트 하네스 구조라 그쪽 층이다.
- [x] **🔴 유료 실행을 "비용 없음" 이라고 말할 수 있는 구멍이 열려 있었다**: 응답 가드가 계약의 **필수** 필드를 다 보는지 재 봤다. 측정 자체는 시끄러웠지만(위임하는 가드까지 누락으로 잡는다) 그 안에 진짜가 있었다.
  - `paidProvider` 를 **양쪽 진행 상황 가드가 전부 안 보고 있었다**(짧은 프로젝트 `isGenerationProgressResponse`, 에피소드 `isEpisodeVideoProgress`). 에피소드 쪽은 `sceneNumbers` 도 빠져 있었다.
  - 🔴 **결과가 정확히 그 필드가 막으려던 것이다.** 값이 없으면 화면에서 `undefined` → falsy → **"Runway 키가 연결되어 있지 않아 비용 없이 임시 영상으로 만들어집니다"**. 계약 주석과 화면 주석이 **둘 다** *"없음을 무료로 읽으면 안 된다"* 고 적어 놓은 그 문장이다(전에 비용 줄 유무로 추론하다 같은 사고를 냈고, 그래서 필수 필드로 만들었다).
  - 🟢 **규모:** 가드를 조이자 프런트 짝 **14개**가 빨개졌다 — 그만큼의 픽스처가 유료 여부 없이 진행 상황을 보내고 있었다.
  - 거절이 맞는 답이다. 화면에는 이미 *"아직 확인하지 못했습니다"* 가 있고, 필수 필드가 빠진 응답은 **가격을 모르는 실행이 아니라 읽을 수 없는 서버**다. 짝이 그걸 고정한다(주변의 짝 둘은 값이 **왔을 때** 무엇을 하는지만 봤다 — 안 온 경우는 아무도 안 봤다).
  - 🟠 이 측정을 감시로 만들지는 **않았다**. 위임·목록 가드 때문에 오탐이 30건이라, 그대로는 예외 목록이 감시보다 커진다. 손으로 훑어 진짜 하나를 꺼낸 것으로 끝냈다.
- [x] **`paidProvider` 의 세 번째 자리 — 돈이 나가는 바로 그 순간**: 511에서 진행 상황 가드 둘을 고치고, 같은 필드가 선언된 나머지 한 곳을 마저 봤다. `StartLongEpisodeVideoGenerationResponse` 다 — 그 필드 주석이 *"시작과 첫 폴링 사이의 추측을 없애려고 여기에도 답한다"* 고 적어 놓은 자리인데, **가드가 안 보고 있었다.** 화면은 그 값을 곧장 작업 상태에 넣는다. 픽스처 **넷**이 그 필드 없이 시작 응답을 보내고 있었다.
- [x] **에피소드 화면이 서버의 답을 받아 놓고 안 읽고 있었다**: `paidProvider` 를 작업 상태에 넣기만 하고 **한 번도 읽지 않은 채**, *"연결되어 있으면 유료, 아니면 무료"* 라는 **양쪽 다 말하는 문장**을 띄우고 있었다. 실행이 시작되기 전이면 그건 정직하다(아무것도 시작 안 했으니). **시작된 뒤에는 아니다** — 이미 쓴 돈에 대해 어느 쪽인지를 사람이 알아내게 만든다. 짧은 프로젝트는 답을 말한다. 이제 여기도 말한다.
  - 🟢 주입: 두 갈래 문장으로 되돌리면 새 짝이 빨개진다.
- [x] **비용 관련 필드를 전부 훑고, 그러다 죽은 계약 타입 둘을 지웠다**: 511·512로 `paidProvider` 를 닫은 뒤, 이름에 cost/usd/budget/paid/calls 가 들어간 계약 필드 **36개**를 훑어 클라이언트 가드가 언급조차 안 하는 게 있는지 봤다. 남은 건 `ApiUsageRecord.actualCostUsd` 하나인데 그건 **응답이 아니라 원장 레코드**라 화면이 읽을 것이 아니다. **돈에 닿는 필드는 이제 다 지켜진다.**
  - 그 과정에서 `VideoGenerationPreviewResponse.budget` 이 **필수**인데 가드로 쓰이는 `isBudgetPreview` 는 `undefined` 를 통과시킨다는 걸 발견하고 파고들었더니 — **그 타입을 아무도 안 쓴다.** 선언 한 줄이 전부다.
  - 같이 죽어 있던 `VideoScenePreview` 와 함께 지웠다. 지운 이유가 정리 때문만은 아니다:
    - 살아 있는 짝(`GetVideoPromptPreviewResponse`/`VideoPromptPreview`)과 **필드 선택성이 다르다** — 베끼기 좋은 자리다. 실제로 내가 방금 거기 시간을 썼다.
    - `VideoScenePreview` 는 공개 응답 타입에 **`imagePath` 를 모델링**한다. 이 저장소는 파일 경로를 공개하지 않기로 했고(짝이 `C:\` 가 화면에 없는지까지 본다), 죽은 타입은 그걸 따라 하기 좋은 본보기다.
  - 🟠 "참조 없는 내보내기" 를 감시로 만들지는 **않았다**. 301개 중 23개가 걸리는데 대부분은 shared 내부 구성 요소이거나 **요청 형식을 문서화한 타입**이다 — 그건 죽은 게 아니라 적어 둔 계약이다. 측정이 그 둘을 구분하지 못하므로 감시로 세우면 예외가 규칙을 삼킨다.
- [x] **실제 데이터 감사: 돈 주고 만든 결과물이 기록과 어긋나는 데는 없다 (읽기만, 유료 호출 없음)**: 계약 쪽을 훑을 만큼 훑어서, 디스크의 진짜 프로젝트를 봤다 — 회차 상태와 파일, 그리고 **유료 클립 기록마다 실제 파일이 있는지**. 회차당 $1.50 을 잃은 그 실패가 어딘가 남아 있는지가 핵심 질문이다.
  - 결과: **유료 클립 30개**(12번 프로젝트 4회차 × 6 + 짧은 프로젝트 1번 × 6) 전부 실물이 있고 크기도 정상(1.3~4.0MB), 완성 표시된 회차 넷 다 최종 영상이 있고, 짧은 프로젝트도 병합 파일이 있다. **잃어버린 유료 작업 없음.**
  - 🟠 **찾았다고 두 번 잘못 말할 뻔했다.** 처음엔 기록 키를 `task_id` 로 봐서(실제는 `runway_task_id`) "유료 클립 0" 이 나왔고, 그다음엔 짧은 프로젝트가 클립을 `videos/runway/` 에 둔다는 걸 몰라서 "여섯 개 전부 없음" 이 나왔다. **둘 다 내 측정 오류였다.** 저장 구조를 먼저 읽고 나서 세는 것이 맞다 — 특히 "돈이 사라졌다" 는 결론은 확인 전에는 절대 적지 않는다.
- [x] **데스크톱 경로 검증의 가장 결과가 큰 입력에 짝을 붙였다**: 509에서 에피소드 병합 파일을 데스크톱 브리지로 넘기기 시작했으니, 받는 쪽을 봤다. `resolveProjectPath` 자체는 견고하다 — 안전한 프로젝트 id, 루트 안, 프로젝트 폴더 안, 전부 **해석된 경로**로 확인한다.
  - 그런데 짝에는 `..` 로 빠져나가는 경우만 있었다. **절대 경로는 빠져나갈 필요가 없다** — `path.resolve` 는 기준을 버리고 그대로 돌려준다. 지금 코드는 그걸 잡지만, 그걸 확인하는 짝이 없었다.
  - 절대 경로(`C:\Windows\System32`), POSIX 절대 경로(`/etc/passwd`), UNC(`\server\share`)를 넣는 짝과, 509에서 보내기 시작한 **에피소드 경로 모양**(한 단계 더 깊음)을 넣는 짝을 추가했다.
  - 🟢 주입: 검사를 **해석된 경로 대신 원본 문자열의 `..` 로** 바꾸면(정확히 주석이 경고하는 리팩터) 데스크톱 스위트가 빨개진다. 전에는 그 리팩터가 전부 초록으로 통과했다.
  - 데스크톱은 vitest 가 아니라 `node --test` 로 돈다(스위트 29개).
- [x] **🔴 데스크톱 사용자 데이터 이전: 한 번 실패하면 "프로젝트가 사라진 것처럼" 보였다**: 515에서 데스크톱을 읽다가 사용자 데이터를 옮기는 코드까지 갔다. 그 함수는 아주 조심스럽게 짜여 있다(아무것도 안 지우고, 복사 실패해도 원본을 남긴다). 그런데 두 가지가 빠져 있었다.
  - 🔴 **부분 복사본이 "이전 완료" 로 읽힌다.** 다른 드라이브면 rename 이 실패해서 복사로 넘어가는데, 그 복사가 중간에 실패하면 새 경로에 **반쯤 채워진 폴더**가 남는다. 다음 실행의 *"새 경로에 뭔가 있으면 손대지 않는다"* 검사가 그걸 **끝난 이전**으로 읽는다. 앱은 부분 데이터 위에서 열리고, 전체는 옛 경로에 그대로 있다. **바이트는 하나도 안 잃었는데 사람이 보는 건 사라진 프로젝트다.**
    - 임시 폴더(`<새경로>.migrating`)에 복사한 뒤 **제자리로 rename** 한다. 새 경로는 **없거나 완전하거나** 둘 중 하나다. 실패하면 임시 폴더를 지우고 다음 실행이 다시 시도한다. 마지막 rename 은 새 경로와 같은 폴더 안이라 드라이브를 넘지 않는다.
  - 🔴 **실패하면 앱이 아예 안 떴다.** 이 이전은 창과 IPC 등록 **앞**에서 돈다. 던지면 `whenReady` 체인이 거기서 끝나서 **창도 핸들러도 없다** — 사용자에게는 그냥 안 켜지는 앱이다. 이제 잡아서 **어디에 데이터가 있는지 말하고** 계속 뜬다.
  - 🟢 주입: 새 경로로 곧장 복사하도록 되돌리면 짝 둘이 빨개진다. 데스크톱 30개 통과.
- [x] **재시작 예산을 다 쓰면 아무도 몰랐다**: 백엔드 프로세스 관리자는 예기치 않게 죽으면 정해진 횟수만큼 다시 띄우고(무한 크래시 루프 없음), **다 쓰면 그냥 `return`** 했다. 그러면 셸에는 **돌아오지 않을 서버를 가리키는 창**만 남는다 — 화면마다 요청이 하나씩 실패하는데 왜인지는 아무 데도 안 나온다.
  - 이 디렉터리가 **같은 모양을 이미 두 번** 고쳤다(`production-startup.ts` 가 그 이름으로 존재하는 이유가 그거다: `return` 하나가 빠져서 죽은 백엔드 위에 창을 열었다).
  - `onGaveUp` 을 붙이고 셸이 말하게 했다. **일부러 종료는 안 시킨다** — 시작 실패는 볼 게 없으니 종료가 맞지만, 여기서는 사람이 작업 중이었다. 읽기 전에 화면을 뺏는 대신, 앱은 열린 채로 **쓸모없지만 정직하게** 남는다.
  - 한 번만 알린다(플래그). 다시 띄우지 않으니 두 번째 종료가 올 일은 없지만, 대화상자를 띄우는 호출자는 **두 번 뜰 수 있으면 안 된다**.
  - 🟢 주입: 알림을 도로 빼면 짝이 빨개진다. 의도적인 `stop()` 은 실패가 아니므로 안 알린다는 짝도 같이 넣었다. 데스크톱 32개 통과.
- [x] **🔴 에피소드는 프롬프트가 잘려도 말하지 않았다 — 돈 내고 만드는 쪽인데**: 프롬프트 ①(Pacing) 결정을 다시 들여다보다가, `promptFor` 가 **길이 한계를 맞추려고 섹션을 정해진 순서로 버리고 그 목록을 돌려준다**는 걸 봤다. 짧은 프로젝트 미리보기는 그 목록을 **처음부터 보여 준다.** 에피소드는 `.prompt` 만 쓰고 **목록을 버렸다.**
  - 🔴 **한계에 가까운 쪽이 조용한 쪽이다.** 실제 데이터로 쟀다: 에피소드 프롬프트 **493~902자**, 짧은 프로젝트 **599~732자**, 한계 **1,000자**. 먼저 넘을 쪽은 에피소드이고, 넘으면 **`Pacing` 이 가장 먼저** 소리 없이 빠진다. 그 뒤에 장면당 $0.25 를 낸다.
  - 계약에 `LongEpisodeVideoPreview.omittedSections` 추가, 서비스가 목록을 유지, 가드가 검사, 화면이 **짧은 프로젝트와 같은 문장**으로 말한다.
  - 라벨 표(`Pacing` → `움직임 속도` 등)를 화면에서 `utils/omittedSectionLabels.ts` 로 뺐다 — 두 화면이 같은 표를 쓰게 됐고, **표 두 벌은 이 저장소가 이미 겪은 실패**다(매핑 상태 라벨이 그렇게 갈렸다).
  - 🟢 주입: 에피소드가 목록을 도로 버리게 하면 백엔드 짝이 빨개진다.
  - 🟠 짝의 단언을 **첫 이름만** 보게 했다. 몇 개가 잘리는지는 프롬프트 문구 길이에 달려 있어서, 개수를 못박으면 라벨 하나 바뀔 때마다 아무 문제 없이 빨개진다.
- [x] **승인 한 번이 다른 장면의 배지를 지우지 못하게 고정했다**: 짧은 프로젝트와 에피소드의 계약 짝을 전부 대조하다가(그 차이가 세 번 연속 결함을 냈으므로) `staleness` 가 **에피소드에선 필수, 짧은 프로젝트에선 선택**인 걸 봤다. 파고드니 이유가 있었다 — **승인·재생성 응답에는 안 실리고 리뷰 GET 에만 실린다**(필드 주석이 정확히 그렇게 말한다).
  - 그래서 두 화면은 **이전 staleness 를 일부러 유지**한다: `staleness: current.status === "ready" ? current.staleness : undefined`. **오늘은 배지가 안 사라진다.**
  - 🟠 그런데 그 줄이 **주석도 짝도 없는 암묵적 불변**이었다. `staleness: response.staleness` 는 **컴파일되고, 더 짧고**, 사람에게 *"다른 장면은 이제 문제 없다"* 고 조용히 말한다 — 정리하다 넣기 딱 좋은 모양이다.
  - 이미지·영상 두 화면에 짝을 넣었다: 3번이 구식인 상태에서 2번을 확정해도 **3번 배지는 남는다.**
  - 🟢 주입: 두 화면 각각에서 그 "정리" 를 넣으면 해당 짝이 빨개진다.
- [x] **재생성이 **그 장면의** 배지만 지우는지도 고정했다**: 520에서 승인 쪽을 고정하고, 같은 모양의 나머지 자리를 훑었다. `current.staleness` 를 이어받는 곳은 네 군데 — 이미지(승인·재생성), 영상(승인), 내레이션(재생성) — 인데 내레이션과 이미지 재생성은 **주석이 이미 있었고** 승인 둘만 없었다(그래서 520에서 그 둘을 고정했다).
  - 남은 구멍은 **주석은 있는데 짝이 없는** 이미지 재생성이었다. 재생성은 그 장면을 방금 현재 대본으로 다시 만들었으니 **그 장면의** 배지는 지워야 하고, **다른 장면 것은 건드리면 안 된다** — 그 장면들에 대해서는 아무것도 알아낸 게 없다.
  - 🟢 주입: 그 장면만이 아니라 목록을 통째로 비우면 짝이 빨개진다. 사라지는 배지는 **돈 주고 만든 그림이 대본보다 뒤처졌다**는 바로 그 표시다.
- [x] **라우트의 반대 방향도 재 봤다 — 깨끗하다 (감시는 안 만들었다)**: 기존 감시는 *"클라이언트가 만들 수 있는 라우트는 서버가 다 처리한다"* 를 본다. 그 **반대**(서버는 처리하는데 아무도 안 부르는 라우트)는 아무도 안 봤다. 죽은 라우트는 공격 표면이자 **베끼기 좋은 나쁜 본보기**라(513에서 죽은 계약 타입을 지운 이유가 그거다) 재 봤다.
  - 서버 라우트 **129개** 중 클라이언트 빌더가 없는 모양은 **하나**뿐이고, 그것도 진짜 고아가 아니다: `story-bible/:collection/search` 는 클라이언트가 **쿼리 문자열**로 만들어서 모양 비교에만 안 걸린 것이다.
  - 그 라우트는 **의도적으로 화면이 없다**. 그리고 이미 알려져 있다 — `story-bible-http.integration.test.ts` 주석이 *"아직 어떤 화면도 닿지 않는 Story Bible 라우트 둘"* 이라고 적고, **양쪽이 검색어 위치를 두고 어긋나 모든 호출이 400 이었는데 타입체크는 통과하던** 그 버그를 잡으려고 실제 라우터를 통과시키는 짝이 있다.
  - 🟠 **감시로는 안 만들었다.** 걸리는 게 하나이고 그 하나가 오탐(쿼리 문자열)이면, 감시는 예외 목록 하나짜리가 된다 — 511·513에서 같은 이유로 접었다. 재 봤다는 사실만 남긴다.
- [x] **🔴 PATCH 가 바꾸는 바로 그 필드를 응답 가드가 안 보고 있었다**: 511에서 접었던 "가드 완전성" 측정을 **파싱을 고쳐 다시** 돌렸다. 여전히 오탐이 많아 **감시로는 안 만들었지만**(목록 위임·전체값 위임·정규식 짝짓기), 그 결과를 손으로 훑다가 진짜를 하나 찾았다.
  - `isStoryBible` 이 **`styleAssetLink` 는 검사하고 `protagonistAssetLink` 는 아예 안 봤다.** `updateProtagonistAssetLink` 의 응답도 같은 가드를 쓴다 — **그 요청이 존재하는 이유인 필드가, 한 번도 검증되지 않는 유일한 필드였다.**
  - 장식용 값이 아니다. 이 링크가 `auto_protagonist` 매핑을 통해 **에피소드 이미지를 무엇으로 그릴지**를 정한다.
  - 스타일 가드를 재사용하지 않았다. **둘은 실제로 다르다**: 스타일은 `snapshot` 을 허용하고 핀 버전을 숫자로 요구하며, 주인공 링크는 살아 있는 정책 둘만 허용하고 `null` 을 받는다. **베껴 썼으면 `snapshot` 을 통과시켰을 것이다** — 짝이 정확히 그 경우를 본다.
  - 🟢 주입: 그 한 줄을 빼면 짝이 빨개진다.
  - 🟠 감시를 못 만든 이유도 남긴다: 정규식으로는 위임을 따라갈 수 없다. 제대로 하려면 실제 TypeScript 파서가 필요하고, 그건 이 문제에 비해 과하다. **세 번 시도했고 세 번 다 접었다** — 대신 그 측정으로 진짜 결함 하나를 꺼냈다.
- [x] **가드 완전성: 28행을 끝까지 손으로 훑었다. 진짜는 하나였고 524에서 고쳤다**: 나머지 행을 하나씩 열어 확인했다 — 항목 술어(`isVideoVersionSummary`, `isShortProjectCastMember`, `isShortProjectContinuityOption`)는 **전부 필수 필드를 다 본다**. 목록 술어가 그쪽으로 위임할 뿐인데, 정규식이 그 위임을 못 따라가서 누락으로 잡혔다.
  - 즉 **클라이언트 가드 표면은 완전하다** — 524에서 닫은 `protagonistAssetLink` 하나를 빼면.
  - 🟠 이 측정을 감시로 만들지 않은 판단이 이걸로 확정됐다. **수확 전체가 결함 하나**였고, 그건 사람이 출력을 읽어서 나왔다. 자동화하려면 실제 TypeScript 파서가 필요한데, 결함 하나를 위해 파서를 들이는 건 비율이 안 맞는다. **다음에 계약에 필드를 더할 때 그 가드를 직접 열어 보는 게 맞다** — 이번 세션의 일곱 건이 전부 그 순간에 생겼다.
- [x] **`대표` 를 정하는 두 철자를 계약이 이름 붙였다 (Cowork 528 의 진짜 고침)**: Cowork 가 자기 492 진단을 **스스로 정정**했다 — `castRole: "representative"` 가 통과한 건 픽스처에 타입이 없어서가 아니라 **계약이 `castRole: string`(자유 문자열)이기 때문**이다. 픽스처에 타입을 걸어도 안 잡힌다(그쪽이 빌더를 망가뜨려 타입 오류 0으로 증명했다).
  - 진짜 원인: **`"protagonist" | "lead"` 가 세 곳에 손으로 적혀 있고 계약에는 없었다** — 화면의 `isRepresentative()`, `story-prompt.service.ts` 의 캐스트 리드 선택, `story-asset-metadata.ts` 의 `대표/서브` 판정. 503에서 접은 그 모양인데 이번엔 사본이 셋이고 정본이 없었다.
  - `SHORT_PROJECT_LEAD_CAST_ROLES` + `isShortProjectCastLead()` + `SHORT_PROJECT_LEAD_CAST_ROLE`(쓰는 쪽) 를 계약에 넣고 셋을 전부 그쪽으로 돌렸다. **`castRole` 은 자유 문자열로 남긴다** — 파이썬이 뭘 적었든 그 프로젝트는 열려야 한다. 좁히는 유니온이 아니라 **읽는 쪽들이 합의한 목록**이다.
  - 🔴 **`"lead"` 는 아무도 안 지키고 있었다.** 목록에서 빼도 **두 앱 전부 초록**이었다. 이 앱은 `"protagonist"` 만 쓰고 `"lead"` 는 파이썬 시절 데이터에만 있으니, **몇 년 전 정한 대표가 조용히 서브가 되고 유료 프롬프트가 그대로 나가도** 아무도 몰랐다는 뜻이다. 짝을 넣었다 — 목록에서 빼면 빨개진다.
  - 🟢 Cowork 가 부탁한 검증: 빌더가 `"representative"` 를 내도록 망가뜨리면 **타입체크는 0 그대로, 런타임 짝 넷이 빨개진다.** 빌더의 값어치는 "틀릴 수 있는 자리를 15개에서 1개로" 이고, 그 1개는 짝이 지킨다 — 그쪽이 적은 그대로다.
- [x] **528의 부류("읽기만 하고 쓰지 않는 옛 철자")를 더 훑었다 — 하나는 이미 지켜지고 있었고, 하나는 오늘 비용이 0이라 안 고쳤다**:
  - 🟢 `episode-context-builder.ts` 의 `status === "open" || status === "planned"` — `"lead"` 와 같은 모양이라 주입해 봤더니 **짝이 문다**(`"splits secrets by reveal_available_episode and keeps only open/planned foreshadowing"`). 지켜지고 있다.
  - 🟠 그러다 더 큰 걸 봤는데 **고치지 않았다**: 연속성 메모가 `resolvedForeshadowingIds` 를 **저장하고**, 컨텍스트 빌더는 **그걸 안 읽는다**. 빌더가 받는 건 메모의 다섯 필드뿐(`episodeNumber/summary/events/characterChanges/nextActions`)이고, 미해결 판정은 **Story Bible 항목의 `status` 만** 본다. 그런데 **화면은 그 status 를 아예 안 보낸다** — 이 앱에서 만든 복선은 영원히 "미해결" 이고, 회수했다고 메모에 적어도 **다음 회차 유료 대본 프롬프트에 그대로 다시 실린다.**
  - 🔴 **그런데 실제 데이터로 재니 비용이 0이다**: 프로젝트 셋 다 복선 항목 **0개**, 메모의 `resolved_foreshadowing_ids` 도 전부 비어 있다. **아무도 아직 복선을 안 썼다.**
  - 그래서 안 고쳤다. 세 가지가 겹친다 — ① 오늘 도달 불가능(Pacing 때 배운 것) ② 주석이 *"matching Python"* 이라 **물려받은 제품 동작**이지 이식 결함이 아니다 ③ 고치면 **유료 프롬프트의 내용이 바뀐다** — 그건 캡틴D 결정이다. **사실만 적어 두고 넘긴다.**
- [x] **🔴 명언 카드가 매번 "최종 영상 있음" 옆에 "장면 0/1" 을 달고 있었다 — 서버는 이미 답을 보내는데**: Cowork 가 *"사장님이 매일 만드시는 게 BGM 깔린 명언 카드"* 라고 해서 그 경로를 봤다. 거기가 제일 안 본 자리였다.
  - 계약이 `VideoLibraryProjectSummary.photoCard` 를 왜 만들었는지 **그 필드 주석에 그대로 적혀 있다**: *"its row reads 장면 0/1 — which looks like unfinished work sitting next to 최종 영상 있음, two lines contradicting each other… The screen could infer it… and that is the shape this repository has spent a week removing: a screen deducing a fact the server knows. So the row says it."*
  - 🔴 **그런데 보관함 화면이 그 필드를 안 읽는다.** 행은 `장면 {videosReadyCount}/{sceneCount}` 를 무조건 찍는다. 카드는 설계상 장면 영상이 없으니 **항상 0/N**이다.
  - 🔴 **이 컴퓨터에 실제 명언 카드가 셋 있고 전부 그 상태다**(`scenes=1 videos=0 final=true`). 매일 쓰는 화면에서 매번 보인다.
  - 🟠 508 감시가 못 잡은 이유: 그 감시는 이름이 소스 어딘가에 나오면 통과시키는데, `photoCard` 는 **App.tsx 의 화면 이름**과 겹친다. 감시 주석에 *"우연히 겹치면 감시가 약해질 뿐"* 이라고 적어 둔 그 느슨함이 실제로 한 건을 가렸다.
  - 카드면 `명언 카드`, 아니면 기존 장면 수를 그대로 찍는다. 🟢 주입: 되돌리면 짝이 빨개진다. 반대 방향 짝도 넣었다(장면 있는 프로젝트는 계속 센다) — 숫자를 감추는 것으로는 만족되지 않게.
- [x] **🔴 「누적 $」 이 원장 둘 중 하나만 읽고 있었다 (Cowork 532)**: 영상 보관함의 비용 열이 `RunwayBudget` 만 봤다. 이 앱은 원장을 둘 쓴다 — `runway_budget_usage.json`(영상)과 `api_budget_usage.json`(이미지·대본·내레이션·아웃라인). **OpenAI 원장은 처음부터 모든 행에 `project_id` 를 적고 있었다.** 기록할 게 없었고, 읽는 쪽이 없었다.
  - 실측(제가 다시 셌다): 화면 **$8.00** vs 실제 **$12.60**. **$4.60(36%)이 안 보인다.**
  - 🟠 **제 집계가 두 번 틀렸고 둘 다 고쳤다.** ① `actual_cost_usd` 가 없을 때 `estimated_cost_usd` 로 떨어지게 짜서 실패 행이 부풀었다 ② 화면이 성공 행만 센다고 가정했는데 `costsByScene` 는 **`succeeded` 로 거르지 않는다**(실패했지만 청구된 $0.25 짜리 둘도 화면에 이미 들어간다 — 맞는 동작이다). **Cowork 숫자가 맞았다.**
  - `OpenAiBudget.costsByProject()` 를 붙이고 보관함이 둘을 더한다. 표시 전용이라 원장을 못 읽으면 0 — `costsByScene` 와 같은 자세이고 그 이유를 주석에 적었다.
  - 🟠 **에피소드 행은 그대로 0을 더한다.** 이 원장에는 장면·회차 차원이 없어서 회차의 이미지·대본은 **부모 프로젝트 키**로 기록된다. 그래서 회차 행에는 더할 게 없고, **부모의 $3.45 는 실을 행이 없다** — 532 ②는 숫자 문제가 아니라 **표시 방식 결정**이다(회차마다 나눌지, 묶음 헤더 한 줄로 낼지). 캡틴D·Cowork 몫으로 넘긴다.
  - 🟢 주입: 한 원장으로 되돌리면 짝 둘이 빨개진다. 실패했지만 청구된 호출도 세는 짝을 같이 넣었다 — **원장은 결과가 아니라 금액을 적는다.**
- [x] **🔴 승인 거절이 네 실패를 한 문장으로 뭉개서, 캡틴D가 "입력 내용을 확인해 주세요" 앞에서 멈추셨다 (Cowork 533)**: 검토 파일이 아직 없는 프로젝트는 `scriptFingerprint: ""` 를 돌려준다. 화면은 **서버가 방금 준 그 값을** 승인 요청에 실어 보내고, 서버 첫 줄이 자기 값을 거절한다. 그 `INVALID_REQUEST` 가 화면에서 *"입력 내용을 확인해 주세요"* 가 된다 — **아무것도 입력한 적 없는 사람에게 오타를 냈다고 말한다.**
  - 네 조건(낯선 키 · 지문 형식 · **지문 없음** · 승인자 형식)이 전부 같은 문장으로 나갔다. 화면은 가장 사람 탓인 읽기를 고를 수밖에 없었다.
  - `details.reason` 으로 갈랐다: `no_baseline` · `fingerprint_malformed` · `approved_by_invalid` · `unexpected_fields`. 계약에 `MAPPING_APPROVAL_INVALID_REASONS` 로 이름 붙였다(507에서 `unavailableReason` 을 셋으로 가른 것과 같은 모양).
  - 🟠 **`no_baseline` 은 잘못된 요청이 아니다.** *"이 프로젝트는 검사 기준을 아직 안 잡았다"* 이고, 출구는 「지금 대본 기준으로 다시 맞추기」다. 서버가 어느 쪽인지 말해야 화면이 그 말을 할 수 있다.
  - 🟢 주입: 빈 지문이 자기 이유를 잃으면 짝이 빨개진다. 네 이유를 한 짝에서 전부 본다.
  - 🟠 화면 절반(거절이 뻔한 요청을 아예 안 보내기 · 「다시 맞추기」 설명이 "한 번도 안 맞춘" 경우를 포함하기)은 **Cowork 몫**이고, 겹치지 않게 그쪽에 진행하라고 회신했다.
- [x] **캡틴D께 드린 우회로가 실제로 안전한지 확인하고 고정했다**: 533의 안내는 *"「지금 대본 기준으로 다시 맞추기」를 먼저 누르면 넘어갑니다"* 였다. 그 버튼은 `beginReview` 이고, **이미 해 둔 연결을 지우는지** 아무도 확인 안 했다 — 사람에게 누르라고 한 이상 그건 확인할 일이다.
  - 확인: 짧은 프로젝트에서 `markMappingReviewBegun()` 은 **no-op** 이고 `beginReview` 는 **검토 기록만** 쓴다. 매핑은 안 건드린다. **우회로는 안전하다.**
  - 그런데 그게 짝으로 안 잡혀 있었다. 버튼 설명이 *"대본을 고쳤다면"* 이라 **연결을 막 끝낸 사람에게는 자기 작업을 날릴 버튼으로 읽힌다** — 그 두려움이 근거 없다는 걸 코드가 말해야 한다.
  - 🟢 주입: `beginReview` 가 매핑도 지우게 만들면 새 짝을 포함해 셋이 빨개진다.
- [x] **거절 이유가 화면까지 살아서 가는지 고정했다 (Cowork 가 그 위에 붙이기 전에)**: `6c766c4` 로 `details.reason` 을 실어 보내기 시작했는데, **그게 화면까지 도착하는지는 아무도 안 지키고 있었다.** 사슬은 넷이다 — 서비스가 `details` 를 넣고, `toApiErrorShape` 가 본문에서 꺼내고, `MappingsApiError` 가 들고, `toMappingDisplayError` 가 아는 코드에 대해 넘긴다.
  - 🟠 **가운데 한 칸이 군더더기처럼 생겼다.** `toMappingDisplayError` 의 삼항은 "details 있으면 붙이고 없으면 말고" 인데, 지우면 **컴파일되고** 화면은 조용히 *"입력 내용을 확인해 주세요"* 로 돌아간다 — 캡틴D를 멈춰 세운 바로 그 문장으로.
  - 짝 하나로 사슬 전체를 지난다: 400 + `reason: "no_baseline"` → 표시 오류의 `details.reason` 이 그대로. **고정 문장은 고정 문장 그대로**라는 것도 같이 본다(이유는 화면이 *더* 말하게 하는 것이지 원문을 노출하는 게 아니다).
  - 🟢 주입: 그 삼항을 "정리" 하면 빨개진다.
  - Cowork 가 이 위에 화면을 붙인다. **붙이기 전에 이음매를 지켜 두는 게 순서다.**
- [x] **🔴 빈 지문은 읽을 때 생기는 게 아니라 저장되고 있었다 — 533의 진짜 원인**: Cowork 는 `loadReview` 의 ENOENT 갈래가 `script_fingerprint: ""` 를 **돌려준다**는 데까지 짚었다. 실제 데이터를 보니 그보다 나쁘다 — **그 값이 파일로 쓰여 있다.**
  - `repository.save()` → `invalidateReview()` 가 `loadReview` 의 **없을 때 기본값을 그대로 되쓴다.** 그래서 **검토를 한 번도 안 연 회차라도** 매핑이 한 번 쓰이면(스토리 바이블이 `auto_protagonist` 를 심는 것만으로 충분하다) *"기준은 빈 문자열"* 이라는 검토 기록이 남는다.
  - 🔴 **캡틴D의 5화가 지금 정확히 그 상태다**(`script_fingerprint: ""`, `mapping_revision: 1`, 파일 시각은 최근). 명언 카드는 화면에서 그 단계를 없앴지만 **회차는 그 단계를 진짜로 지나야 한다** — 카드 고침이 5화를 구해 주지 않는다.
  - 고침: **시작된 적 없는 검토는 무효화할 것이 없다.** 지문이 비어 있으면 아무것도 안 쓴다. 다음 `beginReview` 가 소유자의 장면에서 진짜 지문을 쓴다.
  - 🟠 기존 짝 하나가 옛 동작을 못박고 있었다(레거시 마이그레이션 뒤 `mapping_revision > 0`). 그 짝의 주제가 아니라 곁다리였고, **의미 있는 성질**(검토가 시작된 뒤의 매핑 변경은 무효화한다)로 바꿔 적었다. 양방향 짝을 새로 넣었다.
  - 🟢 주입: 되쓰기를 되돌리면 새 짝이 빨개진다.
  - 🟠 **이미 쓰인 5화 파일은 이 고침으로 안 고쳐진다.** 캡틴D는 「지금 대본 기준으로 다시 맞추기」를 한 번 누르셔야 하고, 그게 연결을 안 지운다는 건 `41c97ac` 에서 확인했다.
- [x] **🟠 위 항목의 원인 주장을 정정했다 — 그 되쓰기는 승인 버튼을 막은 원인이 아니다**: `fcdb3a6` 는 옳은 고침이지만 **원인 설명이 틀렸다.**
  - 파일이 없을 때도 `loadReview` 는 똑같이 `script_fingerprint: ""` 를 돌려준다. 화면은 그 값을 그대로 `approve` 에 실어 보내고, 서버는 거절한다 — **기록이 쓰였든 안 쓰였든 답이 같다.** 즉 **검토를 한 번도 안 연 회차는 전부** 같은 자리에서 막히고, 되쓰기는 그것과 무관하다.
  - 이미 있던 짝(`says which of the four things was wrong`)이 **검토 파일이 아예 없는 프로젝트**로 `no_baseline` 을 받아 내고 있었다. 처음부터 반증이 초록으로 켜져 있었는데 못 봤다.
  - 진짜 자리는 **화면이 기준이 없는 상태에서 그 버튼을 내주는 것** — Cowork 533 ①, 그쪽 몫이다.
  - 남는 값어치: 되쓰기는 여전히 잘못이다(시작된 적 없는 검토의 리비전을 올리고, 마이그레이션을 검토인 양 기록한다). 그건 그대로 두고 주석·계획의 원인 주장만 바로잡았다.
  - 🟢 정정을 실행 가능하게 만든 짝을 넣었다 — **파일이 있든 없든 같은 이유로 거절된다**를 한 테스트가 둘 다 확인한다. 같은 잘못된 결론에 두 번 도달하지 않도록.
- [x] **🔴 2774 고침 — 설치 프로그램이 방금 빌드한 것을 싣는다**: `package` 는 `electron-builder --dir` 뿐이었고, electron-builder 는 `../backend/dist-bundle` 과 `../frontend/dist` 를 **그대로 복사**했다. **두 스크립트 어느 쪽도 그것들을 만들지 않았다** — 트리에 놓여 있던 것이 그대로 설치 프로그램에 들어갔고, 6일 묵은 번들로 그 실패를 실제로 본 적이 있다. 설치본 안에서는 보이지 않고, 첫 증상은 **며칠 전에 고친 버그가 되살아난 모습**이다.
  - `build:release` 를 넣었다 — shared → backend 번들 → frontend → desktop, 싣는 순서 그대로. `package` · `package:installer` 둘 다 그것을 먼저 돌린다.
  - 🟢 짝은 **썩지 않는 규칙**을 못박았다: **설치 프로그램이 복사하는 것 중 깨끗한 체크아웃에 없는 것(= .gitignore 가 막는 빌드 산출물)은 먼저 도는 빌드에 이름이 있어야 한다.** `extraResources` 에 새 산출물을 더하고 빌드를 안 붙이면 여기서 빨개진다 — 남의 설치본에서가 아니라.
  - 🟢 주입: `package` 를 옛날 형태로 되돌리고 frontend 를 빌드 목록에서 빼면 둘 다 빨개진다.
  - 🟠 **electron-builder 는 돌리지 않았다** — 합의한 배포 순서상 패키징 착수는 사용자 몫이다. `build:release` 사슬만 끝까지 돌려서 네 워크스페이스가 실제로 다 만들어지는 것을 확인했다.
- [x] **🔴 월 예산 $10 이 상수였고, 아무도 그 값을 넘기지 않았다 — 다 쓰면 나갈 문이 없었다**: `DEFAULT_MONTHLY_LIMIT_USD = 10` 은 OpenAI·Runway 각각에 있는데, **여섯 군데 모듈 전부 기본값으로만 만든다.** 설정도, 환경 변수도 없다.
  - 거절 자체는 맞다. **그 뒤에 있는 벽이 문제다** — 다 쓰면 (a) 달이 바뀌기를 기다리거나 (b) 원장 파일을 손으로 고치는 수밖에 없다. (b)는 `load()` 주석이 *"쓴 기록이 그때 사라진다"* 고 못박아 둔 바로 그 짓이다.
  - 환경 변수로 읽게 했다 — `PROMPTS_ROOT` · `FONTS_ROOT` 와 같은 방식. **기본값은 안 움직였다.** `OPENAI_MONTHLY_BUDGET_USD` · `RUNWAY_MONTHLY_BUDGET_USD`.
  - 🟠 **한도를 올리는 건 돈에 관한 결정이라 내가 정하지 않았다.** 이건 그 결정을 *말할 수 있게* 만든 것뿐이다. 설정 화면에 둘지는 캡틴D 몫으로 남긴다.
  - 🔴 **양수 유한수가 아니면 전부 무시하고 기본값을 쓴다.** 오타가 지출 한도를 넓힐 수 있으면 안 되고, 틀렸을 때 안전한 쪽은 작은 쪽뿐이다. `0` 도 거절한다 — "한 푼도 쓰지 마" 는 키를 빼면 되는 말이고, 망가진 변수에서 읽힌 0 은 *예산 소진*과 구별이 안 된다.
  - 🟢 주입: 거절 조건을 `NaN` 만으로 줄이면 `-5` 가 통과해 빨개지고, Runway 를 상수로 되돌리면 "두 제공자 다" 짝이 빨개진다.
  - 🟢 화면은 이미 `monthlyLimitUsd` 를 다섯 군데에서 보여 준다 — 바꾸면 바로 보인다.
  - 이번 달 실제 사용: OpenAI **$1.95 / $10**, Runway **$3.00 / $10**. 지금 당장 막히지는 않는다.
- [x] **🔴 예산의 "이번 달"이 UTC 달이었다 — 한국 시각으로 매달 아홉 시간이 지난달에 얹혔다**: 두 예산 다 `timestamp.startsWith(now.toISOString().slice(0, 7))` 로 **UTC 달**을 비교했다. 그런데 이 원장은 **한 사람의 한 달치 용돈**이고, 그 사람의 달은 로컬 달이다.
  - KST 10-01 00:00 은 UTC 09-30 15:00 이다. **10월 첫 아침에 쓴 돈이 9월에 얹히고**, 9월 예산을 다 썼다면 **10월 1일 오전 9시까지 계속 거절당한다.** 자정이 지나는 걸 보면서 벽이 그대로인 사람에게, 화면에는 그걸 설명할 문장이 하나도 없다.
  - 반대 방향도 있다 — 그 아홉 시간의 지출은 새 달에 안 얹힌다(느슨한 쪽).
  - 규칙을 `budget-month.ts` 한 곳에 뒀다. **같은 돈 규칙이 두 벌이면 한 벌만 고칠 기회도 두 벌이다.**
  - 🟠 기존 짝 둘(`only counts usage from the current UTC month`)이 UTC 경계를 못박고 있었다. **이름이 메커니즘을 적었을 뿐 근거 주석이 없었다** — 지킬 값어치가 있는 성질(지난달 지출은 이번 달이 아니다)로 다시 적고, **시간대를 시험 안에 명시**했다(전엔 돌리는 기계에 따라 달라졌다).
  - 읽을 수 없는 timestamp 는 **어느 달에도 안 든다** — 문자열 비교 때와 같다. 느슨한 쪽이지만 일부러 그대로 뒀다: 모든 달에 드는 썩은 행 하나가 **영원히 모든 지출을 거절**한다. 원장 자체를 못 읽는 경우는 이미 따로 거절한다.
  - 🟢 주입: UTC 비교로 되돌리면 짝 네 개가 빨개진다.
- [x] **🟠 스토리 바이블 링크의 버전 정책이 여섯 벌로 손으로 적혀 있었다**: 서버 넷(`stylePolicies` 지역 배열, 주인공용 `!==` 두 줄, 응답 매퍼의 캐스트 두 개), 화면 둘(`||` 사슬 두 개). **여섯이 서로 맞았는데, 맞게 만드는 것이 아무것도 없었다** — 정책을 하나 더하면 여섯 군데 다 컴파일되고, 기억 못 한 복사본이 런타임에서 거절한다.
  - 계약에 한 벌씩 두고 타입을 파생시켰다 — `LONG_STORY_BIBLE_PROTAGONIST_LINK_POLICIES`(둘) · `LONG_STORY_BIBLE_STYLE_LINK_POLICIES`(셋). 이미 이 저장소가 `ASSET_MAPPING_VERSION_POLICIES` 에 쓰던 모양 그대로다.
  - 🟠 **두 집합을 서로 파생시키지 않았고, `ASSET_MAPPING_VERSION_POLICIES` 에서도 파생시키지 않았다.** 오늘 같은 문자열 셋을 담고 있지만 **링크의 정책이 매핑으로 옮겨 가지 않는다** — `episode-story-bible-mapping-sync.ts` 는 그 값을 읽지도 않는다. 묶으면 **이 앱에 없는 관계를 못박는 것**이고, 한쪽이 다른 쪽이 못 받는 정책을 갖는 날 그건 빌드 오류가 아니라 **결정**이어야 한다.
  - 🟢 주입: 계약에서 `snapshot` 을 빼면 **서버와 화면 짝이 각각 하나씩** 빨개진다 — 양쪽이 정말 계약을 읽는다는 뜻이다.
- [x] **🔴 캡틴D 결정: 월 예산 한도를 설정 화면에서 바꾼다 — 542의 열린 질문이 닫혔다**: 환경 변수만으로는 *앱 안에서 쓰는 사람*에게 없는 것과 같았다. 화면에 붙였다.
  - **같은 손잡이 하나다.** 저장하면 앱이 이미 소유한 `.env` 에 `OPENAI_MONTHLY_BUDGET_USD` / `RUNWAY_MONTHLY_BUDGET_USD` 줄이 들어간다 — 두 번째 저장소를 만들지 않았다. 우선순위는 **저장값 > 실행 환경 > $10**: 앱 안에서 타이핑한 것이 더 최근이고 더 의도적인 발언이고, 그 사람은 자기가 친 화면이 그 뒤로 참말을 하길 기대한다.
  - 🔴 **다시 켜지 않아도 된다.** `monthlyLimitUsd` 를 생성 시점 상수에서 **매번 묻는 조회**로 바꿨다(`monthlyLimit()`). 바깥 호출부는 넷뿐이었고 전부 이미 async 였다.
  - **쓴 금액을 같이 보여준다** — 거절을 계산하는 바로 그 원장에서 읽는다. `$10` 은 아무 질문에도 답하지 않고, `$3.00 씀 · $7.00 남음` 이 사이클 전에 묻는 유일한 질문에 답한다. 두 제공자는 끝까지 안 합친다.
  - 🟠 **`isDefault`**: *"아무도 안 정했다"* 는 *"누가 $10 으로 정했다"* 와 다른 사실이고, 앞엣것만 그 숫자가 **사람이 아니라 앱의 의견**이라는 뜻이다.
  - 🔴 **원장을 못 읽으면 `spendUnavailable`** — `$0.00 씀` 이 아니다. 지출 한도를 올리는 입력칸 바로 옆에서 그건 이 화면이 할 수 있는 **가장 관대한 말**이다. 한도 자체는 여전히 참이라 그대로 보여주고 바꿀 수 있게 둔다.
  - 0 은 서버·화면 양쪽에서 거절한다: *"한 푼도 쓰지 마"* 는 연결 해제가 이미 하는 말이고, 예산 보여주는 모든 화면에서 **한도 0 은 소진과 구별이 안 된다.** 소수점 셋째 자리도 거절한다 — 반올림하면 화면이 **입력한 값이 아닌 한도**를 보여준다.
  - 🟠 배선: 예산을 제공하는 모듈들이 설정 모듈을 import 하므로 **되받으면 순환**이다. 설정 모듈이 `AssetsModule` 의 `LEARNING_DATA_ROOT` 만 받아 **읽기 전용 인스턴스 두 개를 직접 만든다** — 상태가 없어서 공짜고, 대안은 데이터 루트를 손으로 한 번 더 푸는 것이었다(설정 루트를 fail-closed 로 만든 바로 그 중복).
  - 🟢 주입: 검증을 `NaN` 만으로 줄이면 서버·화면 짝이 각각 빨개지고, `spendUnavailable` 갈래를 죽이면 그 짝이 빨개진다.
- [x] **🔴 캡틴D 결정: 부모 프로젝트 비용을 표시한다 — 532 ②가 닫혔다**: OpenAI 원장에는 **회차 차원이 없다.** 회차의 대본·이미지·내레이션은 전부 **부모 프로젝트 키**로 기록되니, 회차 행이 0을 더하는 건 맞고 **그 돈은 어느 화면에도 안 나왔다** — 실원장 기준 **$3.45 가 아무 데도 없었다.** 없는 숫자가 아니라 **갈 데가 없는 숫자**였다.
  - 이야기 단위이므로 **회차 위 묶음 헤더 한 줄**로 냈다. 회차마다 나누면 **원장에 없는 분할을 지어내는 것**이다.
  - **숫자 둘을 따로 말하고 나서 더한다** — `공통 $3.45 · 회차 $1.50 · 합계 $4.95`. 서로 다른 원장에서 오고 서로 다른 질문에 답한다. 화면이 먼저 더해 버리면 어느 쪽이 얼마인지 다시 알 수 없다.
  - 🟠 **보관함에 회차가 있는 이야기에만 헤더가 붙는다.** 이 목록은 결과 보관함이라, 영상에 도달한 적 없는 프로젝트의 지출 줄은 **여기 없는 작업에 대한 금액**이다. 검색으로 회차가 다 걸러진 이야기도 같은 이유로 사라진다.
  - 🟢 화면 가드는 이 필드를 **떨어뜨리되 치명적이지 않게** 다룬다 — 회차 행과 같은 이유다. 이 필드가 없던 시절 번들을 실행하면 헤더 한 줄이 빠질 뿐, 보관함 전체가 "형식 오류" 가 되지 않는다.
  - 🟢 주입: 서버가 `ownCostUsd: 0` 을 내면 백엔드 짝이, 빈 그룹을 거르지 않으면 화면 짝이 빨개진다.
  - 🟠 금액은 다른 행들과 똑같이 **날것으로 더한다**(부동소수점). 센트 반올림은 화면이 한다 — 짝도 `toBeCloseTo` 로 그 사실을 적었다.
- [x] **🔴 예산 거절이 "그래서 어쩌라고" 로 끝났다 — 오늘 문이 생겼는데 문구가 그걸 모른다**: 한도가 상수였을 때는 *"이번 달 예산을 초과했습니다"* 가 **말할 수 있는 전부**였다. 나갈 길이 달이 바뀌기를 기다리거나 원장을 손으로 고치는 것뿐이었고 **둘 다 오류 메시지에 쓸 말이 아니다.** `f3f5e0a` 로 설정 화면이 생긴 순간, 그 문장은 **문 앞에 서서 문이 없다고 말하는 것**이 됐다.
  - 문장을 계약에 한 벌 뒀다(`BUDGET_LIMIT_ROUTE_HINT`) — 화면 열 곳, 서버 둘, 총 열둘이 같은 문장을 가리킨다. 한도가 사는 자리가 바뀌면 **한 줄만 고친다.**
  - 🟢 짝이 **오늘의 열둘이 아니라 규칙**을 지킨다: **화면 쪽 메시지 맵에 새 예산 거절이 추가되면 그 상수를 안 끼운 순간 빨개진다.** 이런 문구는 언제나 *복사해서 한 줄 고치는* 식으로 늘어난다.
  - 🟠 기존 짝 하나가 문장을 통째로 못박고 있었다(`VIDEO_BUDGET_EXCEEDED`). 그 짝의 주제는 **원문 백엔드 상세가 화면에 새지 않는 것**이지 정확한 낱말이 아니라, 이유를 적고 기대값을 갱신했다.
  - 🟠 `budget-refusal-route.test.ts` 는 `new URL(".", import.meta.url)` 로 자기 폴더를 못 찾는다 — `contract-value-sets.test.ts` 가 이미 적어 둔 함정이라 `path.dirname(fileURLToPath(import.meta.url))` 을 쓰고 이유를 남겼다.
  - 🟢 주입: 한 곳에서 상수를 빼면 짝 둘이 빨개진다.
- [x] **🟠 캡틴D가 실제로 걸은 길이 어디에도 없었다 — 조각은 다 덮여 있었는데 걸음이 아니었다**: 5화 관문은 화면·서버·계약 세 군데서 각각 짝을 받았지만, **사람이 실제로 밟는 순서**로 걸어 본 짝은 없었다. 그 차이가 *초록인 스위트*와 *되는 앱*의 차이다.
  - HTTP 로 끝까지 걷는 짝을 넣었다: **스토리 바이블이 심은 매핑만 있는 회차** → 검토 열기(지문 `""`) → 「연결 다 했음」 **거절, 이유는 `no_baseline`** → 「지금 대본 기준으로 다시 맞추기」 → 승인 통과 → 회차 상태 `asset_mapping_approved` → **심긴 연결 그대로 남아 있음**.
  - 🔴 **픽스처를 손으로 지었더니 500 이 났다** — `ASSET_MAPPING_DATA_INVALID`. 원인은 제품이 아니라 내 픽스처였다: Episode 매핑의 `project_id` 는 `<id>/Episode<NN>` 이고 `mapping_id` 는 16자리 16진수다. **캡틴D의 5화 파일에서 그대로 베껴** 고쳤다 — 그럴듯해 보이기만 하는 픽스처는 그의 데이터에 대해 아무것도 증명하지 못한다.
  - 🟠 곁다리로 알게 된 것: **매핑 파일이 망가져 있으면 검토 화면은 열리고 승인에서야 500 이 난다.** `loadReview` 는 매핑을 안 읽고 `approve` 는 읽기 때문이다. 오늘은 도달 경로를 못 만들어서 **적어만 둔다.**
  - 🟢 주입: `no_baseline` 이 이유를 잃으면 이 걸음이 빨개진다.
- [x] **🔴 클립 길이는 고를 수 있는데 단가가 상수였다 — 10초 프로젝트를 절반 값으로 부르고 있었다 (Cowork 547 ① 을 재다가 나옴)**: `VIDEO_SCENE_ESTIMATED_COST_USD = 0.25` 은 **장면당 고정**인데 `RUNWAY_CLIP_DURATIONS` 는 처음부터 `[5, 10]` 이었다. 10초로 잡은 프로젝트는 **영상을 두 배 사면서 같은 값을 부른다** — 그것도 *쓸지 말지 결정하는 preflight* · 확인 패널 · 미리보기 · 재시도 안내 · 워크플로 안내, 전부에서.
  - 🔴 **어느 방향으로 틀렸는지가 전부다.** `local-video-workflow.service.ts` 주석이 이미 적어 뒀다 — *"Quoting money low is the one direction this must never be wrong in."* 고정 숫자는 5초에선 맞고 **10초에선 절반만 참**이다.
  - 🟠 **실제로 쓰이는 설정이다**: 명언 카드 셋이 `clip_duration_seconds: 10` 이다. 카드는 유료 호출이 없어 돈은 안 틀렸지만, **영상 프로젝트를 10초로 잡는 순간 틀린다.**
  - 초당 $0.05 로 파생시켰다 — **5초에서 정확히 오늘의 $0.25 를 재현**하므로 5초 프로젝트는 아무것도 안 움직인다. Runway 가 실제로 클립당 정액이라면 10초를 **과다** 견적하는데, 그게 안전한 방향이고 여전히 틀려야 할 방향이다.
  - 🔴 **평평한 장면당 상수를 남기지 않았다.** 모든 호출부가 길이를 손에 쥐고 있고(단기 설정·회차 설정 둘 다 갖는다), **길이를 못 대는 자리는 자기가 뭘 값 매기는지 모르는 자리**다. 컴파일러가 여섯 파일을 목록으로 줬다.
  - 🟢 곁다리 개선: 단기 제출은 이제 **미리보기가 계산한 금액을 그대로 합산**한다. 사람이 보고 누른 숫자가 곧 기록되는 숫자라, 확인창과 청구가 어긋날 구조가 사라졌다.
  - 🟢 주입: 다시 `0.25` 고정으로 되돌리면 계약 짝 셋과 회차 짝 하나가 빨개진다.
- [x] **🔴 모델 이름이 여덟 벌로 적혀 있었고, 그중 둘은 정상 응답을 거부한다 — 대기 중인 1080p 교체가 정확히 이걸 밟는다**: 실제로 전선에 나가는 값은 `RUNWAY_MODEL` 하나인데, 나머지 일곱이 **각자 `"gen4_turbo"` 를 적어** 뒀다 — 서버 기록·미리보기·확인 해시·계약 필드 둘·화면 가드 둘.
  - 🔴 **화면 가드 둘이 핵심이다.** `value.model === "gen4_turbo"` 로 비교하고 아니면 응답 전체를 버린다. 어댑터에서만 모델을 바꾸면 **서버는 맞게 답하는데 영상 화면 둘이 "서버 응답을 확인할 수 없습니다"** 라고 말한다. 정리 문제가 아니라 **날짜가 붙은 함정**이다 — 모델 교체는 이미 대기 목록에 있다.
  - 계약에 `VIDEO_MODELS` 를 두고 타입을 파생시켰다. **타입만으론 안 강제된다**(리터럴이 그대로 대입된다) — 그래서 `RUNWAY_MODEL: VideoModel` 로 **값**을 묶고, 나머지 여섯이 그 값을 쓴다. 이제 모델을 바꾸면 **계약에 이름을 올리기 전까진 컴파일이 안 된다.**
  - 🟠 확인 해시에도 모델이 들어간다 — 한 모델에서 뜬 미리보기가 교체 뒤에 제출되면 안 된다. **값도 결과도 그 아래에서 바뀐다.**
  - 🟢 짝은 **아홉 번째 복사본**을 잡는다: 어댑터 말고 어떤 서버 소스에도 모델 문자열이 나오면 안 된다(테스트 픽스처는 제외 — 거기서 이름을 대는 건 무엇을 시험하는지 밝히는 것이다).
  - 🟢 주입: 미리보기에 리터럴을 되돌리면 그 짝이 파일 이름을 대며 빨개진다.
- [x] **🔴 오디오 모드 네 이름이 일곱 벌 — 그리고 그게 내 짝의 사각지대였다**: `narration` · `narration+bgm` · `bgm` · `silent` 이 계약 필드, 서버 검증 셋(단기·회차·회차 상세 읽기), 저장 스키마의 `USED_AUDIO_MODES`, **화면의 라디오 버튼 목록**에 각각 손으로 적혀 있었다.
  - 🟠 **화면 목록이 버튼을 그린다.** 저장 스키마에 모드를 더하고 그 목록에 안 더하면 **서버는 받는데 아무도 고를 수 없는 모드**가 된다.
  - 🔴 **`contract-value-sets.test.ts` 가 이걸 놓친 이유가 둘이다**: ① 계약이 `mode` 를 인라인 유니온으로 선언해서 **비교할 배열이 없었고** ② 짝이 `COPY_MINIMUM = 5` 미만 집합은 아예 안 봤다. `AUDIO_MODES` 는 넷이다. **그 짝이 잡으라고 만들어진 바로 그 모양**(`["narration", ...] as AudioMode[]`)이 눈앞에 있었는데 통과했다.
  - 계약에 `AUDIO_MODES` + `isAudioMode` 를 뒀다. **`.includes` 는 타입을 안 좁힌다** — 원래 `!==` 사슬이 하던 narrowing 을 유지하려면 타입 가드여야 한다(`isShortProjectCastLead` 와 같은 모양).
  - 🟢 **짝을 넓혔다**: 전부를 적은 목록은 **크기와 무관하게 복사본**이다 — 전부를 나열한 게이트는 아무것도 안 좁히니까. 비율 규칙은 부분 목록용으로 남긴다.
  - 🟢 **넓히자마자 넷을 더 찾았다** — 전부 `api/mappingsApi.ts` 다: `ASSET_MAPPING_ASSIGNMENT_SOURCES`(4/4) · `ASSET_MAPPING_VERSION_POLICIES`(3/3) 를 **바로 옆에 있는 계약 배열을 두고** 손으로 다시 적어 뒀다. 둘 다 import 로 바꿨다.
  - 🟠 겹치는 집합 하나가 한 리터럴을 여러 번 지목한다(버전 정책 셋 = 스타일 링크 정책 셋, 주인공 정책 둘을 포함). **한 줄이 네 건으로 보이지만 고침은 import 하나**라, 기계 장치를 더 붙이지 않고 주석으로 적었다.
  - 🟢 주입: 화면 목록을 리터럴로 되돌리면 짝이 파일과 집합 이름을 대며 빨개진다.
- [x] **🟢 서버 쪽 같은 짝도 같은 사각지대였다 — 넓혔고, 거기엔 복사본이 없었다**: `apps/backend/src/contract-value-sets.test.ts` 도 `COPY_MINIMUM = 5` 미만 집합을 안 보고 있었다. 화면 쪽과 **같은 규칙**(전부를 적으면 크기와 무관하게 복사본)으로 맞췄다.
  - 🟢 **찾은 건 없다.** 그래도 넣는다 — 두 짝이 서로 다른 규칙을 들고 있으면, 다음에 어느 쪽에서 새는지가 규칙이 아니라 **우연**이 된다.
  - 🟢 주입: `episode-detail.ts` 에 네 모드를 리터럴로 되돌리면 파일과 집합 이름을 대며 빨개진다.
- [x] **🔴 계약이 인라인 유니온으로 쓴 집합은 짝이 구조적으로 못 본다 — 재 보니 19개, 실제 복사본 23벌**: 550 에서 `AUDIO_MODES` 가 그 이유로 통과한 걸 보고 **계약 전체를 훑었다.** 배열로 선언된 집합은 15개인데, **문자열 유니온으로만 선언된 것이 19개** 더 있었고 그중 열 개가 앱 어딘가에 손으로 다시 적혀 있었다.
  - 결과가 제일 나쁜 셋을 먼저 배열로 내렸다: **`VIDEO_JOB_STATUSES`(5)** · **`ASPECT_RATIOS`(2)** · **`LONG_EPISODE_OUTLINE_STATUSES`(2)**.
  - 🔴 `VIDEO_JOB_STATUSES` 는 **화면 폴링 가드**에 복사돼 있었다 — 서버가 상태를 하나 더하면 **작업이 도는 중에 그 화면이 죽는다**(응답 전체를 형식 오류로 버린다).
  - 🟠 **규칙에 구멍이 있어서 좁혔다**: "전부를 적으면 복사본" 만으로는 **더 긴 정당한 목록**이 작은 집합을 포함할 때마다 오탐이 난다 — 회차 초안 상태 여섯이 outline 상태 둘을 품고, 저장 레코드 상태 여섯이 API 상태 다섯 + `submitting` 을 품는다. **`submitting` 은 API 에 일부러 없다.** 그래서 *"전부를 적었고 그 외엔 없다"* 로 바꿨다 — 오탐 둘이 사라지고 진짜 여섯만 남았다.
  - 고친 여섯: `videoWorkflowApi.ts` · `longProjectsApi.ts`(둘) · `LongEpisodeOutlineScreen.tsx` · `episode-videos.service.ts` · `episode-timeline.service.ts`.
  - 🟠 **남은 일곱 유니온은 아직 배열이 아니다**(`NarrationAudioState` · `AssetOwnership` · `ReviewDecision` · `AssetFileAuditClassification` · `LongStoryBibleCollection` · `ProviderCredentialKind` · 리뷰 `pending|approved` 등). 복사본이 각 1~3벌이고 결과가 가볍다 — 다음 차례로 적어 둔다.
  - 🟢 주입: 화면 가드를 리터럴로 되돌리면 짝이 파일과 집합 이름을 대며 빨개진다.
- [x] **🟢 남은 유니온까지 다 내렸다 — 이제 계약 집합의 손글씨 복사본이 0이다**: 앞 항목에서 셋만 하고 일곱을 미뤄 뒀는데, 이어서 끝냈다. **배열 15개 → 27개.**
  - 내린 것: `NARRATION_AUDIO_STATES` · `LONG_EPISODE_CONTINUITY_UNAVAILABLE_REASONS` · `LONG_STORY_BIBLE_COLLECTIONS` · `ASSET_FILE_AUDIT_CLASSIFICATIONS` · `PROVIDER_CREDENTIAL_KINDS` · `ASSET_OWNERSHIPS` · `REVIEW_DECISIONS` · `SCENE_REVIEW_STATUSES` · `PROJECT_ASSET_MAPPING_REVIEW_STATUSES`.
  - 고친 복사본 열하나. 🟠 그중 하나는 **오늘 내가 쓴 것**이다 — `MonthlyBudgetCard.tsx` 의 `ORDER = ["openai", "runway"]`. 짝을 넓힌 그 오후에 같은 손으로 새 복사본을 하나 만들어 놨다는 뜻이고, **규칙이 사람보다 오래 간다**는 근거이기도 하다.
  - **재측정: 계약 집합을 손으로 다시 적은 자리가 앱 전체에 하나도 없다.** 남은 유니온 일곱은 어디에도 복사돼 있지 않아 그대로 둔다 — 복사본이 없는 유니온은 배열로 만들 값어치가 없다(Pacing 규칙: 닿지 않는 것은 고치지 않는다).
  - 🟢 주입: 마지막으로 고친 자리를 리터럴로 되돌리면 짝이 파일과 집합 이름을 대며 빨개진다.
- [x] **🔴 대본이 앞 회차를 모르는 채로 만들어지는데 아무도 말하지 않았다 — 유료 프롬프트 안의 침묵**: 연속성 메모는 손으로 쓰는 것이고, 없으면 `continuityContext` 가 **조용히 건너뛴다.** 건너뛰는 건 맞다(없는 메모가 대본 생성을 막으면 안 된다). **말 안 하는 게 틀렸다** — 그 payload 는 유료 프롬프트로 들어간다.
  - 🟠 실데이터로 확인: 12번의 **1화와 5화에 메모가 없다.** 그대로 6화를 만들면 **바로 앞 회차를 모르는 대본**이 나오고, 화면 어디에도 그 사실이 없다.
  - 고침: 최근 셋 중 메모 없는 회차를 회차의 `warnings` 에 적는다 — 그 목록은 회차 화면과 개요 목록 **두 곳에서 이미 읽힌다.**
  - 🟠 **메모를 쓰는 프로젝트에서만 말한다**(`hasAnyMemo`). 아무도 안 쓰는 프로젝트라면 2화부터 전 회차에 뜨고, 그게 경고 목록이 안 읽히게 되는 방식이다. *"앞 회차엔 있는데 이 회차엔 없다"* 가 사람이 할 일이 있는 버전이고, *"이 기능을 쓴 적 없다"* 는 소식이 아니다.
  - 🟠 사후에 말한다: 대본은 **싼 단계**($0.05)라, 무엇을 모르고 쓰였는지 알면 **비싼 단계 전에** 메모를 적고 다시 만들 수 있다.
- [x] **🔴 곁다리로 더 큰 걸 찾았다 — "응답에 실려 간다"고 적힌 경고가 실제로는 안 실렸다**: `episode-warnings.ts` 주석이 *"the response already carries the sentence"* 라고 못박아 두었는데, `episode-scripts.service.ts` 의 `toApi` 는 **outline 행만 펼치고 `stored.warnings` 를 안 읽었다.** 그래서 이 호출 중에 붙은 경고는 **디스크에만 남고 응답에는 없었다.**
  - 🔴 제일 값비싼 문장이 그 경로에 있다 — **"돈은 나갔는데 원장이 모른다"**(`spendUnrecorded`). 사람은 다른 화면을 다시 열어야 봤다.
  - `toEpisodeDetail` 은 원래 읽고 있었다. **조용히 안 읽던 건 이 빌더 하나**였고, 주석은 둘 다에 대해 참인 줄 알고 쓰여 있었다.
  - 둘을 합치고 중복을 없앤다 — 앞선 경고는 outline 행에, 방금 붙인 건 `stored` 에 있는 게 정상이다.
  - 🟢 주입: 경고 조건을 죽여도, `stored.warnings` 병합을 빼도 같은 짝이 빨개진다.
- [ ] **🟠 실사용에서 나온 것, 사이클 끝나고 고칠 것 — `BAD_OUTPUT` 이 "알 수 없는 오류" 로 뭉개진다**: 2026-09-05 캡틴D의 5화 3번 장면이 **같은 오류로 두 번** 실패했다(`INTERNAL.BAD_OUTPUT.CODE01`, $0.50 나가고 결과물 0).
  - 원인은 앱 결함이 아니라 **프롬프트 내용**이었다: 그 장면만 *"수호자의 얼굴이 수많은 얼굴 조각으로 분해되고"* 를 세 자리에서 요구하는데, **우리 템플릿이 모든 장면에 붙이는 마지막 줄이 `Maintain stable identity, anatomy…` 다.** 한 프롬프트 안에서 정면으로 충돌한다. 배제: 해상도·이미지 크기 정상, 프롬프트 704자로 오히려 다른 장면보다 짧다.
  - 🔴 **화면에는 `An unexpected error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)` 만 떴다.** 사람이 할 수 있는 게 없는 문장이다 — 원장·레코드·프롬프트를 다 열어 보고서야 "프롬프트를 바꾸면 된다"에 도달했는데, **그건 화면이 할 수 있었던 말이다.**
  - `BAD_OUTPUT` 은 다른 실패와 뜻이 다르다: **재시도가 도움이 안 되고, 프롬프트를 바꿔야 하는 유일한 부류**다. 지금은 `unknown` 으로 뭉뚱그려져 있다(`runway-video-adapter.ts` 의 `RunwayErrorCategory`).
  - 할 일: `bad_output` 범주 추가 + 한국어 문구(*"모델이 이 장면을 만들지 못했습니다. 같은 프롬프트로 다시 시도해도 같은 결과일 가능성이 큽니다 — 장면 지시를 바꿔 보세요."*). 범주 목록은 계약 층, 문구가 뜨는 자리는 화면 층이라 Cowork 과 맞춘다(554).
  - 🟠 **지금 안 고치는 이유**: 5화가 `videos_generating` 으로 멈춰 있고, 소스를 저장하면 캡틴D의 watch 서버가 재시작한다(`5908a80`). 유료 작업 중 재시작이 이 잠복 문구 문제보다 나쁘다.
  - 🟢 **2026-09-06: 계약·서버 절반 완료**(`6bb5ec6`, 이 문서 맨 아래 항목). 범주를 새로 만드는 대신 **제공자 코드 표 하나**를 계약에 뒀다 — 어댑터의 `remedy` 와 화면의 문장이 같은 행에서 나온다. **화면 한 줄이 남아 있어 이 항목은 열어 둔다.**
- [x] **🔴 실사용에서 돈을 잃은 자리 — 화면이 "잠시 후 다시 시도" 라고 했고, 그 조언이 틀렸고, 두 번 청구됐다 (Cowork 548 · 계약과 서버 절반)**: 5화 3번 장면이 `INTERNAL.BAD_OUTPUT.CODE01` 로 실패했다. 화면은 *"영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."* 를 보여 줬고, 캡틴D는 그 말을 믿고 눌렀고, **똑같이 실패하고 $0.25 가 또 나갔다.**
  - 🔴 **코드를 손에 쥐고 뜻을 버리고 있었다.** 어댑터가 `failureCode` 를 사람 문장 안에 녹여 넣고(`"… (Runway code: INTERNAL.BAD_OUTPUT.CODE01)"`), 화면은 **그 문장 전체를 코드 표에서 조회**해서 당연히 못 찾고 폴백 문구를 냈다.
  - Cowork 이 Runway 문서를 찾아왔다: `INTERNAL.BAD_OUTPUT` 의 1순위 원인은 **입력 미디어의 글자·로고**와 **글자 생성을 요구하는 프롬프트**다. 3번의 첫 프레임은 2번의 끝 — *"테이프 라벨이 화면 전체를 차지한다"*. 🟠 **내 진단(얼굴 분해)보다 그쪽이 맞았고, 나는 이미지의 해상도·용량만 재고 무엇이 찍혀 있는지는 안 봤다.**
  - 계약: `SceneFailure { category, providerCode?, remedy, billedOnFailure }` + `sceneFailures` 를 두 진행 응답에.
  - 🔴 **`remedy` 가 boolean 이 아니라 셋인 이유**: 문서의 `retryable: yes` 는 *"일시 오류일 수도 있다"* 이지 *"같은 입력으로 다시 보내라"* 가 아니다. `BAD_OUTPUT` 은 retryable 인데 **입력을 안 바꾸면 영원히 실패**한다. **둘을 한 단어로 묶는 게 오늘 그 $0.25 를 만든 조언이다.**
  - 🟠 `billedOnFailure` 는 필수다. 모르는 채로 버튼을 누르게 한 게 문제였지, 필드가 없던 게 문제가 아니다. **모르는 코드는 `retry` + 청구됨** — 다시 눌러도 되는지는 모르고, 이 제공자가 실패도 청구한다는 건 안다.
  - 앱이 스스로 내린 판정(타임아웃·빈 출력)은 **제공자 코드가 없고 청구도 없다** — 돈이 움직였다면 그 호출이 그 순간 제 원장 행을 적었다.
  - 🟠 **화면 절반은 Cowork 몫이라 안 건드렸다** — 그쪽이 그 순간 `longProjectsApi.ts` 를 편집 중이었다. `sceneFailures` · `providerCode` 를 **옵셔널 필드 짝의 예외로 기록**했고, 그 예외는 **화면이 읽는 순간 스스로 실패**한다. 인계가 곧 예외다.
  - 🟢 주입: `BAD_OUTPUT` 을 `change_input` 에서 빼면 짝 둘이 빨개진다. 어댑터 새 export 는 예산 짝이 **분류를 요구**해서 `NOT_BILLED` 에 이유와 함께 올렸다.
  - 🟠 창을 기다렸다: 5화가 `videos_review` 로 넘어가 **유료 작업이 도는 게 없고**, 그 상태는 고아 복구 대상이 아니라 재시작해도 되돌려지지 않는다.
- [x] **🔴 키 없이 만든 플레이스홀더를 유료 실행이 "이미 있는 그림"으로 재사용하고 있었다 — 빈 화면으로 영상을 산다**: `validImage` 가 **바이트가 PNG 로 파싱되는지만** 봤는데, 가짜 경로가 쓰는 `PLACEHOLDER_PNG` 는 **진짜 1×1 PNG(68바이트)** 다.
  - 그래서 키 없이 한 번 돌린 회차를 키를 연결하고 열면 미리보기가 **`reusableSceneNumbers: [1..6]` · `estimatedCostUsd: $0.00`** 이라고 답하고, 아무것도 안 만들고 넘어가서 **빈 프레임 여섯 장으로 Runway 클립을 산다** — 내용 없는 영상에 $1.50.
  - 🟠 **가상이 아니다**: `design-preview-long-1` 의 1화가 이 컴퓨터에서 정확히 그 상태다(장면 여섯 개 전부 68바이트). 나머지 44장은 실제 이미지(최대 3.0MB)다.
  - 영상 쪽은 이 선을 이미 긋고 있었다(`validFile(file, paid)`), 판별 함수 `isPlaceholderImage` 도 **바이트 옆에 이미 있었다** — 회차 이미지 경로만 안 쓰고 있었다. 같은 모양으로 맞췄다: **제공자에 도달한 실행만** 엄격한 검사를 받는다(가짜 경로가 플레이스홀더를 쓰고 읽는 건 그 경로의 정상 동작이다).
  - 🔴 **짝의 픽스처 자체가 결함의 일부였다.** `PNG_BASE64` 가 `PLACEHOLDER_PNG` 와 **바이트가 같았고**, 가짜 OpenAI 가 그걸 "산 그림"으로 31군데에서 돌려주고 있었다. **스텁과 구별할 수 없는 픽스처로는 둘의 차이를 시험할 수 없다** — 241바이트짜리 진짜 PNG(`BOUGHT_PNG_BASE64`)를 만들어 갈랐다.
  - 🟢 주입: 플레이스홀더 검사를 빼면 새 짝이 빨개진다(재사용 6개 · 견적 $0.00).
  - 🟠 유료 작업이 도는 동안에는 **보고만 하고 안 고쳤다.** 5화가 `completed` 로 끝난 뒤에 넣었다.
- [x] **🔴 같은 구멍이 단기 프로젝트 이미지 경로에도 그대로 있었다 — 쌍둥이를 확인하는 게 남은 절반이었다**: 회차 쪽을 고치자마자 그 짝을 봤다. `local-image-generation.service.ts` 의 `validPng` 도 **바이트가 파싱되는지만** 물었고, 재사용 갈래(`:175`)가 그걸로 판단한다. **같은 결함, 같은 모양.**
  - 🟠 **고쳤는데 테스트가 하나도 안 깨졌다** — 즉 이 자리를 보고 있던 짝이 하나도 없었다. 그게 이 부류가 살아남는 방식이다.
  - 픽스처도 같은 문제를 안고 있었다: `PNG_BASE64` 가 `PLACEHOLDER_PNG` 와 바이트가 같고, 가짜 OpenAI 가 그걸 "산 그림"으로 **12군데**에서 돌려줬다. 회차 쪽에서 한 것과 같이 241바이트 진짜 PNG 로 갈랐다.
  - 🟢 주입: 플레이스홀더 검사를 빼면 새 짝이 빨개진다(재사용 6개, 유료 호출 0회).
  - 🟠 **오늘 두 번째로 같은 교훈이다** — 한쪽 파이프라인이 이미 그은 선을 다른 쪽이 안 긋고 있는 자리. 영상↔이미지, 단기↔회차. 이 축은 계속 훑을 값어치가 있다.
- [x] **🔴 무음 플레이스홀더가 "나레이션 있음" 으로 통과했다 — 같은 계열 세 번째, 그리고 이번엔 게이트와 렌더러가 서로 다른 답을 하고 있었다**: 키 없는 TTS 경로는 장면마다 **4바이트 무음 mp3** 를 쓴다. 병합의 "나레이션이 있나" 판정이 **파일 크기 > 0** 이었다.
  - 🔴 **회차 쪽이 특히 나빴다**: 게이트(`narrationAvailable`)는 플레이스홀더를 통과시키고, 정작 `mergeScenes` 는 그걸 **제대로 걸러 냈다**(`hasRealAudio`). 그래서 나올 수 있는 조합 중 최악이 나왔다 — **모드는 허용되고, 오류는 없고, 완성된 영상에 목소리만 없다.** 두 코드가 같은 파일들을 두고 **다른 질문**에 답하고 있었다.
  - 🟠 **단기 쪽은 둘 다 못 걸렀다** — 게이트도 렌더러도 크기만 봤다. 어긋나지는 않았지만, **무음을 나레이션으로 구워 넣고 아무 말도 안 했다.**
  - 둘 다 같은 질문을 하게 했다. **기록에 플레이스홀더 어댑터가 적힌 장면만 탈락**한다 — 기록이 아예 없는 장면은 여전히 통과시킨다. 그 필드가 생기기 전에 만든 나레이션은 진짜고, 그걸 빼앗는 건 **반대 방향의 같은 실수**다.
  - 🟠 회차에는 `placeholderNarrationScenes` 가 **이미 그 파일 안에 있었다.** 게이트만 안 쓰고 있었다.
  - 🟢 주입: 단기 쪽 검사를 빼면 새 짝이 빨개진다. 짝은 **게이트와 렌더러를 한 테스트에서 같이** 확인한다 — 둘이 갈라진 게 이 결함이었으니까.
  - 🟠 **또 아무 짝도 이 자리를 안 보고 있었다**(고쳐도 기존 테스트가 하나도 안 깨졌다). 오늘 세 번째로 같은 신호다.
- [x] **🔴 자막이 얇았던 이유: 두 폰트 다 가족에서 가장 얇은 인스턴스였다 (Cowork 556 · 배선은 내 몫)**: 캡틴D — *"글씨가 너무 얇아"*. Cowork 이 재 보니 `Noto Serif KR` 은 **ExtraLight 200**, `Noto Sans KR` 은 **Thin 100** 이 기본 인스턴스였다. `Bold: -1` 은 이미 켜져 있었고, **가족 안에 진짜 굵은 자소가 없어서** libass 가 200 을 합성으로 부풀리고 있었을 뿐이다.
  - 파일 메타데이터를 **직접 다시 확인했다**(저장소에 들어갈 19MB 바이너리다): usWeightClass 700/500, Bold 비트, fvar 제거됨, name[1]·[16] 이 자막이 부르는 이름과 일치. Cowork 측정과 전부 일치했다.
  - **더하기가 아니라 바꿔치웠다.** 네 파일 모두 타이포그래픽 가족명이 같아서, 두 파일을 남기면 **fontconfig 가중치 근접도**에 기댄다 — 이 앱이 통제도 시험도 못 하는 것이다. 가변 폰트 둘(32.6MB)을 지우고 정적 둘(19.4MB)만 남겼다: 결정적이고, **설치본이 13MB 작아진다.**
  - 🔴 **기존 짝은 이 결함을 통과시켰다** — *"이 이름의 파일이 있나"* 만 물었고, ExtraLight 로도 참이었다. **가족마다 파일 하나, 그리고 usWeightClass ≥ 500** 으로 바꿨다. 이게 처음부터 잡았어야 할 규칙이다.
  - 🟠 **비율을 다시 쟀다**(`subtitle-font-metrics.test.ts`, 실제 FFmpeg): `0.662 → 0.6712`, `0.625 → 0.6346`. **Cowork 예상보다 훨씬 작게 움직였다** — CJK 는 굵어져도 같은 칸을 더 채울 뿐 폭이 거의 안 늘어난다. 옛 값이 허용 오차 안이라 짝은 안 빨개졌지만 **낡은 값이었고**, 미리보기가 영상보다 1.5% 좁게 그리는 건 이 상수가 막으라고 있는 것이다. 실측값으로 갱신했다.
  - 🟢 **`GET /fonts/:name` 을 붙였다** — 미리보기가 영상과 **같은 바이트**로 그리게. 프런트 `public/` 에 20MB 를 복사하지 않는다(같은 바이너리 두 벌은 나중에 갈라진다). 이름은 디렉터리 목록과 **정확히 일치**해야 통과하고 경로로 합쳐지지 않으므로 `..` 이 할 일이 없다.
  - 🟠 **라우트 짝이 그 형태를 못 읽었다.** `@Get(API_ROUTES.subtitleFont(":name"))` — 빌더 호출은 스캐너가 아는 세 형태에 없었다. 기준 상수를 새로 만드는 우회로는 **"API_ROUTES 의 모든 항목은 서빙돼야 한다"** 는 그 짝의 규칙과 충돌한다(기준 상수는 라우트가 아니다). 그래서 **스캐너에 네 번째 형태를 가르쳤다** — 빌더를 매개변수 이름으로 호출하면 그 출력이 곧 패턴이다.
  - 🟢 주입: 얇은 파일을 하나 더 넣으면 폰트 짝이, 이름 검사를 무르게 하면 라우트 짝 둘이 빨개진다.
- [x] **🟢 캡틴D 결정: 모델 교체는 "기능만" — 그릇을 세웠다 (557)**: *"모델 교체는 내가 원할 때 가능하게 기능만 만들어놔."* 기본값은 `gen4_turbo` 그대로, **바꿀 수 있는 길만** 냈다.
  - 계약: `VideoModelOption { id, label, pricePerSecondUsd, ratios, maxDurationSeconds }` + `VIDEO_MODEL_OPTIONS`. **드롭다운이 아니라 단가가 본체**라는 Cowork 의 판단이 맞다 — 값이 모델을 안 따라가면 예산 검사가 옛 단가로 통과한다.
  - `videoSceneEstimatedCostUsd(seconds, model)` 로 바꿨다. 회차·단기 양쪽의 **미리보기·확인 해시·재시도 견적·advance** 가 전부 고른 모델을 지나간다.
  - 선택값은 월 한도와 **같은 자세**다 — 같은 `.env`, 매번 조회. 그래서 고른 순간 다음 견적부터 바뀐다.
  - 🔴 **`gen4.5` 를 목록에 안 넣었다.** Cowork 이 $0.12/초라고 적었지만 **내가 확인한 수치가 아니다.** $0.05/초는 추측이 아니라 이 컴퓨터의 Runway 원장이 5초 장면마다 $0.25 를 찍어 온 값의 재현이다. **확인 안 된 단가를 예산 검사 밑에 두는 건, 이 구조가 막으려고 있는 바로 그 실패다.** 실제 요율을 확인하면 계약에 한 줄이다.
  - 🟠 `ratios` 를 지금 넣었다 — `"720:1280"` 은 Runway 어휘고 여덟 파일이 안다. 지금 안 넣으면 회사를 더할 때 그 여덟을 다시 찾아야 한다(547·557 둘 다 같은 지적).
  - 🔴 알 수 없는 모델은 **거절**이지 조용한 기본값이 아니다. 값을 못 매기는 이름이 저장되면 앞선 모델 단가가 그대로 쓰인다.
  - 🟠 **주입이 안 문다는 걸 짝에 적었다**: 모델이 하나면 그 단가와 초당 상수가 같은 숫자라 바꿔치워도 초록이다. **오늘은 모양을 지키고, 두 번째 모델이 오르는 순간 값어치가 생긴다.** 안 무는 걸 무는 척하지 않는다.
  - 다른 회사 어댑터는 범위 밖(557 합의) — 프롬프트 방언이 회사마다 달라서, 그릇부터 있는 게 맞다.
- [x] **🔴 대본과 그림이 "화면에 글자가 보인다" 를 요구하고 있었다 — 거부된 클립과 못생긴 클립이 같은 뿌리다 (Cowork 557 1순위, 캡틴D "그것도 하고")**: Runway 문서가 `INTERNAL.BAD_OUTPUT` 의 1순위 원인으로 **입력 프레임의 글자·로고**와 **글자 생성을 요구하는 프롬프트** 둘을 든다. **이 앱은 둘 다 만났다** — 5화 3번의 첫 프레임이 테이프 라벨 클로즈업이라 두 번 거부되고 $0.50 이 사라졌고, 통과한 4번·6번은 **빨간 글자판이 5초 내내 화면을 잡고** 있다. 같은 뿌리의 두 얼굴이다.
  - 두 자리에 규칙을 넣었다: **대본 프롬프트**(글자가 뜨는 것을 장면의 주된 사건으로 삼지 말 것)와 **이미지 프롬프트**(읽히는 글자를 그리지 말 것). 입력 프레임이 원인이라 이미지 쪽이 더 중요하다 — 그 프레임을 만드는 게 이미지 단계다.
  - 🔴 **기록과 전송을 갈랐다.** 상수 한 줄을 기록 프롬프트에 넣으면 **이제까지 만든 그림이 전부 "장면 내용이 바뀐 뒤로" 로 뜬다**(이 컴퓨터에 30장, 한 장도 안 바뀌었는데). `styleStale` 주석이 적어 둔 그 함정이고, 이번엔 반대편에서 같은 함정이다. 규칙은 **그리는 방법에 대한 말**이지 장면에 대한 말이 아니라, 참조 노트와 같이 요청에만 실린다.
  - 🟠 단기 쪽은 **보낸 프롬프트를 그대로 기록하고 있었다** — 회차 쪽은 이미 둘로 나눠 두었는데 단기만 하나였다. 같은 모양으로 맞췄다(오늘 네 번째 쌍둥이 비대칭).
  - 🟢 주입: 규칙을 빼면 새 짝 둘이, 규칙을 기록에 넣으면 기존 짝 둘이 빨개진다. **양쪽이 서로 반대 방향을 지킨다.**
- [x] **🔴 라벨 수정이 걷어낸 지시가 `Pacing` 줄에 그대로 살아 있었다 — ①의 진짜 절반 (Cowork 557 2순위)**: `Opening/Main/Ending movement` 를 `Starts at / Action / Ends at` 으로 바꿔 한 컷 안의 **멈춤 → 급발진 → 순간이동**을 없앴는데, **같은 지시가 다른 문으로 들어오고 있었다.**
  - 실데이터 30개 프롬프트의 `Pacing` 값을 다 뽑아 보니 여럿이 **시간에 따른 변화**를 지시한다: `정적 후 급격함` · `느림에서 빠름으로 전환` · `처음에는 느리다가 … 급격히 빨라진다`. **5초 한 컷에 두 박자를 요구하는 문장이다.**
  - 🟠 Cowork 이 프레임으로 본 것과 맞아떨어진다 — **5화 6번**(`느림에서 빠름으로 전환; intensity 최고`)이 3.7초부터 하얗게 날아간다.
  - 🔴 **영상 프롬프트 템플릿을 안 고쳤다.** `Pacing` 줄을 빼거나 바꾸면 **기록된 30개 프롬프트가 전부 낡음으로 뜬다**(`videoStale` — "장면 내용이 바뀐 뒤로", 장면은 안 바뀌었는데). 이미지 규칙 때와 같은 함정이고, 여기서는 요청/기록을 가를 수도 없다 — 기록이 곧 보낸 것이어야 한다.
  - 그래서 **원천을 고쳤다**: 대본 프롬프트가 *"장면 전체에 걸친 하나의 상태만 적고, 속도가 달라져야 하면 장면을 나누라"* 고 말한다. **새 대본부터 적용되고 기존 기록은 하나도 안 움직인다.** 라벨 수정이 통했던 것과 같은 지렛대 — 렌더가 아니라 지시를 고친다.
  - 🟠 **영상 템플릿에서 `Pacing` 을 아예 뺄지는 캡틴D 몫으로 남긴다.** 빼면 30개가 낡음으로 뜨고, 유료 출력이 바뀌는 결정이다. 근거는 있다 — 프롬프트가 길면 **이 앱이 이미 제일 먼저 버리는 섹션**이 `Pacing` 이고(`removable` 첫 자리), 구체적 동작은 `Starts at/Action/Ends at` 이 이미 다 말한다.
  - 🟢 주입: 규칙을 빼면 새 짝 둘이 빨개진다. 짝은 **유료 프롬프트 본문**에서 확인한다 — 옆 주석이 아니라.
- [x] **🔴 완료된 회차가 자기 영상 목록에 409 를 냈다 — 읽기를 쓰기처럼 막고 있었다 (Cowork 관측)**: `review()` 가 `videos_review`·`videos_approved` 만 허용해서, 병합까지 끝나 `completed` 가 된 회차가 **자기 클립 목록을 거절**했다. 시도한 건 읽기뿐인데 *"영상 작업을 할 수 없습니다"* 가 나온다.
  - 🟠 Cowork 이 5화에서 실측했고, 그 때문에 화면에서 **같은 호출 세 자리를 감싸야** 했다(마운트·폴링·복구). 그중 복구 갈래가 제일 나빴다 — **가져오기가 이미 성공한 뒤**에 "할 수 없습니다" 가 뜬다.
  - 🟢 **이미지 쪽은 처음부터 이 선을 긋고 짝에 적어 두었다**: *"Reading is not reviewing: the acts still refuse at a stage that has moved on."* 오늘 다섯 번째 쌍둥이 비대칭이다.
  - 읽기는 이제 **"클립이 실제로 있는가" 하나만** 묻는다. 생성 중이면 그 검사에 걸리므로 *"아직 아무것도 없다"* 는 여전히 거절이다.
  - 🔴 **하마터면 승인까지 열 뻔했다** — `approve` 가 `review()` 를 게이트로 쓰고 있었다. 읽기를 풀면 **병합 끝난 회차를 다시 승인**할 수 있게 된다. 승인에 자기 상태 게이트를 돌려줬다(전과 같은 두 상태).
  - 🟠 기존 짝 하나가 **옛 구현의 부수 결과**를 못박고 있었다(폴링이 이르면 검토가 거절된다). 그 짝의 주제는 *"상태가 옮겨지기 전에 succeeded 라고 말하지 말 것"* 이고 거절은 곁다리였다 — 성질로 다시 적었다: **클립이 있으니 읽기는 되고, 단계가 지났으니 승인은 안 된다.**
  - 🟢 주입: 읽기를 다시 막으면 짝 둘이, 승인 게이트를 빼면 짝 둘이 빨개진다.
- [x] **🔴 "코드가 없다" 를 "공짜였다" 로 답하고 있었다 — Cowork 이 잡았고, 원장이 증거다 (563)**: `sceneFailureFor` 가 제공자 코드가 없으면 `billedOnFailure: false` 를 냈다. **두 사실이 아니다.**
  - 🔴 **5화 3번이 두 번 실패하며 원장에 $0.25 두 줄을 남겼다.** 그 기록은 `failure_code` 필드가 생기기 전 것이라 코드가 없다 — 옛 규칙이면 화면이 캡틴D 에게 *"청구되지 않았습니다"* 라고 말하는데 **그의 원장이 그 문장을 반박한다.**
  - **틀린 "청구됐습니다" 는 잠깐 갸웃하는 값이고, 틀린 "청구 안 됐습니다" 는 돈이다.** Cowork 이 화면에서 `false` 를 침묵으로 다루기로 한 판단이 옳았고, 계약이 그렇게 만들 필요가 없게 고쳤다.
  - 이제 **보내기 전에 이 앱이 거절한 것만** 공짜로 보고한다(`budget_exceeded` · `budget_ledger_unreadable`) — 그것만 실제로 알 수 있는 것이다. 타임아웃·빈 출력·중단된 제출·코드 이전의 제공자 문장은 전부 **청구됨**: 작업은 이미 제출됐고 이 제공자는 실패도 청구한다.
  - 🟢 주입: 옛 규칙으로 되돌리면 짝이 빨개진다.
- [x] **🟢 인계 예외가 스스로 사라졌다 — 장치가 설계대로 돌았다**: `sceneFailures` · `providerCode` 를 옵셔널 필드 짝의 예외로 적으면서 *"화면이 읽는 순간 이 줄은 실패한다"* 고 썼는데, **Cowork 이 읽자 정확히 그렇게 실패했다.** 지웠다. 예외가 인계였고, 인계가 끝나자 예외가 자기를 끝냈다.
- [x] **🔴 값이 모델을 안 따라가는 구멍이 계약 함수 안에 있었다 — Cowork 의 짝이 잡았다 (565)**: `videoSceneEstimatedCostUsd(seconds, id)` 가 **모르는 id 를 목록 첫 옵션의 단가로 조용히 계산**했다(`videoModelOption` 의 폴백). 그쪽이 두 번째 옵션을 prop 으로 넣고 카드를 그려 보니 **모든 줄이 기본 모델의 $0.05 로** 나왔다.
  - 🔴 **이 설계가 막으려던 바로 그 실패다** — *"값이 모델을 안 따라가는 선택기는 없느니만 못하다"*. 다른 모델에 대해 조용히 답하는 건 **바꾸기 전의 평평한 상수보다 나쁘다**: 움직인 것처럼 보이니까.
  - 옵션 객체를 그대로 받게 넓혔다. 옵션을 쥔 쪽(화면)은 그걸로 값을 매기고, 이름만 쥔 쪽(서버)은 그 이름이 `resolveVideoModel` 에서 온 우리 것이라 폴백이 여전히 그 함수의 일이다.
  - 🟠 **한 개짜리 목록이라 내 짝은 이걸 못 잡았다**(557에 그렇게 적어 뒀다 — "두 번째 모델이 오르는 순간 값어치가 생긴다"). Cowork 이 **가상의 두 번째 옵션을 화면에 직접 넣어** 그날을 앞당겨 재 봤다. 계약 짝에도 같은 방식으로 넣었다.
- [x] **🔴 오늘 붙인 안내 문구 하나가 거짓이었다 — 세 번째 하드코딩 $10 을 못 보고 지나갔다**: `45032ae` 로 모든 예산 거절에 *"설정 화면에서 한도를 올릴 수 있습니다"* 를 붙였는데, `VIDEO_BUDGET_EXCEEDED` 만은 **그 한도를 안 본다.**
  - `local-video-submission.service.ts` 에 자기만의 `DEFAULT_MONTHLY_BUDGET_USD = 10` 이 있고, 제출 하나의 총액을 그 값과 비교한다. **설정에서 Runway 를 $14 로 올려도 이 검사는 10 그대로다** — 즉 문구가 *"가서 올리세요"* 라고 시키는 숫자가 안 움직인다.
  - 🟠 **오늘 가격으로는 도달 불가라서 놓치기 쉬웠다**(12장면 × 10초 = $6.00). **그런데 오늘 내가 만든 모델 기능이 이걸 살린다** — 초당 $0.12 면 같은 12장면이 $14.40 이고, 그때 제일 먼저 거절하는 게 이 자리다.
  - 이제 **다른 검사와 같은 월 한도**를 본다. *"이 요청 하나가 한 달치보다 비싸다"* 는 장면별 preflight 이전에 말할 수 있는 유일한 것이고, 그러면 문구도 참이 된다. 생성자 인자는 자기 값을 넣는 짝들을 위해 남겼다.
  - 🟠 **또 아무 짝도 이 자리를 안 보고 있었다** — 고쳐도 기존 테스트가 하나도 안 깨졌다. 오늘 네 번째로 같은 신호다.
  - 🟢 주입: 자기 상수로 되돌리면 새 짝이 빨개진다(월 $1 이 6장면 $1.50 을 막아야 하는데 안 막는다).
- [x] **🔴 「이미 낸 돈으로 가져오기」가 정작 제일 필요한 장면을 건너뛰고 있었다 (두 파이프라인 다)**: 복구는 기록이 `succeeded` 인 장면만 봤다.
  - 🔴 **`failed` 는 Runway 가 뭘 만들었는지와 아무 상관 없는 이유로도 붙는다.** `timeout` 은 **작업이 아직 돌고 있는데 우리가 기다리기를 그만둔 것**이고(`runway-workflow-support.ts:155`), `no_output` 은 성공한 작업에 URL 이 아직 안 붙은 그 순간에 적힌다. **둘 다 원장에 이미 올라가 있고**, 둘 다 Runway 쪽에 완성된 클립을 남긴다.
  - 그런데 그 클립으로 돌아가는 유일한 길이 **정확히 그 장면들을 지나쳤다.** 남는 길은 「다시 시도」 = **같은 초를 두 번 사는 것**뿐. 복구가 존재하는 이유가 그건데.
  - 🟠 판별은 **제공자에게 묻는 것**으로 충분하다. 진짜로 실패한 작업은 아래에서 `no_output` 으로 떨어진다 — 실패 문자열 화이트리스트가 필요 없다.
  - 🔴 **바이트만 되찾으면 반쪽이다.** 장면은 연속성 의존이라 실패 기록 하나가 작업 전체를 멈춘다. 되찾고도 `failed` 로 두면 **재생되지 않는 유료 클립 옆에서 멈춘 채**로 있다. 그래서 기록도 `succeeded` 로 되돌린다.
  - 🟠 **그러면 작업이 다시 이어지고 남은 장면이 생성된다** — 시작할 때 낸 돈이 그거지만, **"가져오기" 라고 적힌 버튼 뒤의 지출**이다. 화면이 그렇게 말하도록 568로 넘겼다.
  - 🟠 이미 `failed` 인 기록은 `empty_output` 으로 **덮어쓰지 않는다** — 제공자 사유와 `failure_code` 는 화면이 "그대로 다시 보내도 되나"·"청구됐나" 를 고르는 근거다.
  - 🟢 주입: 두 파일 각각 옛 필터로 되돌리면 새 짝이 정확히 하나씩 빨개진다. 백엔드 1442.
- [x] **🔴 Runway 가 문서에 적어 둔 두 원인 중 하나만 막고 있었다 — 영상 프롬프트가 글자를 요구한다**: `INTERNAL.BAD_OUTPUT` 의 첫 원인 둘은 **입력 프레임 위의 글자·로고**와 **글자를 요구하는 프롬프트**. 앞의 것은 이미지 프롬프트 쪽에서 막았는데 뒤의 것은 열려 있었다.
  - 🟢 **가정이 아니라 실측이다.** 영상 프롬프트가 쓰는 필드에서만 골라 살아 있는 프로젝트를 훑었다(238장면):
    ```
    12/Episode01 2장면   end_motion  '먼지가 걷힌 케이스 위에서 'IBAD'라는 손글씨가 드러나고…'
                         camera_motion '…케이스 글씨로 빠르게 돌리 인한다'
    12/Episode03 4장면   environment_motion '광고 문구가 낙서를 덮었다가 다시 갈라진다'
    IBAD/Episode01 2장면 main_motion '허공의 분류 문구가 …교차 표시된다'
    IBAD/Episode01 4장면 environment_motion '네온 간판이 물웅덩이에 흔들리며…'
    ```
    첫 줄이 **문서에 적힌 실패 그 자체**다 — 마지막 박자가 글자이고, 카메라가 그 글자로 들어간다.
  - 🔴 **기록이 아니라 요청 때만 붙인다.** 기록된 프롬프트에 상수 한 줄을 넣으면 **43개 전부 구식**이 된다 — 아무도 안 쓴 줄 때문에 43장면이 "프롬프트가 바뀌었습니다" 를 읽는다. 이미지 쪽과 같은 갈래다.
  - 🟠 **붙이는 자리는 어댑터** — Runway 로 나가는 문이 거기 하나고, 두 파이프라인이 다 지나가며, 세 번째 호출자가 잊을 수 없다.
  - 🔴 **자리를 미리 떼어 놓는다**(`RUNWAY_PROMPT_AUTHORING_LIMIT = 1000 - 78 = 922`). 1,000 까지 받아 놓고 규칙을 붙이면 **어댑터가 제출 직전에 그 장면을 거절**한다 — 돈은 안 나가지만, 괜찮다고 말해 준 한계에서 작업이 멈춘다. 나중에 검사하는 대신 방을 먼저 뺀다.
  - 🟢 지금 기록된 43개는 **493~902자**라 아무것도 안 움직인다. 여유 20자.
  - 🟠 화면 글자수 세기도 같은 상수를 본다 — 1,000 을 세면서 서버가 922 에서 거절하면 그게 사본 문제다.
  - 🟢 주입: 예약을 없애면(=1,000 그대로) 한계까지 쓴 프롬프트가 어댑터에서 거절되어 새 짝이 빨개진다. 타입체크 0 · 백엔드 1444 · 프론트 1335.
- [x] **🔴 계약이 이미 선언한 문자열 하나가 열 군데에 다시 적혀 있었다**: 완성 영상 경로 `videos/final/instagram_reel.mp4` — 백엔드 다섯, 프론트 넷, 그리고 **계약 자신의 응답 필드 둘**(그 필드 타입이 바로 이 문자열이다).
  - 🔴 **프론트 사본 둘은 응답 가드 안에 있다.** 이름이 바뀌면 시끄럽게 깨지는 게 아니라 **완성된 영상이 완성된 것으로 인식되지 않게** 된다.
  - 🟠 회차 디렉터리 배치는 바로 이 이유로 `LONG_STORY_DIRECTORY` 하나로 모아 뒀는데(그 주석이 그렇게 적혀 있다), **그 끝에 있는 파일은 안 모아져 있었다.**
  - 🟢 이제 `FINAL_VIDEO_RELATIVE_PATH` 한 집. 계약 필드 둘도 `typeof` 로 그걸 가리킨다.
  - 🟢 **감시도 붙였다** — 값 집합만 사본이 되는 게 아니다. 계약의 **경로 모양 상수**(값에 `/` 가 든 것)를 앱 소스가 다시 타이핑하면 두 앱 각각에서 빨개진다. 파서가 아무것도 못 찾으면 그것부터 실패한다.
  - 🟢 주입: 가드 한 줄을 문자열로 되돌리면 프론트 감시가 그 파일을 이름 대서 빨개진다. 타입체크 0 · 백엔드 1446 · 프론트 1337.
  - 🟠 `longProjectsApi.ts` 는 Cowork 미커밋 작업이 있는 파일이라 **내 두 줄만 인덱스에 올렸다**(그쪽 작업은 작업 트리에 그대로).
- [x] **🔴 `BAD_OUTPUT` 이 "알 수 없는 오류" 로 뭉개진다 (3811의 그 항목, 계약·서버 절반)**: 화면 표는 **이 앱의 범주**로 문장을 고르는데, Runway 작업 실패의 범주는 **제공자의 영어 원문**이라 매번 빗나가서 폴백으로 떨어진다.
  - 🔴 **그 폴백이 바로 "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." 다** — 두 번 따라 눌러 두 번 청구된 그 문장이, **지금은 올바른 조언 바로 위에** 뜬다. 한 실패에 대해 두 문장이 정반대를 말한다.
  - 🟠 **표를 둘로 만들 뻔했다.** 어댑터가 코드로 `remedy` 를 고르고, 화면이 같은 코드들로 문장을 고르면 **같은 문자열을 키로 삼는 목록이 둘**이 된다 — 이번 주 내내 잡아 온 그 사본이고, 하필 최악의 방향으로 갈라진다.
  - 🟢 한 표로 계약에 뒀다(`PROVIDER_TASK_FAILURES` · `providerTaskFailure`). 접두사 매칭 — 코드에 변형 접미사가 붙는다(`INTERNAL.BAD_OUTPUT.CODE01`). `runwayFailureOutcome` 은 이제 이 표를 읽는다.
  - 🟠 **문장은 원인만 말한다.** 청구 여부는 `billedOnFailure` 의 문장이고, 한 사람의 돈에 대해 두 자리에서 말하면 둘이 어긋난다.
  - 🟢 짝 넷: 접미사째 인식 / 모르는 코드는 **아무 답도 안 함**(호출자 기본값이 정직한 바닥) / **기다리라고 말하지 않음**(기다려서 안 풀리는 실패에) / 프롬프트에 청구를 적지 않음.
  - 🟢 주입: 접두사 매칭을 완전 일치로 바꾸면 `.CODE01` 이 인식 안 돼 짝이 빨개진다. 타입체크 0 · 계약 42 · 백엔드 1446 · 프론트 1337.
  - 🟠 **화면 한 줄이 남았다** — `sceneErrorMessage(code)` 가 `providerCode` 를 먼저 보게 하는 것. 그 파일은 Cowork 미커밋 작업 안이라 라운드로 넘겼다.
- [x] **🟠 오늘 네댓 번 이름 없이 지나간 그 빨간 줄 — 이름이 나왔고, 다음번엔 증거를 들고 오게 했다**: `assets.cross-process.test.ts` 다. 백엔드 전체 실행 한 번에서 실패했고, 그 뒤로 **단독 5회 · 전체 3회 전부 초록**이라 재현은 못 했다.
  - 🔴 **이름이 없던 이유**: `execFile` 이 거부하면 메시지가 `Command failed` 뿐이다. **타임아웃에 죽은 자식과 자기 단언이 실패한 자식을 구별할 수 없고**, 읽을 때쯤이면 `afterEach` 가 디렉터리를 지운 뒤다.
  - 이제 실패가 이렇게 온다: 죽임당했는지 · 종료 코드 · 시그널 · 자식 출력 꼬리, 그리고 개수가 틀리면 **라이브러리 목록과 `assets.json`** 까지.
  - 🟠 **재시도도, 타임아웃 늘리기도 일부러 안 했다.** 놀고 있는 기계에서 자식 하나가 **0.8초**인데 예산은 20초다 — 타임아웃은 설명으로 빈약하고, 더 늘리면 정체가 뭐든 덮기만 한다. 이 짝이 지키는 건 **두 프로세스가 한 에셋 라이브러리에 쓰는 것**이다. 부하에서 그게 안전하지 않다면 **이 깜빡임이 발견이지 잡음이 아니다** — 지금은 둘 중 뭔지 알 방법이 없었다.
  - 🟢 주입 둘: 자식 예산을 1ms 로 하면 `killed by timeout: true · SIGTERM` 이 찍히고, 두 번째 writer 를 첫 번째와 같게 하면 목록과 JSON 이 찍힌다.
- [x] **🟠 두 병합이 배경음 기본값을 각자 답하고 있었다 — 갈라지면 완성된 영상에서 들린다**: 0.25 두 벌, 2 두 벌, *"어떤 모드가 트랙을 쓰나"* 두 가지 표현, *"bgm 혼자면 원래 크기"* 두 벌.
  - 지금은 서로 같다 — **이 저장소의 모든 사본이 갈라지기 전까지 그랬던 그대로다.** 그리고 갈라진 둘은 둘 다 사람이 읽다가 찾았지 무엇이 실패해서 찾은 게 아니다.
  - 🔴 여기서의 드리프트는 **들린다.** 같은 모드가 두 파이프라인에서 다르게 섞이고, 어느 쪽을 듣고 있는지 화면은 말해 주지 않는다.
  - 🟠 백엔드가 아니라 **계약에 뒀다** — `MergeAudioSettings.volume` 은 선택 필드다. 안 보내는 클라이언트는 자기가 뭘 받는지 알 권리가 있고, 지금은 영상을 만들어 봐야 안다.
  - 🟢 짝 둘: **목소리 밑으로 깔되 목소리가 없으면 비키는 것**(0.25 vs 1), 그리고 **트랙을 쓰는 모드 목록을 계약의 모드에서 걸러서** 만든다 — 다섯 번째 모드가 결정 없이 들어오면 조용히 "트랙 없음" 이 되는 대신 빨개진다.
  - 🟢 주입: `bgm` 갈래를 없애면 첫 짝이 빨개진다. 타입체크 0 · 계약 44 · 백엔드 1446 · 프론트 1341.
- [x] **🟠 세 플레이스홀더 중 나레이션만 집이 없었다 — 그리고 그중 하나는 진짜로 어긋날 수 있는 자리였다**: 같은 사실이 다섯 군데에 적혀 있었다. 4바이트가 세 서비스에, 어댑터 이름이 네 군데에.
  - 🔴 **다섯 번째가 문제였다**: `narration-review.service.ts` 는 **상수를 import 해 놓고 그 옆에 맨 문자열을 쓰고 있었다**(57행은 상수로 비교, 129행은 문자열로 기록). 상수를 바꾸면 **그 파일이 한 값을 쓰고 같은 파일이 다른 값을 비교한다** — 방금 만든 스텁이 진짜 나레이션으로 읽힌다. 아무것도 실패하지 않는다.
  - 클립·이미지 플레이스홀더는 각각 집을 얻었다 — **"플레이스홀더가 뭔지 아는 자리의 수" 가 곧 "서로 다르게 알 수 있는 자리의 수"** 였기 때문이고, 실제로 그랬다. 나레이션이 셋 중 마지막이었다.
  - 🟠 **`isPlaceholderNarration(bytes)` 은 일부러 안 만들었다** — 다른 둘과의 차이다. 4바이트 헤더는 크기가 0이 아닌 멀쩡한 MP3라 **파일에 물어볼 수 없다.** `size > 0` 을 물어본 게 무음 스텁을 목소리처럼 완성 영상에 넣은 그 결함이다. 아는 건 기록의 `PLACEHOLDER_ADAPTER` 뿐이고, 모든 호출자가 그걸 읽는다.
  - 🟢 감시 둘: 자기 모듈 말고 어떤 서버 소스도 **어댑터 이름**이나 **그 바이트**를 다시 쓰지 못한다. 주입: 129행을 문자열로 되돌리면 파일 이름을 대며 빨개진다. 타입체크 0 · 백엔드 1448.
- [x] **🔴 인스타그램의 두 한계 중 하나는 서버가 아예 안 세고 있었다 — 그 서비스 자기 주석이 왜 세야 하는지 써 놓고서**: `instagram-publish.service.ts` 의 글자수 검사 주석은 *"화면을 건너뛴 호출자가 업로드가 끝난 뒤에 거절당하지 않도록"* 이라고 적혀 있다.
  - 🔴 **해시태그 30개 한계는 화면에만 있었다.** 그래서 그 주석이 말하는 바로 그 경우가 열려 있었고, **이쪽이 더 나쁘다** — 컨테이너(미디어 업로드)가 먼저 만들어지고 거절은 마지막 publish 호출에서 온다.
  - 🟠 **글자수 2200 은 두 벌**이었다(화면 하나, 서버 하나). 그 약속을 떠받치는 숫자가 둘이면 **한 번의 수정으로 약속이 깨진다.**
  - 🟢 계약에 `INSTAGRAM_CAPTION_MAX` · `INSTAGRAM_HASHTAG_MAX` · `instagramHashtagCount(caption)` 로 뒀다. **되돌릴 수 없는 유일한 게시**라서 둘이 같은 숫자를 봐야 한다.
  - 🔴 **세는 방식도 하나여야 한다.** 화면은 *해시태그 칸*만 셌는데, **본문에 쓴 태그도 같은 한계에 들어간다** — 인스타그램이 31로 읽는 캡션을 화면은 29로 표시했다. 이제 둘 다 캡션 전체를 같은 함수로 센다(화면의 `해시태그 N/30` 표시도 그 숫자다). 서버가 화면이 받아들인 것을 거절하는 일이 없다.
  - 🟠 맨 `#` 는 태그가 아니고(`10 # 20`), 한글 태그는 센다 — ASCII 만 보는 카운터는 이 앱이 실제로 쓰는 캡션에 대해 늘 0을 답한다.
  - 🟢 짝: 계약 넷 + 서버 하나(둘 다 **컨테이너 생성 전에** 거절되고, 딱 한계면 통과한다). 주입: 해시태그 검사를 빼면 서버 짝이 빨개진다. 타입체크 0 · 계약 48 · 백엔드 1449 · 프론트 1341.
- [x] **🟠 D-036 의 *"모든 모듈이 이 한 코드를 보내서 사람이 한 문장을 읽는다"* 를 일곱 개의 문자열이 떠받치고 있었다**: 오류 팩토리 다섯이 `"BUDGET_LEDGER_UNREADABLE"` 를 각각 써 넣고, 백엔드 상수 하나, 프론트 상수 하나.
  - **여섯이 일치하는 것과 하나가 존재하는 것은 다르다.** 일곱 번째가 어긋나면 유료 경로가 **어느 화면도 모르는 코드**로 답하고, 특별히 일반적이지 않은 실패에 대해 일반 문구가 나온다.
  - 영어 문장(`"Monthly spend could not be read…"`)도 다섯 벌이었다 — 하나로 모았다.
  - 🟢 코드는 계약에, 문장은 백엔드에 한 집씩. 프론트는 계약 것을 재수출한다.
  - 🟠 **유니온 타입 안의 리터럴은 그냥 뒀다** — 그건 이미 컴파일러가 잡는다. 팩토리가 상수를 그 유니온으로 타입된 생성자에 넘기므로, 유니온이 더 이상 포함하지 않는 값은 빌드가 안 된다. **감시 대상은 유니온이 아니라 맨 문자열을 쓰는 팩토리** 라서, 감시가 `|` 가 든 줄을 건너뛴다.
  - 🟢 경로 상수 감시를 **한 값짜리 계약 상수** 전체로 넓혔다(경로 모양 또는 SCREAMING_SNAKE 모양). 주입: 팩토리 하나를 맨 문자열로 되돌리면 파일 이름을 대며 빨개진다.
  - 타입체크 0 · 백엔드 1449 · 프론트 1343.
- [x] **🔴 한 장면이 몇 초짜리인지 정하는 식이 두 벌이었다 — 그건 길이이자 곧 가격이다**: 회차 두 서비스가 `Number(duration_seconds) / sceneCount >= 7.5 ? 10 : 5` 를 각자 적어 뒀고, 한쪽 주석은 *"다른 쪽과 같은 도출"* 이라고 써 놓았다.
  - 🔴 **Runway 는 초당 과금이다.** 한쪽이 10, 다른 쪽이 5를 답하면 **견적이 두 배로 갈린다** — 어긋나는 두 절반이 하필 **버튼 앞에 보여 주는 가격**과 **실제로 제공자에게 보내는 길이**다.
  - 7.5 라는 중간값이 두 번 적혀 있으면, 한 번의 수정으로 두 가지로 적히게 된다.
  - 🟢 계약에 `clipDurationSecondsPerScene(total, sceneCount)` 하나로. 반환 타입도 `RunwayClipDurationSeconds` 라 5·10 이 아닌 값은 타입이 막는다.
  - 🟠 **내림이 아니라 가까운 쪽**이다 — 장면당 정확히 7.5초는 10에 더 가깝고, 내리면 **실제로 만드는 것보다 짧은 클립을 견적**하게 된다(돈을 낮게 부르는 방향, 이건 절대 틀리면 안 되는 방향이다).
  - 🟢 짝 셋: 항상 Runway 가 받는 두 값 중 하나 / 7.5 는 10 / 그 길이가 그대로 견적으로 이어진다. 주입: `>=` 를 `>` 로 바꾸면 빨개진다. 계약 51 · 백엔드 1449.
- [x] **🟠 "말 안 하는 기록은 몇 장면인가" 를 양쪽이 각자 적어 두고 있었다**: 저장된 개수가 검증에 걸린 단기 프로젝트와, `scene_count` 가 생기기 전에 쓰인 회차 — 둘 다 6으로 되돌아가는데 상수는 두 벌이었다.
  - 위험한 건 **둘이 6에 대해 의견이 갈리는 게 아니라**, 경계(2~12)가 움직이는 동안 **기본값만 안 따라가서 합법적인 개수가 아니게 되는 것**이다. 그러면 되돌아간 그 값이 자기를 보낸 검증에 다시 걸린다 — 열 수 없는 프로젝트다.
  - 🟢 그래서 검사받는 경계 **바로 옆** 계약에 뒀다. 짝 둘: 경계 안에 있을 것, 그리고 다른 개수와 똑같이 1..n 으로 번호가 매겨질 것. 주입: 16 으로 바꾸면 둘 다 빨개진다.
- [x] **🟠 다이제스트 모양 검사가 아홉 벌이었다 — 전부 디스크나 회선에서 온 식별자의 관문이다**: `/^[a-f0-9]{64}$/` 가 서버 넷(요청·저장 검증), 클라이언트 넷(응답 가드), 화면 하나.
  - 🔴 **이 검사가 틀리는 방식은 조용하다**: 한 사본에서 앵커(`^$`)만 빠지면 **뒤에 무엇이 붙은 다이제스트도 통과한다** — 그러면 지문 비교가 **다시는 불일치를 못 내는** 비교가 된다.
  - 🟢 계약에 `isSha256Hex(value)` 하나로. **정규식 상수가 아니라 함수로** 내보냈다 — 공유된 정규식 객체는 누군가 `g` 플래그를 붙이는 순간 공유 가변 상태가 되고, `lastIndex` 때문에 **다른 호출자들이 한 번 걸러 다른 답을 하게 된다.**
  - 🟢 짝 넷: 64자 소문자 hex 만 통과 / 양끝이 앵커라 무엇도 함께 못 탄다 / 길이·대문자 거절(대문자를 접지 않는 이유: 이 앱은 소문자로 쓰고, 둘 다 받으면 같은 해시의 두 표기가 문자열 비교에서 불일치가 된다) / 문자열이 아니면 예외가 아니라 false.
  - 🟠 여섯 자리를 옮겼다. **남은 셋(`longProjectsApi.ts` · `mappingsApi.ts` · `MappingReviewScreen.tsx`)은 Cowork 미커밋 작업 안이라 라운드로 넘겼다.**
  - 🟢 주입: 앵커를 빼면 짝 둘이 빨개진다. 계약 57 · 백엔드 1449 · 프론트 1343.
- [x] **🟠 데스크톱이 "어떤 폴더를 열어 주는가" 를 백엔드 허용 목록의 손으로 베낀 사본으로 정하고 있었다 — 주석만 "미러" 라고 말할 뿐**: `apps/desktop/src/project-path.ts` 의 `SAFE_PROJECT_ID_PATTERN` 은 `apps/backend/src/projects/project-id.ts` 것과 같은 식이고, 둘을 붙들고 있던 건 **주석 한 줄**이었다.
  - 🔴 **이 허용 목록은 경로 탈출 거절의 절반**이다. 사본이 넓게 갈라지면 **백엔드가 열어 주지 않을 폴더를 데스크톱이 연다** — 그리고 조용히 갈라진다. 양쪽 다 자기 테스트는 계속 통과하니까.
  - 🟠 **공유가 아니라 검사로 막았다.** 데스크톱은 `@ai-animation-studio/shared` 에 의존하지 않는다(의존을 만들면 **설치 프로그램이 실어야 할 것이 달라진다**). 패키징은 사용자 요청 전까지 안 건드리기로 한 영역이라, 런타임 결합 없이 **백엔드 소스에서 리터럴을 읽어 비교**하는 짝을 데스크톱 워크스페이스에 넣었다.
  - 🟢 짝 셋: 식과 플래그가 같을 것 / 경로 탈출을 가르는 이름들(`..` `.` `a/b` `a\b` `C:` `a.b` 빈 문자열 등)에 대해 **양쪽 답이 같을 것** / 그리고 허용된 id 라도 상대 경로로 자기 폴더 밖을 못 나갈 것.
  - 🟢 주입: 데스크톱 쪽 목록에 `.` 하나만 더해도 짝 둘이 빨개진다. 데스크톱 37(34 → +3).
- [x] **🔴 클립 경로가 파일을 내주기 전에 묻는 두 질문이 여섯 자리에 흩어져 있었고, 이미 갈라져 있었다**: *"이 실행이 제공자에 닿았나"* 와 *"이 파일이 그 클립 노릇을 할 수 있나"*. 한 자리의 주석은 이미 **"같은 판단이 사는 다섯 번째 자리"** 라고 세고 있었다.
  - 🔴 **실제 차이가 있었다**: 회차 병합은 `(item as VideoRecord).execution_mode` 로 **맨 캐스트**를 썼고 단기는 모양을 먼저 검사했다. 기록 하나가 망가지면 **한쪽은 병합 도중 TypeError 를 던지고** 다른 쪽은 "유료 실행 아님" 으로 읽는다.
  - 🔴 **둘 다 갈라져도 시끄럽게 안 깨진다.** "유료 아님" 이라고 답하면 실행이 **느슨한 파일 검사**로 넘어가고, 느슨한 검사가 바로 **스텁 여섯 개를 유료 클립으로 통과시킨** 그 검사다.
  - 🟢 `placeholder-clip.ts` 에 `wasPaidRun(records)` · `isUsableClip(stat, paid)` 로 모았다. 그 모듈 주석이 이미 *"플레이스홀더가 뭔지 아는 자리의 수 = 서로 다르게 알 수 있는 자리의 수"* 라고 적어 둔 집이다.
  - 🟠 **`paid` 를 접어 넣지 않고 인자로 고른다** — 느슨한 답이 로컬 가짜 경로에서는 **옳기** 때문이다(거긴 일부러 플레이스홀더를 쓰고 내주는 게 정상 동작이다). 복구는 무조건 `true` 를 넘기는데, 그게 복구가 찾는 것("누가 돈 낸 클립")의 정직한 표현이다.
  - 🟠 그리고 두 자리는 `{ size }` 만 뽑아 써서 **`isFile()` 을 안 물었다** — `scene1.mp4` 라는 이름의 디렉터리가 stat 도 되고 크기도 있다. 이제 전부 묻는다.
  - 🟠 곁다리: 라이브러리 스캔에 `? ... : 6` 인라인 기본값이 하나 더 있었다 — 방금 계약으로 모은 `DEFAULT_SCENE_COUNT` 로 바꿨다.
  - 🟢 짝 다섯. 주입: `wasPaidRun` 에서 모양 검사를 빼면(=회차 쪽 옛 표현) 그 짝이 빨개진다. 백엔드 1455.
- [x] **🟠 "이 파일을 못 읽었을 때 사람에게 뭐라고 말하나" 가 열한 벌이었다**: 회차·장기 서비스 아홉이 `private json`, 하나가 `readJson`, 하나는 인라인 — 전부 같은 try/catch.
  - 🔴 **배관이 아니다.** 세 갈래가 **화면의 세 가지 다른 문장**이고, 각각 사람을 **다른 곳으로 보낸다**:
    ```
    ENOENT       "없음" — 실패가 아니다. 대본 전 회차는 per-episode project.json 자체가 없다(정상 상태)
    SyntaxError  파일 탓이지 디스크 탓이 아니다 — 저장 오류로 말하면 멀쩡히 읽히는 파일을 두고
                 권한과 여유 공간을 확인하러 보낸다
    그 밖        저장 오류. 일부러 마지막 — 모르는 실패를 위 둘 중 하나로 조용히 분류하면 안 된다
    ```
  - 열한 벌이 오늘은 일치했다. **못 견디는 건 그중 하나가 손질되는 것**이다 — 한 서비스만 "없는 회차" 를 저장 실패로 답하면, **그 화면 하나에서만 디스크가 죽어 가는 것처럼 보이고** 나머지 화면은 전부 프로젝트가 멀쩡하다고 말한다.
  - 🟢 `long-project-json.ts` 한 집으로. 호출 자리 53개를 기계적으로 옮겼다.
  - 🟢 짝 넷 — 세 갈래 각각과 정상 경로. 특히 **디렉터리를 파일로 읽으면 EISDIR** 라서 "그 밖" 으로 떨어져야 한다(이걸 "없음" 으로 추측하면 **프로젝트가 사라졌다고 말하게 된다**).
  - 🟢 주입: SyntaxError 갈래를 빼면 그 짝이 빨개진다. 타입체크 0 · 백엔드 1459.
- [x] **🟠 "이 회차가 존재하나" 를 여섯 서비스가 각자 답하고 있었다**: 같은 네 조건을 여섯 번 적어 뒀다.
  - 🔴 조건 하나가 느슨해져도 **실패하지 않는다** — 나머지 다섯이 거절하는 회차를 **그 화면 하나만 열거나**, 다섯이 여는 회차를 그 하나만 거절한다.
  - 🟠 **`episode_number !== number` 가 그중 군더더기처럼 보이면서 아닌 조건이다.** 개요는 배열이고, **자리와 저장된 번호가 일치한다는 것**이 "두 번째 항목" 과 "2화" 를 같은 것으로 만든다. 빠지면 **번호에 구멍 난 개요가 옆 회차를 물어본 번호로 돌려준다.**
  - 🟠 내용이 아니라 **개요 파일 경로**를 받는다 — 읽어 놓고 검사를 잊는 것이 이 함수가 대체하는 바로 그 모양이라, 읽기와 거절을 호출자가 떼어 놓을 수 없게 했다.
  - 🟢 짝 넷(자리 일치 / 범위 밖·정수 아님 / 번호 불일치 / 개요가 레코드 배열이 아님). 주입: 번호 일치 조건을 빼면 그 짝이 빨개진다. 타입체크 0 · 백엔드 1463.
- [x] **🟠 두 예산 원장의 산술이 한 벌씩인데, 그 산술을 붙들고 있는 짝이 없었다**: `spentThisMonth`·`remaining`·`preflight` 가 제공자마다 **똑같이** 한 번씩 적혀 있다.
  - 🟠 **일부러 떨어뜨려 둔 게 아니다.** 파일이 둘인 건 OpenAI 와 Runway 지출을 **절대 합치면 안 되기** 때문이지만, 그 위의 산술은 **한 규칙**이다.
  - 🔴 **근거는 걱정이 아니라 사고다**: 월 경계를 UTC 로 계산하던 시절이 있었고(사람은 현지 월을 산다) 그걸 **양쪽에서** 고쳐야 했다. 어느 달에 속하는지는 이미 `budget-month.test.ts` 가 두 원장 모두 붙들고 있는데, **그 달 위에서 계산하는 나머지는 어느 쪽도 안 붙들려 있었다.**
  - 🔴 **기반 클래스로 묶지는 않았다** — 돈 코드 둘을 한 상속으로 엮는 위험이 이득보다 크다. 대신 **같은 내용에 같은 답을 하는지**를 짝으로 박았다.
  - 🟢 짝 다섯: 실패한 시도도 지출로 센다 / 거절 경계가 센트 단위까지 같다 / 남은 금액이 음수로 안 간다(음수는 화면에서 **크레딧처럼 읽힌다**) / 원장을 못 읽으면 **양쪽 다 0 으로 후퇴하지 않고 거절한다** / 원장이 아예 없으면 양쪽 다 정직한 0.
  - 🟢 주입 둘: Runway 쪽에서 실패 행을 빼면 첫 짝이, OpenAI 쪽 `Math.max(0, …)` 를 없애면 셋째 짝이 빨개진다. 타입체크 0 · 백엔드 1468.
  - 🟠 곁다리로 배운 것: 처음 쓴 픽스처(`2026-08-31T23:00Z`)가 **현지 시간으로는 9월**이라 짝이 빨개졌다 — 코드가 아니라 제 픽스처가 틀렸고, 그게 현지 월 규칙이 살아 있다는 증거였다.
- [x] **🔴 Cowork 이 잰 "두 문장" 의 서버 쪽 절반 — 예상 못 한 예외에는 코드가 아예 없었다**: 이 저장소의 모든 의도된 거절은 `{ code, message }` 를 실은 `HttpException` 이고 모든 클라이언트 가드가 그 모양을 읽는다. **그 나머지는 아무도 안 다듬고 있었다** — 예상 못 한 throw 는 Nest 기본 `{ statusCode, message }` 로 나가고, 거기엔 `code` 가 없다.
  - 🔴 **그래서 클라이언트가 "서버가 죽었다" 와 "서버는 떠 있는데 라우트 하나가 터졌다" 를 구별할 수 없었다.** 2026-09-06 13분 장애에서 화면마다 두 문장이 동시에 떴다(577 측정): 두 모듈은 *"서버가 꺼져 있을 수 있습니다"*, 열여섯은 *"서버 응답을 확인할 수 없습니다"*. **진짜 크래시에서는 둘 다 틀리다.**
  - 🟢 전역 필터 하나. 크래시에 코드가 붙으니 **"서버 꺼졌나" 를 묻는 두 모듈이 이제 옳게 아니라고 답하고**, 나머지 열여섯은 자기 UNKNOWN 문구("요청을 처리하지 못했습니다")로 떨어진다 — 그게 실제로 일어난 일이다.
  - 🟠 **`HttpException` 은 한 글자도 안 건드리고 통과시킨다.** Nest 자신의 404·413 도 포함해서 — 여기서 다시 빚으면 저장소의 다른 짝들이 이미 붙들고 있는 동작을 옮기게 된다.
  - 🟠 **본문은 원인을 말하지 않는다.** 예외의 실제 문구는 **로그로만** 간다 — 응답 본문에 스택이나 파일 경로가 실리는 건 누출이고, 모르는 실패에서 지어낸 문장은 밋밋한 문장보다 나쁘다.
  - 🟢 짝 넷 + 주입 둘: 본문에 예외 문구를 실으면 누출 짝이, `HttpException` 통과를 없애면 나머지 둘이 빨개진다. 타입체크 0 · 백엔드 1472.
- [x] **🟠 저장소가 이미 적어 둔 규칙 — *"같은 문장을 두 번 쌓지 않는다"* — 을 열넷 중 둘만 지키고 있었다**: 회차 경고 헬퍼와 단기 고아 복구만 검사했고, **나머지 열두 자리는 무조건 덧붙였다.**
  - 🔴 **반복되는 문장이 하필 중요한 문장이다.** `spendUnrecordedWarning` 은 **유료 호출이 성공했는데 원장 행이 안 써졌을 때마다** 적힌다 — 원장이 계속 못 써지는 상태면 장면마다, 실행마다 하나씩 쌓인다.
  - 같은 지시문이 화면에 여섯 번 뜨면 **여섯 개의 별개 문제로 읽히고**, 그 프로젝트가 하려던 다른 말을 밀어낸다.
  - 🟠 **동일성은 문장 전체다.** 다른 장면을 가리키는 두 경고는 **서로 다른 두 사실**이라 둘 다 남아야 하고, 같은 문장이 두 번인 것은 한 사실을 두 번 말한 것이다.
  - 🟢 한 헬퍼로 모았다 — 회차 헬퍼도 이제 그걸 부른다. 짝 셋(중복 안 쌓음 / 다른 문장은 순서대로 둘 다 / **받은 배열을 안 건드리고 새 배열을 준다** — 호출자들이 전부 저장 전 레코드를 펼쳐 쓰는 중이라 제자리 변경은 아직 안 쓴 기록을 고치는 것이다).
  - 🟢 주입: 중복 검사를 빼면 첫 짝이 빨개진다. 타입체크 0 · 백엔드 1475.
  - 🟠 **덧붙임: 그 필터가 로그에 쓰는 것도 계약 규칙에 걸린다** — *"API 키와 Secret 은 응답과 로그에 포함하지 않는다"*. 이 필터는 **예상 못 한 실패가 들고 있던 것을 그대로** 로그로 보내므로, 저장소에 이미 있는 리댁터를 통과시킨다(`OPENAI_API_KEY=` · `RUNWAY_API_SECRET=` · 맨 `sk-` 토큰). **패턴을 여기 다시 적는 건 오늘 하루 지운 바로 그것**이라 클래스 이름이 `ProviderSettings…` 여도 그대로 쓴다. 짝 하나 + 주입 확인.
- [x] **🟢 캡틴D의 열린 질문 하나("Runway 한도를 올릴까")를 숫자로 바꿔 뒀다 — 유료 호출 없이 디스크만 읽었다**: 6~10화를 끝내는 데 얼마가 드는지, 그리고 **어디서 벽에 부딪히는지**를 실제 데이터로 계산했다.
  ```
  지금 상태(프로젝트 12)   1~5화 completed, 각 6장면 전부 진짜 클립
                           6화 script_review · 클립 0 / 7~10화 개요만 있고 디렉터리 없음
  이번 달 Runway           $5.00 / $10   (원장 전체 $10.00 중 절반이 지난달)
  이번 달 OpenAI           $2.60 / $10
  ```
  ```
  한 화 영상   30초 ÷ 6장면 = 장면당 5초 → 장면당 $0.25 → 한 화 $1.50
  6~10화 (5화분)                                        Runway $7.50
  남은 이번 달 예산                                      $5.00
  🔴 → 8화까지 $4.50 로 되고, 9화 두 번째 장면에서 한도에 걸린다
  ```
  - 🟠 **필요한 한도는 $14 가 아니라 $12.50 이다**(이미 쓴 $5.00 + $7.50). 내가 앞서 적은 $14 는 **초당 $0.12 짜리 모델을 골랐을 때**의 숫자였다 — 오늘 모델(gen4_turbo, 초당 $0.05)에서는 $12.50 이면 5화분이 다 들어간다.
  - 🟢 OpenAI 쪽은 여유가 있다: 한 화당 **대본 $0.05 + 이미지 $0.60 + 내레이션 $0.06 = $0.71**, 5화분 $3.55 인데 남은 게 $7.40 이다.
  - 🟠 `design-preview-long-1` 1화는 **mp4 6개가 전부 스텁**이다(`videos_approved` 상태). 오늘 넣은 검사 덕에 유료 병합은 이제 거절되지만, **그 프로젝트를 완성본으로 착각하지 않게** 여기 적어 둔다.
- [ ] **🔴 오늘 밤 Cowork 쪽 작업 1,368줄이 커밋되지 않은 채 작업 트리에만 있다 (2026-09-06 확인)**
  ```
  git status --short                28개 (수정 22 · 추적 안 됨 6)
  git diff --stat                   22 files changed, 1368 insertions(+), 140 deletions(-)
  VideoWorkflowScreen.tsx 마지막 커밋  24a2cf4  2026-09-05 07:35  ← 오늘 밤 라운드들 이전
  HEAD 에 sceneRemedyAdvice · narrationLooksTooLong · httpError   전부 없음
  다른 워크트리(feature/backend · feature/frontend)  둘 다 0baddcb 로 멈춤 · 스태시 없음
  ```
  - 라운드 565~579 에 *"커밋"*, *"커밋 셋"* 이라고 적혀 있으나 **git 에는 없다.** 그 작업에는 오늘 잡은 결함의 화면 절반이 거의 다 들어 있다 — `remedy`·`billedOnFailure` 문구, 폴링 소멸 고침, 무료 「가져오기」 버튼, `sceneErrorMessage` 의 제공자 코드 우선, `narrationLength`, `httpError`.
  - 🔴 **`git checkout` · `git restore` · `git stash` 한 번이면 없어진다.** 오늘 밤 양쪽 다 주입 테스트로 파일을 되돌렸다 복구하기를 수십 번 했다.
  - 🔴 **그리고 프론트가 지금 1344 중 1 실패다** — `httpError.ts:62` 가 계약 상수 대신 리터럴을 쓴다(내 감시가 잡았다). 미커밋인 남의 새 파일이라 내가 안 고쳤다.
  - 581 로 넘겼다. 기본값은 **쓴 사람이 커밋하는 것**이고, 원하면 내가 커밋하되 **1,368줄을 내가 쓰지 않았다는 사실을 메시지에 명시**한다.
- [x] **🟠 정정: `efe107f` 커밋 메시지가 저장소 상태를 잘못 말한다**: *"The other side landed the remaining three"* 라고 적었는데 **들어온 것은 작업 트리였고 git 이 아니었다.** 감시를 붙인 판단 자체는 유효하다(HEAD 에도 그 사본들이 없으므로 초록이다) — 틀린 것은 *"landed"* 라는 표현이다. 푸시된 메시지는 못 고치므로 여기 남긴다.
- [x] **🔴 출처 표시가 필요한 음원인데 서버는 그걸 아예 안 보고 있었다 — 되돌릴 수 없는 유일한 동작에서**: 화면은 막는다(캡션에 자동으로 넣고, 문구가 비면 버튼을 안 열어 준다). **서버는 `attribution` 이라는 단어조차 없었다.**
  - 🟠 캡션 글자수·해시태그 검사가 그 옆에 있는 이유가 그대로 적혀 있다 — *"화면을 건너뛴 호출자가 업로드가 끝난 뒤에 거절당하지 않도록"*.
  - 🔴 **그런데 이건 거절로 끝나지 않는다.** 인스타그램은 어느 쪽이든 받아 준다. 없는 것은 **CC BY 라이선스가 요구하는 출처 표시**이고, 그게 **공개된 채로, 되돌릴 수 없이** 빠진다. 업로드 전에 거절하는 것 말고는 잡을 자리가 없다.
  - 🟢 거절 둘: **표시할 문구가 기록돼 있지 않으면**(여기서 그 줄을 지어낼 수 없으니 그 영상은 지금 상태로는 게시 불가다) · **캡션이 그 줄을 안 담고 있으면**(누군가 지운 경우).
  - 🟠 비교 전 공백을 접는다 — 캡션은 조각들을 빈 줄로 잇고, **줄바꿈만 다른 출처 표시는 있는 것**이다.
  - 🟢 짝 셋(단기·회차 두 경로 모두 같은 검사) + 주입: 검사를 빼면 둘이 빨개진다. 타입체크 0 · 백엔드 1479.
- [ ] **🟠 두 번째 부하 의존 깜빡임 관찰**: `videos/project-lock.test.ts` 의 *"throws ProjectLockTimeoutError, never waiting forever"* 가 전체 실행 한 번에서 실패했고 **단독 7/7 · 전체 재실행 초록**이었다. `assets.cross-process` 와 같은 profile(시간 기반). 아직 한 번이라 계측은 안 붙였다 — 다시 나오면 그때 붙인다.
- [x] **🔴 화면이 배운 규칙이 정작 돈이 나가는 자리에는 없었다 — 같은 입력을 그대로 다시 보낼 수 있었다**: 두 영상 화면은 `remedy = change_input` 이면 지시문을 쓸 때까지 확인 버튼을 안 열어 준다. **서버의 `regenerate` 는 그 필드를 아예 안 봤다.**
  - 🔴 **2026-09-05 에 나간 $0.25 가 정확히 그 모양이다** — `INTERNAL.BAD_OUTPUT`(문서상 원인이 입력)인데 화면이 *"잠시 후 다시"* 라고 했고, 눌렀고, **같은 요청이 같은 실패를 다시 샀다.** 화면 절반은 고쳤는데 **서버 절반이 남아 있었다.**
  - 🟢 두 파이프라인 모두, **아카이브·기록 초기화보다 먼저** 거절한다. 전용 코드를 줬다(`VIDEO_RETRY_NEEDS_CHANGED_INPUT` · `LONG_EPISODE_RETRY_NEEDS_CHANGED_INPUT`) — 화면이 여기서 할 말이 따로 있고, 이건 잘못된 요청이 아니라 **앱이 아는 실패를 다시 사는 것을 거절하는 것**이다.
  - 🟠 **`change_input` 에만 건다.** `not_retryable`(안전 거절)의 원인은 첫 프레임이라, **이미지를 다시 만들고 돌아오는 것이 정당한 경로**인데 거기엔 지시문이 따라오지 않는다 — 여기서 막으면 실수가 아니라 **고침을 막는다.** 모르는 코드도 아무것도 요구하지 않는다: 입력이 원인인지 모르면서 요구를 지어내는 것도 틀리는 방법이다.
  - 🟢 짝 넷(계약 판정 셋 + 단기 경로 실동작 하나: 지시문 없으면 거절, 쓰면 통과). 주입: 두 서비스에서 거절을 빼면 그 짝이 빨개진다. 타입체크 0 · 백엔드 1483.
- [x] **🟢 살아 있는 앱으로 오늘 작업을 끝까지 확인했다 (읽기 전용 · 유료 호출 0 · 버튼 0)**: 백엔드가 다시 떠 있어서 오늘 커밋 30여 개가 실제로 도는 서버를 깨뜨리지 않았는지 GET 만으로 확인했다.
  ```
  /health 200 · /projects 200 · /long-projects 200 · /settings/providers 200
  프로젝트 12  1~5화 completed · 6화 script_review · 7~10화 outline_ready
  ```
  - 🟢 **오늘 넣은 연속성 경고가 실제로 화면에 도달한다** — 6화가 이 문장을 달고 있다:
    > *"이 대본은 5화 이야기를 모르는 채로 만들어졌습니다. 그 회차의 연속성 메모가 없습니다 — 메모를 적고 대본을 다시 만들면 반영됩니다."*
  - 🔴 **그리고 그 경고가 캡틴D의 결정 순서를 정해 준다.** 5화 연속성 메모를 확인해 보니 `{"memory": null, "canSave": true}` — **정말로 비어 있다.** 즉 **메모를 먼저 쓰지 않고 6화 대본을 다시 만들면 $0.05 로 같은 구멍을 다시 산다.** 순서는 **5화 메모 → 6화 대본 재생성** 이고, 그 반대는 돈만 나간다.
  - 🟠 경고 문구 자체가 그 순서를 말하고 있다는 점이 이 문장의 값어치다 — 사람이 문서를 찾아볼 필요가 없다.
- [x] **🟠 "이 기록은 몇 장면인가" 를 일곱 서비스가 각자 답하고 있었다 — 각자 자기 리터럴 6 으로**: 같은 삼항식이 일곱 번.
  - 🔴 **위험한 건 숫자가 아니라 그 답이 정하는 것이다: 몇 장면을 걸어갈지.** 12장면 회차에 6 이라고 답하는 서비스는 **절반에서 멈추고 나머지를 "없음" 으로 보고**하고, 6장면 회차에 12 라고 답하는 서비스는 **아무도 만든 적 없는 파일을 찾는다.** 일곱 자리가 따로 답하면 **두 화면이 회차 길이에 대해 의견이 갈릴 기회가 일곱 번**이다.
  - 🟢 `storedSceneCount(record)` 하나로. 숫자 자체는 계약의 `DEFAULT_SCENE_COUNT` 인데, 그건 **검사받는 경계 바로 옆**에 있다 — 경계 밖 기본값은 자기를 보낸 검증에 다시 걸리는 프로젝트다.
  - 🟠 **일부러 검증은 안 한다.** 12 라고 적힌 기록은 그대로 받는다 — 허용 범위는 **개수를 고르는 자리**의 질문이지 낡은 기록을 읽는 자리의 질문이 아니다. 여기서 거절하면 범위 밖 기록이 **틀린 게 아니라 아예 안 열리게** 된다.
  - 🟢 짝 넷(그대로 받음 / 없으면 기본값 / **정수가 아니면 기본값**(비정수가 `sceneNumbersFor` 에 닿으면 디스크에 없는 장면 목록을 만든다) / 검증 안 함). 주입: 정수 검사를 `typeof number` 로 낮추면 셋째가 빨개진다. 타입체크 0 · 백엔드 1487.
  - 🟠 **안 건드린 것 하나**: `project.mapper.ts` 의 `looksLikeVideoRecord` 는 `scene <= 6` 으로 남겼다. 그건 **job_id 가 없던 파이썬 기록**만 판별하는 발견법이고, 주석이 *"관계없는 손상 데이터가 없던 작업을 지어내지 않도록"* 좁게 잡았다고 적어 뒀다 — 넓히면 의미가 바뀐다.
- [x] **🟠 감시 열 개를 스스로 감사했다 — 둘이 "아무것도 안 보면서 초록" 일 수 있었다**: 이 저장소는 그 실패를 이미 두 번 적어 뒀다(*"A sweep's own worst failure is silently stopping to look"*, money-guard 의 220 하한). 그래서 감시마다 **"아직 뭔가를 찾고는 있는가"** 를 확인했다.
  ```
  paid-services            🟢 목록 전체 일치를 요구한다 — 빈 스캔은 그 자체로 빨개진다 + 전용 짝까지 있다
  contract-value-sets 둘   🟢 files.length > 140 하한이 같은 파일 안에 있다
  route-shape-coverage     🟢 하한 있음        money-guard  🟢 sources > 220
  contract-optional-fields 🟢 하한 있음        budget-preflight-coverage  🟢 하한 있음
  video-model-single-source 🟢 계약 목록에 포함되는지 별도로 확인한다
  🔴 decision-doc-references   하한 없음 — 두 검사 다 "비어 있으면 성공" 이다
  🔴 placeholder-single-source 하한 없음 (오늘 내가 만든 것이다)
  ```
  - 🟠 **둘 다 "비어 있음 = 성공" 형태였다.** 문서 제목 패턴이 어긋나거나 소스 걷기가 옮겨진 디렉터리를 보면, **감시는 초록인데 지키는 것이 없다.**
  - 🟢 하한을 붙였다(실제 수보다 넉넉히 낮게 — 결정 하나·파일 몇 개 지운다고 빨개지면 안 된다).
  - 🟢 주입 둘: 결정 문서 제목 패턴을 `###` → `####` 로 바꾸면 새 짝 포함 셋이 빨개지고(전에는 **초록이었다**), 플레이스홀더 감시의 걷기 시작점을 하위 디렉터리로 옮기면 새 짝이 빨개진다. 백엔드 1491.
- [x] **🟢 오늘 밤 전체를 한 번에 다시 검증했다 — 마지막 전체 빌드 이후 커밋 20여 개가 더 쌓였기 때문이다**: 커밋마다 관련 스위트만 돌린 것과, **전부 함께 도는 것**은 다른 질문이다.
  ```
  npm run build   네 워크스페이스 전부 성공(계약 → 백엔드 → 프론트 → 데스크톱)
  npm test        백엔드 1491 · 프론트 1344 · 계약 57 · 데스크톱 37 — 실패 0
  타입체크        0
  git status      0
  살아 있는 앱    /health · /projects · /long-projects · /settings/providers · vite  전부 200
  ```
  - 🟠 **감시 감사도 여기서 닫혔다**: 저장소 전체를 도는 스캐너 **열둘 전부** 이제 "아직 뭔가를 찾고 있는가" 하한을 갖는다(열은 이미 있었고, 둘은 오늘 붙였다). `fake-timer-restoration`·`atomic-write-coverage` 도 확인했다 — 둘 다 이미 있었다.
- [x] **🟢 아침 결정 1번이 실제로 동작하는지, 유료 호출 직전까지 확인했다 (코드 변경 없음)**: *"5화 메모 → 6화 대본 재생성"* 이 값어치가 있으려면 **메모가 정말로 유료 프롬프트에 실려야** 한다. 안 실리면 $0.05 는 아무것도 사지 않는다.
  - 🟢 그걸 붙들고 있는 짝이 이미 있다 — `episode-scripts.openai.test.ts` 의 *"carries the earlier Episodes' memos into the prompt it sends"*. 가짜 OpenAI 에 **실제로 나간 요청 본문**을 열어서, 메모의 **구별되는 단어들**이 그 안에 있는지 본다(템플릿 문구와 우연히 겹치지 않도록 일부러 특이한 문장을 쓴다).
  - 🟠 그리고 **최근 셋은 통째로, 그보다 오래된 것은 요약만** 실린다는 것까지 갈라서 확인한다 — 1화의 사건이 **없는 것이 압축이 동작한 증거이지 손실이 아니라는 점**을 따로 못 박아 뒀다.
  - 🟢 6화를 다시 만들면 3·4·5화가 "최근 셋" 에 들어간다. **즉 5화 메모는 통째로 실린다.** 순서만 지키면 그 $0.05 는 산다.
