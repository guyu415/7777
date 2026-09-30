import { AuthorizationError, CimdFetchError, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export async function completeMcpAuthorization(provider: OAuthHelpers, request: AuthRequest) {
  const now = new Date().toISOString();
  return provider.completeAuthorization({
    request,
    userId: "local-user",
    metadata: { approvedAt: now },
    scope: request.scope,
    props: { userId: "local-user", approvedAt: now },
    // Authorizing another client must not scan or revoke existing connections.
    // Legacy grants lack KV metadata, so a full scan can exceed Workers' per-
    // request KV limits. Existing grants retain their normal expiry/revocation.
    revokeExistingGrants: false,
  });
}

export function authorizationFailure(error: unknown): Response {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (error instanceof AuthorizationError) {
    if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
    return Response.json({ error: error.code, error_description: error.description },
      { status: 400, headers });
  }
  let reason = "authorization_service_error";
  const diagnostic: Record<string, string | number> = {};
  if (error instanceof CimdFetchError) {
    reason = "client_metadata_unavailable";
    const status = /HTTP\s+(\d{3})\b/.exec(error.detail);
    if (status) diagnostic.metadata_http_status = Number(status[1]);
    diagnostic.metadata_failure = status ? "http_error"
      : /timed out|timeout/i.test(error.detail) ? "timeout"
      : /does not match metadata URL/i.test(error.detail) ? "client_id_mismatch"
      : /exceeds size limit|exceeded size limit/i.test(error.detail) ? "document_too_large"
      : /JSON|UTF-8|empty|invalid|must|required|support|authentication method/i.test(error.detail) ? "invalid_document"
      : "fetch_failed";
    // Only expose the public ChatGPT client document URL, never an arbitrary
    // URL (which could contain credentials or query parameters).
    if (/^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]+\/)?client\.json$/.test(error.metadataUrl)) {
      diagnostic.metadata_url = error.metadataUrl;
    }
  }
  else if (error instanceof Error && /too many|limit exceeded/i.test(error.message)) reason = "authorization_storage_limit";
  else if (error instanceof Error && /metadata|kv|storage/i.test(error.message)) reason = "authorization_storage_error";
  else if (error instanceof Error && /crypto|encrypt|wrap|algorithm/i.test(error.message)) reason = "authorization_crypto_error";
  // Never include request URLs, client metadata, codes or tokens in diagnostics.
  console.error("MCP authorization failed", { reason });
  return Response.json({ error: "temporarily_unavailable", reason,
    ...diagnostic, error_description: "Authorization temporarily failed. Return to connection settings and start authorization again." },
    { status: 503, headers });
}
