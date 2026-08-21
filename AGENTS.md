# AGENTS.md

## Shared AI Guidelines

All coding agents must read and follow `AI_GUIDELINES.md` before changing this
repository. If that file conflicts with this project-specific document, this
document takes precedence.

## TypeScript Migration Scope

- The existing `app/`, `tests/`, and `prompts/` directories are the preserved
  Python baseline. Do not move, rewrite, or delete them unless explicitly asked.
- New application code belongs in `apps/` and shared TypeScript contracts belong
  in `packages/shared/`.
- Python-specific coding rules apply to the preserved Python code only.
- New code uses TypeScript strict mode, npm workspaces, React with Vite for the
  frontend, NestJS for the backend, and Electron for the Windows desktop shell.
- Do not connect paid OpenAI or Runway requests until their approval and budget
  gates have tests using fake adapters.
- A worktree does not imply file ownership. The user must explicitly assign the
  frontend, backend, or integration role for each session.

## 프로젝트 목적

사용자가 주제를 입력하면 OpenAI API가 대본, 장면 6개와 이미지 6장을 생성한다.

Runway API는 승인된 장면 이미지 1장당 약 5초의 세로 영상을 1개씩 생성한다.

사용자는 Runway 요청 전에 장면별 움직임 프롬프트와 예상 비용을 확인·수정하고,
생성된 영상 6개를 검토한다. 프로그램은 확정된 영상들을 FFmpeg로 순서대로 병합하여
Instagram Reels용 최종 MP4를 생성한다.

## 고정 Workflow

```text
주제 입력
→ 프로젝트·API·예산·캐릭터 검사
→ OpenAI Story API로 대본 및 장면 6개 생성
→ OpenAI Image API로 이미지 6장 생성
→ 사용자 이미지 검토
→ Runway 장면별 프롬프트·예상 비용 확인 및 수정
→ 사용자의 명시적 전송 승인
→ Runway Image-to-Video 순차 생성
→ 장면별 영상 저장 및 검토
→ 장면 6개 사용 확정
→ FFmpeg 순서 병합
→ Instagram Reels용 최종 MP4 생성
```

## AI Provider 역할

### OpenAI Story API

- 프로젝트 설정과 Asset Folder의 텍스트 정보를 사용한다.
- 대본과 정확히 6개 장면을 생성한다.
- 장면별 시작 움직임, 주요 움직임, 종료 움직임과 카메라 움직임을 생성한다.
- 다음 장면으로 전달할 구조화된 움직임 연결 정보를 생성한다.

### OpenAI Image API

- 장면별 대본, 시각 설정, Candidate Character와 Reference 이미지를 사용한다.
- 장면당 기본 이미지 1장만 생성한다.
- 특정 장면만 재생성할 수 있어야 한다.

### Runway Video API

- OpenAI Image API가 생성하고 사용자가 검토한 장면 이미지를 입력으로 사용한다.
- 기본 모델은 `gen4_turbo`이다.
- 기본 출력은 `720:1280`, 무음, 장면당 5초이다.
- 이미지 1장당 영상 1개를 생성한다.
- Scene 1부터 Scene 6까지 기본적으로 순차 생성한다.
- 사용자가 최종 확인 버튼을 누르기 전에는 유료 요청을 보내지 않는다.
- 이전 장면의 종료 움직임과 현재 장면의 시작 움직임을 현재 프롬프트에 자동 결합한다.
- 장면 연결 강도 기본값은 `보통`이다.
- 완료 장면은 재개 시 건너뛰고 실패하거나 미완료된 장면만 처리한다.
- 자동 무한 재시도는 금지한다.

## Runway 요청 확인 규칙

실제 요청 전에 반드시 다음 정보를 표시한다.

- 모델
- 화면 비율과 해상도
- 장면 수와 장면별 길이
- 실행 방식
- 오디오 사용 여부
- 장면 연결 강도
- 장면별 최종 프롬프트
- 예상 최대 호출 수
- 이번 요청 예상 비용
- Runway 로컬 기록 비용과 남은 로컬 예산

장면별 최종 프롬프트는 사용자가 확인하고 수정할 수 있어야 한다.

프롬프트 확인·수정·창 닫기만으로는 API 요청이 발생하지 않는다.

## 생성·중지·복구 규칙

- 진행 창 닫기는 화면만 닫으며 백그라운드 생성을 중단하지 않는다.
- 생성 중지는 아직 제출하지 않은 다음 장면 요청만 중단한다.
- 이미 Runway에 제출한 Task는 상태를 계속 추적하여 결과를 저장한다.
- Task ID, 입력 해시, 프로젝트 ID와 Scene 번호를 영구 저장한다.
- 앱 강제 종료 후 Task ID를 조회하여 작업을 복구한다.
- 성공한 장면 파일은 보존하고 재요청하지 않는다.
- 실패한 장면은 사용자의 명시적 재시도 승인 후 해당 장면만 다시 요청한다.
- 재시도 전 추가 예상 비용을 다시 표시한다.
- 동일한 입력 해시와 성공 결과가 있으면 중복 API 호출을 차단한다.

## 영상 검토 규칙

병합 전에 각 장면 영상을 검토한다.

- 장면 영상 재생
- 원본 OpenAI 이미지 확인
- Runway에 전달한 최종 프롬프트 확인
- 장면 사용 확정
- 해당 장면만 재생성
- 생성 상태와 로컬 비용 기록 확인

영상 6개가 모두 사용 확정되어야 FFmpeg 병합을 실행할 수 있다.

영상 사용 확정은 Asset Library 등록이나 승인과 무관한 프로젝트 내부 상태이다.

## 영상 저장소

생성 영상은 Asset Library에 저장하지 않는다.

프로젝트별 영상 저장 구조:

```text
videos/
├─ runway/
│  ├─ scene1.mp4
│  ├─ scene2.mp4
│  ├─ scene3.mp4
│  ├─ scene4.mp4
│  ├─ scene5.mp4
│  └─ scene6.mp4
├─ continuity/
│  ├─ scene1_last.png
│  ├─ scene2_last.png
│  ├─ scene3_last.png
│  ├─ scene4_last.png
│  ├─ scene5_last.png
│  └─ scene6_last.png
└─ final/
   └─ instagram_reel.mp4
```

- `runway/`에는 병합 전 원본 장면 영상을 저장한다.
- `continuity/`에는 검토와 복구에 사용하는 장면별 마지막 프레임을 저장한다.
- `final/`에는 FFmpeg로 병합한 최종 영상을 저장한다.
- 기존 프로젝트의 CapCut 파일은 자동 삭제하지 않지만 새 Workflow에서는 사용하지 않는다.

## Workflow 상태

- INIT
- READY
- GENERATING_STORY
- GENERATING_IMAGES
- IMAGES_READY
- WAITING_FOR_VIDEO_CONFIRMATION
- GENERATING_VIDEOS
- VIDEOS_READY
- REVIEWING_VIDEOS
- VIDEOS_APPROVED
- RENDERING
- COMPLETED
- INTERRUPTED
- FAILED
- CANCELLED

`WAITING_FOR_VIDEO_CONFIRMATION`은 실패 상태가 아니다. 사용자의 프롬프트·비용 확인과
명시적 API 전송 승인을 기다리는 정상 일시 중지 상태이다.

`REVIEWING_VIDEOS`도 실패 상태가 아니다. 생성된 장면 영상을 병합 전에 검토하는 상태이다.

## 역할 분리

### Workflow Engine

- 실행 순서와 상태 관리
- Project Context 전달
- 저장 및 재개
- 중복 요청 방지
- 오류와 중지 처리

### AI Director

- 장르, 분위기, 감정과 시각 방향 결정
- 장면별 시작·주요·종료 움직임 생성
- 카메라 움직임과 다음 장면 연결 정보 생성

### Image Pipeline

- 대본·장면·이미지 생성
- 사용자 이미지 검토 후 `IMAGES_READY` 상태 저장

### Video Generation Pipeline

- Runway 요청 프롬프트 조립
- 비용 확인과 사용자 승인 Gate 적용
- Runway Task 제출·조회·다운로드
- 완료 장면 저장, 재개와 개별 재생성
- 마지막 프레임 추출

### Video Review

- 병합 전 장면 영상 검토
- 장면별 사용 확정과 개별 재생성 연결
- 모든 장면 확정 후 `VIDEOS_APPROVED` 상태 저장

### Video Pipeline

- 확정된 Runway 영상 6개의 존재 여부 검사
- 파일명, 순서, 길이와 손상 여부 검사
- FFmpeg로 Scene 1부터 Scene 6까지 순서대로 병합
- Instagram Reels용 최종 MP4 저장

## API 키와 예산 규칙

- OpenAI API 키는 `.env`의 `OPENAI_API_KEY`에서 읽는다.
- Runway API 키는 `.env`의 `RUNWAYML_API_SECRET`에서 읽는다.
- API 키를 코드, 프로젝트 JSON, UI 평문 또는 로그에 기록하지 않는다.
- OpenAI 예산과 Runway 예산을 별도로 관리한다.
- Runway 초기 월 로컬 예산 기본값은 10 USD이다.
- 실제 결제 차단은 각 Provider 플랫폼의 결제·충전 제한과 병행한다.
- 모든 유료 요청은 공통 Budget 실행 Wrapper를 통과한다.
- 요청 전에 예상 비용을 예약하고 완료·실패 결과를 기록한다.
- 자동 무한 재시도는 금지한다.
- 테스트에서는 실제 유료 API를 호출하지 않는다.

## 캐릭터 규칙

- 대표 캐릭터는 모든 장면에 등장한다.
- 기준 이미지를 모든 장면 이미지 생성에 사용한다.
- 얼굴, 머리, 기본 복장, 대표 색상과 고유 소품을 유지한다.
- 표정, 자세, 행동, 배경과 조명은 바꿀 수 있다.

## 스타일 규칙

- 특정 작품이나 작가의 화풍을 복제하지 않는다.
- 미국 TV 애니메이션의 일반 시각 요소를 조합한다.
- 참고 이미지는 색조, 조명, 구도, 배경과 소품 자료로 사용한다.
- 승인·거절 데이터를 Style DNA에 반영한다.
- MVP에서는 PyTorch와 LoRA를 사용하지 않는다.

## 코딩 규칙

- Python 3.12+
- PEP 8
- 타입 힌트
- docstring
- pathlib.Path
- 설정·경로 분리
- 프롬프트는 `prompts/`에서 관리
- subprocess는 인수 배열 사용
- `shell=True` 기본 금지
- 오류를 숨기지 않음
- 로그와 사용자 메시지를 분리

## 테스트 규칙

- OpenAI와 Runway 유료 API는 Mock/Fake Adapter를 사용한다.
- Runway 요청 전 사용자 승인 Gate 테스트
- 예상 비용 표시와 Budget 차단 테스트
- Scene별 순차 생성과 진행률 테스트
- 완료 Scene 건너뛰기 테스트
- 실패 Scene 개별 재시도 테스트
- 중지 후 미제출 Scene 차단 테스트
- Task ID 저장과 비정상 종료 복구 테스트
- 동일 입력 중복 호출 방지 테스트
- FFmpeg 미설치 오류 테스트
- Scene 영상 파일 누락·손상 테스트
- `WAITING_FOR_VIDEO_CONFIRMATION` 저장·재개 테스트
- 영상 검토와 6개 사용 확정 Gate 테스트
- Instagram 실제 업로드 테스트는 별도 Mock으로 수행한다.

## 최종 기준

문서와 코드가 충돌하면 다음 흐름을 최우선으로 적용한다.

```text
OpenAI 대본·이미지 자동 생성
→ 사용자 이미지 검토
→ Runway 프롬프트·비용 확인 및 명시적 승인
→ Runway 장면 영상 순차 생성
→ 사용자 영상 검토
→ FFmpeg 자동 병합
→ Instagram Reels용 최종 MP4
```
