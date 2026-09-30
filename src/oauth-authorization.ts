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
  if (error instanceof AuthorizationError) {
    if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
    return Response.json({ error: error.code, error_description: error.description },
      { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  let reason = "authorization_service_error";
  if (error instanceof CimdFetchError) reason = "client_metadata_unavailable";
  else if (error instanceof Error && /too many|limit exceeded/i.test(error.message)) reason = "authorization_storage_limit";
  else if (error instanceof Error && /metadata|kv|storage/i.test(error.message)) reason = "authorization_storage_error";
  else if (error instanceof Error && /crypto|encrypt|wrap|algorithm/i.test(error.message)) reason = "authorization_crypto_error";
  // Never include request URLs, client metadata, codes or tokens in diagnostics.
  console.error("MCP authorization failed", { reason });
  return Response.json({ error: "temporarily_unavailable", reason,
    error_description: "授权暂时失败，请返回连接设置重新发起授权。" },
    { status: 503, headers: { "Cache-Control": "no-store" } });
}
