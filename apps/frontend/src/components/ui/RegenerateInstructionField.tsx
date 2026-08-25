interface RegenerateInstructionFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Unique per scene — two open confirmations must not share one input id. */
  id: string;
  /** What the direction will steer, in the user's words (e.g. "그림", "영상", "말투"). */
  subject: string;
  placeholder: string;
  "data-testid"?: string;
}

/**
 * The optional one-off direction attached to a single regeneration.
 *
 * Deliberately not a scene edit: what is typed here is used for this one attempt and is never stored, so the
 * next regeneration starts from the plain scene prompt again. That distinction is the whole reason this field
 * exists next to scene editing rather than replacing it — a passing "make it darker" should not become part of
 * the scene, while a wrong action description should. The copy says so, because a text box next to a paid
 * button otherwise looks like it might be saving something.
 */
export function RegenerateInstructionField({
  value,
  onChange,
  disabled,
  id,
  subject,
  placeholder,
  "data-testid": testId,
}: RegenerateInstructionFieldProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-slate-300" htmlFor={id}>
        이번에만 적용할 지시 <span className="text-slate-500">(선택)</span>
      </label>
      <input
        id={id}
        data-testid={testId}
        className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-slate-500">
        이번 재생성에만 쓰이고 저장되지 않습니다. 다음에 다시 만들면 이 지시 없이 원래대로 돌아갑니다. {subject}을(를)
        계속 바꾸려면 장면 편집에서 고쳐야 합니다.
      </p>
    </div>
  );
}
