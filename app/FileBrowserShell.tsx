"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FileExplorer,
  FilePreviewDialog,
  canPreviewFile,
} from "@vryzel/file-next-ui";
import type { FileNode } from "@vryzel/file-next";
import {
  copyFileAction,
  createFolderAction,
  createShareAction,
  deleteFileAction,
  getDownloadUrlAction,
  getPathAction,
  listFilesAction,
  listTrashAction,
  moveFileAction,
  restoreNodeAction,
  purgeNodeAction,
  resetSandboxAction,
  searchFilesAction,
  usageAction,
} from "./lib/actions";
import { DEMO_QUOTA_BYTES } from "./lib/constants";

type PageResult =
  | {
      ok: true;
      value: { items: ReadonlyArray<FileNode>; nextCursor?: string };
    }
  | { ok: false; error: { code: string; message: string } };

const revive = (node: FileNode): FileNode => ({
  ...node,
  createdAt: new Date(node.createdAt),
  updatedAt: new Date(node.updatedAt),
  deletedAt: node.deletedAt ? new Date(node.deletedAt) : null,
});

const asPage = async (
  run: () => Promise<
    | { ok: true; value: { items: ReadonlyArray<FileNode>; nextCursor?: string } }
    | { ok: false; error: { code: string; message: string } }
  >,
): Promise<PageResult> => {
  const result = await run();
  if (!result.ok) {
    return {
      ok: false,
      error: { code: result.error.code, message: result.error.message },
    };
  }
  return {
    ok: true,
    value: {
      items: result.value.items.map(revive),
      nextCursor: result.value.nextCursor,
    },
  };
};

export function FileBrowserShell(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlFolderId = searchParams.get("folder");
  const folderId = urlFolderId && urlFolderId !== "__root__" ? urlFolderId : null;

  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [preview, setPreview] = useState<{ file: FileNode; src: string } | null>(
    null,
  );

  const bumpRefresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const openSigned = useCallback(async (file: FileNode): Promise<string | null> => {
    const signed = await getDownloadUrlAction({ key: file.s3Key });
    return signed.ok ? signed.value.url : null;
  }, []);

  useEffect(() => {
    void usageAction().then(setUsedBytes);
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!folderId) {
        setTrail([]);
        return;
      }
      const result = await getPathAction({ id: folderId });
      if (cancelled) return;
      setTrail(
        result.ok
          ? result.value.segments.map((segment) => ({
              id: segment.id,
              name: segment.name,
            }))
          : [],
      );
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [folderId, refreshKey]);

  const navigateTo = useCallback(
    (next: { id: string | null }) => {
      router.push(next.id === null ? "/" : `/?folder=${next.id}`);
    },
    [router],
  );

  const listFiles = useCallback(
    (input: { parentId: string | null; cursor?: string; limit?: number }) =>
      asPage(() => listFilesAction(input)),
    [],
  );

  const searchFiles = useCallback(
    (input: { query?: string; limit?: number }) =>
      asPage(() => searchFilesAction({ query: input.query ?? "", limit: input.limit })),
    [],
  );

  const listTrash = useCallback(
    (input: { cursor?: string; limit?: number } = {}) =>
      asPage(() => listTrashAction(input)),
    [],
  );

  const requestUpload = useCallback(
    async (file: { name: string; type: string; parentId: string | null }) => ({
      url: `/api/upload?name=${encodeURIComponent(file.name)}&parentId=${file.parentId ?? folderId ?? ""}`,
      method: "PUT" as const,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    }),
    [folderId],
  );

  return (
    <main className="container mx-auto flex min-h-screen max-w-5xl flex-col gap-6 py-10">
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">file-next sandbox</h1>
            <p className="text-sm text-muted-foreground">
              Isolated to this browser. 20 MB quota, 10 MB per file. Reset
              clears your files; leftover objects expire in 24h on the bucket.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm"
            onClick={async () => {
              await resetSandboxAction();
              bumpRefresh();
            }}
          >
            Reset demo
          </button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col">
        <FileExplorer
          className="h-[70vh] overflow-hidden rounded-[10px] border border-border bg-card"
          persistViewKey="file-next-test.view"
          tenantId="sandbox"
          parentId={folderId}
          refreshKey={refreshKey}
          usedBytes={usedBytes}
          quotaBytes={DEMO_QUOTA_BYTES}
          listFiles={listFiles}
          searchFiles={searchFiles}
          listTrash={listTrash}
          requestUpload={requestUpload}
          confirmUpload={bumpRefresh}
          onMove={async ({ itemIds, destinationFolderId }) => {
            for (const id of itemIds) {
              await moveFileAction({ id, newParentId: destinationFolderId });
            }
            bumpRefresh();
          }}
          breadcrumbs={[{ id: "__root__", name: "Home" }, ...trail]}
          onBreadcrumbNavigate={(seg) => {
            navigateTo({ id: seg.id === "__root__" ? null : seg.id });
          }}
          onOpenFolder={(folder) => navigateTo({ id: folder.id })}
          onPreview={async (file) => {
            const src = await openSigned(file);
            if (!src) return;
            if (canPreviewFile(file)) setPreview({ file, src });
            else window.open(src, "_blank", "noopener");
          }}
          onDownload={async (file) => {
            const src = await openSigned(file);
            if (src) window.open(src, "_blank", "noopener");
          }}
          actions={{
            deleteFile: async (input) => {
              await deleteFileAction(input);
              bumpRefresh();
            },
            moveFile: async (input) => {
              await moveFileAction(input);
              bumpRefresh();
            },
            copyFile: async (input) => {
              await copyFileAction(input);
              bumpRefresh();
            },
            renameFile: async (id, newName) => {
              await moveFileAction({ id, newParentId: folderId, newName });
              bumpRefresh();
            },
            restoreNode: async (input) => {
              await restoreNodeAction(input);
              bumpRefresh();
            },
            purgeNode: async (input) => {
              await purgeNodeAction(input);
              bumpRefresh();
            },
            createFolder: async (input) => {
              await createFolderAction(input);
              bumpRefresh();
            },
            createShare: async (input) => {
              const shared = await createShareAction(input);
              if (!shared.ok) throw new Error(shared.error.message);
              return shared.value.url;
            },
          }}
        />
        <FilePreviewDialog
          file={preview?.file ?? null}
          src={preview?.src ?? ""}
          onClose={() => setPreview(null)}
          onDownload={async (file) => {
            const src = await openSigned(file);
            if (src) window.open(src, "_blank", "noopener");
          }}
        />
      </section>
    </main>
  );
}
