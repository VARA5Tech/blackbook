import { AlertTriangle } from "lucide-react";
import { ternStatus } from "@/services/tern-service";

/**
 * A quiet line when Tern needs attention, above the clients list.
 *
 * Only ever shown when the bridge is set up and something is wrong — signed
 * out, unreachable, or Tern has changed the shape of its pages. When all is
 * well it renders nothing, because a green light nobody needs is just noise.
 * Its own read fails soft: a slow bridge never delays the clients list.
 */
export async function TernStatusBanner() {
  const status = await ternStatus().catch(() => null);
  if (!status || !status.configured || status.healthy || !status.message) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-medium">Tern import unavailable.</span> {status.message}
      </span>
    </div>
  );
}
