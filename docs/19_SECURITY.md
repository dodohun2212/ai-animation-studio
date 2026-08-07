# AI Animation Studio
# Security Specification

Version: 1.0

---

# 1. 목적

본 문서는

AI Animation Studio의

보안 정책을 정의한다.

사용자의 데이터와

API Key를 안전하게 보호하는 것을 목표로 한다.

---

# 2. 목표

프로젝트 실행에 필요한

민감한 정보를

안전하게 관리한다.

---

# 3. 보호 대상

다음을 보호한다.

OpenAI API Key

Project Data

Character Data

Lore Data

Style Data

Reference Data

Logs

Configuration

---

# 4. API Key 관리

API Key는

.env 파일에 저장한다.

코드 안에 작성하지 않는다.

GitHub에 업로드하지 않는다.

---

# 5. 환경 변수

필수

OPENAI_API_KEY

선택

MONTHLY_BUDGET

LOG_LEVEL

OUTPUT_DIRECTORY

---

# 6. Git 보안

다음 파일은

GitHub에 업로드하지 않는다.

.env

cache/

logs/

backup/

output/

learning_data/

videos/

images/generated/

---

# 7. .gitignore

다음을 포함한다.

.env

__pycache__/

*.pyc

cache/

logs/

backup/

output/

learning_data/

videos/

images/generated/

---

# 8. 로그 보안

로그에는

다음을 기록하지 않는다.

API Key

Access Token

환경 변수

개인정보

민감한 Prompt

---

# 9. Prompt 보안

Prompt에는

민감한 개인정보를 포함하지 않는다.

사용자가 입력한 개인정보는

자동으로 포함하지 않는다.

---

# 10. 파일 접근

프로그램은

프로젝트 폴더 내부만

읽고 쓴다.

시스템 폴더를

임의로 수정하지 않는다.

---

# 11. FFmpeg 실행

FFmpeg 실행 시

명령어를

문자열 연결로 생성하지 않는다.

인수 배열을 사용한다.

사용자 입력을

명령어에 그대로 전달하지 않는다.

---

# 12. 입력 검증

사용자 입력은

검증 후 사용한다.

검사 항목

빈 문자열

허용되지 않는 문자

너무 긴 입력

잘못된 경로

---

# 13. 파일명 규칙

파일명은

프로그램이 생성한다.

사용자가

임의의 파일명을

실행 경로로 사용하지 않는다.

---

# 14. 경로 관리

모든 파일 경로는

프로젝트 루트 기준으로

생성한다.

상대 경로와

pathlib를 사용한다.

---

# 15. JSON 보안

JSON 저장 전

필수 항목을 검사한다.

손상된 JSON은

로드하지 않는다.

---

# 16. 예외 처리

예외 발생 시

민감한 정보를

오류 메시지에 출력하지 않는다.

---

# 17. 프로젝트 데이터

Project Context는

프로젝트 폴더 안에만 저장한다.

프로그램 종료 시

정상 저장을 확인한다.

---

# 18. 백업

백업 파일은

원본과 분리하여 저장한다.

사용자의 요청 없이는

자동 삭제하지 않는다.

---

# 19. 사용자 권한

프로그램은

사용자 권한 범위 내에서만

동작한다.

관리자 권한을

기본적으로 요구하지 않는다.

---

# 20. 외부 프로그램

프로그램이 사용하는

외부 프로그램은

FFmpeg만 자동 실행한다.

CapCut은

사용자가 직접 실행한다.

프로그램은

CapCut을 제어하지 않는다.

---

# 21. 인터넷 사용

인터넷 연결은

OpenAI API 호출에만 사용한다.

불필요한 외부 통신은 하지 않는다.

---

# 22. 데이터 삭제

사용자가 삭제를 요청한 경우에만

Project

Memory

Cache

Backup

을 삭제한다.

자동 삭제는 수행하지 않는다.

---

# 23. 업데이트 보안

프로젝트 업데이트 시

사용자의 프로젝트 데이터와

학습 데이터를 유지한다.

업데이트로 인해

데이터가 삭제되어서는 안 된다.

---

# 24. 향후 확장

향후

클라우드 환경으로 확장하더라도

다음 원칙을 유지한다.

API Key 분리

권한 최소화

민감 정보 암호화

안전한 로그 관리

---

# 25. 완료 기준

프로젝트는

API Key와

프로젝트 데이터를

안전하게 보호하며,

민감한 정보가

코드, 로그, Git 저장소에

노출되지 않아야 한다.

---

End of File