import { useEffect, useState } from "react";
import type { Project } from "@ai-animation-studio/shared";

import { getProject } from "../../api/projectsApi.js";
import { resumeTarget, type ResumeTarget } from "../../utils/resumeTarget.js";

interface Props {
  projectId: string;
  onResume: (target: ResumeTarget) => void;
  /**
   * Rendered but refused, with the caller saying why beside it.
   *
   * A screen that has work still unsaved must not offer a shortcut past it, and hiding the button instead would
   * make the screen look like the one that never had a next step — which is the thing this component exists to
   * fix. So it stays visible and inert.
   */
  disabled?: boolean;
}

/**
 * The one next step, offered from a screen that is not the project screen.
 *
 * Loads the project on its own and fails silent: this is a shortcut, not the screen's own content, so a project
 * request that fails must leave the screen exactly as it was rather than put an error on it. 「프로젝트로
 * 돌아가기」 is always still there, and that path already reports its own failures.
 */
export function ContinueToNextStep({ projectId, onResume, disabled }: Props) {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProject(projectId)
      .then((response) => { if (!cancelled) setProject(response.project); })
      .catch(() => { if (!cancelled) setProject(null); });
    return () => { cancelled = true; };
  }, [projectId]);

  const target = project ? resumeTarget(project) : null;
  if (!target) return null;

  return (
    <button
      type="button"
      data-testid="continue-to-next-step"
      className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
      disabled={disabled}
      onClick={() => onResume(target)}
    >
      {target.label}
    </button>
  );
}
