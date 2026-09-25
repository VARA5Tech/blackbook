"use client";

import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  confirmDocumentUploadAction,
  deleteDocumentAction,
  documentDownloadUrlAction,
  requestDocumentUploadAction,
} from "@/actions/client-actions";
import { Section } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

export type DocumentView = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  kind: string | null;
  source: string;
  createdAt: Date | string;
};

const MAX_BYTES = 25 * 1024 * 1024;

function readableSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Files attached to a client. The browser uploads straight to storage through
 * a signed URL, so a large scan never goes through Blackbook's server; the
 * server only records what the file is and hands back a link to fetch it.
 */
export function DocumentsCard({
  customerId,
  documents,
  canManage,
}: {
  customerId: string;
  documents: DocumentView[];
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, startTransition] = useTransition();

  async function upload(file: File) {
    if (file.size > MAX_BYTES) return void toast.error("That file is over 25 MB.");
    setUploading(true);
    try {
      const requested = await requestDocumentUploadAction({
        customerId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!requested.ok) throw new Error(requested.error);

      // Straight to storage, not through the server.
      const put = await fetch(requested.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      });
      if (!put.ok) throw new Error("Storage refused the upload.");

      const confirmed = await confirmDocumentUploadAction({ documentId: requested.data.documentId, customerId });
      if (!confirmed.ok) throw new Error(confirmed.error);
      toast.success(`${file.name} added`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function download(id: string) {
    startTransition(async () => {
      const result = await documentDownloadUrlAction({ documentId: id });
      if (!result.ok) return void toast.error(result.error);
      // A signed link, good for a few minutes; open it to save the file.
      window.open(result.data, "_blank", "noopener");
    });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name}? The file is deleted from storage.`)) return;
    startTransition(async () => {
      const result = await deleteDocumentAction({ documentId: id, customerId });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <Section
      title="Documents"
      icon={Paperclip}
      count={documents.length || undefined}
      flush
      action={
        canManage ? (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploading ? "Uploading…" : "Add"}
            </Button>
          </>
        ) : null
      }
    >
      {documents.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No documents yet.{canManage ? " Add a scan, an itinerary or anything else that belongs on this client." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.filename}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {[doc.kind, readableSize(doc.sizeBytes), doc.source === "tern" ? "from Tern" : null, formatDate(doc.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Download ${doc.filename}`} onClick={() => download(doc.id)} disabled={busy}>
                <Download className="size-4" />
              </Button>
              {canManage ? (
                <Button variant="ghost" size="icon" aria-label={`Remove ${doc.filename}`} onClick={() => remove(doc.id, doc.filename)} disabled={busy}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
