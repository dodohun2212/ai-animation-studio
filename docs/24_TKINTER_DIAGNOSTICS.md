# Tkinter 실행 환경 진단

## 확인 결과

2026-07-27 현재 사용 중인 실행 파일은 다음과 같다.

```text
C:\Users\lg\AppData\Local\Programs\Python\Python312\python.exe
Python 3.12.10
TclVersion 8.6
TkVersion 8.6
```

설치 폴더에는 `tcl86t.dll`, `tk86t.dll`, `tcl8.6/init.tcl`,
`tk8.6`이 존재하며 DLL과 `init.tcl`이 요구하는 버전은 모두 8.6.15이다.
`TCL_LIBRARY`와 `TK_LIBRARY` 환경변수는 설정되어 있지 않았다.

제한된 명령 실행 환경에서는 빈 `tkinter.Tk()` 생성이 프로젝트 모듈을
불러오기 전에 다음 오류로 실패했다.

```text
_tkinter.TclError: Can't find a usable init.tcl
```

진단 명령에서 `TCL_LIBRARY`와 `TK_LIBRARY`를 올바른 설치 폴더로
일시 지정해도 같은 오류가 발생했다.

이후 승인된 GUI 실행 환경에서 동일한 Python 3.12와 동일 프로젝트로
`StudioApp` 및 새 프로젝트 창을 실제 생성하는 데 성공했다. 따라서
Python 설치 손상이나 프로젝트 UI 코드 문제가 아니라 제한 실행 환경의
Tcl 초기화 제약으로 판정한다.

## 일반 실행에서도 같은 오류가 날 때만 적용할 복구 방법

1. Windows의 **설치된 앱**에서 Python 3.12를 선택한다.
2. **수정(Modify)** 또는 **복구(Repair)**를 실행한다.
3. 선택 기능에서 `tcl/tk and IDLE`이 포함됐는지 확인한다.
4. 복구 후 다음 명령으로 빈 창 생성을 먼저 확인한다.

```powershell
python -m tkinter
```

5. 성공한 뒤 Studio UI smoke test를 다시 실행한다.

일반 데스크톱 실행에서 UI가 정상 열리면 Python 복구는 필요하지 않다.
프로젝트 코드에서 특정 사용자 경로를 `TCL_LIBRARY` 또는 `TK_LIBRARY`로
하드코딩하지 않는다. 다른 PC와 가상환경을 깨뜨릴 수 있기 때문이다.

## 현재 대체 검증

제한 환경에서는 다음을 자동 테스트한다.

- UI 모듈 Python 문법 검사
- 버튼이 호출하는 서비스 함수의 상태 전환
- Mapping 편집·승인·무효화 핸들러의 도메인 API
- 앱 재시작을 모사한 JSON 저장·재로딩
- 승인 전 이미지 Adapter 호출 0회

승인된 GUI 실행으로 메인 창, 좌측 메뉴, 새 프로젝트 창의 실제 위젯
생성을 확인했다. 실제 Mapping Asset 데이터가 없는 관계로 Scene Mapping
썸네일이 채워진 상태의 육안 검증은 별도 샘플 프로젝트에서 수행해야 한다.
