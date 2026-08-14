// Blog-mode navigation singleton. BlogShell owns the URL (pushState + its own
// route parsing); everything below it — post entries, topic chips, related
// lists — navigates through go() so a link click never reloads the page.
// Before the shell registers (or if it ever unmounts), fall back to a real
// navigation so links keep working no matter what.

let handler: (url: string) => void = (url) => {
  location.href = url;
};

export function setNavHandler(fn: ((url: string) => void) | null): void {
  handler = fn ?? ((url) => (location.href = url));
}

/** Navigate the blog shell to a site-relative URL ("/", "/topic/x", "/a/b"). */
export function go(url: string): void {
  handler(url);
}

/** Topic route for a tag. */
export function topicUrl(tag: string): string {
  return `/topic/${encodeURIComponent(tag)}`;
}
