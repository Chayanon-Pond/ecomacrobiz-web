/**
 * Markdown round-trip check for the admin block editor.
 *
 *   npm run verify:roundtrip                # the 9 seeded posts (src/content/posts/posts.json)
 *   npm run verify:roundtrip -- --verbose   # also print the line diff of non-identical output
 *
 * For every post: bodyMarkdown -> editor JSON (markdown.ts) -> a real Tiptap
 * Editor instance (happy-dom) -> editor.getJSON() -> Markdown. ORIGINAL and
 * OUTPUT are parsed with remark + remark-gfm (the public renderer's parser),
 * position data stripped, insignificant differences normalized, and the mdast
 * deep-compared. Exit code 1 when any post FAILs.
 *
 * Normalizations (all invisible in the rendered article):
 * - inline formatting compared as styled runs (text + set of marks), so
 *   `***x***` nesting order, `*`/`_` and `**`/`__` do not matter;
 * - whitespace runs collapse to one space (HTML does the same);
 * - list/list-item `spread` (loose vs tight) ignored — the editor keeps it anyway;
 * - link/image references resolved to their definitions;
 * - a paragraph holding only images is split into one paragraph per image.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import type { Definition, Nodes, PhrasingContent, Root, RootContent } from "mdast";

// Plain .ts (CommonJS under tsx, like the imported src/ modules) so Tiptap and
// ProseMirror load once; mixing ESM + CJS copies breaks ProseMirror plugin keys.
const verbose = process.argv.includes("--verbose");

// Tiptap's Editor needs a DOM; happy-dom provides one headless.
const win = new Window({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  if (g[key] === undefined) {
    const v = (win as unknown as Record<string, unknown>)[key];
    g[key] = typeof v === "function" && /^[a-z]/.test(key) ? (v as (...a: unknown[]) => unknown).bind(win) : v;
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Editor } = require("@tiptap/core") as typeof import("@tiptap/core");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { baseExtensions } = require("../src/components/admin/editor/extensions") as typeof import("../src/components/admin/editor/extensions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { docToMarkdown, markdownToDoc, parseMarkdown } = require("../src/components/admin/editor/markdown") as typeof import("../src/components/admin/editor/markdown");

type Post = { slug: string; bodyMarkdown: string };
const data = JSON.parse(readFileSync(resolve(__dirname, "../src/content/posts/posts.json"), "utf8")) as { posts: Post[] };

/** Constructs the seeded posts do not use, so the bridge is exercised beyond them. */
const FIXTURE = [
  'Para with ***both*** and `code` and ~~strike~~ and [link](https://a.example "T") and [`code link`](/x).',
  "Soft line break and a hard one\\",
  "next line. Escaped \\[1\\] and a \\* star.",
  "",
  "- [ ] todo",
  "- [x] done",
  "",
  "| left | center | right |",
  "|:-|:-:|-:|",
  "| 1 | **2** | [3](/three) |",
  "",
  "> quote",
  ">",
  "> - in list",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "#### H4",
  "",
  "##### H5 kept",
  "",
  "1. one",
  "   - nested",
  "",
  "     loose paragraph",
  "2. two",
  "",
  "3. three",
  "",
  "---",
  "",
  "<div>raw html</div>",
  "",
  'Text[^1] with ![inline](/x.png "10x10") image and <kbd>html</kbd>.',
  "",
  "[^1]: Footnote.",
  "",
  '[ref]: https://ref.example "Ref"',
  "",
  "See [ref] and [label][ref] here, plus www.example.com and https://auto.example.",
  "",
  '![a](/a.png "1200x800 Caption")',
  "![b](/b.png)",
  "",
].join("\n");

/* ---------------- normalization ---------------- */

type Run = Record<string, unknown>;

function definitions(tree: Root): Map<string, Definition> {
  const defs = new Map<string, Definition>();
  const walk = (n: Nodes) => {
    if (n.type === "definition") defs.set(n.identifier.toLowerCase(), n);
    if ("children" in n) for (const c of n.children) walk(c as Nodes);
  };
  walk(tree);
  return defs;
}

function runs(nodes: PhrasingContent[], marks: string[], defs: Map<string, Definition>, out: Run[] = []): Run[] {
  for (const n of nodes) {
    const m = [...marks].sort();
    switch (n.type) {
      case "text":
        out.push({ t: "text", v: n.value, m });
        break;
      case "strong":
        runs(n.children, [...marks, "strong"], defs, out);
        break;
      case "emphasis":
        runs(n.children, [...marks, "emphasis"], defs, out);
        break;
      case "delete":
        runs(n.children, [...marks, "delete"], defs, out);
        break;
      case "link":
        runs(n.children, [...marks, `link(${n.url}|${n.title ?? ""})`], defs, out);
        break;
      case "linkReference": {
        const d = defs.get(n.identifier.toLowerCase());
        runs(n.children, [...marks, d ? `link(${d.url}|${d.title ?? ""})` : `linkref(${n.identifier})`], defs, out);
        break;
      }
      case "inlineCode":
        out.push({ t: "code", v: n.value, m });
        break;
      case "break":
        out.push({ t: "br" });
        break;
      case "image":
        out.push({ t: "img", url: n.url, alt: n.alt ?? "", title: n.title ?? "", m });
        break;
      case "imageReference": {
        const d = defs.get(n.identifier.toLowerCase());
        out.push({ t: "img", url: d?.url ?? `ref:${n.identifier}`, alt: n.alt ?? "", title: d?.title ?? "", m });
        break;
      }
      case "html":
        out.push({ t: "html", v: n.value.trim(), m });
        break;
      case "footnoteReference":
        out.push({ t: "fnref", id: n.identifier, m });
        break;
    }
  }
  return out;
}

function cleanRuns(list: Run[]): Run[] {
  const merged: Run[] = [];
  for (const r of list) {
    const prev = merged[merged.length - 1];
    if (r.t === "text" && prev?.t === "text" && JSON.stringify(prev.m) === JSON.stringify(r.m)) {
      prev.v = String(prev.v) + String(r.v);
    } else merged.push({ ...r });
  }
  for (const r of merged) if (r.t === "text") r.v = String(r.v).replace(/\s+/g, " ");
  // Whitespace next to a hard break or at the edges of the block is not rendered.
  merged.forEach((r, i) => {
    if (r.t !== "text") return;
    if (i === 0 || merged[i - 1].t === "br") r.v = String(r.v).replace(/^ /, "");
    if (i === merged.length - 1 || merged[i + 1].t === "br") r.v = String(r.v).replace(/ $/, "");
  });
  return merged.filter((r) => r.t !== "text" || r.v !== "");
}

function phr(nodes: PhrasingContent[], defs: Map<string, Definition>) {
  return cleanRuns(runs(nodes, [], defs));
}

function norm(n: RootContent, defs: Map<string, Definition>): unknown[] {
  switch (n.type) {
    case "paragraph": {
      const kids = n.children.filter((c) => !(c.type === "text" && !c.value.trim()) && c.type !== "break");
      if (kids.length > 1 && kids.every((c) => c.type === "image" || c.type === "imageReference")) {
        return kids.map((k) => ({ type: "paragraph", runs: phr([k], defs) }));
      }
      const r = phr(n.children, defs);
      return r.length ? [{ type: "paragraph", runs: r }] : [];
    }
    case "heading":
      return [{ type: "heading", depth: n.depth, runs: phr(n.children, defs) }];
    case "blockquote":
      return [{ type: "blockquote", children: n.children.flatMap((c) => norm(c, defs)) }];
    case "list":
      return [
        {
          type: "list",
          ordered: Boolean(n.ordered),
          start: n.ordered ? (n.start ?? 1) : null,
          items: n.children.map((i) => ({ checked: i.checked ?? null, children: i.children.flatMap((c) => norm(c, defs)) })),
        },
      ];
    case "code":
      return [{ type: "code", lang: n.lang ?? null, meta: n.meta ?? null, value: n.value }];
    case "table":
      return [
        {
          type: "table",
          align: n.align ?? [],
          rows: n.children.map((row) => row.children.map((cell) => phr(cell.children, defs))),
        },
      ];
    case "thematicBreak":
      return [{ type: "thematicBreak" }];
    case "html":
      return [{ type: "html", value: n.value.trim() }];
    case "definition":
      return [];
    case "footnoteDefinition":
      return [{ type: "footnoteDefinition", id: n.identifier, children: n.children.flatMap((c) => norm(c, defs)) }];
    default:
      return [{ type: n.type }];
  }
}

function normalize(md: string): unknown[] {
  const tree = parseMarkdown(md);
  const defs = definitions(tree);
  return tree.children.flatMap((c) => norm(c, defs));
}

/* ---------------- diff ---------------- */

function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${path}: ${JSON.stringify(a)?.slice(0, 200)} !== ${JSON.stringify(b)?.slice(0, 200)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) return `${path}[${i}]: missing in ORIGINAL, OUTPUT has ${JSON.stringify(b[i]).slice(0, 200)}`;
      if (i >= b.length) return `${path}[${i}]: missing in OUTPUT, ORIGINAL has ${JSON.stringify(a[i]).slice(0, 200)}`;
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function lineDiff(a: string, b: string): string[] {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(al.length, bl.length) && out.length < 12; i++) {
    if (al[i] !== bl[i]) out.push(`    L${i + 1}\n      - ${JSON.stringify(al[i] ?? null)}\n      + ${JSON.stringify(bl[i] ?? null)}`);
  }
  return out;
}

/* ---------------- run ---------------- */

async function main() {
let failed = 0;
let identical = 0;
console.log(`Markdown round-trip: ${data.posts.length} posts + 1 synthetic fixture (markdown -> Tiptap editor -> markdown)\n`);
const cases: Post[] = [...data.posts, { slug: "fixture:all-constructs (synthetic)", bodyMarkdown: FIXTURE }];

// Self-test: the normalizer must still see a one-word change.
const probe = data.posts[0].bodyMarkdown;
if (!firstDiff(normalize(probe), normalize(probe.replace("Branding", "Brandink")))) {
  console.error("normalizer self-test failed: a content change was not detected");
  process.exit(2);
}

for (const post of cases) {
  const original = post.bodyMarkdown;
  const editor = new Editor({ extensions: baseExtensions(), content: markdownToDoc(original) });
  const json = editor.getJSON();
  editor.destroy();
  const output = docToMarkdown(json);

  const diff = firstDiff(normalize(original), normalize(output));
  const same = original.replace(/\s+$/, "") === output.replace(/\s+$/, "");
  if (same) identical++;
  if (diff) failed++;
  const tag = diff ? "FAIL" : "PASS";
  console.log(`${tag}  ${post.slug}  (${original.length} -> ${output.length} chars, ${same ? "byte-identical" : "text differs, semantics equal"})`);
  if (diff) console.log(`      first diff: ${diff}`);
  if (verbose && !same) console.log(lineDiff(original.replace(/\s+$/, ""), output.replace(/\s+$/, "")).join("\n"));
}
console.log(`\n${cases.length - failed}/${cases.length} PASS · ${identical} byte-identical`);
await win.happyDOM.close();
process.exit(failed ? 1 : 0);
}

void main();
