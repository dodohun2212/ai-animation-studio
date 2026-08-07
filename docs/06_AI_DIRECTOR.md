# AI Animation Studio
# AI Director Specification

Version: 1.1.0

## 1. 목적

AI Director는 프로젝트의 창작 방향을 결정한다.

직접 파일을 저장하거나 API, CapCut, FFmpeg를 실행하지 않는다.

## 2. 입력

- Project Context
- 사용자 주제
- 대표 캐릭터
- Lore
- Style DNA
- 참고 이미지 메타데이터
- 영상 목표 길이

## 3. 출력

- Production Plan
- Story Direction
- Visual Direction
- Scene Direction
- CapCut Motion Direction
- Validation Criteria

## 4. Production Plan

- 장르
- 분위기
- 목표 감정
- 이야기 속도
- 장면 수 6개
- 장면별 권장 길이
- 색감과 조명
- 카메라 구성
- 반전 또는 결말 방향

## 5. CapCut Motion Direction

AI Director는 각 장면에 대해 사용자가 CapCut에 입력할 움직임 지침을 생성한다.

각 지침에는 다음을 포함한다.

- 대표 캐릭터의 행동
- 표정 변화
- 시선 방향
- 팔·몸·머리 움직임
- 카메라 이동
- 줌 또는 패닝
- 배경 움직임
- 장면 시작 상태
- 장면 종료 상태
- 권장 길이
- 피해야 할 얼굴·손·의상 왜곡
- 다음 장면으로 연결되는 마지막 자세

## 6. CapCut 관련 제한

AI Director는 다음을 하지 않는다.

- CapCut 실행
- CapCut API 호출
- CapCut 프로젝트 생성
- CapCut 렌더링
- CapCut 화면 자동화

AI Director의 책임은 텍스트 형태의 움직임 지침 생성까지이다.

## 7. Story Direction

Story Engine에 다음을 전달한다.

- 장르
- 분위기
- 시작 3초 Hook
- 갈등
- 절정
- 결말 또는 여운
- 대표 캐릭터의 역할

## 8. Character Direction

- 모든 장면에 대표 캐릭터 등장
- 핵심 외형 유지
- 감정과 행동의 자연스러운 연속
- 대표 소품 유지

## 9. Style Direction

- Style DNA 유지
- 참고 이미지의 색감·조명·구도 요소 활용
- 특정 작품·작가 스타일 복제 금지
- 장면 간 급격한 스타일 변화 금지

## 10. Validation Direction

- 캐릭터 존재
- 외형 일관성
- 장면 설명 일치
- 스타일 일관성
- Lore 충돌 없음
- CapCut 애니메이션에 적합한 단순하고 명확한 구도

## 11. 완료 조건

AI Director는 스토리, 이미지와 수동 CapCut 작업이 동일한 제작 방향을 따르도록 충분한 지침을 제공해야 한다.
