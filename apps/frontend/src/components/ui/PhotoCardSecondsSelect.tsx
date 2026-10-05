import { useEffect } from "react";
import { PHOTO_CARD_MAX_TOTAL_DURATION_SECONDS, photoCardDurationChoices, type PhotoCardDurationSeconds } from "@ai-animation-studio/shared";

interface Props {
  /** How many pictures the card has right now. 0 (nothing picked yet) offers what one picture could take. */
  pictureCount: number;
  value: PhotoCardDurationSeconds;
  onChange: (seconds: PhotoCardDurationSeconds) => void;
  testId: string;
  className: string;
  disabled?: boolean;
}

/**
 * 사진 카드·뉴스 릴의 「한 장당 길이」.
 *
 * 목록은 공유 `photoCardDurationChoices(사진 수)` 그대로 — 사진 수 × 길이가 릴스 한도(180초)를 넘는 값은 아예
 * 보이지 않습니다. 사진을 더 골라 지금 값이 한도를 넘게 되면, 남은 것 중 **가장 긴 값으로 바로 내립니다**.
 * 고른 사람이 길게 원했다는 뜻이니 가장 짧은 값으로 떨어뜨리지 않습니다. 서버도 같은 검사를 하지만, 거절은
 * 누른 뒤에야 오므로 여기서 먼저 막습니다.
 */
export function PhotoCardSecondsSelect({ pictureCount, value, onChange, testId, className, disabled }: Props) {
  const choices = photoCardDurationChoices(Math.max(1, pictureCount));
  const allowed = choices.includes(value);
  const fallback = choices[choices.length - 1];

  useEffect(() => {
    if (!allowed && fallback !== undefined) onChange(fallback);
  }, [allowed, fallback, onChange]);

  return (
    <>
      <select
        data-testid={testId}
        className={className}
        value={allowed ? value : fallback}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) as PhotoCardDurationSeconds)}
      >
        {choices.map((seconds) => <option key={seconds} value={seconds}>{seconds}초</option>)}
      </select>
      <span className="mt-1 block text-xs text-slate-500" data-testid={`${testId}-cap`}>
        릴스는 모두 합쳐 {PHOTO_CARD_MAX_TOTAL_DURATION_SECONDS}초까지라, 사진 수에 따라 넘는 길이는 목록에서 빠집니다.
      </span>
    </>
  );
}
