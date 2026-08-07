# AI Animation Studio
# Workflow Engine Specification

Version: 1.1.0

## 1. 목적

Workflow Engine은 전체 실행 순서, 상태, 저장 및 재개를 관리한다.

## 2. 고정 Workflow

```text
INIT
→ READY
→ GENERATING_STORY
→ GENERATING_IMAGES
→ IMAGES_READY
→ WAITING_FOR_CAPCUT
→ CAPCUT_CLIPS_READY
→ RENDERING
→ COMPLETED
```

오류 시 `FAILED`, 사용자 취소 시 `CANCELLED`로 전환한다.

## 3. 1차 실행

1. 설정 로드
2. Logger 초기화
3. API 키 확인
4. 예산 확인
5. 대표 캐릭터 확인
6. 프로젝트 생성
7. Memory, Lore, Style, Reference 로드
8. 대본과 장면 생성
9. 이미지 6장 생성
10. 움직임 프롬프트 생성
11. 프로젝트 저장
12. 상태를 `WAITING_FOR_CAPCUT`으로 변경
13. 사용자 작업 안내
14. 정상 일시 중지

## 4. WAITING_FOR_CAPCUT

이 상태는 오류가 아니다.

Workflow는 CapCut을 실행하거나 감시하지 않는다.

사용자에게 다음을 안내한다.

- 이미지 폴더
- 움직임 프롬프트 파일
- 장면별 권장 길이
- CapCut 출력 파일 경로와 이름
- 프로젝트 재개 명령

## 5. 재개 실행

1. 저장된 프로젝트 목록 로드
2. 사용자가 프로젝트 선택
3. Project Context 복원
4. 상태 확인
5. `videos/capcut/scene1.mp4~scene6.mp4` 검사
6. 누락 시 파일명 안내 후 상태 유지
7. 통과 시 `CAPCUT_CLIPS_READY`
8. FFmpeg 실행
9. 최종 파일 검증
10. `COMPLETED`
11. Memory 저장

## 6. 영상 파일 검사

검사 항목:

- 정확히 6개 파일
- 이름 일치
- 0바이트가 아님
- ffprobe 성공
- 영상 스트림 존재
- 길이 0초 초과
- 지원 가능한 코덱·컨테이너

## 7. Retry

재시도 가능:

- OpenAI 일시 오류
- 네트워크 오류
- Rate Limit
- FFmpeg 일시적 파일 잠금

재시도 불가:

- API 키 없음
- 대표 캐릭터 없음
- 손상된 프로젝트 데이터
- 누락 CapCut 파일
- 사용자가 잘못된 이름으로 저장한 파일

누락 CapCut 파일은 실패가 아니라 대기 상태 유지이다.

## 8. Event

- PROJECT_STARTED
- STORY_GENERATED
- IMAGES_GENERATED
- WAITING_FOR_CAPCUT
- CAPCUT_CLIPS_VALIDATED
- RENDER_STARTED
- PROJECT_COMPLETED
- PROJECT_FAILED
- PROJECT_CANCELLED

## 9. 완료 조건

- 대본 및 장면 완료
- 이미지 6장 완료
- CapCut 영상 6개 사용자 제공
- 파일 검사 통과
- FFmpeg 병합 성공
- 최종 MP4 검증
- Memory 저장 완료

## 10. 금지 사항

Workflow Engine은 다음을 하지 않는다.

- CapCut 실행
- CapCut 클릭
- CapCut 자동 내보내기
- CapCut 창 감시
- 사용자 대신 Image to Video 수행
