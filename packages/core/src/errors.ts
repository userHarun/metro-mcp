export type MetroErrorCode =
  | "configuration"
  | "invalid_request"
  | "timeout"
  | "upstream"
  | "invalid_response"
  | "catalog_not_ready"
  | "not_found"
  | "rate_limited"
  | "internal_error";

export class MetroError extends Error {
  readonly code: MetroErrorCode;
  readonly status: number;
  readonly requestId: string | null;

  constructor(
    code: MetroErrorCode,
    message: string,
    options: { status?: number; requestId?: string | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MetroError";
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.requestId = options.requestId ?? null;
  }
}

function statusForCode(code: MetroErrorCode): number {
  switch (code) {
    case "invalid_request": return 400;
    case "not_found": return 404;
    case "rate_limited": return 429;
    case "configuration":
    case "catalog_not_ready": return 503;
    case "timeout": return 504;
    case "upstream":
    case "invalid_response": return 502;
    case "internal_error": return 500;
  }
}

export function toMetroError(error: unknown): MetroError {
  if (error instanceof MetroError) return error;
  return new MetroError("internal_error", "The METRO request could not be completed.", { cause: error });
}
