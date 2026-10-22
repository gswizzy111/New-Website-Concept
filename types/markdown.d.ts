// legal/*.md files are imported as their raw text (next.config.ts turbopack rule).
declare module "*.md" {
  const content: string;
  export default content;
}
