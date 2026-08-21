import { useState } from "react";
import type { Project } from "@ai-animation-studio/shared";

import { CreateProjectForm } from "./components/CreateProjectForm.js";
import { ProjectDetail } from "./components/ProjectDetail.js";
import { ProjectList } from "./components/ProjectList.js";
import { ProviderSettingsScreen } from "./components/ProviderSettingsScreen.js";

type Screen =
  | { name: "list" }
  | { name: "create" }
  | { name: "detail"; projectId: string }
  | { name: "providerSettings" };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [listRefreshToken, setListRefreshToken] = useState(0);

  function handleCreated(project: Project): void {
    setListRefreshToken((token) => token + 1);
    setScreen({ name: "detail", projectId: project.id });
  }

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

        {screen.name === "list" && (
          <>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="text-sm text-violet-300 underline"
                onClick={() => setScreen({ name: "providerSettings" })}
              >
                API 설정
              </button>
            </div>
            <ProjectList
              refreshToken={listRefreshToken}
              onOpenProject={(projectId) => setScreen({ name: "detail", projectId })}
              onCreateNew={() => setScreen({ name: "create" })}
            />
          </>
        )}
        {screen.name === "create" && (
          <CreateProjectForm onCreated={handleCreated} onCancel={() => setScreen({ name: "list" })} />
        )}
        {screen.name === "detail" && (
          <ProjectDetail projectId={screen.projectId} onBack={() => setScreen({ name: "list" })} />
        )}
        {screen.name === "providerSettings" && (
          <ProviderSettingsScreen onBack={() => setScreen({ name: "list" })} />
        )}
      </section>
    </main>
  );
}
