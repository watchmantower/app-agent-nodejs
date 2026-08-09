import { ScannerTrafficCategory } from "../http/scannerTraffic";

type ScannerTrafficInput = {
  category: ScannerTrafficCategory;
  path: string;
  method: string;
  status: number;
};

type ScannerTrafficMetric = {
  category: ScannerTrafficCategory;
  count: number;
  samplePaths: string[];
  methods: Record<string, number>;
  statuses: Record<string, number>;
};

const MAX_SAMPLE_PATHS = 10;

export class ScannerTrafficCollector {
  private map = new Map<ScannerTrafficCategory, ScannerTrafficMetric>();

  record(input: ScannerTrafficInput) {
    const existing = this.map.get(input.category) || {
      category: input.category,
      count: 0,
      samplePaths: [],
      methods: {},
      statuses: {},
    };

    existing.count += 1;
    existing.methods[input.method] = (existing.methods[input.method] || 0) + 1;
    existing.statuses[String(input.status)] = (existing.statuses[String(input.status)] || 0) + 1;

    if (!existing.samplePaths.includes(input.path) && existing.samplePaths.length < MAX_SAMPLE_PATHS) {
      existing.samplePaths.push(input.path);
    }

    this.map.set(input.category, existing);
  }

  snapshotAndReset() {
    const metrics = Array.from(this.map.values());
    this.map.clear();
    return { metrics };
  }
}
