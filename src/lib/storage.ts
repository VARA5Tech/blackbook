import "server-only";
import { logger } from "@/lib/logger";

/**
 * Object storage, over Supabase Storage's own REST API.
 *
 * Blackbook keeps documents — passports scanned in, itineraries, whatever the
 * desk attaches to a client — out of Postgres and in a private bucket. This is
 * the one place the application talks to Supabase over HTTP rather than SQL,
 * and it is deliberate: files are not relational data, so none of the reasons
 * the database is reached over a connection string apply here. The rule that
 * bans Supabase's API for business data is about PostgREST and the `public`
 * tables — transactions, tsvector ranking, trigram search and Better Auth all
 * need real SQL. Storage is a separate
 * service on a separate path (`/storage/v1/*`); reaching it does not route any
 * business data through PostgREST and breaks none of that.
 *
 * Auth is the Supabase service role key, server-side only and never
 * `NEXT_PUBLIC_`. The bytes still never pass through the Next server in bulk:
 * the browser uploads and downloads straight to Storage through short-lived
 * signed URLs this file mints, so the key stays on the server and the traffic
 * does not.
 *
 * Optional, like PostHog and the Tern bridge: with the variables unset the
 * document features simply do not appear, and the rest of the application is
 * untouched. The same three variables point at a self-hosted Supabase or the
 * hosted platform without a code change.
 */

const BASE = () => `${process.env.SUPABASE_URL?.replace(/\/+$/, "")}/storage/v1`;
const BUCKET = () => process.env.STORAGE_BUCKET ?? "";
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function storageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.STORAGE_BUCKET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * The path of one object under the storage API, encoded segment by segment so a
 * slash in the key stays a folder separator while spaces and the like escape.
 */
function objectPath(key: string): string {
  return `${BUCKET()}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Headers for a call the server makes as itself.
 *
 * The self-hosted gateway (Kong) gates every route on `apikey`, and Storage
 * authorises the action on the bearer token; both carry the service role key.
 */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { apikey: KEY(), authorization: `Bearer ${KEY()}`, ...extra };
}

/** A signed URL the browser can PUT a file to, good for a few minutes. */
export async function signedUpload(key: string, _contentType: string, expiresIn = 300): Promise<string> {
  if (!storageConfigured()) throw new StorageError("Storage is not configured.");
  const res = await fetch(`${BASE()}/object/upload/sign/${objectPath(key)}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) {
    logger.warn("storage.sign_upload_failed", { status: res.status });
    throw new StorageError(`Storage would not sign the upload (${res.status}).`);
  }
  // `url` is a path like /object/upload/sign/<bucket>/<key>?token=<jwt>; the
  // browser PUTs the file straight to it, the token doing the authorising.
  const { url } = (await res.json()) as { url: string };
  return `${BASE()}${url}`;
}

/**
 * A signed URL the browser can GET the file from, good for a few minutes.
 *
 * `downloadName` sets the filename the browser saves it as, through Storage's
 * `download` parameter, so a document stored under an opaque key still
 * downloads as "Passport.pdf".
 */
export async function signedDownload(key: string, downloadName?: string, expiresIn = 300): Promise<string> {
  if (!storageConfigured()) throw new StorageError("Storage is not configured.");
  const res = await fetch(`${BASE()}/object/sign/${objectPath(key)}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new StorageError(`Storage would not sign the download (${res.status}).`);
  const { signedURL } = (await res.json()) as { signedURL: string };
  const suffix = downloadName ? `&download=${encodeURIComponent(downloadName)}` : "";
  return `${BASE()}${signedURL}${suffix}`;
}

/** Stores bytes the server already holds — a document fetched from Tern, say. */
export async function putObject(key: string, body: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
  const res = await fetch(`${BASE()}/object/${objectPath(key)}`, {
    method: "POST",
    headers: authHeaders({ "content-type": contentType, "x-upsert": "true" }),
    // A byte array is a valid fetch body at runtime; the lib types are narrower.
    body: (body instanceof ArrayBuffer ? new Uint8Array(body) : body) as unknown as BodyInit,
  });
  if (!res.ok) {
    logger.warn("storage.put_failed", { status: res.status });
    throw new StorageError(`Storage refused the upload (${res.status}).`);
  }
}

/** Reads an object the server needs in hand. Rare; most reads are signed URLs. */
export async function getObject(key: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE()}/object/authenticated/${objectPath(key)}`, { headers: authHeaders() });
  if (!res.ok) throw new StorageError(`Storage could not return the object (${res.status}).`);
  return res.arrayBuffer();
}

export async function deleteObject(key: string): Promise<void> {
  const res = await fetch(`${BASE()}/object/${objectPath(key)}`, { method: "DELETE", headers: authHeaders() });
  // 200 on delete, 404/400 when it was already gone — all mean "not there now".
  if (!res.ok && res.status !== 404 && res.status !== 400) {
    logger.warn("storage.delete_failed", { status: res.status });
    throw new StorageError(`Storage refused the delete (${res.status}).`);
  }
}

/** True if the object is there. Used to confirm a browser upload landed. */
export async function objectExists(key: string): Promise<{ ok: boolean; size: number | null; contentType: string | null }> {
  const res = await fetch(`${BASE()}/object/authenticated/${objectPath(key)}`, { method: "HEAD", headers: authHeaders() });
  return {
    ok: res.ok,
    size: res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null,
    contentType: res.headers.get("content-type"),
  };
}
