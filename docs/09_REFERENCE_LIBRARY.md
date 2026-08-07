# AI Animation Studio
# Reference Library Specification

Version: 1.0

---

# 1. 목적

Reference Library는

사용자가 업로드한

참고 자료를 관리하는 시스템이다.

Reference Library는

이미지를 복제하기 위한 시스템이 아니다.

참고 요소를 분석하여

프로젝트의 Style Profile을 보조한다.

---

# 2. 목표

Reference Library는

프로젝트의 시각적 품질을 향상시키기 위한

보조 시스템이다.

---

# 3. 관리 대상

Reference Library는

다음 자료를 관리한다.

Style

Lighting

Background

Composition

Color

Camera

Props

Environment

Architecture

Texture

---

# 4. 지원 파일

PNG

JPG

JPEG

WEBP

---

# 5. Reference 등록

사용자는

원하는 참고 이미지를

등록할 수 있다.

등록 시

메타데이터를 생성한다.

---

# 6. Reference Metadata

각 Reference는

다음 정보를 가진다.

Reference ID

File Name

Created Date

Description

Category

Tags

Priority

Enabled

License Note

---

# 7. Category

기본 분류

Style

Lighting

Background

Composition

Props

Character

Environment

Camera

Color

---

# 8. Tags

Reference는

복수의 Tag를 가진다.

예시

forest

night

cinematic

warm

fog

ruins

magic

snow

---

# 9. Priority

모든 Reference는

Priority를 가진다.

Priority가 높을수록

검색 우선순위가 높다.

---

# 10. Enable

Reference는

활성

비활성

상태를 가진다.

비활성 자료는

검색 대상에서 제외한다.

---

# 11. Search

Reference Engine은

다음을 기준으로 검색한다.

Category

Tag

Priority

Project Genre

Mood

Scene

---

# 12. Similar Search

Reference Engine은

유사한 분위기의 자료를

우선 검색한다.

---

# 13. Multi Reference

하나의 Scene은

여러 Reference를 사용할 수 있다.

예시

Background

+

Lighting

+

Color

+

Composition

---

# 14. Character Reference

대표 캐릭터의

기준 이미지를 저장한다.

대표 캐릭터 생성 시

우선적으로 사용한다.

---

# 15. Style Reference

Style Profile을

보조하는 자료를 저장한다.

예시

색감

조명

렌더링 분위기

---

# 16. Background Reference

배경을 위한

참고 자료를 저장한다.

예시

숲

도시

학교

우주

동굴

사막

바다

---

# 17. Camera Reference

카메라 구도를 위한

참고 자료를 저장한다.

예시

Wide Shot

Close Up

POV

Low Angle

High Angle

Tracking

---

# 18. Prompt 적용

Prompt Engine은

Reference Metadata를

Prompt에 반영한다.

Reference 자체를

복제하지 않는다.

---

# 19. Validation

Validation Engine은

Reference 적용 여부를 확인한다.

Reference와

완전히 동일한 결과를

생성해서는 안 된다.

---

# 20. Storage

Reference는

reference_library/

폴더에 저장한다.

---

# 21. Folder Structure

style/

lighting/

background/

composition/

props/

metadata/

---

# 22. Metadata File

각 Reference는

JSON Metadata를 가진다.

예시

reference_0001.json

---

# 23. Workflow

Reference 등록

↓

Metadata 생성

↓

Tag 생성

↓

Category 저장

↓

검색 가능

↓

Prompt 적용

---

# 24. Rules

Reference는

창작을 보조한다.

Reference는

최종 결과를

결정하지 않는다.

최종 결과는

Style Profile

Character

Lore

Story

를 우선한다.

---

# 25. Completion Criteria

Reference Library는

사용자가 등록한 자료를

효율적으로 검색하고

프로젝트의 품질 향상에

기여해야 한다.

---

End of File