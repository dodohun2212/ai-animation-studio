import type { ChangeEvent } from "react";

import { newsReelTextBox, type NewsReelTextField } from "@ai-animation-studio/shared";

/**
 * 계약이 정한 칸 하나를, **남은 글자 수를 보여 주면서** 받습니다.
 *
 * 🔴 **이 파일에는 숫자가 없습니다.** 15·20 을 여기 적으면 계약과 화면 두 군데가 되고, 캡틴D가 「제목을 더 크게」
 * 하셔서 15가 13이 되는 날 **둘 중 하나만** 바뀝니다. `newsReelTextBox(field, value)` 가 `limit` 을 들고 옵니다
 * (docs/06_DECISIONS.md D-053).
 *
 * 🔴 **자르지 않습니다.** `maxLength` 를 안 붙였습니다 — 길이로 자르면 사람은 **무엇을 잃었는지 모른 채**
 * 다음 칸으로 갑니다(요약 칸이 같은 이유로 안 자릅니다, CLI 943 §1). 넘으면 **빨갛게 세고**, 카드를 만드는
 * 버튼은 `refusal` 로 잠급니다.
 */
interface CountedFieldProps {
  /** 라벨과 칸을 잇는 id — 한 화면에 넷이 있으므로 부르는 쪽이 정합니다. */
  id: string;
  /** 계약이 부르는 이름. 이것이 한도와 필수 여부를 데려옵니다. */
  field: NewsReelTextField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 여러 줄로 받을 칸(자막)은 `rows` 를 주면 `textarea` 가 됩니다. 기본은 한 줄 `input`. */
  rows?: number;
  placeholder?: string;
  /** 칸 아래 한 줄 설명 — 없으면 안 그립니다. */
  hint?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * 화면의 빈 칸(`""`)을 계약의 **없음**(`null`)으로 옮깁니다.
 *
 * 🔴 계약은 **빈 문자열을 값으로 치지 않습니다**(docs/06_DECISIONS.md D-054). `""` 를 그대로 보내면 `refusal: "blank"` 가
 * 돌아오는데, 그건 **일부러** 그렇게 둔 것이고 바꿔야 할 곳은 여기입니다 — 파일에 구워진 뒤보다 **칸에서**
 * 바꾸는 편이 낫습니다.
 *
 * 🟠 **`trim` 한 결과로 판단하되, 값은 원문 그대로** 돌려줍니다. 공백만 친 칸은 없는 것이고, 앞뒤 공백이
 * 붙은 글은 그 사람이 친 글입니다.
 */
export function newsReelFieldValue(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function CountedField({
  id,
  field,
  label,
  value,
  onChange,
  rows,
  placeholder,
  hint,
  disabled,
  "data-testid": testId,
}: CountedFieldProps) {
  const box = newsReelTextBox(field, newsReelFieldValue(value));
  /* 🔴 **넘은 것만 빨갛게 합니다.** 아직 안 친 칸(`missing`)은 잘못이 아니라 **아직**입니다 — 화면을 열자마자
     넷이 빨간 건 틀렸다는 말이 아니라 **시끄러운** 것입니다. 못 쓴 칸은 카드 만들 때 버튼이 막습니다. */
  const over = box.refusal === "too_long";

  const field_ =
    "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";
  const handle = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label className="block text-sm text-slate-300" htmlFor={id}>
          {label}
        </label>
        {/* 🟠 숫자를 **라벨 옆**에 둡니다. 칸 아래에 두면 다 치고 나서야 보입니다. */}
        <span
          className={`text-xs tabular-nums ${over ? "text-rose-300" : "text-slate-500"}`}
          data-testid={testId === undefined ? undefined : `${testId}-count`}
        >
          {box.count}/{box.limit}
          {over && <span className="ml-1">· {-box.remaining}자 넘었습니다</span>}
        </span>
      </div>

      {rows === undefined ? (
        <input id={id} data-testid={testId} className={field_} value={value} placeholder={placeholder} disabled={disabled} onChange={handle} />
      ) : (
        <textarea id={id} data-testid={testId} rows={rows} className={field_} value={value} placeholder={placeholder} disabled={disabled} onChange={handle} />
      )}

      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
