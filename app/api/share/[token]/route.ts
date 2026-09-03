import { createShareRouteHandler } from "@vryzel/file-next/server";
import { getFileSystemInstance, getStore } from "@/app/lib/file-next";

export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return createShareRouteHandler({
    store: getStore(),
    fs: getFileSystemInstance(),
  })(req);
}
