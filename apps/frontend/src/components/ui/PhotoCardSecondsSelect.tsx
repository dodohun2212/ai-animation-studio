import { useEffect, useState } from "react";
import { PHOTO_CARD_MAX_TOTAL_DURATION_SECONDS, photoCardMaxDurationSeconds, type PhotoCardDurationSeconds } from "@ai-animation-studio/shared";

/** 한 장당 최소 1초. 릴스 전체 한도는 공유 PHOTO_CARD_MAX_TOTAL_DURATION_SECONDS. */
const MIN_SECONDS = 1;

interface Props {
  /** How many pictures the card has right now. 0 (nothing picked yet) offers what one picture could take. */
  pictureCount: number;
  value: PhotoCardDurationSeconds;
  onChange: (seconds: PhotoCardDurationSeconds) => void;
  testId: string;
  className: string;
  disabled?: boolean;
  /**
   * 사진 수가 늘어 지금 값이 한도를 넘으면 바로 최댓값으로 내릴지. 만드는 화면은 내립니다.
   * 설정 화면은 내리지 않습니다 — 저장된 값이 한도를 넘었다는 사실을 화면이 보여 주고 저장을 막아야 해서,
   * 조용히 고쳐 두면 사람이 모르는 새 값이 저장됩니다.
   */
  autoClamp?: boolean;
  /** 아래 안내 한 줄. 설정 화면은 자기 안내 줄이 따로 있어 끕니다. */
  showHint?: boolean;
}

/**
 * 사진 카드·뉴스 릴의 「한 장당 길이」 — 1초 단위로 직접 적는 칸(캡틴D 2026-10-05: 「1초 단위로 내가 입력할 수
 * 있게」). 예전에는 5·10·15… 목록에서 골랐습니다.
 *
 * 범위는 1초 ~ 사진 수 × 길이가 릴스 한도(180초)를 넘지 않는 가장 긴 값. 범위 밖이거나 정수가 아닌 값은 올려 보내지
 * 않고, 칸을 벗어날 때 가장 가까운 허용값으로 맞춥니다. 서버도 같은 검사를 하지만 거절은 누른 뒤에야 오므로
 * 여기서 먼저 막습니다.
 */
export function PhotoCardSecondsSelect({ pictureCount, value, onChange, testId, className, disabled, autoClamp = true, showHint = true }: Props) {
  // 공유 규칙 그대로(CLI Round 1202) — 서버의 isPhotoCardDurationAllowed 와 같은 최댓값. 0장은 한 장으로 봅니다.
  const max = photoCardMaxDurationSeconds(pictureCount);
  const [draft, setDraft] = useState(String(value));

  // 바깥에서 값이 바뀌면(사진 수에 따른 보정, 저장값 불러오기) 칸도 따라갑니다.
  useEffect(() => { setDraft(String(value)); }, [value]);

  useEffect(() => {
    if (autoClamp && value > max) onChange(max as PhotoCardDurationSeconds);
  }, [autoClamp, value, max, onChange]);

  const parsed = Number(draft);
  const draftValid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= MIN_SECONDS && parsed <= max;

  function settle(): void {
    const rounded = Math.round(Number(draft));
    const next = Number.isFinite(rounded) && draft.trim() !== "" ? Math.min(max, Math.max(MIN_SECONDS, rounded)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next as PhotoCardDurationSeconds);
  }

  return (
    <>
      <input
        type="number"
        inputMode="numeric"
        data-testid={testId}
        className={className}
        min={MIN_SECONDS}
        max={max}
        step={1}
        value={draft}
        disabled={disabled}
        aria-invalid={!draftValid}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const next = Number(text);
          if (text.trim() !== "" && Number.isInteger(next) && next >= MIN_SECONDS && next <= max) onChange(next as PhotoCardDurationSeconds);
        }}
        onBlur={settle}
      />
      {!draftValid && (
        <span role="alert" className="mt-1.5 block text-sm text-rose-400" data-testid={`${testId}-invalid`}>
          {MIN_SECONDS}~{max}초 사이의 정수로 적어 주세요.
        </span>
      )}
      {showHint && (
        <span className="mt-1 block text-xs text-slate-500" data-testid={`${testId}-cap`}>
          1초 단위로 적을 수 있습니다. 릴스는 모두 합쳐 {PHOTO_CARD_MAX_TOTAL_DURATION_SECONDS}초까지라, 사진 {Math.max(1, pictureCount)}장이면 한 장당 최대 {max}초입니다.
        </span>
      )}
    </>
  );
}
