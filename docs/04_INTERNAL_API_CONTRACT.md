# Internal API Contract

React Frontend와 NestJS Backend 사이의 로컬 JSON 계약이다. OpenAI와 Runway의
유료 Provider API와는 별개다.

## 규칙

- JSON 필드는 `camelCase`를 사용한다.
- 시간은 UTC ISO 8601 문자열을 사용한다.
- 짧은 프로젝트는 설정한 장면 수(2~12개)만큼의 장면을 1번부터 순서대로 가진다.
- 요청·응답 타입은 `packages/shared/src`에서 정의하고 복사하지 않는다.
- 오류 형식은 `{ code, message, details? }`를 사용한다.
- Preview endpoint는 유료 Provider 요청을 보내지 않는다.
- API 키와 Secret은 응답과 로그에 포함하지 않는다.
- 필요한 기능을 구현할 때만 endpoint를 추가한다.

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
필요하다. 같은 `userRequestId`를 재사용해도 새 Provider 작업을 만들지 않는다.

새 기능을 구현할 때는 계약과 테스트를 함께 추가한다. 이 문서의 예시 표는
매번 갱신하지 않으며, 실제 존재하는 전체 Route는 위 규칙대로 `packages/shared/src`에서 확인한다.
