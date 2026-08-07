# AI Animation Studio
# Memory System Specification

Version: 1.0

---

# 1. 목적

Memory System은

프로젝트에서 생성되는 모든 정보를 저장하고

다음 프로젝트에서 재활용하기 위한 시스템이다.

Memory System은

AI가 이전 프로젝트의 경험을 활용할 수 있도록 한다.

---

# 2. 목표

프로젝트를 제작할수록

더 일관성 있고

더 높은 품질의 결과를 생성하도록 한다.

---

# 3. 저장 대상

Memory System은

다음을 저장한다.

Project

Story

Scene

Character

Lore

Style

Reference

Prompt

Image

Video

Rating

Approval

Rejected Data

Logs

---

# 4. Project Memory

프로젝트별 정보를 저장한다.

항목

Project ID

생성 날짜

주제

장르

제작 시간

생성 결과

---

# 5. Story Memory

스토리 정보를 저장한다.

항목

제목

줄거리

장면

결말

장르

분위기

---

# 6. Scene Memory

각 Scene 정보를 저장한다.

항목

Scene 번호

설명

카메라

등장인물

배경

분위기

생성 이미지

---

# 7. Character Memory

대표 캐릭터와

모든 등장인물의 상태를 저장한다.

항목

현재 위치

감정

행동

관계

성장

장비

---

# 8. Style Memory

Style Profile을 저장한다.

항목

Color Palette

Lighting

Composition

Mood

Rendering Style

Style Score

---

# 9. Lore Memory

세계관 정보를 저장한다.

항목

장소

사건

조직

종족

아이템

Timeline

---

# 10. Reference Memory

사용된 Reference 정보를 저장한다.

항목

Reference ID

Category

Tags

Priority

사용 횟수

---

# 11. Prompt Memory

생성에 사용한 Prompt를 저장한다.

항목

Prompt ID

Prompt Version

사용 Engine

생성 시각

---

# 12. Image Memory

생성된 이미지를 저장한다.

항목

Image ID

Scene

Prompt ID

Character

Style

생성 결과

---

# 13. Video Memory

영상 정보를 저장한다.

항목

Video ID

Project ID

Duration

Resolution

FPS

Output Path

---

# 14. User Rating

사용자의 평가를 저장한다.

예시

좋음

보통

나쁨

별점

메모

---

# 15. Approval

사용자가 승인한 결과를 저장한다.

승인 데이터는

Style 학습에 활용한다.

---

# 16. Rejected Data

거절된 결과를 저장한다.

동일한 문제가 반복되지 않도록

참고 자료로 사용한다.

---

# 17. Search

Memory Engine은

다음을 기준으로 검색한다.

Project

Character

Style

Genre

Mood

Tags

---

# 18. Priority

최근 데이터와

사용자 승인 데이터의

우선순위를 높게 적용한다.

---

# 19. Update Rule

프로젝트 종료 후

Memory를 갱신한다.

프로젝트 진행 중에는

필요한 경우에만 저장한다.

---

# 20. Delete Rule

Memory는

자동 삭제하지 않는다.

사용자가 명시적으로 삭제한 경우에만

제거한다.

---

# 21. Storage

저장 위치

learning_data/

---

# 22. 저장 구조

projects/

stories/

characters/

styles/

lore/

references/

prompts/

images/

videos/

ratings/

logs/

---

# 23. Validation

저장 전

다음을 검사한다.

중복 데이터

손상된 데이터

필수 정보 누락

잘못된 ID

---

# 24. Workflow

Load Memory

↓

Search

↓

Project 실행

↓

Update Memory

↓

Save Memory

---

# 25. Completion Criteria

Memory System은

프로젝트의 모든 핵심 정보를

안전하게 저장하고

다음 프로젝트에서

효율적으로 재사용할 수 있어야 한다.

---

End of File