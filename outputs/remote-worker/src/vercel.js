export function normalizeVercelRequest(request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get("__mwi_path");
  if (!rewrittenPath) return request;
  url.searchParams.delete("__mwi_path");
  url.pathname = `/v1/${rewrittenPath.replace(/^\/+/, "")}`;
  return new Request(url, request);
}
