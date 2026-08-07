# AI Animation Studio
# Video Pipeline Specification

Version: 1.0

---

# 1. 목적

Video Pipeline은

사용자가 CapCut Pro에서 생성한 영상을

자동으로 검사하고

FFmpeg를 이용하여

최종 릴스 영상을 생성하는 과정을 정의한다.

Video Pipeline은

CapCut을 자동 제어하지 않는다.

---

# 2. 목표

사용자가 제작한

6개의 장면 영상을

하나의 자연스러운 영상으로 병합한다.

---

# 3. 입력

Project Context

CapCut Video Files

Configuration

---

# 4. 출력

Final Video

Video Metadata

Render Log

Updated Project Context

---

# 5. 전체 Workflow

WAITING_FOR_CAPCUT

↓

사용자가 영상 제작

↓

영상 저장

↓

프로그램 실행

↓

영상 검사

↓

FFmpeg 병합

↓

Validation

↓

최종 저장

↓

COMPLETED

---

# 6. CapCut 작업

CapCut 작업은

사용자가 수행한다.

프로그램은

CapCut을 실행하지 않는다.

프로젝트를 생성하지 않는다.

자동 렌더링을 수행하지 않는다.

---

# 7. CapCut 출력 파일

필수 파일

scene1.mp4

scene2.mp4

scene3.mp4

scene4.mp4

scene5.mp4

scene6.mp4

---

저장 위치

videos/

capcut/

---

# 8. 파일 검사

프로그램은

다음을 확인한다.

파일 존재

파일 이름

파일 크기

영상 길이

영상 스트림

손상 여부

---

# 9. 누락 파일

파일이 없으면

Workflow는

WAITING_FOR_CAPCUT

상태를 유지한다.

사용자에게

누락된 파일명을 출력한다.

---

# 10. 손상 파일

영상을 읽을 수 없으면

손상으로 판단한다.

병합을 시작하지 않는다.

---

# 11. 영상 순서

병합 순서는

항상

scene1

↓

scene2

↓

scene3

↓

scene4

↓

scene5

↓

scene6

이다.

---

# 12. FFmpeg

FFmpeg는

자동으로 실행된다.

역할

영상 병합

해상도 통일

FPS 통일

오디오 처리

최종 MP4 생성

---

# 13. Intro

설정되어 있으면

인트로를

영상 앞에 추가한다.

---

# 14. Outro

설정되어 있으면

아웃트로를

영상 뒤에 추가한다.

---

# 15. Background Music

배경음악이 설정되어 있으면

최종 영상에 삽입한다.

---

# 16. Audio

장면 영상에

오디오가 존재하면

Configuration 규칙에 따라 처리한다.

---

# 17. Render Settings

기본 출력

1080 × 1920

30 FPS

H.264

AAC

MP4

---

# 18. Metadata

최종 영상은

Metadata를 생성한다.

항목

Project ID

Duration

Resolution

FPS

Codec

Render Time

Created Date

---

# 19. Logging

다음을 기록한다.

병합 시작

병합 완료

FFmpeg 명령

렌더링 시간

오류

---

# 20. Validation

병합 후

다음을 검사한다.

파일 생성

영상 재생 가능

길이 정상

해상도 정상

손상 여부

---

# 21. Render 실패

FFmpeg 오류 발생 시

FAILED

상태로 변경한다.

오류 로그를 저장한다.

---

# 22. Render 성공

Project Context를 갱신한다.

최종 영상 경로를 저장한다.

상태를

COMPLETED

로 변경한다.

---

# 23. 출력 위치

output/

reels/

---

최종 파일

final.mp4

---

# 24. Workflow

WAITING_FOR_CAPCUT

↓

영상 검사

↓

FFmpeg 병합

↓

Validation

↓

Export

↓

COMPLETED

---

# 25. 제한 사항

Video Pipeline은

CapCut을 제어하지 않는다.

사용자의 입력을 대신하지 않는다.

영상 생성 기능은 수행하지 않는다.

Video Pipeline은

CapCut이 생성한 영상만 처리한다.

---

# 26. 완료 기준

다음 조건을 만족해야 한다.

영상 6개 존재

영상 검사 통과

FFmpeg 병합 성공

Validation 통과

최종 MP4 생성

Project Context 저장

---

End of File