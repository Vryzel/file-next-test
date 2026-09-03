import { DEMO_MAX_FILE_BYTES } from "@/app/lib/constants";
import { getDemoAuth, getWriteThrough } from "@/app/lib/file-next";

export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 20;

const allowUpload = (ip: string): boolean => {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_HITS) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
};

const clientError = (status: number, code: string, message: string): Response =>
  Response.json({ ok: false, error: { code, message } }, { status });

export async function PUT(req: Request): Promise<Response> {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!allowUpload(ip)) {
      return clientError(429, "RateLimited", "Too many uploads. Try again later.");
    }

    const len = Number(req.headers.get("content-length") ?? "NaN");
    if (!Number.isFinite(len) || len < 0 || len > DEMO_MAX_FILE_BYTES) {
      return clientError(413, "PayloadTooLarge", "File is too large for this demo.");
    }

    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (!name) {
      return clientError(400, "InternalError", "Missing name");
    }
    const parentId = url.searchParams.get("parentId");
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > DEMO_MAX_FILE_BYTES) {
      return clientError(413, "PayloadTooLarge", "File is too large for this demo.");
    }
    const auth = await getDemoAuth();
    const result = await getWriteThrough().writeThroughFile({
      tenantId: auth.tenantId,
      parentId: parentId && parentId.length > 0 ? parentId : null,
      name,
      body,
      contentType: req.headers.get("content-type") ?? "application/octet-stream",
      ownerId: auth.userId,
    });
    if (!result.ok) {
      const message = /quota/i.test(result.error.message)
        ? result.error.message
        : "Upload failed";
      return clientError(500, result.error.code, message);
    }
    return Response.json({ ok: true, value: { id: result.value.id } });
  } catch (error) {
    console.error(error);
    return clientError(500, "InternalError", "Upload failed");
  }
}
