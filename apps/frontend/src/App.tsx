import { WorkflowState } from "@ai-animation-studio/shared";

export function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-violet-400">
          Prism Forge
        </p>
        <h1 className="mt-3 text-4xl font-semibold">AI Animation Studio</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          TypeScript 기반 새 버전의 실행 환경이 준비되었습니다. 기존 Python
          워크플로는 새 기능이 검증될 때까지 그대로 보존됩니다.
        </p>
        <div className="mt-8 inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-300">
          초기 상태: {WorkflowState.Init}
        </div>
      </section>
    </main>
  );
}
