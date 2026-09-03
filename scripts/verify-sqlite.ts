/**
 * Standalone verification script — exercises the full library
 * interface against a real R2 bucket + a persistent SQLite
 * metadata store. No Next.js in the loop, so better-sqlite3's
 * native binding loads cleanly via Node.
 *
 * Usage:
 *   pnpm verify:sqlite
 *
 * Reads the same env vars as the Next.js test project
 * (FILE_NEXT_*, AWS_ACCESS_KEY_ID, etc.) from .env.local.
 *
 * What it does:
 *   1. createSqliteStore (persistent ./verify.db)
 *   2. writeThrough.writeThroughFile → PUT to R2
 *   3. listChildren → verifies the write mirrored into metadata
 *   4. moveNode → rename the file in place (cascades path)
 *   5. getPath → walks the parent chain (always root for files)
 *   6. updateMetadata → merges a custom key
 *   7. search → case-insensitive substring match
 *   8. deleteNode → soft-delete + delete from R2
 *   9. reconcile → no-op scan
 */
// Load .env.local (Next.js does this automatically; tsx doesn't).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  parseFileSystemConfig,
  createFileSystem,
  createSqliteStore,
  asTenantId,
  asUserId,
  asS3Key,
} from "@vryzel/file-next";
import { createWriteThrough } from "@vryzel/file-next/sync";

function readEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function assertEnv(env: NodeJS.ProcessEnv, keys: ReadonlyArray<string>, context: string): void {
  for (const key of keys) {
    if (!env[key] || env[key]!.length === 0) {
      throw new Error(`${context}: missing required env var ${key}. Copy .env.example to .env.local.`);
    }
  }
}

function parseConfig(env: NodeJS.ProcessEnv) {
  assertEnv(env, ["FILE_NEXT_PROVIDER", "FILE_NEXT_BUCKET"], "config");
  const provider = env.FILE_NEXT_PROVIDER!;
  if (provider === "r2") {
    assertEnv(env, ["FILE_NEXT_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], "R2");
    return {
      provider: "r2" as const,
      bucket: env.FILE_NEXT_BUCKET!,
      endpoint: env.FILE_NEXT_ENDPOINT!,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    };
  }
  assertEnv(env, ["FILE_NEXT_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], "S3");
  return {
    provider: "s3" as const,
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

function header(title: string): void {
  console.log(`\n\x1b[1m▶ ${title}\x1b[0m`);
}

function ok(label: string, extra?: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? ` — ${extra}` : ""}`);
}

function fail(label: string, err: unknown): never {
  console.error(`  \x1b[31m✗\x1b[0m ${label}`);
  console.error(err);
  process.exit(1);
}

async function main(): Promise<void> {
  header("0. Setup");
  const cfg = parseConfig(readEnv());
  const parsed = parseFileSystemConfig(cfg);
  if (!parsed.ok) fail("parseFileSystemConfig", parsed.error);
  ok("config parsed", `${parsed.value.provider} / ${parsed.value.bucket}`);

  const store = createSqliteStore({ path: "./verify.db" });
  const fs = createFileSystem(parsed.value, { store });
  const writeThrough = createWriteThrough(fs, store);

  const tenant = asTenantId("verify-tenant");
  const user = asUserId("verify-user");

  header("1. writeThroughFile → R2 PUT + metadata mirror");
  const stamp = Date.now();
  const name = `verify-${stamp}.txt`;
  const body = new TextEncoder().encode(
    `Verification run at ${new Date().toISOString()}\n`,
  );
  const writeRes = await writeThrough.writeThroughFile({
    tenantId: tenant,
    parentId: null,
    name,
    contentType: "text/plain",
    body,
    ownerId: user,
  });
  if (!writeRes.ok) fail("writeThroughFile", writeRes.error);
  ok("created", `${writeRes.value.name} → ${writeRes.value.path} (${writeRes.value.size} bytes)`);
  const id = writeRes.value.id;

  header("2. listChildren → should see the file");
  const listRes = await store.listChildren({ tenantId: tenant, parentId: null });
  if (!listRes.ok) fail("listChildren", listRes.error);
  const found = listRes.value.items.find((n) => n.id === id);
  if (!found) fail("listChildren", new Error("created file not visible"));
  ok("listed", `${listRes.value.items.length} file(s) in root`);

  header("3. moveNode → rename in place");
  const renamedName = `renamed-${stamp}.txt`;
  // Rename in place by passing the current parentId (null for root).
  const moveRes = await store.moveNode({
    tenantId: tenant,
    id,
    newParentId: null,
    newName: renamedName,
  });
  if (!moveRes.ok) fail("moveNode", moveRes.error);
  ok("renamed", `${moveRes.value.name} → ${moveRes.value.path}`);

  header("4. getPath → root → file");
  const pathRes = await store.getPath({ tenantId: tenant, id });
  if (!pathRes.ok) fail("getPath", pathRes.error);
  ok("path walked", pathRes.value.segments.map((s) => s.name).join(" / "));

  header("5. updateMetadata → merge a custom key");
  const metaRes = await store.updateMetadata({
    tenantId: tenant,
    id,
    metadata: { source: "verify-script", run: String(stamp) },
  });
  if (!metaRes.ok) fail("updateMetadata", metaRes.error);
  ok("metadata updated", JSON.stringify(metaRes.value.metadata));

  header("6. search → case-insensitive substring");
  const searchRes = await store.search({ tenantId: tenant, query: "RENAMED" });
  if (!searchRes.ok) fail("search", searchRes.error);
  const hit = searchRes.value.items.find((n) => n.id === id);
  if (!hit) fail("search", new Error("expected match not found"));
  ok("search hit", hit.name);

  header("7. getNode → round-trip read");
  const getRes = await store.getNode({ tenantId: tenant, id });
  if (!getRes.ok) fail("getNode", getRes.error);
  if (!getRes.value) fail("getNode", new Error("getNode returned null"));
  ok("round-trip", `${getRes.value.name} · ${getRes.value.size} bytes · metadata keys: ${Object.keys(getRes.value.metadata).length}`);
  // The s3_key is the ORIGINAL name — moveNode only renames in
  // the metadata tree, the S3 object key is stable.
  const s3KeyForDelete = getRes.value.s3Key;

  header("8. deleteNode → soft-delete + R2 delete");
  // Read the bytes from R2 first to confirm they exist, then delete.
  const readRes = await fs.forTenant(tenant).adapter.read({ key: asS3Key(s3KeyForDelete) });
  if (!readRes.ok) fail("adapter.read (precondition)", readRes.error);
  ok("R2 read before delete", `${readRes.value.body.byteLength} bytes`);

  const delRes = await store.deleteNode({ tenantId: tenant, id });
  if (!delRes.ok) fail("deleteNode", delRes.error);
  ok("metadata tombstoned");

  header("9. reconcile → no-op scan");
  const reconRes = await store.reconcile();
  if (!reconRes.ok) fail("reconcile", reconRes.error);
  ok("scanned", `${reconRes.value.scanned} live row(s) (orphans: ${reconRes.value.orphansInS3.length} in S3)`);

  console.log("\n\x1b[1;32m✓ all 9 metadata store operations succeeded against R2 + SQLite\x1b[0m");
  console.log("(SQLite db: ./verify.db — delete it if you want to start fresh)");
}

main().catch((e) => {
  console.error("\n\x1b[1;31mfatal:\x1b[0m", e);
  process.exit(1);
});
