# AI Animation Studio
# Directory Structure Specification

Version: 1.0

---

# 1. 목적

본 문서는 AI Animation Studio 프로젝트의 디렉터리 구조를 정의한다.

모든 개발자는 본 문서의 구조를 유지해야 한다.

기존 폴더의 이름은 변경하지 않는다.

새로운 기능은 기존 폴더 안에 추가한다.

---

# 2. 최상위 구조

AI-Animation-Studio/

README.md

AGENTS.md

LICENSE

CHANGELOG.md

requirements.txt

.gitignore

.env.example

docs/

prompts/

app/

assets/

character/

reference_library/

learning_data/

images/

videos/

output/

cache/

logs/

tests/

scripts/

---

# 3. docs/

프로젝트 문서를 저장한다.

설계 문서

요구사항

API 문서

로드맵

개발 가이드

---

# 4. prompts/

OpenAI 프롬프트를 저장한다.

코드 안에 Prompt를 작성하지 않는다.

구성

system/

story/

image/

character/

style/

lore/

templates/

---

# 5. app/

실제 Python 코드가 위치한다.

구성

core/

engines/

services/

models/

config/

utils/

main.py

---

# 6. assets/

프로젝트에서 사용하는 정적 리소스

fonts/

music/

sfx/

overlays/

templates/

---

# 7. character/

캐릭터 데이터를 저장한다.

main_character/

npc/

enemies/

profiles/

---

# 8. reference_library/

사용자가 등록한 참고 이미지를 저장한다.

style/

lighting/

background/

composition/

props/

metadata/

---

# 9. learning_data/

프로젝트가 학습용으로 저장하는 데이터

projects/

approved/

rejected/

ratings/

style_profile/

lore/

embeddings/

---

# 10. images/

이미지 저장

generated/

selected/

reference/

temp/

---

# 11. videos/

영상 저장

capcut/

rendered/

final/

temp/

---

# 12. output/

최종 결과

reels/

shorts/

thumbnails/

archive/

---

# 13. cache/

캐시 데이터 저장

동일 요청 재사용

API 비용 절감

---

# 14. logs/

로그 저장

workflow.log

api.log

ffmpeg.log

error.log

project.log

---

# 15. tests/

테스트 코드

unit/

integration/

system/

---

# 16. scripts/

유틸리티 스크립트

초기 설정

백업

정리

데이터 변환

---

# 17. 폴더 규칙

폴더 이름은 변경하지 않는다.

새로운 기능은 기존 폴더 안에 추가한다.

동일한 역할의 폴더를 새로 만들지 않는다.

---

# 18. 파일 규칙

파일 하나는 하나의 역할만 가진다.

파일이 커지면 분리한다.

순환 참조를 만들지 않는다.

---

# 19. Import 규칙

상위 계층은 하위 계층을 사용할 수 있다.

Engine끼리는 직접 의존하지 않는다.

Workflow Engine을 통해 통신한다.

---

# 20. 저장 규칙

프로젝트마다 고유 ID를 가진다.

예시

learning_data/projects/

project_0001/

project.json

story.json

scene.json

images/

video/

logs/

---

# 21. 변경 규칙

기존 구조를 변경하지 않는다.

새로운 기능은

기존 구조 안에서 확장한다.

---

# 22. 완료 조건

모든 코드가

본 문서의 구조를 따른다.

모든 문서는

본 구조를 기준으로 작성한다.

모든 Engine은

app/engines 아래에 구현한다.

---

End of File