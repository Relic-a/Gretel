export function getRequiredApiToken(): string {
  return process.env.GRETEL_API_TOKEN || "";
}

export function verifyApiToken(request: Request): boolean {
  const expectedToken = getRequiredApiToken();

  if (!expectedToken) {
    return true;
  }

  const tokenHeader = request.headers.get("x-gretel-token") || "";

  if (tokenHeader && tokenHeader === expectedToken) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";

  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expectedToken) {
    return true;
  }

  return false;
}
