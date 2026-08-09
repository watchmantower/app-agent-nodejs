import * as crypto from "crypto";

export type ErrorRecordInput = {
  method: string;
  route: string;
  status: number;
  name: string;
  message: string;
  stack?: string | null;
};

type ErrorMetric = ErrorRecordInput & {
  fingerprint: string;
  count: number;
};

function firstStackFrame(stack?: string | null) {
  if (!stack) return "";
  return stack.split("\n").slice(1, 2).join("").trim();
}

function createFingerprint(input: ErrorRecordInput) {
  return crypto
    .createHash("sha1")
    .update([input.name, input.route, input.status, firstStackFrame(input.stack)].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export class ErrorCollector {
  private map = new Map<string, ErrorMetric>();
  private droppedCount = 0;

  record(input: ErrorRecordInput, maxErrors: number) {
    const fingerprint = createFingerprint(input);
    const existing = this.map.get(fingerprint);

    if (existing) {
      existing.count += 1;
      return;
    }

    if (this.map.size >= maxErrors) {
      this.droppedCount += 1;
      return;
    }

    this.map.set(fingerprint, {
      ...input,
      fingerprint,
      count: 1,
    });
  }

  snapshotAndReset() {
    const errors = Array.from(this.map.values());
    const droppedCount = this.droppedCount;
    this.map.clear();
    this.droppedCount = 0;

    return { errors, droppedCount };
  }
}
