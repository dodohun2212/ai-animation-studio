# AI Animation Studio
# Deployment Specification

Version: 1.0

---

# 1. 목적

본 문서는

AI Animation Studio를

개발 환경에서 실행하기 위한

배포 및 실행 환경을 정의한다.

---

# 2. 목표

누구나 동일한 환경에서

프로젝트를 실행할 수 있도록 한다.

---

# 3. 운영 환경

운영체제

Windows 11

지원

Windows

Linux

macOS

---

# 4. Python

권장 버전

Python 3.12 이상

가상환경 사용을 권장한다.

---

# 5. 필수 프로그램

Python

Git

FFmpeg

Visual Studio Code

CapCut Pro

---

# 6. CapCut

CapCut은

사용자가 직접 사용하는

외부 프로그램이다.

프로그램은

CapCut을

실행하거나

자동 제어하지 않는다.

---

# 7. Git

프로젝트 버전 관리는

Git을 사용한다.

Remote Repository는

GitHub를 사용한다.

---

# 8. 프로젝트 복제

프로젝트는

Git으로 복제한다.

예시

git clone

↓

프로젝트 폴더 생성

---

# 9. 가상환경

프로젝트마다

독립적인 Python 가상환경을 사용한다.

---

# 10. 의존성 설치

requirements.txt

기준으로

모든 라이브러리를 설치한다.

---

# 11. 환경 변수

프로젝트 루트에

.env 파일을 생성한다.

---

필수 항목

OPENAI_API_KEY

---

선택 항목

MONTHLY_BUDGET

LOG_LEVEL

OUTPUT_DIRECTORY

---

# 12. FFmpeg

FFmpeg는

PATH에 등록되어 있어야 한다.

프로그램 시작 시

자동으로

설치 여부를 검사한다.

---

# 13. 폴더 생성

프로그램 시작 시

필요한 폴더가 없으면

자동 생성한다.

예시

images/

videos/

output/

logs/

cache/

learning_data/

---

# 14. 첫 실행

프로그램 시작

↓

환경 검사

↓

폴더 검사

↓

FFmpeg 검사

↓

API Key 검사

↓

프로젝트 준비 완료

---

# 15. 일반 실행

사용자

↓

주제 입력

↓

OpenAI 생성

↓

이미지 생성

↓

WAITING_FOR_CAPCUT

↓

사용자 CapCut 작업

↓

프로그램 재실행

↓

영상 병합

↓

최종 영상 생성

---

# 16. 프로젝트 재개

프로그램 시작 시

WAITING_FOR_CAPCUT

상태의 프로젝트가 있으면

사용자에게

재개 여부를 묻는다.

---

# 17. 출력 폴더

최종 영상

output/reels/

---

이미지

images/generated/

---

로그

logs/

---

캐시

cache/

---

학습 데이터

learning_data/

---

# 18. 실행 로그

프로그램 시작 시

다음을 기록한다.

운영체제

Python 버전

FFmpeg 버전

프로젝트 버전

실행 시간

---

# 19. 오류 처리

다음을 검사한다.

Python 미설치

FFmpeg 미설치

API Key 없음

폴더 접근 불가

필수 파일 없음

---

# 20. 프로젝트 종료

프로젝트 종료 시

다음을 수행한다.

Project Context 저장

Memory 저장

로그 저장

Cache 갱신

---

# 21. 업데이트

프로젝트 업데이트는

Git Pull을 사용한다.

사용자 데이터는

업데이트 과정에서

삭제하지 않는다.

---

# 22. 백업

프로젝트 완료 후

자동 백업을 생성한다.

저장 위치

backup/

---

# 23. 배포 원칙

프로젝트는

로컬 환경에서

독립적으로 실행 가능해야 한다.

외부 서버 없이도

동작할 수 있어야 한다.

---

# 24. 향후 확장

향후

Docker

AWS

클라우드 환경

에서도

동일한 구조를 유지한다.

MVP에서는

로컬 실행을 기준으로 한다.

---

# 25. 완료 기준

프로젝트는

새로운 PC에서도

환경 설정만 완료하면

동일한 방식으로

정상 실행되어야 한다.

---

End of File