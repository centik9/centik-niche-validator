export function classifyNumber(value) {
  if (value === null || value === undefined) {
    return { status: "missing", value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { status: "unusable", value: null };
  }
  if (value === 0) {
    return { status: "measured_zero", value: 0 };
  }
  if (value < 0) {
    return { status: "unusable", value: null };
  }
  return { status: "measured", value };
}

export function isMeasuredStatus(status) {
  return status === "measured" || status === "measured_zero";
}

export function field(status, value, extra = {}) {
  return { status, value, ...extra };
}

export function labelDemand(metric) {
  if (!metric || metric.status === "missing" || metric.status === "unsupported" || metric.status === "unusable" || metric.status === "not_requested" || metric.value == null) {
    return metric && metric.status === "failed" ? "Failed" : "Insufficient data";
  }
  if (metric.status === "failed") return "Failed";
  if (metric.status === "measured_zero") return "0 (measured)";
  if (metric.status === "partial") return `${metric.value} (partial)`;
  return String(metric.value);
}
