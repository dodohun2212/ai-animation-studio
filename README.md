# AI Animation Studio

대본과 장면 이미지를 생성하고, 사용자가 승인한 Runway 영상들을 FFmpeg로
병합하여 Instagram Reels용 MP4를 만드는 애플리케이션입니다.

기존 Python/Tkinter 프로그램에서 TypeScript로의 이전은 끝났고, 지금은 실사용
피드백을 받아 고치고 다듬는 단계입니다. 파이썬 소스(`app/`, `tests/`)는
2026-09-02에 저장소에서 지웠습니다 — 원본 동작을 확인해야 하면 git 히스토리에
있습니다(`git log --diff-filter=D -- app`). 자세한 경위는
`docs/06_DECISIONS.md`의 D-047입니다.

## 현재 구조

```text
apps/frontend/       React + Vite
apps/backend/        NestJS
apps/desktop/        Electron
packages/shared/     공통 TypeScript 계약
prompts/             대본 생성 템플릿 — 실행 중에 읽히고 설치 프로그램에 복사됩니다
fonts/               자막 렌더링용 폰트 — 같은 이유로 실행에 필요합니다
learning_data/       파이썬 시절 데이터(보존). 지금 앱은 `apps/backend/learning_data`에 씁니다
docs/                제품 명세 · 작업 기록 · 결정 기록
```

## 개발 환경

- Node.js 22+
- npm workspaces
- TypeScript strict mode
- FFmpeg / ffprobe — 영상 병합과 음원 길이 확인에 실제로 쓰입니다(설치돼 있지 않으면 병합이 거절됩니다)

## 명령어

```text
npm install
npm run typecheck
npm run build
npm test
npm run dev:frontend
npm run dev:backend
npm run dev:desktop
```

PowerShell 실행 정책 때문에 `npm.ps1`이 차단되면 `npm.cmd`를 사용합니다.

## 현재 구현 상태

동작합니다:

- 단편 프로젝트 — 대본·장면 생성(OpenAI), 장면 이미지 생성과 검토, Runway 영상 생성,
  영상 검토, FFmpeg 병합
- 장기 프로젝트(회차) — 개요·회차 대본, 참고 자산 매핑, 회차 이미지·영상·병합
- 명언 카드 — 그림 한 장과 문장 하나로 만드는 무료 경로(자막 위치·크기 조절 포함)
- 내레이션(TTS)·자막·배경음악 — 음원 보관함, 라이선스 기록, 시작 지점 선택
- 유료 요청 앞의 승인·예산 게이트와 월 사용 원장(OpenAI·Runway 각각)
- Instagram 게시 — 계정 선택, 커버 프레임, 게시 기록
- 보관함 — 자산·영상·음원, 버전 보관과 복원
- Electron 데스크톱 셸

아직입니다:

- NSIS 설치 프로그램
- 서버 배포와 사용자 계정

자세한 현재 요구사항과 순서는 `docs/`를 확인합니다.

## 작업공간

```text
AI-Animation-Studio-Workspace/
├─ main/       통합과 검증
├─ frontend/   feature/frontend
└─ backend/    feature/backend
```

세 폴더에는 저장소 전체가 보이는 것이 정상입니다. 역할은 폴더에 들어 있는
파일이 아니라 체크아웃된 브랜치와 담당 작업으로 구분합니다.
