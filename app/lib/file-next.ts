/**
 * Real S3/R2 + SQLite metadata. Tenant comes from the sandbox cookie, never the client.
 */
import { cookies } from "next/headers";
import {
  parseFileSystemConfig,
  createFileSystem,
  createSqliteStore,
  asTenantId,
  asUserId,
  type FileSystem,
  type FileSystemConfig,
  type MetadataStore,
  type AuthContext,
} from "@vryzel/file-next";
import { createServerActions } from "@vryzel/file-next/server";
import { createWriteThrough } from "@vryzel/file-next/sync";
import { DEMO_QUOTA_BYTES } from "./constants";
import {
  SANDBOX_COOKIE,
  SANDBOX_MAX_AGE,
  isSandboxId,
  newSandboxId,
} from "./session";

function readEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function assertEnv(env: NodeJS.ProcessEnv, keys: ReadonlyArray<string>): void {
  for (const key of keys) {
    if (!env[key] || env[key]!.length === 0) {
      console.error(`missing required env var ${key}`);
      throw new Error("Storage is not configured");
    }
  }
}

function parseConfig(env: NodeJS.ProcessEnv): FileSystemConfig {
  assertEnv(env, ["FILE_NEXT_PROVIDER", "FILE_NEXT_BUCKET"]);
  const provider = env.FILE_NEXT_PROVIDER!;
  if (provider !== "s3" && provider !== "r2") {
    throw new Error("Storage is not configured");
  }

  if (provider === "r2") {
    assertEnv(env, ["FILE_NEXT_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    return {
      provider: "r2",
      bucket: env.FILE_NEXT_BUCKET!,
      endpoint: env.FILE_NEXT_ENDPOINT!,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    };
  }

  assertEnv(env, ["FILE_NEXT_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  return {
    provider: "s3",
    bucket: env.FILE_NEXT_BUCKET!,
    region: env.FILE_NEXT_REGION!,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: env.FILE_NEXT_ENDPOINT ? true : false,
    ...(env.FILE_NEXT_ENDPOINT ? { endpoint: env.FILE_NEXT_ENDPOINT } : {}),
  };
}

let _config: FileSystemConfig | null = null;
let _fs: FileSystem | null = null;
let _store: MetadataStore | null = null;
let _actions: ReturnType<typeof createServerActions> | null = null;
let _writeThrough: ReturnType<typeof createWriteThrough> | null = null;

function getConfig(): FileSystemConfig {
  if (!_config) {
    const parsed = parseFileSystemConfig(parseConfig(readEnv()));
    if (!parsed.ok) throw parsed.error;
    _config = parsed.value;
  }
  return _config;
}

export async function getDemoAuth(): Promise<AuthContext> {
  const jar = await cookies();
  const raw = jar.get(SANDBOX_COOKIE)?.value;
  const id = raw && isSandboxId(raw) ? raw : newSandboxId();
  if (id !== raw) {
    jar.set(SANDBOX_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SANDBOX_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return { tenantId: asTenantId(id), userId: asUserId(id) };
}

export function getStore(): MetadataStore {
  if (!_store) {
    _store = createSqliteStore({ path: ".data/metadata.db" });
  }
  return _store;
}

export function getFileSystemInstance(): FileSystem {
  if (!_fs) {
    _fs = createFileSystem(getConfig(), {
      store: getStore(),
      quotaBytes: DEMO_QUOTA_BYTES,
    });
  }
  return _fs;
}

export function getWriteThrough(): ReturnType<typeof createWriteThrough> {
  if (!_writeThrough) {
    _writeThrough = createWriteThrough(getFileSystemInstance(), getStore());
  }
  return _writeThrough;
}

export function getActions(): ReturnType<typeof createServerActions> {
  if (!_actions) {
    _actions = createServerActions({
      store: getStore(),
      writeThrough: getWriteThrough(),
      fs: getFileSystemInstance(),
      getAuth: () => getDemoAuth(),
    });
  }
  return _actions;
}

export function _resetForTests(): void {
  _config = null;
  _fs = null;
  _store = null;
  _actions = null;
  _writeThrough = null;
}
