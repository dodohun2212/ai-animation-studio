# AI Animation Studio
# Development Guide

Version: 1.0

---

# 1. 목적

본 문서는 AI Animation Studio 프로젝트의 개발 규칙을 정의한다.

모든 개발자는 본 문서를 기준으로 코드를 작성한다.

---

# 2. 개발 목표

프로젝트는

유지보수

확장성

안정성

재사용성

을 최우선으로 개발한다.

---

# 3. 개발 환경

Language

Python 3.12+

IDE

Visual Studio Code

Version Control

Git

Repository

GitHub

Operating System

Windows

Linux

macOS

---

# 4. 코딩 스타일

PEP8을 따른다.

Type Hint를 사용한다.

Docstring을 작성한다.

하드코딩을 금지한다.

Magic Number를 금지한다.

---

# 5. 파일 작성 규칙

파일 하나는

하나의 역할만 가진다.

파일이 지나치게 커질 경우

분리한다.

---

# 6. 함수 작성 규칙

함수는

하나의 기능만 수행한다.

함수 이름은

동작을 명확하게 표현한다.

---

예시

create_project()

generate_story()

build_prompt()

generate_image()

export_video()

---

# 7. 변수 작성 규칙

의미 없는 변수명을 사용하지 않는다.

금지

a

b

temp

test

추천

project_context

scene_prompt

character_profile

style_profile

---

# 8. 클래스 작성 규칙

클래스는

하나의 책임만 가진다.

클래스는

상속보다 조합을 우선한다.

---

# 9. Config 규칙

설정값은

config에서만 관리한다.

코드 안에 직접 작성하지 않는다.

예시

API Key

Budget

FPS

Resolution

Language

Timeout

Retry

---

# 10. Prompt 규칙

Prompt는

prompts/

폴더에서 관리한다.

Python 코드 안에 Prompt를 작성하지 않는다.

---

# 11. Engine 규칙

모든 Engine은

동일한 인터페이스를 구현한다.

initialize()

execute()

validate()

cleanup()

---

# 12. Workflow 규칙

Workflow Engine만

다른 Engine을 호출할 수 있다.

Engine끼리는

직접 호출하지 않는다.

---

# 13. 예외 처리

모든 예외는

try/except로 처리한다.

예외를 무시하지 않는다.

모든 오류는

로그를 남긴다.

---

# 14. Logging

모든 작업은

Logger를 사용한다.

print()는

디버깅 외에는 사용하지 않는다.

---

# 15. Memory 규칙

Memory는

Workflow 종료 후

저장한다.

중간 저장은

필요한 경우에만 수행한다.

---

# 16. API 규칙

OpenAI API는

Workflow를 통해 호출한다.

Engine이 직접 API를 호출하지 않는다.

---

# 17. Cache 규칙

동일한 요청은

Cache를 우선 사용한다.

Cache가 존재하지 않을 경우에만

API를 호출한다.

---

# 18. 테스트 규칙

새로운 기능은

반드시 테스트를 작성한다.

Unit Test

Integration Test

System Test

를 구분한다.

---

# 19. Git 규칙

main

배포 가능한 코드만 유지한다.

feature/*

기능 개발

fix/*

버그 수정

docs/*

문서 수정

---

# 20. Commit 규칙

커밋 메시지는

명확하게 작성한다.

예시

feat: add Story Engine

fix: resolve image cache bug

docs: update workflow guide

refactor: simplify Prompt Builder

---

# 21. 리뷰 규칙

새로운 기능은

기존 기능을 변경하지 않아야 한다.

기존 기능을 수정하는 경우

영향 범위를 확인한다.

---

# 22. 품질 기준

모든 코드는

읽기 쉬워야 한다.

중복 코드를 최소화한다.

복잡한 로직은

주석보다

함수 분리를 우선한다.

---

# 23. 성능 기준

불필요한 반복문을 줄인다.

API 호출을 최소화한다.

캐시를 적극 활용한다.

메모리 사용량을 고려한다.

---

# 24. 보안 기준

API Key는

.env 파일에 저장한다.

민감한 정보는

GitHub에 업로드하지 않는다.

---

# 25. 완료 기준

새로운 기능은

다음을 만족해야 한다.

- 코드 작성 완료
- 테스트 완료
- 로그 확인
- 문서 업데이트
- 예외 처리 구현

---

# End of File