import { createShareRouteHandler } from "@vryzel/file-next/server";
import { getFileSystemInstance, getStore } from "@/app/lib/file-next";

export const dynamic = "force-dynamic";

const handler = createShareRouteHandler({
  store: getStore(),
  fs: getFileSystemInstance(),
});

export const GET = handler;
