import { Logger, type LoggerService } from "@nestjs/common";

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(OPENAI_API_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/(RUNWAYML_API_SECRET\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/(RUNWAY_API_SECRET\s*[=:]\s*)\S+/gi, "$1[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
  // Meta secrets do not live in dotenv lines — they ride in query strings, because that is the shape Meta
  // documents for its token endpoints. instagram-oauth.ts says the app secret "must never be logged — see
  // ProviderSettingsLogger for the redaction this codebase already applies", and until this line that
  // redaction had no pattern for the very thing it was pointing at.
  //
  // Stops at `&` rather than at whitespace: in a URL the next parameter follows immediately, and \S+ would
  // swallow the rest of the query — which reads as having redacted more than it did.
  [/([?&](?:client_secret|access_token|input_token|fb_exchange_token|code)=)[^&\s]+/gi, "$1[REDACTED]"],
];

/**
 * The pattern table applied to one string, for callers with no runtime secrets to remember.
 *
 * Exported so the table has one home. A provider's own refusal sentence is persisted into a project file and
 * shown on a screen (openai-common.ts), which is the same "about to leave this process" moment the class below
 * exists for — and a second hand-written list of patterns is a list that stops matching the first one.
 */
export function redactSecrets(value: unknown): string {
  let message = typeof value === "string" ? value : JSON.stringify(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) message = message.replace(pattern, replacement);
  return message;
}

/** Redacts values before this feature sends anything to a Nest logger. */
export class ProviderSettingsRedactor {
  private readonly runtimeSecrets = new Set<string>();

  remember(secret: string): void {
    if (secret) this.runtimeSecrets.add(secret);
  }

  redact(value: unknown): string {
    let message = typeof value === "string" ? value : JSON.stringify(value);
    for (const secret of this.runtimeSecrets) message = message.replaceAll(secret, "[REDACTED]");
    return redactSecrets(message);
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
