import type { Editor } from "@tiptap/core";
import {
  Code2,
  Heading2,
  Heading3,
  Heading4,
  ImagePlus,
  Images,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  type LucideIcon,
} from "lucide-react";

export type BlockAction = "upload-image" | "library-image";

export type BlockItem = {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Extra search terms (Thai + English + markdown syntax). */
  keywords: string;
  run: (editor: Editor) => void | BlockAction;
};

export const BLOCK_ITEMS: BlockItem[] = [
  {
    key: "p",
    label: "ข้อความ",
    hint: "ย่อหน้าธรรมดา",
    icon: Pilcrow,
    keywords: "paragraph text ย่อหน้า",
    run: (e) => void e.chain().focus().setParagraph().run(),
  },
  {
    key: "h2",
    label: "หัวข้อใหญ่",
    hint: "H2 · ##",
    icon: Heading2,
    keywords: "heading h2 title หัวข้อ",
    run: (e) => void e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    key: "h3",
    label: "หัวข้อย่อย",
    hint: "H3 · ###",
    icon: Heading3,
    keywords: "heading h3 subtitle หัวข้อ",
    run: (e) => void e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    key: "h4",
    label: "หัวข้อย่อยระดับ 3",
    hint: "H4 · ####",
    icon: Heading4,
    keywords: "heading h4 หัวข้อ",
    run: (e) => void e.chain().focus().setHeading({ level: 4 }).run(),
  },
  {
    key: "ul",
    label: "รายการแบบจุด",
    hint: "- ",
    icon: List,
    keywords: "bullet list ul รายการ",
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  {
    key: "ol",
    label: "รายการแบบตัวเลข",
    hint: "1. ",
    icon: ListOrdered,
    keywords: "ordered numbered list ol รายการ ลำดับ",
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "task",
    label: "รายการสิ่งที่ต้องทำ",
    hint: "[ ] ",
    icon: ListChecks,
    keywords: "task todo checklist checkbox เช็กลิสต์",
    run: (e) => void e.chain().focus().toggleTaskList().run(),
  },
  {
    key: "quote",
    label: "ข้อความอ้างอิง",
    hint: "> ",
    icon: Quote,
    keywords: "quote blockquote อ้างอิง คำพูด",
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: "code",
    label: "บล็อกโค้ด",
    hint: "```",
    icon: Code2,
    keywords: "code codeblock pre โค้ด",
    run: (e) => void e.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "table",
    label: "ตาราง",
    hint: "3 × 3 มีหัวตาราง",
    icon: TableIcon,
    keywords: "table grid ตาราง",
    run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    key: "hr",
    label: "เส้นคั่น",
    hint: "---",
    icon: Minus,
    keywords: "divider hr horizontal rule separator เส้น",
    run: (e) => void e.chain().focus().setHorizontalRule().run(),
  },
  {
    key: "image",
    label: "อัปโหลดรูปภาพ",
    hint: "JPEG, PNG, WebP, AVIF, GIF",
    icon: ImagePlus,
    keywords: "image picture photo upload รูป ภาพ",
    run: () => "upload-image",
  },
  {
    key: "library",
    label: "แทรกจากคลังสื่อ",
    hint: "เลือกรูปที่อัปโหลดไว้แล้ว",
    icon: Images,
    keywords: "media library image รูป คลัง",
    run: () => "library-image",
  },
];

export function filterBlocks(query: string): BlockItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_ITEMS;
  return BLOCK_ITEMS.filter((b) => `${b.label} ${b.hint} ${b.keywords}`.toLowerCase().includes(q));
}
