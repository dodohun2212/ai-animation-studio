# AI Animation Studio
# Lore System Specification

Version: 1.0

---

# 1. 목적

Lore System은

프로젝트의 세계관을 관리하는 시스템이다.

모든 프로젝트는

동일한 세계관 안에서

연결될 수 있도록 설계한다.

---

# 2. 목표

프로젝트가 계속 성장하여도

세계관의 일관성을 유지한다.

새로운 영상을 제작할 때마다

기존 설정을 활용할 수 있어야 한다.

---

# 3. 관리 대상

Lore System은

다음을 관리한다.

국가

도시

마을

건물

지역

차원

행성

조직

종족

역사

사건

아이템

전설

괴물

동물

---

# 4. Lore ID

모든 세계관 데이터는

고유 ID를 가진다.

예시

LORE-0001

LORE-0002

---

# 5. Location

장소 정보를 관리한다.

항목

이름

설명

위치

기후

분위기

위험도

대표 색감

관련 사건

---

# 6. Region

지역은

여러 장소를 포함할 수 있다.

예시

왕국

↓

수도

↓

학교

↓

교실

---

# 7. Character Connection

각 장소는

관련 캐릭터를 가진다.

예시

주인공

NPC

적

동료

주민

---

# 8. Event

세계관에서 발생한

주요 사건을 관리한다.

항목

사건 이름

발생 시점

관련 인물

관련 장소

결과

---

# 9. Timeline

모든 사건은

시간 순서를 가진다.

새로운 사건은

기존 Timeline과

충돌하지 않아야 한다.

---

# 10. Item

세계관 아이템을 관리한다.

항목

이름

설명

등급

소유자

능력

획득 위치

---

# 11. Organization

조직 정보를 관리한다.

예시

왕국

학교

기사단

연구소

비밀 조직

---

# 12. Species

등장 종족을 관리한다.

예시

인간

정령

괴물

기계

외계 생명체

---

# 13. Environment

환경 정보를 관리한다.

예시

숲

도시

사막

빙하

우주

바다

동굴

---

# 14. Weather

장면의 날씨를 관리한다.

예시

맑음

비

눈

안개

폭풍

---

# 15. Time

시간 정보를 관리한다.

예시

새벽

아침

낮

노을

밤

심야

---

# 16. Lore Rules

새로운 설정은

기존 설정과

충돌해서는 안 된다.

---

# 17. Duplicate Rule

동일한 장소를

다른 이름으로 생성하지 않는다.

동일한 사건을

중복 생성하지 않는다.

---

# 18. Reference Rule

Reference Library는

Lore보다 우선하지 않는다.

세계관이

항상 우선된다.

---

# 19. Story Rule

Story Engine은

Lore 정보를 참고하여

스토리를 작성한다.

기존 세계관을

가능한 한 유지한다.

---

# 20. Character Rule

대표 캐릭터의

행동은

Lore와 모순되지 않아야 한다.

---

# 21. Validation

Validation Engine은

다음을 검사한다.

장소 충돌

사건 충돌

세계관 오류

시간 오류

관계 오류

---

# 22. Storage

저장 위치

learning_data/

lore/

---

# 23. 저장 파일

locations.json

events.json

timeline.json

items.json

organizations.json

species.json

environment.json

---

# 24. Workflow

Load Lore

↓

Check Timeline

↓

Check Location

↓

Apply Story

↓

Validation

↓

Save Lore

---

# 25. Completion Criteria

모든 프로젝트는

동일한 세계관 안에서

자연스럽게 연결될 수 있어야 한다.

새로운 설정은

기존 세계관을 훼손하지 않고

확장되어야 한다.

---

End of File