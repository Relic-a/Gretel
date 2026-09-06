export function canarySet(seed) {
  const raw = `GRETEL-CANARY-${seed}-Qz9secret`;
  return {
    raw,
    cookie: `session=${raw}; HttpOnly`,
    url: `https://provider.invalid/callback?token=${encodeURIComponent(raw)}&state=x`,
    encodedBase64: Buffer.from(raw, "utf8").toString("base64"),
    encodedUrl: encodeURIComponent(raw)
  };
}

export function scanForCanaries(text, canaries) {
  const values = [canaries.raw, canaries.encodedBase64, canaries.encodedUrl];
  return values.filter((value) => value.length > 4 && text.includes(value));
}
