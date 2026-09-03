import { Suspense } from "react";
import { FileBrowserShell } from "./FileBrowserShell";

export const dynamic = "force-dynamic";

export default function HomePage(): React.ReactElement {
  return (
    <Suspense fallback={<p className="p-10 text-sm text-muted-foreground">Loading…</p>}>
      <FileBrowserShell />
    </Suspense>
  );
}
