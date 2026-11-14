/**
 * Editor schema shared by the admin block editor and the round-trip script
 * (scripts/verify-markdown-roundtrip.mts). No React here so it runs in Node.
 *
 * Every node maps 1:1 onto an mdast node (see markdown.ts); storage stays
 * Markdown. Constructs the editor cannot model are kept verbatim in the
 * `rawMarkdown` (block) / `rawInline` (inline) atoms instead of being lost.
 */
import { Extension, Node, mergeAttributes, textblockTypeInputRule, type AnyExtension } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import Heading from "@tiptap/extension-heading";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/** H1 is the post title; the UI offers H2–H4. H1/H5/H6 already in a body are kept. */
export const UI_HEADING_LEVELS = [2, 3, 4] as const;

const MdHeading = Heading.extend({
  addInputRules() {
    return UI_HEADING_LEVELS.map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{2,${level}})\\s$`),
        type: this.type,
        getAttributes: { level },
      }),
    );
  },
  addKeyboardShortcuts() {
    const out: Record<string, () => boolean> = {};
    for (const level of UI_HEADING_LEVELS) {
      out[`Mod-Alt-${level}`] = () => this.editor.commands.toggleHeading({ level });
    }
    return out;
  },
}).configure({ levels: [1, 2, 3, 4, 5, 6] });

/** Markdown allows `[`code`](url)` and `**`code`**`, so code may share marks. */
const MdCode = Code.extend({ excludes: "" });

/**
 * Block image. `title` is stored verbatim because the site uses it for
 * dimensions + caption: `![alt](src "1200x800 Caption")` (Markdown.tsx).
 */
export const ImageBlock = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      title: { default: null },
      // In-flight upload (blob: preview). Never rendered or serialized.
      uploadId: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },
});

/** Block Markdown the editor cannot model (raw HTML, footnote definitions…), kept verbatim. */
export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { value: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "pre[data-raw-markdown]", getAttrs: (el) => ({ value: (el as HTMLElement).textContent ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["pre", { "data-raw-markdown": "", class: "ed-raw", contenteditable: "false" }, node.attrs.value as string];
  },
});

/** Inline counterpart (inline HTML, footnote references, images inside text…). */
export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { value: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "code[data-raw-inline]", getAttrs: (el) => ({ value: (el as HTMLElement).textContent ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["code", { "data-raw-inline": "", class: "ed-raw-inline", contenteditable: "false" }, node.attrs.value as string];
  },
});

/** Markdown-only attributes: loose/tight lists and GFM column alignment. */
const MarkdownAttrs = Extension.create({
  name: "markdownAttrs",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList", "taskList", "listItem", "taskItem"],
        attributes: { spread: { default: false, rendered: false, keepOnSplit: true } },
      },
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: (el) => {
              const a = (el as HTMLElement).style.textAlign;
              return a === "left" || a === "center" || a === "right" ? a : null;
            },
            renderHTML: (attrs) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
          },
        },
      },
    ];
  },
});

export const LINK_PROTOCOLS = ["http", "https", "mailto", "tel"];

export function baseExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: false,
      code: false,
      underline: false, // not representable in Markdown
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        protocols: LINK_PROTOCOLS,
        HTMLAttributes: { rel: null, target: null, class: null },
      },
    }),
    MdHeading,
    MdCode,
    ImageBlock,
    RawMarkdown,
    RawInline,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    MarkdownAttrs,
  ];
}
