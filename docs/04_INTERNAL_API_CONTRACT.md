# Internal API Contract

React Frontend와 NestJS Backend 사이의 로컬 JSON 계약이다. OpenAI와 Runway의
유료 Provider API와는 별개다.

## 규칙

- JSON 필드는 `camelCase`를 사용한다.
- 시간은 UTC ISO 8601 문자열을 사용한다.
- 짧은 프로젝트는 설정한 장면 수(2~12개)만큼의 장면을 1번부터 순서대로 가진다.
- 요청·응답 타입은 `packages/shared/src`에서 정의하고 복사하지 않는다.
- 오류 형식은 `{ code, message, details? }`를 사용한다. **예외가 없다** — 예상하지 못한 throw 도
  전역 필터가 같은 모양으로 답한다(`INTERNAL_ERROR`, 500). 그 전까지 예상 못 한 실패만 `code` 없이
  나갔고, 그래서 클라이언트가 **서버가 죽은 것과 라우트 하나가 터진 것을 구별할 수 없었다** — 한 번의
  장애에 화면마다 다른 문장이 뜬 원인이다(2026-09-06). 크래시 응답 본문은 원인을 말하지 않는다:
  예외의 실제 문구는 로그로만 가고, 스택이나 파일 경로가 본문에 실리는 것은 누출이다.
- Preview endpoint는 유료 Provider 요청을 보내지 않는다.
- API 키와 Secret은 응답과 로그에 포함하지 않는다.
- 필요한 기능을 구현할 때만 endpoint를 추가한다.

## 사진별 로컬 카메라 움직임

명언 카드와 뉴스 릴의 `ProjectSummary.stillMotions`는 사진 순서의 전체 배열이다. 과거 프로젝트에 저장값이 없으면 각 사진이 기존 `zoom_in`으로 응답한다. 가능한 값은 `zoom_in`, `zoom_out`, `pan_left`, `pan_right`, `still`이며 공통 타입은 `packages/shared/src/domain.ts`에 있다. 일반 영상 릴에는 이 필드가 없다.

`POST /projects/:projectId/videos/merge`의 `MergeVideosRequest.stillMotions`는 카드의 모든 사진에 대한 값을 순서대로 받는다. 생략하면 마지막 성공한 병합의 선택을 유지한다. 사진 수가 다르거나 알 수 없는 값, 일반 영상 릴의 요청은 거절한다. 선택은 FFmpeg 병합과 프로젝트 저장이 성공한 뒤에만 보존한다.

`POST /projects/:projectId/videos/still-motion-preview`는 `{ sceneNumber, motion, subtitleLayout? }`을 받는다. `sceneNumber`는 1부터 시작한다. `subtitleLayout`은 명언 카드에만 허용되며 저장하지 않은 크기·위치·`effect`·`darkening`도 미리 보는 값이다. `effect`는 `lightning`, `cosmic`, `celestial_rays`, `ocean_wave`, `none` 중 하나이고, 오래된 카드처럼 생략하면 `lightning`이다. 효과는 첫 사진에만 적용되며 우주·빛줄기·파도 효과가 움직이는 동안 글자는 처음부터 보인다. 알 수 없는 효과는 400으로 거절한다. `darkening`은 번개에만 적용되는 0–80%의 0.5% 간격 값이며, 생략하면 기존 값인 43.5%를 쓴다. 응답은 한 사진 길이의 무음 `video/mp4` 바이너리다. 최종 병합과 같은 로컬 FFmpeg 필터·글자/뉴스 띠를 사용하며 프로젝트와 완성 영상을 바꾸지 않고 유료 Provider를 호출하지 않는다. 프론트는 응답을 Blob으로 읽는다.

`POST /projects/:projectId/videos/merge`의 명언 카드 `subtitleLayout`도 `effect`와 `darkening`을 받는다. 선택은 병합이 성공한 뒤에만 크기·위치와 함께 저장되어 `ProjectSummary.subtitleLayout`으로 돌아온다. `none`은 배경 효과만 생략하고 순차 자막 등장에는 영향을 주지 않는다. `darkening`은 번개 뒤 검은 오버레이의 불투명도를 조절한다.

## 명언·뉴스 릴 사진 길이

`CreatePhotoCardRequest.clipDurationSeconds`와 `CreateNewsReelRequest.clipDurationSeconds`는 사진마다 동일하게 적용되는 길이다. 허용 선택지는 5, 10, 15, 20, 30, 45, 60, 90, 120, 180초이며, 선택한 초 × 사진 수가 최대 180초여야 한다. `photoCardDurationChoices(pictureCount)`는 화면 선택지를, `isPhotoCardDurationAllowed(value, pictureCount)`는 서버 검증을 제공한다. 초과 값은 프로젝트 생성 전에 거절한다. 누군가 설정 화면에서 사진 카드 길이를 바꿀 때도 같은 합계 제한을 적용한다.

`GET /projects/:projectId/settings` 응답은 사진 카드/뉴스 릴이면 `pictureCard: true`를 포함한다. 일반 생성 영상 프로젝트에는 필드를 생략한다. 설정 화면은 이 서버 분류를 사용해 사진 길이 선택지와 영상 모델 길이·요금 선택지를 구분한다.

## 뉴스 릴 게시 본문용 요약

`POST /news/card-text`는 기존 한 번의 글 생성 호출에서 카드 글과 함께 `summary?: string`을 돌려준다. 요약이 오면 카드 글과 함께 원문 기사 대조 결과 `check`에 포함된다. `POST /news/reels`의 `card.summary?: string`은 400자 이내의 비어 있지 않은 요약을 프로젝트에 저장한다. 과거 카드와 직접 작성한 카드에는 이 필드가 없을 수 있다. 화면은 요약이 없을 때 기존 제목·장면 자막 초안을 사용할 수 있다.

## 밈·챌린지 후보 피드

`GET /trends/memes`는 저장된 마지막 YouTube 후보 목록만 읽고 외부 API를 호출하지 않는다. `POST /trends/memes/refresh`만 YouTube Data API의 최근 한국 대상 짧은 영상 메타데이터를 수집한다. 제목·설명·태그에 공통 해시태그나 문구가 영상 3편 이상, 서로 다른 채널 2곳 이상에 나온 것을 **후보**로 묶는다. 같은 응답에 대표 영상들이 있어 화면에서 바로 펼쳐 볼 수 있다. 이 단계는 영상 속 행동을 분석하거나 프로젝트를 만들지 않는다.

공통 DTO와 검증 함수는 `packages/shared/src/trend.ts`, route helper는 `API_ROUTES`에 있다. 각 영상의 `viewCount`는 API에 없으면 `null`; `viewCountObservedAt`은 그 값을 읽은 시각이다. 과거 같은 영상의 숫자가 있을 때만 `previousViewCount`와 `previousViewCountObservedAt`을 함께 보낸다. 수집 실패는 저장된 목록을 지우지 않는다(단, 수집 후 30일이 된 메타데이터는 정책에 맞춰 삭제한다). `MEME_TREND_KEY_MISSING`은 YouTube 키 설정, `MEME_TREND_QUOTA_EXCEEDED`는 할당량 종료, `MEME_TREND_SOURCE_FAILED`는 출처 실패, `MEME_TREND_STORE_UNREADABLE`은 저장 파일 문제를 구분한다. 키는 `ProviderCredentialKind`의 `youtube`로만 저장하며 응답에 실리지 않는다.

## 밈 관찰 작업 공간

`GET /trends/memes/:trendId/workspace`는 현재 피드에 있는 후보의 저장된 `MemeTrendWorkspace`만 읽는다. 응답 `analyses[]`는 서로 다른 제작자의 분석 제안을 최대 3건 보존하고, `sourceVideoId` 외 YouTube 제목·채널 메타데이터를 복사하지 않는다. `POST /trends/memes/:trendId/analysis`는 그 후보 `videos[]`의 `sourceVideoId` 한 편만 명시적으로 Gemini에 보낸다. 성공하고 JSON을 검증한 경우 같은 영상 분석만 교체하고 다른 출처 제안과 사람이 저장한 `cards`는 바꾸지 않는다. 저장된 영상이 현재 후보 피드에서 빠져 채널 중복 여부를 검증할 수 없으면 새 분석은 `MEME_ANALYSIS_SOURCE_UNKNOWN`으로 거절한다. 이미 분석한 제작자의 다른 영상은 `MEME_ANALYSIS_CHANNEL_ALREADY_USED`, 분석 3건 뒤 새 출처는 `MEME_ANALYSIS_SOURCE_LIMIT`으로 거절한다. 기존 단일 `analysis` 저장 형식은 읽을 때 `analyses[]`로 정규화한다. `PUT /trends/memes/:trendId/cards`는 `expectedCardsSavedAt`으로 동시 편집을 확인하고 카드만 저장한다. 카드 추가·수정·조회에는 Provider 호출이 없다.

영상 분석은 별도 `meme_analysis_call_usage.json`에 요청 **전에** 1회를 기록한다. 하루 최대 3회이며 실제 전송 뒤 실패해도 1회를 쓴다. 실패 시 기존 분석과 카드는 남고 `MEME_ANALYSIS_FAILED`의 `details.dailyCalls`가 새 횟수를 알린다. 장부가 읽히지 않으면 전송하지 않는다. 키 누락, 현재 후보 밖 영상, 출처 제작자 중복·확인 불가, 후보별 출처 한도, 카드 형식·충돌, 작업 공간 저장 오류는 각각 `MEME_ANALYSIS_KEY_MISSING`, `MEME_ANALYSIS_VIDEO_NOT_IN_TREND`, `MEME_ANALYSIS_CHANNEL_ALREADY_USED`/`MEME_ANALYSIS_SOURCE_UNKNOWN`, `MEME_ANALYSIS_SOURCE_LIMIT`, `MEME_CARDS_INVALID`, `MEME_CARDS_CONFLICT`, `MEME_WORKSPACE_STORE_UNREADABLE`로 구분한다. 현재 피드에서 빠진 후보는 `MEME_TREND_UNKNOWN`이지만 사람이 적은 카드 파일을 지우지 않는다. 저장 파일에는 YouTube 조회수·제목 등의 메타데이터를 복사하지 않는다.

## 소설 분석 — M1

`POST /story-analysis/preview`는 `NovelStoryAnalysisInput`을 검증하고 OpenAI 요청 프롬프트(순서대로 `prompts[]`), 입력·프롬프트 SHA-256, 모델, 글자 수·분할 수·Provider 호출 수, 예상 비용을 돌려준다. Provider 호출·저장은 없다. 원문 상한은 JavaScript 문자열 길이 120,000이며 60,000자 이하에는 기존 단일 분석 호출을, 초과 입력에는 최대 60,000자 단위의 추상 부분 분석과 최종 합성 호출을 쓴다. 긴 입력을 받을 수 있도록 JSON 본문 상한은 1 MB다. 제목 120자, 한 줄 설명 500자, 출처 메모 500자, 회차 1–20, 회차당 장면 2–12를 받는다. `rightsConfirmed: true`가 필수다. 저장된 OpenAI 키가 없을 때도 프롬프트는 미리 볼 수 있지만 `providerAvailable`은 `false`다.

`POST /story-analysis`는 같은 입력과 미리보기의 해시, `approved: true`를 요구한다. 서버가 입력과 프롬프트 계획을 다시 만들어 해시가 다르면 거절하고, 전체 예상 비용을 월 예산 장부에서 선검사한 뒤에만 호출한다. 60,000자 이하에는 기존 단일 분석 요청을 보낸다. 더 긴 입력은 60,000자 이하 조각마다 요약 요청을 보내고, 조각 요약들을 합성해 최종 추상 이야기 구조(줄거리·장르·분위기·주제·인물 카드·회차 구성·주의 표지)를 만든다. 프리뷰의 마지막 합성 프롬프트는 승인 뒤 생성되는 추상 요약이 들어갈 위치를 표시한다. 모델은 `gpt-5.6-luna`, 응답은 strict JSON Schema이며 모든 Responses 요청은 `store: false`다. 호출당 비용은 `$0.05`로 보수적으로 추정하고, 호출 수에 맞춰 미리보기·예산 검사·월 장부에 반영한다.

원문 본문은 `learning_data/story_sources/`나 예산 장부에 쓰지 않는다. 입력 해시를 파일명으로 사용하며, 저장값은 해시·프롬프트 해시·제목·선택 출처 메모·권리 확인 시각·모델·회차/장면 수·분석 결과뿐이다. 같은 입력의 성공 결과는 다시 돌려주고 Provider를 재호출하지 않는다. 분석 시도 직전 `.claimed` 파일을 독점 생성하므로 응답이 모호하게 끊겨도 같은 입력은 다시 보내지 않는다. 이 기능의 오류 코드는 `STORY_ANALYSIS_INVALID_REQUEST`, `STORY_ANALYSIS_PROMPT_STALE`, `STORY_ANALYSIS_KEY_MISSING`, `STORY_ANALYSIS_BUDGET_EXCEEDED`, `STORY_ANALYSIS_ALREADY_ATTEMPTED`, `STORY_ANALYSIS_STORAGE_ERROR`, `STORY_ANALYSIS_PROVIDER_ERROR`다.

## 온라인 소설 출처 검색·가져오기

`POST /story-sources/search`는 `{ query, topic?, page? }`를 받고 Gutendex 메타데이터 검색 결과 중 Project Gutenberg의 영어 작품만 반환한다. `copyright=false`는 미국 기준이며, 한국 내 보호기간을 보장하지 않는다. 서버는 이름과 사망연도가 제공된 저자 전원 및 번역자 전원이 현재 연도 기준 한국의 생존기간+70년을 넘긴 작품만 남긴다. 검색 응답에는 제목·작가/번역자·주제어·원본 작품 페이지·필터의 근거 문구가 있다. 원문 길이는 카탈로그가 제공하지 않아 검색 결과에 정확한 글자 수/길이 필터를 표시하지 않는다.

`POST /story-sources/import`는 `{ sourceId, chapterRange? }`를 받는다. 본문 요청은 사용자가 작품을 선택한 뒤에만 발생하며, 서버는 작품 ID로 Project Gutenberg 공식 텍스트 미러 경로를 구성한다(클라이언트 URL을 받지 않는다). Gutenberg 머리말·꼬리말과 줄바꿈을 정규화한 문자열의 JavaScript UTF-16 `length`를 분석 입력 글자 수로 센다. 120,000자 이하는 `sourceText`를 반환한다. 초과 작품은 장 경계와 각 장의 글자 수만 반환하며, 프론트가 연속된 `chapterRange`를 보내면 그 범위 본문만 반환한다. 범위가 여전히 120,000자를 넘으면 `selectionTooLong`으로 거절한다. 장 경계를 찾지 못한 원문은 자동 분할하지 않는다.

분석 입력의 선택적 `source` citation과 M2 `source` 안의 citation은 작품 ID·제목·저자/번역자·원본 링크·권리 필터 근거·전체/선택 글자 수·선택 장 범위를 담는다. 원문은 분석 저장 파일이나 장기 프로젝트 출처 파일에 쓰지 않는다. 이 보수적 필터는 법률 자문이나 판본별 권리 보증이 아니다. Project Gutenberg는 해외 사용자의 현지 권리 확인을 요구한다. 공유마당은 공개 문서만으로 원문 자동 전송 권한을 확인하지 못해 현재 출처에 포함하지 않는다. 이 경로는 실제 Provider를 호출하지 않는다.

## 소설 분석 결과로 장기 프로젝트 만들기 — M2

`POST /long-projects/from-story-analysis`는 `{ projectId, settings, source, analysis, protagonistAssetId? }`를 받는다. `source`는 M1이 돌려준 원문 없는 `NovelStorySourceMetadata`; 본문은 받지 않는다. `analysis`는 화면에서 확인·수정한 줄거리·인물 카드·회차 개요이며, 회차 개수는 최종 `settings.episodeCount`와 맞아야 한다. `source`의 회차·장면 수는 최초 분석 요청의 기록이므로 화면에서 회차를 추가·삭제하거나 새 프로젝트 설정을 바꿔도 덮어쓰지 않는다. `settings`의 제목·한 줄 소개·장르·분위기·주제는 승인한 분석과 일치해야 한다. 주인공 역할은 정확히 하나여야 하고, 선택한 `protagonistAssetId`는 사용 가능한 캐릭터 폴더여야 한다.

서버는 `project.json`을 `outline_ready`로, 모든 항목을 `outline_ready`인 `episode_outlines.json`으로 저장한다. 수정된 인물 카드와 주의 표지는 Story Bible `basic`에 놓아 다음 회차 프롬프트가 읽는다. 선택한 주인공 폴더 링크도 함께 저장한다. M1에서 받은 출처 메타데이터는 `novel_story_source.json`에 보존한다. 기존 `<projectId>` 폴더 안의 임시 `long_story` 디렉터리에 네 파일을 먼저 모두 쓴 뒤 최종 `long_story`로 이름을 바꾸므로 저장 중 실패하면 반쪽 프로젝트가 보이지 않는다. 기존 짧은 프로젝트와 같은 ID를 쓸 수 있으며, `long_story`가 이미 있으면 기존 자료를 그대로 두고 충돌 오류를 돌려준다. 이 경로는 OpenAI·이미지·영상 Provider를 부르지 않는다.

## 소설 인물 이미지 → 보관함 폴더 — M3 백엔드 계약

`POST /story-analysis/character-image/preview`는 `{ storyInputSha256, characterId, name, appearance, personality }`를 받고, 이미지 모델에 보낼 프롬프트·입력/프롬프트 SHA-256·모델/크기·고정 예상 비용 `$0.10`·OpenAI 키와 월 예산 상태를 돌려준다. 저장이나 Provider 호출은 없다. 원문과 출처 메모는 이 요청과 프롬프트에 포함하지 않는다. 이름·ID는 최대 80자, 외모·성격은 각각 최대 500자다.

`POST /story-analysis/character-image`는 같은 다섯 필드와 미리보기의 두 해시, `approved: true`가 필수다. 서버는 해시·OpenAI 키·월 예산을 다시 확인한 뒤 `gpt-image-2`로 1024×1536 PNG를 한 번만 요청한다. `learning_data/novel_character_images/`에 입력 해시별 독점 claim을 먼저 쓰고, 성공한 PNG를 저장한 뒤 보관함의 캐릭터 폴더와 정면 이미지를 한 번의 인덱스 쓰기로 등록한다. 응답은 `{ folderAssetId, imageAssetId, reused, spendUnrecorded? }`다. 같은 입력은 폴더를 재사용하며, 유료 이미지 저장 뒤 보관함 등록에 실패해도 다음 요청은 저장된 PNG로 등록을 재개하고 Provider를 다시 부르지 않는다. 전송 여부가 모호하고 PNG도 없으면 claim을 유지해 재전송을 거절한다. PNG 자체를 디스크에 쓸 수 없는 드문 실패는 `NOVEL_CHARACTER_IMAGE_STORAGE_ERROR.details.recoveryImageBase64`로 이미 치른 결과 바이트를 돌려준다.

새 폴더와 이미지는 `approved:false`로 등록한다. 사람은 생성된 이미지를 확인해 사용할 폴더를 M2의 `protagonistAssetId`로 고른다. 기존 장기 프로젝트 생성 경로가 해당 폴더를 Story Bible에 연결한다. 이 경로의 오류 코드는 `NOVEL_CHARACTER_IMAGE_INVALID_REQUEST`, `NOVEL_CHARACTER_IMAGE_PROMPT_STALE`, `NOVEL_CHARACTER_IMAGE_KEY_MISSING`, `NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED`, `NOVEL_CHARACTER_IMAGE_ALREADY_ATTEMPTED`, `NOVEL_CHARACTER_IMAGE_STORAGE_ERROR`, `NOVEL_CHARACTER_IMAGE_PROVIDER_ERROR`, `BUDGET_LEDGER_UNREADABLE`이다.

## 소설 조연과 보관함 캐릭터 폴더 연결 — M4

`CreateNovelStoryProjectRequest.supportingCharacterAssetLinks?`는 검토된 `supporting` 인물의 `{ characterId, assetId }` 목록이다. 주인공·존재하지 않는 인물은 이 목록에 넣을 수 없고, 인물 ID와 Asset 폴더 ID는 각각 중복될 수 없다. 각 Asset은 사용 가능한 `character` 폴더여야 한다. 빈 목록은 기존 M2 요청과 같다.

장기 프로젝트 생성은 이를 `story_bible.json`의 `basic.supporting_character_asset_links`에 `{ character_id, asset_id }`로 저장한다. `GET /long-projects/:projectId/story-bible`은 camelCase `supportingCharacterAssetLinks`로 노출한다. `PATCH /long-projects/:projectId/story-bible/supporting-character-asset-links`는 `{ links }` 전체를 교체하며, 빈 배열은 연결을 해제한다. 입력은 프로젝트 Story Bible에 이미 있는 조연 ID만 받을 수 있다.

연결된 조연 폴더는 기존 Asset Mapping 규칙을 따라 `auto_supporting_cast`로 이미지가 없는 회차에 자동 등록된다. 해당 Asset을 사용자가 제외했거나 이미 수동 연결했으면 자동 경로가 덮어쓰지 않는다. 이미지가 있는 회차의 매핑은 바꾸지 않는다. 이 연결은 프로젝트 설정 데이터만 바꾸며 Provider를 호출하지 않는다.


## 밈 관찰 카드에서 단기 프로젝트 초안으로

`CreateProjectRequest.initialStoryDraft?`는 `{ projectName, character, fullStory, additionalNotes, sceneCount }`를 받는다. 새 프로젝트를 만들 때 기존 단기 설정에 함께 저장하며, 유효하지 않으면 프로젝트를 만들지 않는다. `fullStory`에는 사람이 수정한 2–12장면 계획, `additionalNotes`에는 저장한 관찰 카드와 원본 복제 금지 지시가 들어간다. 기존 대본 미리보기는 이 설정을 읽기만 하고 Provider를 호출하지 않는다. 실제 대본 생성은 기존 승인·예산 게이트를 통과해야 한다. 이 필드를 생략한 일반 단기 프로젝트 생성은 기존과 같다.

## 대표 Route (예시, 전체 목록 아님)

마이그레이션 초기에 작성된 예시 목록이다. 지금은 단기·장기 프로젝트, Story,
Asset Library/Mapping, 이미지, 영상, 내레이션·자막 등 훨씬 많은 Route가
존재한다 — 전체 목록과 정확한 요청·응답 타입은 이 예시 대신 항상
`packages/shared/src`(각 route 상수와 DTO)를 신뢰한다.

| Method | Route | 목적 | Provider 호출 |
|---|---|---|---|
| `GET` | `/health` | 로컬 Backend 상태 | 없음 |
| `GET` | `/projects` | 프로젝트 목록 | 없음 |
| `POST` | `/projects` | 프로젝트 생성 | 없음 |
| `GET` | `/projects/:projectId` | 프로젝트 조회 | 없음 |
| `POST` | `/projects/:projectId/videos/preview` | 프롬프트·비용 확인 | 없음 |
| `POST` | `/projects/:projectId/videos/generations` | 승인된 영상 작업 시작 | Gate 통과 후 |
| `GET` | `/projects/:projectId/videos/generations/:jobId` | 진행 상태 조회 | 저장된 Task만 조회 |

Runway 전송에는 유효한 `confirmationId`, 고유한 `userRequestId`,
`approved: true`와 수정 가능한 비어 있지 않은 장면 프롬프트가 장면 수만큼
필요하다.

`userRequestId`가 무엇을 보장하는지는 한 문장으로 적으면 틀린다. 실제 동작은 셋이다.

- 같은 `userRequestId` + **같은** 프롬프트·입력 해시 → 기존 작업을 그대로 돌려준다.
- 같은 `userRequestId` + **다른** 프롬프트 → `VIDEO_REQUEST_ID_CONFLICT`로 **거절한다.**
  조용히 같은 작업을 돌려주지 않는다. 같은 의도라고 말해놓고 다른 것을 보내는 요청이기 때문이다.
- **다른** `userRequestId` + 같은 입력 해시 → 그래도 기존 작업을 돌려준다. 재사용 판정은
  id 하나가 아니라 입력 자체에도 걸려 있다.

그리고 **돈을 막는 것은 이 id가 아니다.** 두 번째 시작을 실제로 거절하는 것은 회차·프로젝트의
상태 게이트이고(이미 생성 중이면 시작 자체가 안 된다), `userRequestId`는 그 앞단에서
*같은 누름인지*를 판정한다. 이 구분을 흐리면 게이트를 건드리는 사람이 "어차피 id가 막는다"고
읽는다 — 그때 돈이 나간다.

새 기능을 구현할 때는 계약과 테스트를 함께 추가한다. 이 문서의 예시 표는
매번 갱신하지 않으며, 실제 존재하는 전체 Route는 위 규칙대로 `packages/shared/src`에서 확인한다.
