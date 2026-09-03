/**
 * Standalone verification script — exercises the full library
 * interface against a real R2 bucket + a Postgres-backed
 * metadata store. Same 9 operations as `verify-sqlite.ts`,
 * but the store lives in Docker Postgres (see
 * `docker-compose.yml`).
 *
 * Usage:
 *   docker compose up -d
 *   pnpm verify:postgres
 *   docker compose down   # when done
 *
 * Reads the same env vars as the Next.js test project
 * (FILE_NEXT_*, AWS_ACCESS_KEY_ID, etc.) from .env.local.
 * Postgres connection comes from POSTGRES_URL or defaults to
 * the docker-compose dev credentials.
 */
// Load .env.local (Next.js does this automatically; tsx doesn't).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  parseFileSystemConfig,
  createFileSystem,
  createPostgresStore,
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

  const pgUrl = process.env.POSTGRES_URL ?? "postgres://file_next:file_next@localhost:5433/file_next";
  ok("postgres URL", pgUrl.replace(/:[^:@]+@/, ":***@"));

  const stamp = Date.now();
  const schema = `verify_${stamp}`;
  const store = createPostgresStore({ connectionString: pgUrl, schema });
  const fs = createFileSystem(parsed.value, { store });
  const writeThrough = createWriteThrough(fs, store);

  const tenant = asTenantId("verify-tenant");
  const user = asUserId("verify-user");

  try {
    header("1. writeThroughFile → R2 PUT + metadata mirror");
    const name = `verify-${stamp}.txt`;
    const body = new TextEncoder().encode(
      `Postgres-backed verification run at ${new Date().toISOString()}\n`,
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
    const moveRes = await store.moveNode({
      tenantId: tenant,
      id,
      newParentId: null,
      newName: renamedName,
    });
    if (!moveRes.ok) fail("moveNode", moveRes.error);
    ok("renamed", `${moveRes.value.name} → ${moveRes.value.path}`);

    header("4. getPath → root → file (recursive CTE)");
    const pathRes = await store.getPath({ tenantId: tenant, id });
    if (!pathRes.ok) fail("getPath", pathRes.error);
    ok("path walked", pathRes.value.segments.map((s) => s.name).join(" / "));

    header("5. updateMetadata → JSONB merge");
    const metaRes = await store.updateMetadata({
      tenantId: tenant,
      id,
      metadata: { source: "verify-postgres", run: String(stamp) },
    });
    if (!metaRes.ok) fail("updateMetadata", metaRes.error);
    ok("metadata updated", JSON.stringify(metaRes.value.metadata));

    header("6. search → ILIKE (case-insensitive substring)");
    const searchRes = await store.search({ tenantId: tenant, query: "RENAMED" });
    if (!searchRes.ok) fail("search", searchRes.error);
    const hit = searchRes.value.items.find((n) => n.id === id);
    if (!hit) fail("search", new Error("expected match not found"));
    ok("search hit", hit.name);

    header("7. getNode → round-trip read");
    const getRes = await store.getNode({ tenantId: tenant, id });
    if (!getRes.ok) fail("getNode", getRes.error);
    if (!getRes.value) fail("getNode", new Error("getNode returned null"));
    ok(
      "round-trip",
      `${getRes.value.name} · ${getRes.value.size} bytes · metadata keys: ${Object.keys(getRes.value.metadata).length}`,
    );
    const s3KeyForDelete = getRes.value.s3Key;

    header("8. deleteNode → soft-delete + R2 delete");
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

    console.log("\n\x1b[1;32m✓ all 9 metadata store operations succeeded against R2 + Postgres\x1b[0m");
    console.log("(postgres schema: " + schema + " — dropped automatically on exit)");
  } finally {
    // Drop the per-run schema so the database stays tidy.
    const { Pool } = await import("pg");
    const adminPool = new Pool({ connectionString: pgUrl });
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await adminPool.end();
    }
  }
}

main().catch((e) => {
  console.error("\n\x1b[1;31mfatal:\x1b[0m", e);
  process.exit(1);
});
