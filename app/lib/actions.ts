"use server";

import { asS3Key } from "@vryzel/file-next";
import type { FileNode, FileSystemError } from "@vryzel/file-next";
import {
  getActions,
  getDemoAuth,
  getFileSystemInstance,
  getStore,
} from "./file-next";

type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const clientMessage = (message: string): string =>
  /AWS_|FILE_NEXT_|env var|credential|Storage is not configured/i.test(message)
    ? "Storage is unavailable"
    : message;

const toActionError = (
  error: FileSystemError,
): { code: string; message: string; retryable: boolean } => ({
  code: error.code,
  message: clientMessage(error.message),
  retryable: error.retryable,
});

const wrap = async <T>(
  run: () => Promise<{ ok: true; value: T } | { ok: false; error: FileSystemError }>,
): Promise<ActionResult<T>> => {
  try {
    const result = await run();
    if (!result.ok) return { ok: false, error: toActionError(result.error) };
    return { ok: true, value: result.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return {
      ok: false,
      error: {
        code: "InternalError",
        message: clientMessage(message),
        retryable: true,
      },
    };
  }
};

export async function listFilesAction(input: {
  parentId: string | null;
  cursor?: string;
  limit?: number;
}): Promise<
  ActionResult<{ items: ReadonlyArray<FileNode>; nextCursor?: string }>
> {
  return wrap(() => getActions().listFiles(input));
}

export async function searchFilesAction(input: {
  query: string;
  limit?: number;
}): Promise<
  ActionResult<{ items: ReadonlyArray<FileNode>; nextCursor?: string }>
> {
  return wrap(() => getActions().searchFiles(input));
}

export async function listTrashAction(input: {
  cursor?: string;
  limit?: number;
} = {}): Promise<
  ActionResult<{ items: ReadonlyArray<FileNode>; nextCursor?: string }>
> {
  return wrap(() => getActions().listTrash(input));
}

export async function deleteFileAction(input: { id: string }) {
  return wrap(() => getActions().deleteFile(input));
}

export async function moveFileAction(input: {
  id: string;
  newParentId: string | null;
  newName?: string;
}) {
  return wrap(() => getActions().moveFile(input));
}

export async function copyFileAction(input: {
  id: string;
  newParentId: string | null;
  newName?: string;
}) {
  return wrap(() => getActions().copyFile(input));
}

export async function createFolderAction(input: {
  name: string;
  parentId: string | null;
}) {
  return wrap(() => getActions().createFolder(input));
}

export async function restoreNodeAction(input: { id: string }) {
  return wrap(() => getActions().restoreNode(input));
}

export async function purgeNodeAction(input: { id: string }) {
  return wrap(() => getActions().purgeNode(input));
}

export async function createShareAction(input: { id: string }) {
  return wrap(() => getActions().createShare(input));
}

export async function prepareUploadAction(input: {
  name: string;
  contentType: string;
  contentLength: number;
  parentId: string | null;
}) {
  return wrap(() => getActions().prepareUpload(input));
}

export async function confirmUploadAction(input: {
  id: string;
  parentId: string | null;
  name: string;
  contentType?: string;
  size?: number;
}) {
  return wrap(() => getActions().confirmUpload(input));
}

export async function usageAction(): Promise<number> {
  const auth = await getDemoAuth();
  const sum = await getStore().sumSize({ tenantId: auth.tenantId });
  return sum.ok ? sum.value : 0;
}

export async function getPathAction(input: {
  id: string;
}): Promise<ActionResult<{ segments: ReadonlyArray<FileNode> }>> {
  return wrap(async () => {
    const auth = await getDemoAuth();
    return getStore().getPath({ tenantId: auth.tenantId, id: input.id });
  });
}

export async function getDownloadUrlAction(input: {
  key: string;
}): Promise<ActionResult<{ url: string }>> {
  return wrap(async () => {
    const auth = await getDemoAuth();
    const signed = await getFileSystemInstance()
      .forTenant(auth.tenantId)
      .adapter.createPresignedDownloadUrl({
        key: asS3Key(input.key),
        expiresIn: 900,
      });
    if (!signed.ok) return signed;
    return { ok: true, value: { url: signed.value.url } };
  });
}

export async function resetSandboxAction(): Promise<ActionResult<void>> {
  const files = await wrap(() =>
    getActions().listFiles({ parentId: null, limit: 500 }),
  );
  if (!files.ok) return files;
  for (const item of files.value.items) {
    const deleted = await wrap(() =>
      getActions().deleteFile({ id: item.id, recursive: true }),
    );
    if (!deleted.ok) return deleted;
  }
  const trash = await wrap(() => getActions().listTrash({ limit: 500 }));
  if (!trash.ok) return trash;
  for (const item of trash.value.items) {
    const purged = await wrap(() => getActions().purgeNode({ id: item.id }));
    if (!purged.ok) return purged;
  }
  return { ok: true, value: undefined };
}
