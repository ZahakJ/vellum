// Typed fetchers for /api/design. A module of its own rather than rows in
// client/api.ts: the design engine is a self-contained surface, and the one
// thing it must borrow from the shared client — `withPreview`, so an admin
// inspecting their own site as a visitor gets the visitor-scrubbed design —
// is imported rather than reimplemented.

import { withPreview } from "../api.ts";
import type { PageMeta } from "../../shared/types.ts";
import type { CustomTheme, TokenSpec } from "../../shared/customTheme.ts";
import type { DesignDoc, DesignSummary, SectionKind } from "../../shared/design.ts";

/** Why the designed site is not being served (admin copy; see designs.ts). */
export interface DesignNotice {
  reason: string;
  design?: string;
  detail?: string;
}

/** GET /api/design/public — visitor-safe. */
export interface PublicDesign {
  schema: number;
  design: DesignDoc | null;
  themes: CustomTheme[];
  notice: DesignNotice | null;
  /** Published notes carrying `page: true` — which URLs the designed site
   *  lays out as pages rather than as articles. Visitor-scoped by the server. */
  pages: PageMeta[];
}

/** GET /api/design — the admin overview. */
export interface DesignOverview {
  schema: number;
  activeId: string | null;
  designs: DesignSummary[];
  themes: CustomTheme[];
  sectionKinds: SectionKind[];
  tokens: TokenSpec[];
  /** Every static page, for the nav builder's picker. */
  pages: PageMeta[];
  /** Every path a VISITOR can reach (posts + pages), so the nav builder can
   *  flag an item pointing at something the public site cannot open. */
  visible: string[];
}

class DesignApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DesignApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withPreview(init));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body; the status still carries the answer
  }
  if (!res.ok) {
    const message =
      body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new DesignApiError(message, res.status);
  }
  return body as T;
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function getPublicDesign(): Promise<PublicDesign> {
  return request<PublicDesign>("/api/design/public");
}

export function getDesignOverview(): Promise<DesignOverview> {
  return request<DesignOverview>("/api/design");
}

export function getDesignDoc(id: string): Promise<DesignDoc> {
  return request<DesignDoc>(`/api/design/docs/${encodeURIComponent(id)}`);
}

export function createDesignDoc(name: string, from?: string): Promise<DesignDoc> {
  return request<DesignDoc>("/api/design/docs", json("POST", { name, ...(from ? { from } : {}) }));
}

export function saveDesignDoc(id: string, doc: DesignDoc): Promise<DesignDoc> {
  return request<DesignDoc>(`/api/design/docs/${encodeURIComponent(id)}`, json("PUT", doc));
}

export function resetDesignDoc(id: string): Promise<DesignDoc> {
  return request<DesignDoc>(`/api/design/docs/${encodeURIComponent(id)}/reset`, { method: "POST" });
}

export function duplicateDesignDoc(id: string): Promise<DesignDoc> {
  return request<DesignDoc>(`/api/design/docs/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
}

export function deleteDesignDoc(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/design/docs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function exportDesignDoc(id: string): Promise<unknown> {
  return request<unknown>(`/api/design/docs/${encodeURIComponent(id)}/export`);
}

export function importDesignDoc(payload: unknown): Promise<DesignDoc> {
  return request<DesignDoc>("/api/design/docs/import", json("POST", payload));
}

export function setActiveDesignId(id: string | null): Promise<{ activeId: string | null }> {
  return request<{ activeId: string | null }>("/api/design/active", json("PUT", { id }));
}

export function createCustomTheme(theme: unknown): Promise<CustomTheme> {
  return request<CustomTheme>("/api/design/themes", json("POST", theme));
}

export function saveCustomTheme(id: string, theme: unknown): Promise<CustomTheme> {
  return request<CustomTheme>(`/api/design/themes/${encodeURIComponent(id)}`, json("PUT", theme));
}

export function deleteCustomThemeById(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/design/themes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
