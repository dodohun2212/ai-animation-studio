# AI Animation Studio
# API Specification

Version: 1.0

---

# 1. 목적

본 프로젝트에서 사용하는

외부 API의 사용 규칙을 정의한다.

MVP에서는

OpenAI API만 사용한다.

---

# 2. 목표

OpenAI API를

안전하고

예산 내에서

효율적으로 사용한다.

---

# 3. 사용 API

OpenAI API

---

# 4. API 사용 목적

다음 작업에 사용한다.

Story 생성

Scene 생성

Image Prompt 생성

Image 생성

CapCut Motion Prompt 생성

Metadata 생성

---

# 5. API 호출 순서

Project 생성

↓

Story 생성

↓

Scene 생성

↓

Image Prompt 생성

↓

Image 생성

↓

Motion Prompt 생성

↓

Metadata 생성

---

# 6. API Key

API Key는

.env 파일에서 관리한다.

코드 안에 작성하지 않는다.

GitHub에 업로드하지 않는다.

---

# 7. 환경 변수

예시

OPENAI_API_KEY

---

필수 항목

API Key

---

# 8. Budget Check

모든 API 호출 전에

Budget Manager를 실행한다.

확인 항목

남은 예산

예상 비용

월 사용량

---

# 9. Cache Check

동일한 요청이 존재하면

API를 호출하지 않는다.

Cache 결과를 사용한다.

---

# 10. 요청 데이터

API 요청에는

다음 정보를 포함할 수 있다.

Project Context

Story

Scene

Character

Style

Lore

Reference

Configuration

---

# 11. 응답 처리

응답을 받은 후

다음을 수행한다.

응답 검증

JSON 저장

Project Context 갱신

로그 기록

---

# 12. Story API

입력

Topic

Genre

Character

Lore

출력

Title

Story

Scene List

Ending

---

# 13. Image Prompt API

입력

Scene

Character

Style

Lore

Reference

출력

Scene Prompt

Negative Prompt

---

# 14. Image API

입력

Scene Prompt

Character Reference

Style Profile

출력

Image

Image Metadata

---

# 15. Motion Prompt API

입력

Scene

Character

Story

출력

CapCut Motion Prompt

권장 장면 길이

장면 시작 상태

장면 종료 상태

---

# 16. Metadata API

입력

Project Context

출력

Metadata

Summary

Keywords

---

# 17. 오류 처리

다음 오류를 처리한다.

Network Error

Timeout

Rate Limit

Invalid Response

Authentication Error

---

# 18. Retry

재시도 가능한 오류만

Retry를 수행한다.

최대 횟수는

Configuration에서 관리한다.

---

# 19. Rate Limit

Rate Limit 발생 시

일정 시간 대기 후

다시 시도한다.

무한 반복은 금지한다.

---

# 20. Logging

다음을 기록한다.

호출 시각

API 종류

응답 시간

토큰 사용량

예상 비용

실제 비용

응답 상태

---

# 21. Security

API Key를

로그에 기록하지 않는다.

사용자에게

API Key를 출력하지 않는다.

민감한 정보를

Prompt에 포함하지 않는다.

---

# 22. 프로젝트 규칙

한 프로젝트는

필요한 API만 호출한다.

동일 작업을

중복 호출하지 않는다.

---

# 23. 사용자 재생성

사용자가

특정 Scene만

재생성을 요청하면

해당 Scene만

API를 다시 호출한다.

---

# 24. Workflow 연동

Workflow Engine은

Budget 확인

↓

Cache 확인

↓

API 호출

↓

응답 저장

↓

Project Context 갱신

순서로 처리한다.

---

# 25. 완료 기준

모든 API 호출이

예산 안에서

안전하게 수행되고

응답이 정상적으로 저장되어

Workflow가

계속 진행될 수 있어야 한다.

---

End of File