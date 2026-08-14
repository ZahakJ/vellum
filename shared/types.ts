// Shared types — the wire contract between server and client. Do not drift from these.

export interface TreeNode {
  name: string;          // file or folder basename, e.g. "Ideas.md" or "projects"
  path: string;          // vault-relative POSIX path, e.g. "projects/Ideas.md"; "" for root
  type: "file" | "folder";
  children?: TreeNode[]; // folders only, sorted: folders first, then files, alpha
}

export interface NoteData {
  path: string;
  content: string;       // raw markdown including frontmatter
  mtimeMs: number;
}

export interface SearchHit {
  path: string;
  title: string;         // basename without .md
  snippet: string;       // ~160 chars of matched context, match wrapped in <mark>…</mark>
  score: number;
}

export interface GraphNode { id: string; title: string; links: number; tags: string[] }
export interface GraphEdge { source: string; target: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export interface Backlink { path: string; title: string; context: string } // context = line containing the link

export interface TagCount { tag: string; count: number }

export interface VaultEvent {
  kind: "created" | "changed" | "deleted" | "renamed";
  path: string;
  toPath?: string; // renamed only
  dir?: boolean;   // true when the event is about a folder
}

export interface ResolveResult { path: string | null } // GET /api/resolve?name= (null = known miss, 200 not 404 so expected misses stay quiet in devtools)

export interface MeData {
  admin: boolean;      // this session may mutate the vault
  public: boolean;     // reads are open without a session (PUBLIC != false)
  protected: boolean;  // an ADMIN_PASSWORD_HASH is configured (sign in/out is meaningful)
  homeNote?: string;   // note opened for fresh visitors (HOME_NOTE)
}
