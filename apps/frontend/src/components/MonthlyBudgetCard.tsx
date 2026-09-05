import { useState } from "react";
import type { ProviderCredentialKind, ProviderMonthlyBudget } from "@ai-animation-studio/shared";
import { saveProviderMonthlyBudget, toDisplayError } from "../api/providerSettingsApi.js";

interface Props {
  budgets: Record<ProviderCredentialKind, ProviderMonthlyBudget>;
  onBudgetChange: (budget: ProviderMonthlyBudget) => void;
}

const LABEL: Record<ProviderCredentialKind, string> = {
  openai: "OpenAI — 글·그림·목소리",
  runway: "Runway — 영상",
};
const ORDER: readonly ProviderCredentialKind[] = ["openai", "runway"];
const money = (value: number) => `$${value.toFixed(2)}`;

/**
 * The one number that stops paid work, where the person can see it and change it.
 *
 * $10 a month each was a constant nobody could reach: spend it, and the only ways on were to wait for the
 * calendar month or to hand-edit the spend ledger — which is the single action that destroys the record of what
 * was spent. The refusal was right and had nothing behind it.
 *
 * Shown next to what has actually been spent, from the same ledger the refusal is computed from, because a
 * limit means nothing on its own: "$10" answers no question, and "$3.00 / $10.00, $7.00 left" answers the only
 * one being asked before a cycle. The two providers are separate budgets and are never added together.
 */
export function MonthlyBudgetCard({ budgets, onBudgetChange }: Props) {
  const [drafts, setDrafts] = useState<Partial<Record<ProviderCredentialKind, string>>>({});
  const [pending, setPending] = useState<ProviderCredentialKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ProviderCredentialKind, { code: string; message: string }>>>({});

  async function save(provider: ProviderCredentialKind) {
    if (pending) return;
    const raw = (drafts[provider] ?? String(budgets[provider].monthlyLimitUsd)).trim();
    const parsed = Number(raw);
    // Checked here as well as on the server so the person is told before a round trip — the server still
    // refuses the same values, and this is not the place that decision is made.
    if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
      setErrors((old) => ({ ...old, [provider]: { code: "INVALID_BUDGET_LIMIT", message: "0보다 큰 금액을 입력해 주세요." } }));
      return;
    }
    setPending(provider);
    setErrors((old) => ({ ...old, [provider]: undefined }));
    try {
      const response = await saveProviderMonthlyBudget(provider, Math.round(parsed * 100) / 100);
      onBudgetChange(response.budget);
      setDrafts((old) => ({ ...old, [provider]: undefined }));
    } catch (caught) {
      setErrors((old) => ({ ...old, [provider]: toDisplayError(caught) }));
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="이번 달 예산" data-testid="monthly-budget-card" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div>
        <h3 className="text-base font-semibold text-slate-100">이번 달 쓸 수 있는 돈</h3>
        <p className="mt-1 text-xs text-slate-500">
          한 달에 이만큼까지만 쓰고, 넘으면 유료 요청을 아예 보내지 않습니다. 두 곳은 각각 따로 셉니다.
        </p>
      </div>

      {ORDER.map((provider) => {
        const budget = budgets[provider];
        const draft = drafts[provider] ?? String(budget.monthlyLimitUsd);
        const error = errors[provider];
        return (
          <div key={provider} data-testid={`monthly-budget-${provider}`} className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-slate-200">{LABEL[provider]}</p>
              {budget.spendUnavailable ? (
                // Not "$0.00 쓴 상태": that is the most permissive thing this card could say, right next to a
                // field for raising a spending limit. The limit is still true and still changeable.
                <p className="text-xs text-amber-300">사용액을 읽지 못했습니다</p>
              ) : (
                <p className="text-xs tabular-nums text-slate-400">
                  이번 달 {money(budget.spentUsd)} 씀 · <span className="text-slate-200">{money(budget.remainingUsd)} 남음</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <span className="text-xs text-slate-500">월 한도</span>
                <span className="text-slate-400">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${LABEL[provider]} 월 한도`}
                  className="w-24 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1.5 text-sm tabular-nums text-slate-100"
                  value={draft}
                  disabled={pending === provider}
                  onChange={(event) => setDrafts((old) => ({ ...old, [provider]: event.target.value }))}
                />
              </label>
              <button
                type="button"
                className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                disabled={pending === provider || draft.trim() === String(budget.monthlyLimitUsd)}
                onClick={() => void save(provider)}
              >
                {pending === provider ? "저장하는 중…" : "저장"}
              </button>
              {/* "Nobody has chosen" is a different fact from "somebody chose $10", and only the first one
                  means the number is the app's opinion rather than the person's. */}
              {budget.isDefault && draft.trim() === String(budget.monthlyLimitUsd) && (
                <span className="text-xs text-slate-500">기본값 — 아직 정하지 않았습니다</span>
              )}
            </div>

            {error && (
              <p role="alert" data-error-code={error.code} className="text-xs text-rose-400">{error.message}</p>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500">
        여기서 바꾸면 다음 요청부터 바로 적용됩니다 — 앱을 다시 켜지 않아도 됩니다.
      </p>
    </section>
  );
}
