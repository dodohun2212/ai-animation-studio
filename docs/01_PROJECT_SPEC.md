# AI Animation Studio
# Software Requirements Specification

Version: 1.1.0

## 1. 목적

본 문서는 프로젝트의 기능적·비기능적 요구사항을 정의한다.

## 2. 제품 목표

사용자가 주제를 입력하면 OpenAI API가 약 30초 애니메이션용 대본, 장면 6개, 이미지 6장과 CapCut 움직임 프롬프트를 생성한다.

사용자는 CapCut Pro에서 각 이미지를 영상으로 직접 변환한다.

프로그램은 CapCut 출력 영상 6개를 FFmpeg로 자동 병합한다.

## 3. 프로그램이 자동 수행하는 작업

- 프로젝트 생성
- API 키·예산·캐릭터 검사
- 제목 생성
- 약 30초 대본 생성
- 정확히 6개 장면 생성
- 장면별 이미지 프롬프트 생성
- 이미지 6장 생성
- 장면별 CapCut 움직임 프롬프트 생성
- 프로젝트 상태 저장
- 영상 파일 6개 검사
- FFmpeg 자동 병합
- 인트로·아웃트로·배경음악 선택 적용
- 최종 MP4 저장
- 로그와 프로젝트 기록 저장

## 4. 사용자가 수행하는 작업

- 주제 입력
- 생성 이미지 검토
- 필요 시 특정 장면만 재생성
- CapCut Pro에서 Image to Video 실행
- 영상 6개를 지정 이름으로 저장
- 최종 영상 확인

## 5. CapCut 경계

CapCut은 사용자가 직접 조작하는 외부 프로그램이다.

다음은 구현하지 않는다.

- CapCut 자동 실행
- CapCut 화면 자동 클릭
- CapCut 자동 내보내기
- CapCut 프로젝트 자동 생성
- CapCut UI 매크로
- 비공식 API 또는 파일 형식 역공학

## 6. 입력

### 필수
- 주제

### 선택
- 장르
- 분위기
- 대표 캐릭터 설정
- 스타일·배경·조명·구도 참고 이미지
- 세계관 또는 시리즈
- 재생성할 장면 번호

## 7. OpenAI 생성 결과

- 제목
- 한 줄 소개
- 약 30초 한국어 대본
- 정확히 6개의 장면
- 장면별 예상 길이
- 행동, 감정, 장소, 카메라 구도
- 이미지 프롬프트
- CapCut 움직임 프롬프트
- 이미지 6장
- 게시 설명문과 해시태그 초안

## 8. 대표 캐릭터

- 모든 장면에 등장한다.
- 화면에서 명확히 식별 가능해야 한다.
- 기준 이미지를 모든 생성 요청에 사용한다.
- 얼굴, 머리, 기본 복장, 대표 색상, 고유 소품을 유지한다.
- 표정, 자세, 행동, 조명과 배경은 변경 가능하다.

## 9. 이미지 생성

- 장면당 기본 1장
- 총 6장
- 9:16 세로형에 적합
- 자막, 워터마크, UI, 의미 없는 글자 금지
- 특정 장면만 재생성 가능
- 전체 자동 재생성 금지

저장 경로:

```text
images/generated/scene1.png
...
images/generated/scene6.png
```

## 10. CapCut 인계

이미지 생성 완료 후 프로그램은 다음을 제공한다.

- 이미지 6장 경로
- 장면별 움직임 프롬프트
- 권장 장면 길이
- 캐릭터 움직임
- 카메라 움직임
- 배경 움직임
- 왜곡 방지 지침
- 파일 저장 규칙

상태를 `WAITING_FOR_CAPCUT`으로 저장한다.

## 11. CapCut 출력 파일

```text
videos/capcut/scene1.mp4
videos/capcut/scene2.mp4
videos/capcut/scene3.mp4
videos/capcut/scene4.mp4
videos/capcut/scene5.mp4
videos/capcut/scene6.mp4
```

프로그램은 존재 여부, 이름, 순서, 파일 크기, 영상 스트림과 길이를 검사한다.

## 12. Workflow 재개

사용자가 영상 6개를 준비한 뒤 프로그램을 다시 실행하면 기존 프로젝트를 선택하여 병합 단계부터 재개한다.

상태 흐름:

```text
IMAGES_READY
→ WAITING_FOR_CAPCUT
→ CAPCUT_CLIPS_READY
→ RENDERING
→ COMPLETED
```

## 13. FFmpeg

- 1080×1920
- 30fps
- H.264
- AAC
- scene1~scene6 순서 병합
- 인트로·아웃트로·배경음악 선택 적용
- 최종 결과: `output/reels/final.mp4`

## 14. 비용

OpenAI API 예산 기준은 월 10 USD이다.

- 호출 전 예산 검사
- 호출·예상 비용 기록
- 캐시 사용
- 무한 재생성 금지
- 플랫폼 사용 한도 설정 병행

## 15. MVP 제외

- CapCut 자동화
- 자동 업로드
- TTS
- 자동 자막
- PyTorch
- LoRA
- 클라우드 배포
- 서버 데이터베이스
