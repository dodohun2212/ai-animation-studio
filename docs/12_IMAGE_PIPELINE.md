# AI Animation Studio
# Image Pipeline Specification

Version: 1.1.0

## 1. 목적

주제와 프로젝트 데이터를 기반으로 이미지 6장과 CapCut용 움직임 프롬프트를 생성한다.

## 2. 입력

- Project Context
- Story
- Scene List
- Character Profile
- Style Profile
- Lore
- Reference Library
- Configuration

## 3. 출력

- `images/generated/scene1.png~scene6.png`
- 장면별 이미지 메타데이터
- 장면별 CapCut 움직임 프롬프트
- 생성 로그
- 업데이트된 Project Context

## 4. 흐름

```text
Context 로드
→ Character·Style·Lore·Reference 로드
→ 장면 프롬프트 생성
→ 이미지 생성
→ 이미지 검증
→ 저장
→ 움직임 프롬프트 생성
→ 다음 장면
→ 6장 완료
→ IMAGES_READY
→ WAITING_FOR_CAPCUT
```

## 5. 장면 처리

Scene 1부터 Scene 6까지 순차 처리한다.

기본 생성 수는 장면당 1장이다.

## 6. 대표 캐릭터

- 모든 장면 프롬프트에 포함
- 기준 이미지를 생성 요청에 사용
- 얼굴, 머리, 기본 복장, 대표 색상과 소품 유지
- 화면에서 명확하게 보여야 함

## 7. Style 및 Reference

- Style DNA를 모든 장면에 적용
- 참고 이미지는 색조·조명·구도·배경·소품 정보로 사용
- 특정 작품 복제 금지
- 장면 간 색감과 렌더링 일관성 유지

## 8. 이미지 검증

- 이미지 파일 존재
- 열기 가능
- 크기 정상
- 캐릭터 등장
- 장면 설명 일치
- 치명적 왜곡 여부
- 자막·워터마크·UI 없음

## 9. 재생성

- 특정 장면만 재생성
- 자동 전체 재생성 금지
- 최대 재시도 수는 Config에서 관리
- 비용 확인 후 호출

## 10. CapCut 움직임 프롬프트

각 장면마다 다음을 생성한다.

- 캐릭터 움직임
- 표정 변화
- 카메라 움직임
- 배경 움직임
- 권장 길이
- 시작 및 종료 자세
- 다음 장면 연결 정보
- 왜곡 방지 조건

저장 예:

```text
prompts/capcut_motion_prompts.txt
```

## 11. Image Pipeline 종료

이미지 6장과 움직임 프롬프트 생성 후 다음을 수행한다.

1. 결과 경로 저장
2. 상태를 `IMAGES_READY`로 변경
3. Project Context 저장
4. 상태를 `WAITING_FOR_CAPCUT`으로 변경
5. 사용자에게 CapCut 작업 방법과 파일명 안내
6. 정상 일시 중지

Image Pipeline은 Video Engine을 자동 호출하지 않는다.

CapCut 작업이 끝난 뒤 사용자가 프로그램을 다시 실행해야 한다.

## 12. 사용자 안내

```text
이미지 생성이 완료되었습니다.

CapCut Pro에서 다음 이미지로 장면 영상을 만드십시오:
images/generated/scene1.png ~ scene6.png

움직임 프롬프트:
prompts/capcut_motion_prompts.txt

저장 위치:
videos/capcut/scene1.mp4 ~ scene6.mp4

완료 후 프로그램을 다시 실행하여 프로젝트를 재개하십시오.
```
