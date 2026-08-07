# PRISM FORGE

OpenAI로 대본과 이미지 6장을 생성하고, Runway로 장면 영상을 만든 뒤
FFmpeg로 Instagram Reels용 최종 영상을 병합하는 제작 도구입니다.

## 기준 Workflow

```text
사용자 프로젝트 설정
→ OpenAI Story API: 대본과 장면 6개
→ OpenAI Image API: 이미지 6장
→ 사용자 이미지 검토
→ Runway 프롬프트·예상 비용 확인 및 수정
→ 사용자의 명시적 요청 승인
→ Runway Image-to-Video 순차 생성
→ 장면별 영상 검토와 사용 확정
→ FFmpeg 순서 병합
→ Instagram Reels용 최종 MP4
```

## Provider 역할

- OpenAI Story API: 대본, 장면 구성과 구조화된 움직임 정보
- OpenAI Image API: 장면별 이미지 생성과 개별 재생성
- Runway Video API: 검토된 이미지 1장당 약 5초의 세로 영상 생성
- FFmpeg: 확정된 Scene 1~6 영상 검사와 순서 병합

## 영상 기본값

- 모델: Runway `gen4_turbo`
- 장면 수: 6개
- 장면 길이: 5초
- 화면: `720×1280`, 9:16
- 오디오: 없음
- 실행: Scene 1부터 순차 생성
- 장면 연결: 이전 Scene 종료 움직임을 다음 Scene 프롬프트에 자동 반영

## 영상 저장 구조

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
│  └─ scene1_last.png ... scene6_last.png
└─ final/
   └─ instagram_reel.mp4
```

생성 영상은 Asset Library에 등록하지 않으며 프로젝트 결과물로 별도 관리합니다.

## 비용 보호

- OpenAI와 Runway 예산을 분리합니다.
- 실제 유료 요청 전 프롬프트, 호출 수와 예상 비용을 표시합니다.
- 사용자의 명시적 승인 전에는 유료 요청을 보내지 않습니다.
- 완료된 Scene은 재개 시 건너뜁니다.
- 자동 무한 재시도는 금지합니다.
- 실패한 Scene만 사용자 승인 후 재생성합니다.

## 기술 스택

- Python 3.12+
- Tkinter
- OpenAI API
- Runway API
- FFmpeg
- JSON 기반 로컬 저장

## 현재 전환 상태

기존 CapCut UI와 실행 경로는 제거되었습니다. 기존 프로젝트 JSON의 CapCut 상태와
경로 필드는 사용자 데이터를 잃지 않도록 불러올 때 새 영상 상태로 변환됩니다.
Runway 네트워크 Adapter와 영상 생성 UI는 다음 구현 단계에서 연결합니다.
