# AI Animation Studio
# System Architecture

Version: 1.1.0

## 1. 핵심 구조

```text
User
  ↓
Workflow Engine
  ↓
AI Director
  ↓
Story / Character / Lore / Style / Reference / Prompt / Image Engines
  ↓
Image Validation
  ↓
IMAGES_READY
  ↓
WAITING_FOR_CAPCUT
  ↓
사용자 수동 CapCut 작업
  ↓
videos/capcut/scene1.mp4~scene6.mp4
  ↓
Video File Validator
  ↓
FFmpeg Engine
  ↓
Export Engine
  ↓
Final Video
```

## 2. CapCut의 위치

CapCut은 시스템 내부 Component, Engine, Service 또는 Provider가 아니다.

CapCut은 Workflow 사이에 존재하는 사용자 수동 작업 단계이다.

프로그램은 CapCut을 호출하지 않는다.

## 3. 계층

- Presentation Layer
- Workflow Layer
- Creative Business Layer
- AI Provider Layer
- Media Processing Layer
- Storage Layer

## 4. Workflow Layer

Workflow Engine은 전체 실행 순서, 상태 저장, 재개와 오류 처리를 담당한다.

비즈니스 로직은 직접 수행하지 않는다.

## 5. AI Director

AI Director는 창작 방향을 결정한다.

- 장르
- 감정
- 스토리 방향
- 색감
- 카메라 방향
- 장면별 CapCut 움직임 지침

AI Director는 CapCut이나 FFmpeg를 직접 실행하지 않는다.

## 6. AI Engines

- Story Engine
- Character Engine
- Lore Engine
- Style Engine
- Reference Engine
- Prompt Engine
- Image Engine
- Validation Engine

Engine끼리는 직접 호출하지 않는다.

## 7. Project Context

모든 Engine은 하나의 Project Context를 공유한다.

주요 필드:

- project_id
- topic
- workflow_state
- character_profile
- lore_context
- style_profile
- references
- story
- scenes
- image_prompts
- motion_prompts
- generated_images
- capcut_clip_paths
- final_video_path
- api_usage
- warnings
- errors

## 8. Workflow 상태

```text
INIT
READY
GENERATING_STORY
GENERATING_IMAGES
IMAGES_READY
WAITING_FOR_CAPCUT
CAPCUT_CLIPS_READY
RENDERING
COMPLETED
FAILED
CANCELLED
```

`WAITING_FOR_CAPCUT`은 정상 상태이다.

## 9. Image Pipeline 완료

이미지 6장과 움직임 프롬프트를 저장한 뒤 다음을 수행한다.

1. Project Context 저장
2. 상태를 `WAITING_FOR_CAPCUT`으로 변경
3. 이미지 폴더와 프롬프트 파일 위치 안내
4. CapCut 출력 파일명 안내
5. 프로그램을 정상 종료하거나 메뉴로 복귀

## 10. 사용자 수동 단계

사용자는 CapCut에서 다음 작업을 한다.

- scene1.png~scene6.png 불러오기
- 각 장면 움직임 프롬프트 적용
- 장면별 영상 생성
- MP4 내보내기
- 지정 경로와 이름으로 저장

이 단계는 프로그램의 자동 실행 그래프에 포함되지 않는다.

## 11. Video Pipeline

Video Pipeline은 이미지를 영상으로 만들지 않는다.

역할:

- CapCut 출력 영상 존재 여부 검사
- 파일명과 순서 검사
- ffprobe를 이용한 영상 스트림 검사
- 영상 길이와 손상 여부 검사
- FFmpeg 병합 입력 목록 생성
- 렌더링 결과 검증

## 12. FFmpeg Engine

자동 처리 항목:

- 입력 정규화
- 해상도 통일
- FPS 통일
- 픽셀 형식 통일
- 장면 연결
- 인트로·아웃트로
- 배경음악
- H.264/AAC 출력

## 13. 재개 구조

프로그램 재실행 시 저장된 프로젝트를 검색한다.

`WAITING_FOR_CAPCUT` 프로젝트가 있으면 다음 메뉴를 제공한다.

- 영상 파일 검사 및 계속
- 이미지 폴더 열기
- 움직임 프롬프트 열기
- 특정 이미지 재생성
- 프로젝트 취소

영상 검사가 통과하면 상태를 `CAPCUT_CLIPS_READY`로 바꾸고 렌더링한다.

## 14. 오류 처리

### 누락 파일
누락된 파일명 전부 출력하고 `WAITING_FOR_CAPCUT` 유지

### 손상 파일
해당 장면 번호와 ffprobe 오류 기록

### FFmpeg 실패
명령 인수와 표준 오류를 로그에 기록하고 `FAILED` 또는 재시도 상태로 전환

### CapCut 관련 오류
프로그램은 CapCut 내부 오류를 감지하거나 복구하지 않는다. 사용자에게 파일 재생성을 안내한다.

## 15. OpenAI Provider

OpenAI API 사용:

- 대본
- 장면
- 이미지 프롬프트
- 이미지 생성
- 메타데이터

CapCut과 FFmpeg는 AI Provider가 아니다.

## 16. Storage

프로젝트 진행 상태는 로컬 JSON으로 저장한다.

프로그램 종료 후에도 `WAITING_FOR_CAPCUT` 프로젝트를 재개할 수 있어야 한다.

## 17. 핵심 설계 원칙

1. OpenAI 자동 생성
2. 사용자 CapCut 수동 작업
3. FFmpeg 자동 병합
4. 수동 단계 전후로 상태 저장
5. CapCut 자동화 금지
