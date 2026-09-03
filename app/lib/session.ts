/** Edge-safe cookie helpers. Do not import file-next from here. */

export const SANDBOX_COOKIE = "fn_sandbox";
export const SANDBOX_MAX_AGE = 60 * 60 * 24;

export const isSandboxId = (id: string): boolean =>
  /^[a-zA-Z0-9_-]{8,64}$/.test(id);

export const newSandboxId = (): string => crypto.randomUUID();
