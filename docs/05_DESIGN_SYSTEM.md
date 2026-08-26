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

### 2.3 간격

4px 격자. 화면 구성은 이 값만 사용:

- 컴포넌트 내부 요소 사이: `gap-2` `gap-3` / `space-y-2` `space-y-3`
- 카드 패딩: 작은 카드 `p-3`~`p-4`, 큰 패널·폼 `p-6`
- 섹션 사이: `space-y-5` 또는 `mt-6`
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

### 3.3 카드·패널

기본 카드 (섹션 패널, 폼 컨테이너):
```
rounded-2xl border border-white/10 bg-slate-900/70 p-6
```

내부 항목 카드 (장면 하나, 목록 항목):
```
rounded-xl border border-white/10 bg-slate-950/40 p-3
```

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
| `active` | 현재 위치·선택 | violet |
| `neutral` | 대기·미시작 | 무채색 |

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

## 4. 화면 패턴

### 4.1 화면 공통 골격

```tsx
<header>
  <h1 className="text-2xl font-semibold text-slate-100">{화면 제목}</h1>
  <p className="mt-1.5 text-sm text-slate-400">{한 줄 설명(선택)}</p>
</header>
{/* mt-6 부터 본문 섹션들, 섹션 간 space-y-5 */}
```
화면 제목은 사이드바 항목명과 일치시킨다. 뒤로가기는 제목 위
`text-xs text-slate-400 hover:text-slate-300` 링크.

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
  외의 색 — sky, teal, lime 등 금지).
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
