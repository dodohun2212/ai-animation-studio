import { randomUUID } from "node:crypto";
import {
  MEME_OBSERVATION_LIMITS, MEME_OBSERVATION_KINDS,
  type MemeAnalysisSuggestion, type MemeObservationCard,
} from "@ai-animation-studio/shared";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const seconds = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MEME_OBSERVATION_LIMITS.secondsMax && Math.round(value * 10) === value * 10);

export function parseMemeSuggestions(raw: string): MemeAnalysisSuggestion[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("analysis_invalid"); }
  if (!object(value) || (value.spokenPhrase !== null && typeof value.spokenPhrase !== "string")
    || (value.gesture !== null && typeof value.gesture !== "string") || !Array.isArray(value.beats) || value.beats.length > 5
    || !Array.isArray(value.uncertainties) || !value.uncertainties.every((item: unknown) => typeof item === "string")) throw new Error("analysis_invalid");
  const suggestions: MemeAnalysisSuggestion[] = [];
  const add = (kind: MemeAnalysisSuggestion["kind"], text: string, startSeconds: number | null = null): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MEME_OBSERVATION_LIMITS.textMax || !seconds(startSeconds)) throw new Error("analysis_invalid");
    suggestions.push({ id: randomUUID(), kind, text: trimmed, startSeconds, endSeconds: null });
  };
  if (typeof value.spokenPhrase === "string") add("line", value.spokenPhrase);
  if (typeof value.gesture === "string") add("gesture", value.gesture);
  for (const beat of value.beats) {
    if (!object(beat) || typeof beat.description !== "string" || !seconds(beat.approxSeconds)) throw new Error("analysis_invalid");
    add("timing", beat.description, beat.approxSeconds);
  }
  return suggestions;
}

export function validateMemeCards(value: unknown): MemeObservationCard[] {
  if (!Array.isArray(value) || value.length > MEME_OBSERVATION_LIMITS.cardsMax) throw new Error("cards_invalid");
  return value.map((item: unknown) => {
    if (!object(item) || !MEME_OBSERVATION_KINDS.some((kind) => kind === item.kind)
      || typeof item.text !== "string" || !item.text.trim() || item.text.length > MEME_OBSERVATION_LIMITS.textMax
      || !seconds(item.startSeconds) || !seconds(item.endSeconds)
      || (item.startSeconds !== null && item.endSeconds !== null && item.endSeconds < item.startSeconds)
      || (item.origin !== "manual" && item.origin !== "suggestion")
      || (item.sourceVideoId !== null && (typeof item.sourceVideoId !== "string" || !/^[\w-]{11}$/u.test(item.sourceVideoId)))
      || (item.suggestionId !== undefined && typeof item.suggestionId !== "string")
      || (item.id !== undefined && (typeof item.id !== "string" || !item.id.trim()))) throw new Error("cards_invalid");
    return {
      id: item.id ?? randomUUID(), kind: item.kind, text: item.text.trim(), startSeconds: item.startSeconds,
      endSeconds: item.endSeconds, origin: item.origin, sourceVideoId: item.sourceVideoId,
      ...(item.suggestionId === undefined ? {} : { suggestionId: item.suggestionId }),
    } as MemeObservationCard;
  });
}
