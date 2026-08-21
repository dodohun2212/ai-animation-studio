# AI Animation Studio

대본과 장면 이미지를 생성하고, 사용자가 승인한 Runway 영상들을 FFmpeg로
병합하여 Instagram Reels용 MP4를 만드는 애플리케이션입니다.

현재는 기존 Python/Tkinter 프로그램의 기능을 TypeScript 애플리케이션으로
이전하는 단계입니다. Python 버전은 비교 기준으로 보존되며 새 기능 개발보다
기존 기능의 동등한 재구현을 우선합니다.

## 현재 구조

```text
app/                 기존 Python 기준 구현
tests/               기존 Python 테스트
prompts/             기존 프롬프트
apps/frontend/       React + Vite
apps/backend/        NestJS
apps/desktop/        Electron
packages/shared/     공통 TypeScript 계약
docs/                현재 명세와 마이그레이션 문서
```

## 개발 환경

- Node.js 22+
- npm workspaces
- TypeScript strict mode
- Python 3.12+는 기존 기준 구현을 검증할 때만 필요
- FFmpeg는 영상 기능 구현과 검증 단계에서 필요

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

구현됨:

- TypeScript monorepo 기반
- React 프론트엔드 기반
- NestJS 백엔드와 로컬 `GET /health`
- Electron 데스크톱 셸
- 초기 공유 타입과 내부 API 계약

아직 구현되지 않음:

- 기존 Python 기능의 실제 마이그레이션
- 프로젝트 저장과 기존 데이터 변환
- OpenAI와 Runway Provider 연결
- 승인·예산 Gate 및 작업 복구
- 영상 검토와 FFmpeg 자동 병합
- 설치 프로그램과 서버 배포

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
