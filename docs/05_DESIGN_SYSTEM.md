# Design System — Prism Forge (AI Animation Studio)

이 문서는 `apps/frontend` 의 모든 UI 작업에 적용되는 규격이다.
새 화면·컴포넌트를 만들거나 기존 화면을 수정할 때, 시각적 결정(색, 여백,
반경, 그림자, 타이포, 상태 표현)은 **이 문서에서 찾아 쓰고, 즉흥적으로
만들지 않는다.** 여기에 없는 패턴이 필요하면 먼저 이 문서에 항목을 추가한
뒤 구현한다.

- 스택 전제: Tailwind CSS v4 (`@import "tailwindcss"`), Inter, 다크 전용
  (`color-scheme: dark`), React + Vite, Electron 데스크톱 셸.
- 기존 화면과 이 문서가 다르면 **이 문서가 맞다.** 다만 리팩터링을 위한
  일괄 수정은 하지 말고, 해당 화면을 다른 이유로 만질 때 규격으로 옮긴다
  (surgical changes 원칙 유지).

---

## 1. 디자인 원칙

1. **작업 도구다.** 이 앱은 감상용 랜딩페이지가 아니라 장면 파이프라인을
   반복 실행하는 제작 도구다. 화려함보다 "지금 어느 단계이고, 다음에 뭘
   해야 하는가"가 항상 먼저 읽혀야 한다.
2. **빛은 아껴 쓴다.** violet 글로우는 브랜드 시그니처지만, 화면당 시선을
   끄는 발광 요소는 1~2곳(주 CTA, 현재 단계 표시)으로 제한한다. 모든 것이
   빛나면 아무것도 눈에 띄지 않는다.
3. **상태색은 문법이다.** emerald=완료/성공, amber=진행 중/주의,
   rose=실패/오류, violet=현재 위치/선택. 이 매핑을 다른 의미로 재사용하지
   않는다.
4. **돈이 걸린 화면은 조용하게.** 비용 확인·전송 승인 화면에서는 장식을
   줄이고 숫자와 승인 버튼이 지배하게 한다. 유료 요청 버튼 주변에 시선을
   분산시키는 요소를 두지 않는다.

---

## 2. Foundation

### 2.1 색

배경 레이어 (어두운 순):

| 역할 | 클래스 |
|---|---|
| 앱 배경 | `bg-slate-950` (+ §5.1의 배경 그라데이션, App 셸에서만) |
| 화면 안 우묵한 면 (썸네일 트레이, 코드/로그 영역) | `bg-slate-950/40` |
| 카드·패널 표면 | `bg-slate-900/70` |
| 사이드바 | `bg-slate-900` |
| 입력 필드 | `bg-slate-900/70` |
| 채워진 트랙(프로그레스 바탕, 스켈레톤) | `bg-slate-800` |

테두리: 기본은 항상 `border-white/10`. 상태 강조 시에만
`border-{색}-400/40` (아래 상태색 표 참조).

텍스트 위계 (4단계만 사용):

| 역할 | 클래스 |
|---|---|
| 제목·강조 | `text-slate-100` (또는 `text-white` — 활성 항목만) |
| 본문 | `text-slate-300` |
| 보조 설명·레이블 | `text-slate-400` |
| 비활성·자리표시 | `text-slate-500` |

`text-slate-200`은 쓰지 않는다 (위계가 흐려진다).

브랜드 액센트:

| 역할 | 클래스 |
|---|---|
| 주 CTA 그라데이션 | `from-violet-500 to-fuchsia-500` |
| 히어로/제목 그라데이션 텍스트 | `from-violet-300 to-pink-300` (bg-clip-text) |
| 활성 네비·선택 배경 | `bg-violet-500/15` + `text-white` |
| 네비 기본 텍스트 | `text-violet-300` |
| 장식 점(dot)·포커스 링 | `bg-violet-400`, `ring-violet-500/30` |

상태색 (의미 고정):

| 상태 | 텍스트 | 테두리 | 배경(칩/배너) |
|---|---|---|---|
| 성공·완료 | `text-emerald-300` | `border-emerald-400/30` | `bg-emerald-500/10` |
| 진행 중·주의 | `text-amber-300` | `border-amber-400/40` | `bg-amber-500/10` |
| 실패·오류 | `text-rose-400` | `border-rose-400/30` | `bg-rose-500/15` |
| 현재 위치·선택 | `text-violet-300` | `border-violet-400/50` | `bg-violet-500/15` |
| **정보·알아 두실 것** | `text-sky-300` | `border-sky-400/30` | `bg-sky-500/10` |

**정보 칸은 2026-09-09에 추가됐다. 색을 고른 것이 아니라, 이미 있던 것을
인정한 것이다.** 이 표에 정보 칸이 없던 동안 네 화면(설정집과 다른 점,
개요·이어쓰기 메모 없음, 단계 안내, Instagram 안내)이 **각자 따로 `sky` 를
찾아냈다** — 22곳. 같은 뜻을 여러 화면이 독립적으로 같은 색으로 적으면,
그건 규칙 위반이라기보다 **표에 칸이 하나 비어 있다는 신호**다.

- 🔴 **기계적으로 옮기면 뜻이 바뀐다.** amber 로 보내면 「주의하세요」가
  되는데 설정집과 다른 점은 주의가 아니라 정보고, violet 로 보내면 「현재
  위치」와 부딪힌다. slate 로 낮추면 알림 넷이 배경으로 가라앉는다.
  **비어 있던 것은 색이 아니라 뜻이었다.**
- 🔴 **그래서 `sky` 는 이 칸에서만 쓴다.** 장식으로는 여전히 금지다(§7).
  §7 이 `sky`·`teal`·`lime` 을 막은 이유는 화면이 기분에 따라 색을
  만들어 내는 것을 막기 위해서고, **뜻이 고정된 칸 하나는 그 이유에
  해당하지 않는다.**
- 🟠 **표기는 위 세 값으로 통일한다.** 지금 코드에는 `text-sky-200`,
  `text-sky-100`, `bg-sky-500/[0.06]`, `border-sky-400/20`, `/25`, `/45`
  처럼 열 가지 표기가 섞여 있다 — 칸이 문서에 없는 동안 각자 정한 값들이다.
  다른 네 상태와 같은 문법으로 맞춘다.

- 원색 배경(`bg-amber-500`, `bg-violet-500` 등)은 작은 인디케이터(점, 채움
  바)에만 허용. 넓은 면에는 항상 `/10~/15` 투명 배경을 쓴다.

### 2.2 타이포그래피

| 역할 | 클래스 |
|---|---|
| 화면 제목 (화면당 1개) | `text-2xl font-semibold text-slate-100` |
| 섹션 제목 | `text-lg font-semibold text-slate-100` |
| 카드 제목·항목명 | `text-sm font-semibold text-slate-100` |
| 본문 | `text-sm text-slate-300` |
| 보조·메타 | `text-xs text-slate-400` |
| 브랜드 워드마크 | `text-xs font-semibold uppercase tracking-[0.24em] text-violet-400` |

- `text-base`는 쓰지 않는다. 본문은 `text-sm`으로 통일 (데스크톱 도구 밀도).
- `font-bold`는 쓰지 않는다. 강조는 `font-semibold`까지.
- 숫자 데이터(비용, 진행 수치)에는 `tabular-nums`를 붙인다.

**제목 앞 앵커** (2026-09-09 추가). 제목은 시선이 걸리는 표식을 하나 갖는다.
어느 표식이냐는 위계로 정해져 있고, 화면이 고르는 것이 아니다:

| 역할 | 앵커 | 클래스 |
|---|---|---|
| 화면 제목 (h1) | 발광하는 점 **하나** | `h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300` + glow-dot |
| 섹션 제목 (h2) | 그라디언트 막대 | `h-4 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400` |
| 카드 제목 (h3) | 같은 막대, 짧게 | `h-3 w-1 flex-shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-400` |

- 제목 줄은 `flex items-center gap-2.5` 로 감싼다. 앵커는 전부 `aria-hidden="true"` —
  장식이지 이름이 아니다(§6).
- 🔴 **막대에는 그림자를 붙이지 않는다.** 발광하는 점은 **화면당 하나(h1)** 다.
  h3 가 일곱 개인 화면에서 점을 일곱 개 켜면 §1 원칙 2 그대로 아무것도 눈에
  안 띈다. 막대는 앵커의 역할만 하고 §2.5 의 글로우 3개에 넷째를 더하지 않는다.
- 상태색을 갖는 제목(진행 중·오류 등)은 그 색이 뜻을 나르므로 위 표에서 제외한다.

### 2.3 간격

4px 격자.

세 단계다. 무엇과 무엇을 벌리는지가 값을 정한다 — 취향으로 고르지 않는다.

| 무엇 사이 | 값 | 예 |
|---|---|---|
| 컴포넌트 내부의 작은 요소 | `gap-2` `gap-3` / `space-y-2` `space-y-3` | 라벨과 입력, 버튼 행, 목록 항목 |
| 카드·패널 **안**의 블록 | `space-y-4` | `rounded-2xl … p-5` 또는 `p-6` 안에서 문단·필드 묶음 사이 |
| 화면 섹션 사이 | `space-y-5` 또는 `mt-6` | `mt-8 max-w-* space-y-5` 화면 본문, 카드끼리 |

- 카드 패딩: 작은 카드 `p-3`~`p-4`, 큰 패널·폼 `p-6`
- 🔴 `space-y-4` 를 화면 본문 래퍼에 쓰지 않는다. 화면 본문은 `space-y-5` 다 —
  2026-09-06 에 세 화면(`App` 명언 건너뜀 안내 · `ProviderSettingsScreen` ·
  `LongProjectSettingsScreen`)이 `space-y-4` 로 어긋나 있었고, 나머지 스무 화면은
  전부 `space-y-5` 였다. 카드 안이 `space-y-4` 인 것은 어긋난 게 아니라 위 표의
  둘째 줄이다 — 열세 군데가 같은 규칙을 쓰고 있었는데 이 문서에만 없었다.
- 화면 제목 아래: `mt-6`, 큰 블록 전환: `mt-8`
- 본문 컨테이너: `max-w-3xl` (폼은 `max-w-xl`), 메인 패딩 `px-12 py-12`

### 2.4 모서리 반경 (3단계로 고정)

| 용도 | 클래스 |
|---|---|
| 카드·패널·폼·다이얼로그 | `rounded-2xl` |
| 카드 내부 항목·입력 필드·썸네일·중첩 박스 | `rounded-xl` |
| 버튼(필/고스트)·칩·배지·점·바 | `rounded-full` |

`rounded-lg`는 신규 코드에서 쓰지 않는다 (기존 코드 수정 시 `rounded-xl`로).
예외: 사이드바 네비 항목은 `rounded-lg` 유지 (좁은 영역 밀도).

### 2.5 그림자와 글로우

임의값 `shadow-[...]`를 매번 새로 만들지 않는다. 아래 3개만 사용:

| 이름 | 값 | 용도 |
|---|---|---|
| glow-cta | `shadow-[0_0_16px_rgba(139,92,246,0.35)]` | 주 CTA 버튼 |
| glow-dot | `shadow-[0_0_6px_rgba(216,180,254,0.7)]` | 장식 점, 스피너 링 |
| glow-bar | `shadow-[0_0_8px_rgba(139,92,246,0.6)]` | 진행 바 채움 |

제목 앞 그라디언트 막대(§2.2)는 **글로우가 아니다** — 그림자가 없다. 넷째
글로우를 추가한 것으로 읽지 않는다.

이 외의 글로우가 필요해 보이면 원칙 2를 다시 읽는다. 일반 elevation
그림자(shadow-md 등)는 다크 배경에서 효과가 없으므로 쓰지 않는다 —
층위는 배경색 단계와 테두리로 표현한다.

### 2.6 모션

- 트랜지션은 `transition-colors duration-150` 을 기본으로, hover/active
  색 변화에만 건다. 레이아웃이 움직이는 애니메이션은 금지.
- 로딩 회전은 `animate-spin`(Spinner 컴포넌트)만 사용.
- 새로 뜨는 패널·다이얼로그는 애니메이션 없이 즉시 표시 (도구 반응성 우선).

---

## 3. 컴포넌트 레시피

**이미 있는 공용 컴포넌트(`Spinner`, `WorkflowProgressBar`)는 반드시
재사용한다.** 아래 레시피를 세 곳 이상에서 반복하게 되면 그때
`components/ui/` 로 추출한다 (미리 추상화하지 않는다).

### 3.1 버튼

주 CTA (화면당 1개, 파이프라인을 전진시키는 행동):
```
rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5
text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]
hover:from-violet-400 hover:to-fuchsia-400 disabled:opacity-50
disabled:pointer-events-none
```

보조 버튼 (취소, 뒤로, 부가 행동):
```
rounded-full border border-white/10 px-5 py-2.5 text-sm text-slate-300
hover:bg-white/5 disabled:opacity-50
```

위험 버튼 (삭제, 중단 — 확인 다이얼로그와 함께):
```
rounded-full border border-rose-400/30 bg-rose-500/15 px-5 py-2.5
text-sm font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50
```

작은 인라인 버튼 (카드 안의 재생성·수정 등):
```
rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300
hover:bg-white/5
```

규칙:
- 그라데이션 CTA가 한 화면에 2개 이상 보이면 잘못된 것이다. 하나만 남기고
  나머지는 보조 버튼으로 내린다.
- **유료 요청을 전송하는 버튼은 반드시 주 CTA 스타일**이고, 라벨에 행동과
  대상을 명시한다 ("영상 N개 생성 전송" — "확인" 같은 모호한 라벨 금지).
- 로딩 중 버튼은 라벨을 진행형으로 바꾸고 (`생성 중...`) disabled 처리.

### 3.2 입력 필드

```
mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5
py-2.5 text-sm text-slate-100 placeholder:text-slate-500
focus:border-violet-400/50 focus:outline-none focus:ring-2
focus:ring-violet-500/30 disabled:opacity-50
```

- 레이블: `block text-sm text-slate-300` + `htmlFor`.
- 필드 오류: 필드 바로 아래 `mt-1.5 text-sm text-rose-400` + `role="alert"`.
- textarea도 동일 규격 (+`resize-y`).
- `select`도 같은 입력 표면을 사용한다. 네이티브로 열리는 선택 목록은 전역에서
  다크 색 체계(`color-scheme: dark`)를 강제하고, 항목은 `bg-slate-900`과
  `text-slate-100` 대비를 유지한다. OS 기본의 흰 목록을 그대로 두어 다크 화면의
  선택 항목이 읽히지 않게 만들지 않는다.

### 3.3 카드·패널

🔴 **클래스 문자열을 손으로 적지 않는다. `apps/frontend/src/components/ui/surfaces.ts`
에서 가져온다** (§3.8). 아래는 그 파일이 무엇을 담고 있는지에 대한 설명이지,
베껴 쓰라고 있는 것이 아니다 — 손으로 베낀 사본 19개가 서로 어긋난 것이
이 파일이 생긴 이유다.

기본 카드 (섹션 패널, 폼 컨테이너) — `cardSection`:
```
space-y-3 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5
```
- `cardSectionWide` = 같은 표면에 `space-y-4` (행이 글이 아니라 컨트롤일 때)
- `cardSectionRoomy` = 같은 표면에 `space-y-4 p-6` (카드 한 장이 화면 전체의 주제일 때)

🟠 **평면 `bg-slate-900/70` 에서 세로 그라디언트로 바뀌었다** (2026-09-09).
카드가 여러 장 쌓일 때 한 덩어리로 읽히던 것을 갈라 놓기 위해서다. **색은 안
늘었다** — 위아래 다 `slate-900` 이고 투명도만 다르다(§7 위반 아님).

내부 항목 카드 (장면 하나, 목록 항목):
```
rounded-xl border border-white/10 bg-slate-950/40 p-3
```
안쪽 카드는 평면 그대로다. 그라디언트는 **바깥 카드끼리 갈라 보이게** 하려는
것이고, 안쪽까지 주면 그 대비가 사라진다.

상태 강조 카드: 기본 카드에서 테두리만 상태색으로 교체
(예: 진행 중 장면 `border-amber-400/40`). 배경은 바꾸지 않는다.

### 3.4 상태 칩 (배지)

**구현체: `components/ui/StatusChip.tsx` — 새로 만들지 말고 이걸 쓴다.**
(장면 진행 그리드·이미지 검토·영상 검토 3곳 이상에서 반복되어 §3 규칙대로 추출했다.)

```tsx
<StatusChip tone="success">확정됨</StatusChip>
```

`tone`은 §2.1 상태색 문법과 1:1로 대응하며 다른 의미로 재사용하지 않는다:

| tone | 의미 | 색 |
|---|---|---|
| `success` | 완료·확정 | emerald |
| `progress` | 진행 중·주의 | amber |
| `danger` | 실패·오류 | rose |
| `neutral` | 대기·미시작, 또는 알릴 것이 없음 | 무채색 |
| `info` | 정보·알아 두실 것 | sky |

내부 클래스(직접 쓸 일 없음):
```
inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5
text-xs font-semibold
```
+ §2.1 상태색 표의 텍스트/테두리/배경 3종 세트.
칩 안 점: `h-1.5 w-1.5 rounded-full bg-current`.
라벨 텍스트는 항상 렌더한다 — 상태를 색으로만 전달하지 않는다(§6).

워크플로우 상태 ↔ 칩 매핑: COMPLETED→성공 / GENERATING_*, RENDERING→진행 중
/ FAILED, CANCELLED→실패 / INTERRUPTED→주의(amber) / 대기·검토 단계→중립
(`border-white/10 text-slate-300`).

**`info` 는 2026-09-11 에 추가됐다. §2.1 에 「정보·알아 두실 것」 칸이 생긴 것은
2026-09-09 인데 이 표에는 이틀 동안 그 칸이 없었고, 그동안 그 뜻이 필요했던 첫 화면
(생성 출처 배지)이 `StatusChip` 을 통째로 베껴 자기 알약을 그렸다.** 베낀 쪽은
`paid_provider` 에 완료색(emerald)을 줬고, 그 배지는 이미지 검토 화면에서 장면의
`StatusChip` 과 **같은 줄에** 놓인다 — 확정된 장면 하나에 초록 알약이 둘, 뜻은 서로
달랐다. 부품에 칸이 없으면 다음 사람은 규칙을 어기는 게 아니라 **부품을 복제한다.**

**`neutral` 은 같은 날 뜻을 넓혔다.** 출처 배지의 `paid_provider` 가 갈 곳이 필요했는데,
「실제 생성」은 완료도 주의도 정보도 아니고 그냥 **알릴 것이 없는 상태**다. 색은 그대로
무채색이다.

**`active` 는 2026-09-11 에 이 표에서 뺐다 — 구현하지 않기로 정한 것이다**
(근거: `docs/06_DECISIONS.md` D-050). §2.1 의 violet 「현재 위치·선택」 칸은
**그대로 있다.** 빠진 것은 색이 아니라 **칩이 그것을 그린다는 주장**이다.
그 뜻은 이 앱에서 언제나 **누를 수 있는 것**이 갖는다 — 사이드바 항목(`App.tsx`),
`StepRibbon` 의 현재 단계, 고르는 칸들(`SceneEditScreen`·`SceneSubtitleFieldset`·
`WorkflowGuideScreen`) — 여섯 곳 전부 §3.2 「활성 네비·선택 배경」 쪽이고 칩이 아니다.
`StatusChip` 은 **항목이 어떤 상태인지**를 읽는 것이라 눌리지 않는다.

### 3.5 오류·안내 배너

인라인 문장 오류(폼)는 §3.2 방식. 화면 수준 오류는 배너로:
```
rounded-xl border border-rose-400/30 bg-rose-500/15 p-4 text-sm
text-rose-300  (+ role="alert", data-error-code 유지)
```
안내·주의 배너는 amber 세트로 동일 구조. 성공 확인은 emerald 세트.

### 3.6 로딩·빈 상태

- 인라인 로딩: 기존 `<Spinner label="..."/>` 사용. 새 스피너를 만들지 않는다.
- 목록 빈 상태: 내부 항목 카드 규격 + 중앙 정렬, 두 줄 구성 —
  `text-sm text-slate-300` 안내 + 필요 시 작은 인라인 버튼. 일러스트 금지.
- 스켈레톤: `animate-pulse rounded-xl bg-slate-800` 블록. 텍스트 자리에는
  높이 `h-4`, 썸네일 자리에는 실제 비율.

### 3.7 다이얼로그 (확인·아카이브 등)

- 오버레이: `fixed inset-0 bg-slate-950/70`
- 패널: `w-full max-w-md rounded-2xl border border-white/10 bg-slate-900
  p-6 space-y-4` (불투명 배경 주의 — /70 아님)
- 제목 `text-lg font-semibold text-slate-100`, 본문 `text-sm text-slate-300`,
  버튼 행은 `flex justify-end gap-3 pt-2`, 파괴적 행동이면 위험 버튼 사용.
- `role="dialog"` `aria-modal="true"` `aria-labelledby` 필수. 열릴 때 첫
  버튼으로 포커스 이동, Esc로 닫기.

---

### 3.8 공유 부품 (`apps/frontend/src/components/ui/`)

레시피를 **문서에서 읽어 베끼는 것**과 **부품에서 가져다 쓰는 것**은 다르다.
베낀 사본은 갈라진다 — 실제로 갈라졌다(§3.3, §4.1). 아래가 있는 것은 이제
클래스 문자열을 새로 적을 이유가 없다는 뜻이다.

| 부품 | 무엇인가 |
|---|---|
| `ScreenHeader.tsx` | 화면 상단 띠 — h1, 뒤로가기, 설명, 화면 단위 액션. §4.1 의 골격을 이것이 그린다 |
| `Panel.tsx` | 카드 한 장. `tone` 으로 §3.4 의 **뜻**을 고른다(색을 고르는 것이 아니다) |
| `StepRibbon.tsx` | 파이프라인 띠 — "6단계 중 4단계"를 답한다 |
| `surfaces.ts` | §3.1 버튼 3종, §3.3 카드 표면 3종, 그리고 `scrollList`(아래) 의 클래스 문자열 |

- 🔴 **`ScreenHeader` 의 화살표는 부품이 그린다.** 호출부는 **말만** 넘긴다
  (`backLabel="프로젝트 목록으로"`). 화살표를 라벨 문자열에 넣으면 접근성
  이름 안으로 들어가 스크린 리더가 "왼쪽 화살표 …"로 읽고(§6 위반), 동시에
  **호출부가 잊을 수 있는 장식**이 된다 — 21곳 중 10곳이 실제로 잊었다.
  장식은 부품이 갖는다.
- 🔴 **`Panel` 의 `tone` 은 §3.4 의 의미 목록이고 팔레트가 아니다.** 화면이
  변화를 주고 싶어서 고르는 값이 아니다. 그리고 tone 이 쓰는 색은 §7 의
  허용 팔레트 안에 있어야 한다 — 새 tone 을 추가할 때 여기가 먼저다.
- 🔴 **길이를 사용자가 정하지 않는 목록에는 `surfaces.ts` 의 `scrollList` 를 쓴다**
  (`max-h-64 space-y-1 overflow-y-auto pr-1`). 보관함 전체를 훑는 검색 결과나
  「지금까지 만든 프로젝트 전부」 같은 목록이다. 2026-09-11 에 캡틴D가 분위기 이미지를
  고르다 막혔다 — 검색이 **84개**를 돌려주고 한 줄씩 세로로 쌓아서 목록 하나가
  **4,588px**이 됐고, 검색창과 그 아래 모든 항목이 화면 밖으로 밀려났다. 내용이 틀린 게
  아니라 **천장이 없었다.**
  - 🟠 **사용자가 직접 고른 목록은 덮지 않는다.** 선택된 분위기·장면 참고 이미지처럼
    길이가 본인 행동의 결과인 목록은 그대로 둔다. 자기가 고른 것을 접어 숨기는 것은
    더 나쁜 문제다.
  - `AssetLibraryScreen` 의 「에셋 목록」은 같은 모양을 손으로 갖고 있고 **일부러 더
    높다** — 그 목록은 폼 안의 한 칸이 아니라 화면 전체의 주제다. 그래서 부품으로
    바꾸지 않았다.
- 새 부품을 `ui/` 에 추가하면 **이 표에 줄을 더하는 변경을 같은 작업에
  포함**한다(§8-2 와 같은 규칙).

---

## 4. 화면 패턴

### 4.1 화면 공통 골격

```tsx
<ScreenHeader
  title={화면 제목}
  description={한 줄 설명(선택)}
  onBack={…}                       {/* 뒤로갈 곳이 있을 때만 */}
  backLabel="프로젝트 목록으로"      {/* 말만. 화살표는 부품이 그린다 */}
/>
{/* 그 아래 본문 섹션들, 섹션 간 space-y-5 */}
```
🟠 **이 마크업을 손으로 적지 않는다** — `ui/ScreenHeader.tsx` 를 쓴다(§3.8).
같은 다섯 줄을 16개 화면이 붙여넣기로 갖고 있었고, 그 중 다섯은 이미
`text-slate-200`(§2.1 에 없는 색)으로 갈라져 있었다.

화면 제목은 사이드바 항목명과 일치시킨다. 화면당 `<h1>` 은 하나이고,
`ScreenHeader` 를 쓰면 그것이 자동으로 지켜진다.

### 4.2 장면 그리드

장면 목록은 항상 `grid gap-3 sm:grid-cols-2 xl:grid-cols-3`을 사용한다 —
장면 수는 프로젝트별로 2~12개까지 달라지므로 마지막 행이 꽉 차지 않아도
된다. 장면 카드 구성(위→아래):

1. 헤더 행: `Scene N` (`text-sm font-semibold text-slate-100`) + 상태 칩
2. 썸네일: `aspect-[9/16] w-full rounded-xl border border-white/10
   bg-slate-800 object-cover` — 9:16 산출물이므로 세로 비율 유지
3. 메타 행: 비용·시각 등 `text-xs text-slate-400 tabular-nums`
4. 행동 행: 작은 인라인 버튼들 (`재생성`, `프롬프트 보기` 등)

현재 생성 중인 장면 카드만 `border-amber-400/40`으로 강조.

### 4.3 검토(Review) 화면

이미지·영상 검토 화면의 목적은 **비교와 확정**이다:
- 원본 이미지와 결과물을 한 카드 안에서 위아래 또는 좌우로 나란히.
- 확정 여부는 카드 테두리로: 확정 `border-emerald-400/30`, 미확정 기본.
- 전체 확정 현황을 상단에 요약 (`N장면 중 M장면 확정` —
  `text-sm text-slate-300 tabular-nums`).
- 병합 CTA는 전체 장면 확정 전까지 disabled + 이유를 보조 텍스트로 표시.

### 4.4 비용·승인 화면 (돈이 걸린 화면)

- 비용 요약은 화면에서 가장 큰 카드로, 기본 카드 규격 + 내부에 정의 목록:
  좌 레이블 `text-sm text-slate-400`, 우 값 `text-sm font-semibold
  text-slate-100 tabular-nums`. 총액 행만 `text-lg`.
- 예상 비용과 남은 예산을 항상 같은 카드에 함께 표시.
- 승인 CTA는 주 CTA 규격, 명시적 라벨. 근처에 장식 요소·글로우 추가 금지.
- 취소·수정은 보조 버튼으로 CTA 왼쪽에.

### 4.5 진행(워크플로우) 화면

- 전체 진행은 `WorkflowProgressBar` 재사용.
- 장면별 순차 진행은 장면 그리드 + 상태 칩으로 표현.
- 중단·재개 버튼은 보조 버튼 규격 (위험 버튼 아님 — 중단은 파괴적이지 않다).
- 실패 장면 카드에는 오류 배너 대신 카드 내 `text-xs text-rose-400` 한 줄
  + `재시도` 인라인 버튼 (재시도는 비용 재승인 흐름으로 연결).

---

## 5. 앱 셸

### 5.1 배경

앱 루트의 radial violet 그라데이션 + 34px 격자선(App.tsx의 인라인
backgroundImage)은 셸 전용이다. 개별 화면·카드에 배경 이미지를 추가하지
않는다. 히어로 이미지(hero-ring, hero-landscape)는 프로젝트 목록 첫
화면에서만 사용한다.

### 5.2 사이드바

현행 구조 유지: 워드마크 → 주 네비(NavBar) → 컨텍스트 네비(장편 워크스페이스
/ 단기 파이프라인). 폭 `w-64` 고정. 활성 항목 `bg-violet-500/15 text-white`,
비활성 `text-violet-300`. **`underline` 은 네비에서 제거한다** (링크가 아니라
현재 위치 표시이므로 배경색으로만 구분).

---

## 6. 접근성 (기존 수준 유지 + 통일)

- 모든 아이콘 버튼에 텍스트 라벨 또는 `aria-label`.
- 상태를 색으로만 전달하지 않는다 — 칩에는 항상 텍스트, 진행 점에는
  `aria-current="step"`.
- `role="alert"`(오류), `role="status"`(로딩), `role="progressbar"`(+value
  속성) 유지.
- 포커스 스타일 제거 금지. 입력은 §3.2의 ring, 버튼은
  `focus-visible:ring-2 focus-visible:ring-violet-500/30
  focus-visible:outline-none`.
- 본문 대비: slate-950~900 배경 위 `text-slate-400` 이하 단계는 보조
  텍스트에만. 본문 이상은 slate-300 이상.

---

## 7. 하지 말 것

- 새로운 색상 팔레트 추가 (slate/violet/fuchsia/pink/emerald/amber/rose
  외의 색 — teal, lime 등 금지).
- `sky` 를 §2.1 「정보·알아 두실 것」 **외의 용도로** 쓰는 것. 그 칸 하나가
  `sky` 의 전부이고, 장식·강조·구분에는 여전히 못 쓴다.
- 화면마다 다른 반경·그림자·간격 즉흥 조합 (§2.4, §2.5의 고정값만).
- 한 화면에 그라데이션 CTA 2개 이상.
- 라이트 모드 대응 코드 (다크 전용 앱이다).
- 외부 UI 라이브러리 도입 (shadcn, MUI 등 — 사용자 승인 없이 금지).
- 이모지를 UI 텍스트에 사용.
- 결제·승인 화면에 장식적 발광 요소 추가.

---

## 8. 작업 절차

새 UI 작업 시:

1. 이 문서에서 해당 패턴(§3, §4)을 찾아 클래스 레시피를 그대로 쓴다.
2. 없는 패턴이면: 기존 원칙(§1)과 Foundation(§2)으로 조합해 만들고, **이
   문서에 레시피를 추가하는 변경을 같은 작업에 포함**시킨다.
3. 완료 보고 전 체크: 반경 3단계 준수 / 임의 shadow 미사용 / 상태색 문법
   준수 / 화면당 CTA 1개 / 텍스트 위계 4단계 / 포커스 스타일 존재.

기존 화면을 다른 이유로 수정할 때: 손대는 범위 안에서만 이 규격으로
정리한다. 규격 통일만을 위한 대규모 일괄 변경은 별도 지시가 있을 때만.
