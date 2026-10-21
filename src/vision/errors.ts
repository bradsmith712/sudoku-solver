export type ScanErrorCode = "no_board_found";

/** Thrown by vision entry points; `code` is what the UI switches on. */
export class ScanError extends Error {
  readonly code: ScanErrorCode;

  constructor(code: ScanErrorCode, message: string = code) {
    super(message);
    this.name = "ScanError";
    this.code = code;
  }
}
