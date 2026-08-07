# AI Animation Studio
# Style System Specification

Version: 1.0

---

# 1. 목적

Style System은

프로젝트의 시각적 정체성을 관리한다.

프로젝트가 수백 개의 영상을 제작하더라도

동일한 브랜드처럼 보이도록 유지한다.

---

# 2. 목표

프로젝트만의

Style DNA를 구축한다.

대표 캐릭터

세계관

조명

색감

구도

카메라

배경

연출

을 일관성 있게 유지한다.

---

# 3. 관리 대상

Color Palette

Lighting

Composition

Camera

Mood

Rendering

Environment

Effects

---

# 4. Style Profile

모든 프로젝트는

하나의 Style Profile을 가진다.

Style Profile에는

Color Palette

Lighting

Composition

Camera

Mood

Background Density

Contrast

Saturation

Effect

정보가 포함된다.

---

# 5. Color Palette

프로젝트에서 사용하는

대표 색상을 관리한다.

항목

Primary Color

Secondary Color

Accent Color

Shadow Color

Highlight Color

---

# 6. Lighting

조명을 관리한다.

지원 항목

Morning

Day

Evening

Night

Indoor

Outdoor

Warm

Cold

Cinematic

---

# 7. Composition

화면 구도를 관리한다.

지원 항목

Wide Shot

Medium Shot

Close Up

Extreme Close Up

Over Shoulder

Low Angle

High Angle

Top View

POV

---

# 8. Camera

카메라 연출을 관리한다.

지원 항목

Static

Pan

Tilt

Zoom

Orbit

Tracking

Handheld

---

# 9. Mood

장면 분위기를 관리한다.

예시

Adventure

Mystery

Fantasy

Horror

Comedy

Drama

Action

Calm

Emotional

---

# 10. Rendering Style

이미지 표현 방식을 관리한다.

항목

Outline

Texture

Shadow

Highlight

Color Density

Background Detail

Character Detail

---

# 11. Style DNA

프로젝트의 핵심 스타일이다.

Style DNA는

사용자의 승인 결과를 기반으로

점진적으로 발전한다.

---

# 12. Style DNA 구성

Color

Lighting

Composition

Mood

Camera

Environment

Character Presentation

Visual Rhythm

---

# 13. Reference 반영

Reference Library의

스타일 이미지를 분석하여

Style Profile에 반영한다.

---

# 14. 사용자 승인

사용자가 승인한 이미지의

Style 정보를 저장한다.

승인 빈도가 높을수록

우선순위를 높인다.

---

# 15. 사용자 거절

거절된 이미지의

Style 정보를 저장한다.

재사용 우선순위를 낮춘다.

---

# 16. Style Score

Style Profile은

점수를 가진다.

높은 점수의 스타일을

우선 적용한다.

---

# 17. Scene 적용

모든 Scene은

동일한 Style Profile을 사용한다.

특별한 연출이 없는 한

장면마다 Style이 급격히 변하지 않는다.

---

# 18. Character 적용

대표 캐릭터는

Style의 영향을 받는다.

그러나

핵심 외형은 변하지 않는다.

---

# 19. Lore 적용

세계관에 따라

Style이 일부 변경될 수 있다.

예시

사막

→ 따뜻한 색감

눈

→ 차가운 색감

우주

→ 높은 대비

---

# 20. Prompt 적용

Prompt Engine은

Style Profile을

Prompt에 포함한다.

---

# 21. Validation

Validation Engine은

다음을 검사한다.

Color 유지

Lighting 유지

Composition 유지

Mood 유지

Character Style 유지

---

# 22. 저장 위치

learning_data/

style_profile/

---

# 23. 저장 파일

style_profile.json

color_palette.json

lighting.json

camera.json

composition.json

mood.json

---

# 24. Workflow

Load Style

↓

Load References

↓

Build Style Profile

↓

Apply To Prompt

↓

Generate Image

↓

Validation

↓

Save Style

---

# 25. 완료 기준

모든 프로젝트가

동일한 브랜드의 작품처럼

느껴질 수 있을 정도의

시각적 일관성을 유지해야 한다.

---

End of File