// Vite serves stylesheet imports as side-effect modules; give them a type so
// dynamic `import("...css")` (lazy KaTeX styles) typechecks.
declare module "*.css";
