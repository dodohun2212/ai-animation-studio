import { Logger, type LoggerService } from "@nestjs/common";

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(OPENAI_API_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/(RUNWAYML_API_SECRET\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/(RUNWAY_API_SECRET\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
];

/** Redacts values before this feature sends anything to a Nest logger. */
export class ProviderSettingsRedactor {
  private readonly runtimeSecrets = new Set<string>();

  remember(secret: string): void {
    if (secret) this.runtimeSecrets.add(secret);
  }

  redact(value: unknown): string {
    let message = typeof value === "string" ? value : JSON.stringify(value);
    for (const secret of this.runtimeSecrets) message = message.replaceAll(secret, "[REDACTED]");
    for (const [pattern, replacement] of SECRET_PATTERNS) message = message.replace(pattern, replacement);
    return message;
  }
}

/** Small feature-local Nest logger wrapper; values are redacted before logging. */
export class ProviderSettingsLogger {
  constructor(
    private readonly sink: Pick<LoggerService, "log" | "error"> = new Logger("ProviderSettings"),
    private readonly redactor = new ProviderSettingsRedactor(),
  ) {}

  rememberCredential(value: string): void { this.redactor.remember(value); }

  log(message: unknown, context?: unknown, details?: unknown): void {
    this.sink.log(this.redactor.redact({ message, context, details }));
  }

  error(message: unknown, context?: unknown, details?: unknown): void {
    this.sink.error(this.redactor.redact({ message, context, details }));
  }
}
