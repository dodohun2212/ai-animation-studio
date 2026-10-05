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

`POST /projects/:projectId/videos/still-motion-preview`는 `{ sceneNumber, motion, subtitleLayout? }`을 받는다. `sceneNumber`는 1부터 시작한다. `subtitleLayout`은 명언 카드에만 허용되며 저장하지 않은 자막 크기·위치도 미리 보는 값이다. 응답은 한 사진 길이의 무음 `video/mp4` 바이너리다. 최종 병합과 같은 로컬 FFmpeg 필터·글자/뉴스 띠를 사용하며 프로젝트와 완성 영상을 바꾸지 않고 유료 Provider를 호출하지 않는다. 프론트는 응답을 Blob으로 읽는다.

## 뉴스 릴 게시 본문용 요약

`POST /news/card-text`는 기존 한 번의 글 생성 호출에서 카드 글과 함께 `summary?: string`을 돌려준다. 요약이 오면 카드 글과 함께 원문 기사 대조 결과 `check`에 포함된다. `POST /news/reels`의 `card.summary?: string`은 400자 이내의 비어 있지 않은 요약을 프로젝트에 저장한다. 과거 카드와 직접 작성한 카드에는 이 필드가 없을 수 있다. 화면은 요약이 없을 때 기존 제목·장면 자막 초안을 사용할 수 있다.

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
