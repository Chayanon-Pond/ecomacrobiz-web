/**
 * Markdown <-> editor document bridge (ProseMirror JSON <-> mdast).
 *
 * Parsing uses the SAME parser as the public renderer (remark-parse +
 * remark-gfm, as in components/content/Markdown.tsx), so what the editor
 * shows is what the article page renders. Output goes through
 * remark-stringify with the house style of posts.json (`-` bullets, `*`
 * emphasis, `**` strong, `---` rules, fenced code).
 *
 * Pure functions on JSON: usable in the browser and in Node (round-trip script).
 */
import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  Definition,
  List,
  ListItem,
  Nodes,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify, { type Options as StringifyOptions } from "remark-stringify";
import { unified } from "unified";

type Mark = { type: string; attrs?: Record<string, unknown> };

export const STRINGIFY_OPTIONS: StringifyOptions = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  rule: "-",
  fence: "`",
  fences: true,
  listItemIndent: "one",
  incrementListMarker: true,
};

const parser = unified().use(remarkParse).use(remarkGfm);
// Unpadded tables (`| a | b |`) like posts.json: smaller diffs, no width games with Thai text.
const stringifier = unified().use(remarkStringify, STRINGIFY_OPTIONS).use(remarkGfm, { tablePipeAlign: false });

export function parseMarkdown(md: string): Root {
  return parser.parse(md) as Root;
}

/* ------------------------------------------------------------------ */
/* Markdown -> editor JSON                                             */
/* ------------------------------------------------------------------ */

type Ctx = { src: string; defs: Map<string, Definition>; linkRefs: Set<string>; rawRefs: Set<string> };

function slice(ctx: Ctx, node: Nodes): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s !== undefined && e !== undefined ? ctx.src.slice(s, e) : "";
}

function collectReferences(src: string, tree: Root): Ctx {
  const ctx: Ctx = { src, defs: new Map(), linkRefs: new Set(), rawRefs: new Set() };
  const walk = (n: Nodes) => {
    if (n.type === "definition") ctx.defs.set(n.identifier.toLowerCase(), n);
    if (n.type === "linkReference") ctx.linkRefs.add(n.identifier.toLowerCase());
    if (n.type === "imageReference") ctx.rawRefs.add(n.identifier.toLowerCase());
    if ("children" in n) for (const c of n.children) walk(c as Nodes);
  };
  walk(tree);
  return ctx;
}

export function markdownToDoc(md: string): JSONContent {
  const src = md.replace(/\r\n?/g, "\n");
  const tree = parseMarkdown(src);
  const ctx = collectReferences(src, tree);
  const content = blocks(tree.children, ctx);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function blocks(nodes: RootContent[], ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) out.push(...block(n, ctx));
  return out;
}

const isBlankText = (n: PhrasingContent) => n.type === "text" && n.value.trim() === "";
const isImage = (n: PhrasingContent) => n.type === "image";

function block(n: RootContent, ctx: Ctx): JSONContent[] {
  switch (n.type) {
    case "paragraph": {
      const kids = n.children.filter((c) => !isBlankText(c) && c.type !== "break");
      // A paragraph holding only images = block image(s) (how posts place figures).
      if (kids.length > 0 && kids.every(isImage)) {
        return kids.map((c) => {
          const img = c as Extract<PhrasingContent, { type: "image" }>;
          return { type: "image", attrs: { src: img.url, alt: img.alt ?? "", title: img.title ?? null } };
        });
      }
      const inl = inline(n.children, [], ctx);
      return [inl.length ? { type: "paragraph", content: inl } : { type: "paragraph" }];
    }
    case "heading": {
      const inl = inline(n.children, [], ctx);
      return [{ type: "heading", attrs: { level: n.depth }, ...(inl.length ? { content: inl } : {}) }];
    }
    case "thematicBreak":
      return [{ type: "horizontalRule" }];
    case "blockquote": {
      const c = blocks(n.children, ctx);
      return [{ type: "blockquote", content: c.length ? c : [{ type: "paragraph" }] }];
    }
    case "list":
      return [list(n, ctx)];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: n.lang ?? null },
          ...(n.value ? { content: [{ type: "text", text: n.value }] } : {}),
        },
      ];
    case "table":
      return [table(n, ctx)];
    case "definition": {
      // Link references are resolved into plain links, so their definition can
      // go; one used by a verbatim image reference (or by nothing) is kept.
      const id = n.identifier.toLowerCase();
      return ctx.linkRefs.has(id) && !ctx.rawRefs.has(id) ? [] : [{ type: "rawMarkdown", attrs: { value: slice(ctx, n) } }];
    }
    default:
      // html, footnoteDefinition, yaml…: keep the exact source.
      return [{ type: "rawMarkdown", attrs: { value: slice(ctx, n) } }];
  }
}

function list(n: List, ctx: Ctx): JSONContent {
  const task = n.children.length > 0 && n.children.every((i) => typeof i.checked === "boolean");
  const type = task ? "taskList" : n.ordered ? "orderedList" : "bulletList";
  const attrs: Record<string, unknown> = { spread: Boolean(n.spread) };
  if (n.ordered && !task) attrs.start = n.start ?? 1;
  return { type, attrs, content: n.children.map((i) => listItem(i, task, ctx)) };
}

function listItem(i: ListItem, task: boolean, ctx: Ctx): JSONContent {
  const content = blocks(i.children, ctx);
  if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
  const attrs: Record<string, unknown> = { spread: Boolean(i.spread) };
  if (task) attrs.checked = Boolean(i.checked);
  return { type: task ? "taskItem" : "listItem", attrs, content };
}

function table(n: Table, ctx: Ctx): JSONContent {
  const align = n.align ?? [];
  return {
    type: "table",
    content: n.children.map((row, r) => ({
      type: "tableRow",
      content: row.children.map((cell, c) => {
        const inl = inline(cell.children, [], ctx);
        return {
          type: r === 0 ? "tableHeader" : "tableCell",
          attrs: { align: align[c] ?? null },
          content: [inl.length ? { type: "paragraph", content: inl } : { type: "paragraph" }],
        };
      }),
    })),
  };
}

function withMark(marks: Mark[], m: Mark): Mark[] {
  return marks.some((x) => x.type === m.type) ? marks : [...marks, m];
}

function textNode(text: string, marks: Mark[]): JSONContent {
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

function inline(nodes: PhrasingContent[], marks: Mark[], ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text": {
        // Soft line breaks render as whitespace on the site; keep the editor single-flow.
        const t = n.value.replace(/\n/g, " ");
        if (t) out.push(textNode(t, marks));
        break;
      }
      case "strong":
        out.push(...inline(n.children, withMark(marks, { type: "bold" }), ctx));
        break;
      case "emphasis":
        out.push(...inline(n.children, withMark(marks, { type: "italic" }), ctx));
        break;
      case "delete":
        out.push(...inline(n.children, withMark(marks, { type: "strike" }), ctx));
        break;
      case "inlineCode":
        if (n.value) out.push(textNode(n.value, withMark(marks, { type: "code" })));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "link":
        out.push(...inline(n.children, withMark(marks, { type: "link", attrs: { href: n.url, title: n.title ?? null } }), ctx));
        break;
      case "linkReference": {
        const def = ctx.defs.get(n.identifier.toLowerCase());
        if (def) {
          out.push(
            ...inline(n.children, withMark(marks, { type: "link", attrs: { href: def.url, title: def.title ?? null } }), ctx),
          );
        } else {
          out.push({ type: "rawInline", attrs: { value: slice(ctx, n) } });
        }
        break;
      }
      default:
        // image inside text, imageReference, inline html, footnoteReference…
        out.push({ type: "rawInline", attrs: { value: slice(ctx, n) } });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Editor JSON -> Markdown                                             */
/* ------------------------------------------------------------------ */

export function docToMarkdown(doc: JSONContent): string {
  const root: Root = { type: "root", children: toBlocks(doc.content ?? []) as RootContent[] };
  const md = stringifier.stringify(root);
  return md.replace(/\n+$/, "") + "\n";
}

function toBlocks(nodes: JSONContent[]): BlockContent[] {
  const out: BlockContent[] = [];
  for (const n of nodes) {
    const b = toBlock(n);
    if (b) out.push(b);
  }
  return out;
}

function toBlock(n: JSONContent): BlockContent | null {
  const a = n.attrs ?? {};
  switch (n.type) {
    case "paragraph": {
      const children = toPhrasing(n.content ?? []);
      return children.length ? { type: "paragraph", children } : null;
    }
    case "heading": {
      const depth = Math.min(6, Math.max(1, Number(a.level) || 2)) as 1 | 2 | 3 | 4 | 5 | 6;
      return { type: "heading", depth, children: toPhrasing(n.content ?? []) };
    }
    case "blockquote":
      return { type: "blockquote", children: toBlocks(n.content ?? []) };
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const ordered = n.type === "orderedList";
      const l: List = {
        type: "list",
        ordered,
        spread: Boolean(a.spread),
        children: (n.content ?? []).map((i) => toListItem(i, n.type === "taskList")),
      };
      if (ordered) l.start = Number(a.start ?? 1);
      return l;
    }
    case "codeBlock":
      return {
        type: "code",
        lang: (a.language as string | null) || null,
        meta: null,
        value: (n.content ?? []).map((t) => t.text ?? "").join(""),
      };
    case "horizontalRule":
      return { type: "thematicBreak" };
    case "image": {
      const src = String(a.src ?? "");
      // Images still uploading (blob: previews) are not content yet.
      if (!src || src.startsWith("blob:") || a.uploadId) return null;
      const p: Paragraph = {
        type: "paragraph",
        children: [{ type: "image", url: src, alt: String(a.alt ?? ""), title: (a.title as string | null) || null }],
      };
      return p;
    }
    case "table":
      return toTable(n);
    case "rawMarkdown":
      return a.value ? { type: "html", value: String(a.value) } : null;
    default:
      return null;
  }
}

function toListItem(n: JSONContent, task: boolean): ListItem {
  const a = n.attrs ?? {};
  const children = toBlocks(n.content ?? []);
  return {
    type: "listItem",
    spread: Boolean(a.spread),
    checked: task ? Boolean(a.checked) : null,
    children,
  };
}

function toTable(n: JSONContent): Table {
  const rows = n.content ?? [];
  const first = rows[0]?.content ?? [];
  const align = first.map((c) => {
    const v = c.attrs?.align;
    return v === "left" || v === "center" || v === "right" ? v : null;
  });
  const children: TableRow[] = rows.map((row) => ({
    type: "tableRow",
    children: (row.content ?? []).map((cell): TableCell => {
      // GFM cells are single-line: paragraphs joined with a space, hard breaks -> space.
      const parts: PhrasingContent[] = [];
      (cell.content ?? []).forEach((p, i) => {
        const inl = toPhrasing(flattenToInline(p)).map((x) => (x.type === "break" ? ({ type: "text", value: " " } as const) : x));
        if (inl.length === 0) return;
        if (i > 0 && parts.length) parts.push({ type: "text", value: " " });
        parts.push(...inl);
      });
      return { type: "tableCell", children: parts };
    }),
  }));
  return { type: "table", align, children };
}

/** Inline content of a block (lists/quotes inside a cell degrade to their text). */
function flattenToInline(n: JSONContent): JSONContent[] {
  if (n.type === "paragraph" || n.type === "heading") return n.content ?? [];
  if (n.type === "text" || n.type === "hardBreak" || n.type === "rawInline") return [n];
  return (n.content ?? []).flatMap((c, i) => (i > 0 ? [{ type: "text", text: " " }, ...flattenToInline(c)] : flattenToInline(c)));
}

/* ---- inline: flat PM text runs -> nested mdast phrasing ---- */

const MARK_PRIORITY = ["link", "bold", "italic", "strike"];

function markKey(m: Mark): string {
  return m.type === "link" ? `link:${String(m.attrs?.href ?? "")}:${String(m.attrs?.title ?? "")}` : m.type;
}

function hasMark(n: JSONContent, key: string): boolean {
  return (n.marks ?? []).some((m) => markKey(m as Mark) === key);
}

function toPhrasing(nodes: JSONContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const wrapping = ((n.marks ?? []) as Mark[]).filter((m) => m.type !== "code" && MARK_PRIORITY.includes(m.type));
    if (wrapping.length === 0) {
      const leaf = toLeaf(n);
      if (leaf) out.push(leaf);
      i++;
      continue;
    }
    // Open the mark whose run is the longest (ties: link > bold > italic > strike)
    // so `**a *b* c**` nests as strong(a, em(b), c).
    let best = wrapping[0];
    let end = -1;
    for (const m of [...wrapping].sort((x, y) => MARK_PRIORITY.indexOf(x.type) - MARK_PRIORITY.indexOf(y.type))) {
      let j = i;
      while (j < nodes.length && hasMark(nodes[j], markKey(m))) j++;
      if (j > end) {
        best = m;
        end = j;
      }
    }
    const key = markKey(best);
    const inner = nodes
      .slice(i, end)
      .map((x) => ({ ...x, marks: ((x.marks ?? []) as Mark[]).filter((m) => markKey(m) !== key) }));
    const children = toPhrasing(inner);
    out.push(wrap(best, children));
    i = end;
  }
  return mergeText(out);
}

function wrap(m: Mark, children: PhrasingContent[]): PhrasingContent {
  switch (m.type) {
    case "bold":
      return { type: "strong", children };
    case "italic":
      return { type: "emphasis", children };
    case "strike":
      return { type: "delete", children };
    default:
      return {
        type: "link",
        url: String(m.attrs?.href ?? ""),
        title: (m.attrs?.title as string | null) || null,
        children,
      };
  }
}

function toLeaf(n: JSONContent): PhrasingContent | null {
  switch (n.type) {
    case "text":
      if (!n.text) return null;
      return (n.marks ?? []).some((m) => m.type === "code")
        ? { type: "inlineCode", value: n.text }
        : { type: "text", value: n.text };
    case "hardBreak":
      return { type: "break" };
    case "rawInline":
      return n.attrs?.value ? { type: "html", value: String(n.attrs.value) } : null;
    default:
      return null;
  }
}

function mergeText(nodes: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === "text" && prev?.type === "text") prev.value += n.value;
    else out.push(n);
  }
  return out;
}
