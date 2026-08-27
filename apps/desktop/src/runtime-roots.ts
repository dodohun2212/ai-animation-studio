import * as path from "node:path";

export interface RuntimeRootsInput {
  /** app.isPackaged */
  packaged: boolean;
  /** app.getPath("userData") — only consulted when packaged. */
  userDataPath: string;
  /** This module's own directory, i.e. apps/desktop/dist at runtime. */
  currentDirectory: string;
}

export interface RuntimeRoots {
  /** Where the saved provider credentials live. */
  providerSettingsRoot: string;
  /** Where projects, the asset library and the budget ledgers live. */
  learningDataRoot: string;
}

/**
 * Both roots the backend needs, decided in one place so the two can never drift apart.
 *
 * Every launcher must state them explicitly. When the desktop shell passed only LEARNING_DATA_ROOT, the
 * credential root silently fell back to the launching process's working directory — so the browser dev server
 * and the desktop shell each kept their own drawer, and a key entered in one was invisible in the other. The
 * user hit exactly that: Instagram app details saved in the browser, and a desktop window that showed no
 * connection at all.
 *
 * In development both roots point at apps/backend, which is where running `npm run dev:backend` already puts
 * them. That is the whole point: the desktop shell and the browser must read the same drawer, or a key entered
 * while developing disappears the moment the other one is launched.
 *
 * The development learning-data root deliberately does NOT resolve to the repository root. That directory holds
 * the preserved Python baseline (see docs/02_MIGRATION_PLAN.md), and pointing a running app at it means reading
 * — and eventually writing — the very data this project is required to leave untouched.
 */
export function resolveRuntimeRoots(input: RuntimeRootsInput): RuntimeRoots {
  if (input.packaged) {
    return {
      providerSettingsRoot: input.userDataPath,
      learningDataRoot: path.join(input.userDataPath, "learning_data"),
    };
  }
  const backendPackage = path.join(input.currentDirectory, "../../backend");
  return {
    providerSettingsRoot: backendPackage,
    learningDataRoot: path.join(backendPackage, "learning_data"),
  };
}
