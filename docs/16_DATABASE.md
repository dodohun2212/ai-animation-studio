# AI Animation Studio
# Database Specification

Version: 1.0

---

# 1. 목적

본 프로젝트는

초기 버전(MVP)에서

별도의 데이터베이스 서버를 사용하지 않는다.

모든 데이터는

로컬 JSON 파일 기반으로 관리한다.

---

# 2. 목표

데이터를

안전하게 저장하고

프로젝트 종료 후에도

이전 작업을 이어서 진행할 수 있도록 한다.

---

# 3. 저장 방식

저장 방식

JSON

---

장점

가볍다.

읽기 쉽다.

수정이 쉽다.

Git으로 관리하기 쉽다.

---

# 4. 저장 위치

learning_data/

---

프로젝트 데이터는

다음 폴더에 저장한다.

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

# 5. Project Database

프로젝트 정보를 저장한다.

저장 항목

Project ID

Project Name

Topic

Genre

Status

Created Date

Updated Date

Current Workflow State

---

# 6. Story Database

스토리 정보를 저장한다.

항목

Title

Synopsis

Scene List

Ending

Mood

Genre

---

# 7. Character Database

캐릭터 정보를 저장한다.

항목

Character ID

Name

Appearance

Personality

Emotion

Equipment

Relationship

History

---

# 8. Style Database

Style 정보를 저장한다.

항목

Style Profile

Color Palette

Lighting

Composition

Camera

Mood

Rendering

---

# 9. Lore Database

세계관 정보를 저장한다.

항목

Location

Event

Timeline

Organization

Item

Species

---

# 10. Reference Database

Reference 정보를 저장한다.

항목

Reference ID

Category

Tags

Priority

Enabled

Usage Count

---

# 11. Prompt Database

Prompt를 저장한다.

항목

Prompt ID

Scene

Prompt Text

Version

Created Date

---

# 12. Image Database

생성된 이미지를 저장한다.

항목

Image ID

Scene

Prompt ID

Image Path

Generation Time

Validation Result

---

# 13. Video Database

영상 정보를 저장한다.

항목

Video ID

Scene

Video Path

Duration

Resolution

Codec

---

# 14. Rating Database

사용자 평가를 저장한다.

항목

Rating

Approval

Comment

Date

---

# 15. Log Database

실행 로그를 저장한다.

항목

Time

Level

Message

Module

Execution Time

---

# 16. JSON 규칙

모든 JSON은

UTF-8

형식을 사용한다.

들여쓰기는

4 Spaces를 사용한다.

---

# 17. 파일 이름 규칙

Project

project_0001.json

Story

story_0001.json

Character

character_main.json

Reference

reference_0001.json

Image

image_scene1.json

Video

video_scene1.json

---

# 18. 저장 시점

다음 시점에 저장한다.

프로젝트 생성

Story 완료

Image 완료

WAITING_FOR_CAPCUT

영상 병합 완료

Project 완료

Memory 업데이트

---

# 19. Resume 지원

WAITING_FOR_CAPCUT

상태를 저장한다.

프로그램 재실행 시

이 상태를 불러온다.

---

# 20. 데이터 무결성

저장 전

다음을 검사한다.

필수 항목

ID

Workflow State

Character

Story

---

# 21. 백업

프로젝트 완료 시

자동 백업을 생성한다.

저장 위치

backup/

---

파일명

project_0001_backup.json

---

# 22. 삭제 규칙

데이터는

자동 삭제하지 않는다.

사용자가 삭제를 요청한 경우에만

제거한다.

---

# 23. 향후 확장

향후

SQLite

PostgreSQL

MongoDB

등으로

교체 가능하도록

Storage Layer를 통해 접근한다.

상위 로직은

데이터 저장 방식에 의존하지 않는다.

---

# 24. Workflow

Load Database

↓

Project Update

↓

Save JSON

↓

Backup

↓

Complete

---

# 25. 완료 기준

모든 프로젝트 데이터가

정상적으로 저장되고

프로그램 종료 후에도

동일한 상태로

복원될 수 있어야 한다.

---

End of File