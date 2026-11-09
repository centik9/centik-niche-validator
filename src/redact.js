export function createRedactor(secrets) {
  const needles = [];
  const list = Array.isArray(secrets) ? secrets : [];
  for (const secret of list) {
    if (typeof secret === "string" && secret.trim().length >= 4) {
      needles.push(secret);
    }
  }
  return function redactText(input) {
    let text = String(input ?? "");
    text = text.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]");
    text = text.replace(/(authorization"\s*:\s*")[^"]+/gi, "$1[redacted]");
    for (const needle of needles) {
      text = text.split(needle).join("[redacted]");
    }
    return text;
  };
}
