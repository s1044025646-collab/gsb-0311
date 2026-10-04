export type ErrorCode =
  | "INVALID_INPUT"
  | "NON_FINITE"
  | "OUT_OF_RANGE"
  | "UNKNOWN_PROCESS"
  | "CONTRADICTORY_FIELDS"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
