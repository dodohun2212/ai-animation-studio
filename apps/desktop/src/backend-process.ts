export interface ChildLike {
  once(event: "exit", listener: (code: number | null) => void): void;
  kill(): void;
}

export interface BackendProcessDeps {
  fork: (modulePath: string, args: readonly string[], env: NodeJS.ProcessEnv) => ChildLike;
  checkHealth: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  modulePath: string;
  env: NodeJS.ProcessEnv;
  port: number;
  maxAutoRestarts?: number;
}

/**
 * Owns the lifecycle of the local Backend process for the packaged desktop
 * shell: starts it, restarts it a bounded number of times if it exits
 * unexpectedly (never an infinite crash loop), and stops it on app quit.
 * Readiness is confirmed by polling the real `/health` route rather than
 * trusting process spawn alone, since a listening process can still be mid
 * bootstrap.
 */
export class BackendProcessManager {
  private readonly deps: BackendProcessDeps;
  private child: ChildLike | undefined;
  private stopped = false;
  private restarts = 0;
  private readonly maxAutoRestarts: number;

  constructor(deps: BackendProcessDeps) {
    this.deps = deps;
    this.maxAutoRestarts = deps.maxAutoRestarts ?? 3;
  }

  start(): void {
    this.stopped = false;
    this.spawn();
  }

  get restartCount(): number {
    return this.restarts;
  }

  private spawn(): void {
    const child = this.deps.fork(this.deps.modulePath, [], this.deps.env);
    this.child = child;
    child.once("exit", () => {
      if (this.stopped) return;
      if (this.restarts >= this.maxAutoRestarts) return;
      this.restarts += 1;
      this.spawn();
    });
  }

  async waitUntilReady(timeoutMs = 15000, intervalMs = 300): Promise<boolean> {
    const url = `http://127.0.0.1:${this.deps.port}/health`;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.deps.checkHealth(url)) return true;
      if (Date.now() >= deadline) return false;
      await this.deps.wait(intervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
  }
}
