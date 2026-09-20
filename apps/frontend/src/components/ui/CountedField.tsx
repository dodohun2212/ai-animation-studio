import type { ChangeEvent } from "react";

/**
 * 줄마다 몇 자까지 들어가는지를 **보여 주면서** 받는 입력 칸.
 *
 * 🔴 자르지 않습니다. 넘으면 빨갛게 세어 보여 줄 뿐이고, 타이핑은 막지 않습니다 — 길이로 자르면 사람은
 * **무엇을 잃었는지 모른 채** 다음 칸으로 갑니다(뉴스 릴 요약 칸이 같은 이유로 안 자릅니다, CLI 943 §1).
 * 대신 넘은 값으로는 **다음 버튼이 안 눌리게** `countedFieldOk` 로 막습니다.
 *
 * 🔴 한도는 **줄마다**입니다. 전체 글자 수가 아닙니다 — 굽는 쪽이 한 줄씩 그리고, 한 줄이 화면 폭을 넘으면
 * 그 줄이 깨집니다. 「합쳐서 40자」는 「20자 + 20자」와 다른 규칙입니다(한 줄에 35자를 넣으면 합계는 통과).
 */
interface CountedFieldProps {
  /** 라벨과 입력을 잇는 id — 한 화면에 여러 개가 열리므로 부르는 쪽이 정합니다. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 한 줄에 들어갈 수 있는 글자 수. */
  perLine: number;
  /** 몇 줄까지 받는지. 1 이면 `<input>`, 그보다 크면 그 줄 수만큼의 `<textarea>`. */
  maxLines: number;
  placeholder?: string;
  /** 칸 아래 한 줄 설명 — 없으면 안 그립니다. */
  hint?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * 줄을 세는 방법.
 *
 * 🟠 `\r\n` 도 한 줄바꿈으로 봅니다 — 붙여넣기가 윈도우에서 오면 `\r` 이 딸려 오고, 그걸 글자로 세면
 * 사람 눈엔 20자인 줄이 21자로 나옵니다.
 */
export function countedFieldLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/);
}

/**
 * 줄마다 글자 수.
 *
 * 🔴 `String.length` 가 아니라 **코드 포인트**로 셉니다. `"𝕏".length` 는 2 라서, 이모지 한 자가 두 자로
 * 세어집니다. 🟠 다만 이것도 완전하지는 않습니다 — 결합 문자(예: 조합형 한글)는 여전히 여러 자로 셉니다.
 * **계약이 세는 단위와 같아야** 화면이 통과시킨 값을 백엔드가 거절하는 일이 안 생깁니다(CLI 에 여쭈는 중).
 */
export function countedFieldCounts(value: string): number[] {
  return countedFieldLines(value).map((line) => Array.from(line).length);
}

/** 넘는 줄이 하나도 없고 줄 수도 넘지 않으면 `true`. 다음 버튼의 자물쇠입니다. */
export function countedFieldOk(value: string, perLine: number, maxLines: number): boolean {
  const counts = countedFieldCounts(value);
  return counts.length <= maxLines && counts.every((count) => count <= perLine);
}

export function CountedField({
  id,
  label,
  value,
  onChange,
  perLine,
  maxLines,
  placeholder,
  hint,
  disabled,
  "data-testid": testId,
}: CountedFieldProps) {
  const counts = countedFieldCounts(value);
  const tooManyLines = counts.length > maxLines;
  const ok = countedFieldOk(value, perLine, maxLines);

  const field =
    "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";
  const handle = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label className="block text-sm text-slate-300" htmlFor={id}>
          {label}
        </label>
        {/* 🟠 숫자를 라벨 옆에 둡니다. 칸 아래에 두면 **다 치고 나서야** 보입니다. */}
        <span
          className={`text-xs tabular-nums ${ok ? "text-slate-500" : "text-rose-300"}`}
          data-testid={testId === undefined ? undefined : `${testId}-count`}
        >
          {counts.map((count, index) => (
            <span key={index} className={count > perLine ? "text-rose-300" : undefined}>
              {index > 0 && <span className="text-slate-600"> · </span>}
              {maxLines > 1 && `${index + 1}줄 `}
              {count}/{perLine}
            </span>
          ))}
        </span>
      </div>

      {maxLines === 1 ? (
        <input
          id={id}
          data-testid={testId}
          className={field}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handle}
        />
      ) : (
        <textarea
          id={id}
          data-testid={testId}
          rows={maxLines}
          className={field}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handle}
        />
      )}

      {/* 🔴 줄이 넘은 것과 글자가 넘은 것은 **고치는 방법이 다릅니다** — 하나로 합치면 사람은 지울 곳을 못 찾습니다. */}
      {tooManyLines && (
        <p className="text-xs text-rose-300" data-testid={testId === undefined ? undefined : `${testId}-lines`}>
          {maxLines}줄까지 들어갑니다 — 지금 {counts.length}줄입니다.
        </p>
      )}
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
