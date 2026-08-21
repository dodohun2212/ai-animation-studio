# Three-AI Team Workflow

## 역할

### Main — GPT-5.6 Sol

- Python 기준 기능 분석
- 작업 범위와 완료 조건 정의
- 공유 타입과 내부 API 계약 관리
- Frontend와 Backend 작업 지시문 작성
- 브랜치 통합, 전체 테스트와 마이그레이션 상태 갱신

### Frontend — Claude

- `apps/frontend`의 화면과 사용자 상호작용
- 로딩, 오류, 승인, 검토와 진행 상태 표현
- `packages/shared` 계약 사용
- Backend 동작을 임의로 가정하지 않음

### Backend — GPT-5.6 Terra

- `apps/backend`의 워크플로와 데이터 저장
- Provider Fake/Adapter와 비용·승인 Gate
- 중지, 재시도, 복구와 중복 호출 차단
- FFmpeg 및 로컬 파일 처리

## 작업 반복 단위

```text
Main이 Python 기능 분석
→ Main이 완료 조건과 공통 계약 확정
→ 사용자가 Frontend/Backend 지시문 전달
→ 각 브랜치에서 구현·테스트
→ 각 브랜치 커밋·푸시
→ Main이 통합
→ Main에서 전체 검증
→ Migration Plan 갱신
→ 다음 기능 선택
```

기존 기능 전체를 한 번에 옮기지 않는다. 통합 가능한 작은 사용자 기능 하나씩
반복한다.

## Git 규칙

- Main: `main`
- Frontend: `feature/frontend`
- Backend: `feature/backend`
- 작업 시작 전 담당 브랜치를 확인한다.
- 다른 AI의 변경을 덮어쓰지 않는다.
- 커밋 전에 관련 테스트를 실행한다.
- Main에는 통합 검증을 통과한 변경만 유지한다.

## 세션 시작 문장

각 새 CLI 세션은 이전 대화를 기억하지 못한다. 다음 순서로 시작한다.

```text
AGENTS.md와 안내된 현재 문서를 먼저 읽고,
현재 브랜치와 Git 상태를 확인해줘.
문서에 없는 결정을 추측하지 말고 질문해줘.
```

그다음 Main이 작성한 이번 기능의 지시문을 전달한다. 장기 요구사항을 대화에만
남기지 않고 현재 문서 또는 마이그레이션 계획에 반영한다.
