import { HttpMetricsStore } from '../http/express';
// src/collector/httpCollector.ts
export class HttpCollector {
  private store = new HttpMetricsStore();

  record(input: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
  }) {
    this.store.record(
      input.method,
      input.route,
      input.status,
      input.durationMs
    );
  }

  snapshotAndReset() {
    return this.store.snapshotAndReset();
  }

  recordDropped(count = 1) {
    this.store.recordDropped(count);
  }

  has(method: string, route: string, status: number) {
    return this.store.has(method, route, status);
  }

  size() {
    return this.store.size();
  }
}
