export function readTask(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "invalid_payload", message: "DataForSEO returned an unusable payload." };
  }
  if (payload.status_code !== 20000) {
    return {
      ok: false,
      code: "provider_status",
      status_code: payload.status_code,
      message: typeof payload.status_message === "string" ? payload.status_message : "DataForSEO returned an error status."
    };
  }
  const task = Array.isArray(payload.tasks) ? payload.tasks[0] : null;
  if (!task || task.status_code !== 20000) {
    return {
      ok: false,
      code: "provider_status",
      status_code: task ? task.status_code : null,
      message: task && typeof task.status_message === "string" ? task.status_message : "DataForSEO task failed."
    };
  }
  const cost = typeof task.cost === "number" && Number.isFinite(task.cost) ? task.cost : null;
  return { ok: true, result: task.result, cost };
}
