"use client";

/**
 * Kanban board (GET leads/board). Drag a card to another column to change its
 * status: optimistic update, PATCH, rollback + toast on error.
 * Input: mouse (6px threshold), touch (long-press 220ms so the page still
 * scrolls), keyboard (focus the grip, Space/Enter to lift, ←/→ jumps between
 * columns, Space/Enter to drop, Esc to cancel). Non-drag alternative: the
 * status menu on every card. Without leads:write the board is read-only.
 */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { Building2, GripVertical, MoreHorizontal, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LEAD_STATUSES } from "@/lib/admin/format";
import { formatRelative } from "@/lib/admin/time";
import type { Lead, LeadBoard, LeadStatus } from "@/lib/admin/types";
import { Badge, LEAD_STATUS_SHORT, LEAD_STATUS_TONE } from "../ui/Badge";
import { cx } from "../ui/cx";
import { Menu } from "../ui/Menu";
import { leadName, userLabel } from "./lead-utils";

const COLUMN_HINT: Record<LeadStatus, string> = {
  new: "ยังไม่ได้ติดต่อกลับ",
  contacted: "ติดต่อไปแล้ว รอผล",
  qualified: "มีโอกาสปิดการขาย",
  closed: "จบงานแล้ว",
  spam: "ไม่ใช่ลูกค้าจริง",
};

/** ←/→ jump to the neighbouring column; ↑/↓ nudge within it. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;
  if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
    event.preventDefault();
    const mid = collisionRect.left + collisionRect.width / 2;
    const rects = droppableContainers
      .getEnabled()
      .map((c) => droppableRects.get(c.id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => a.left - b.left);
    const target =
      event.code === "ArrowRight" ? rects.find((r) => r.left > mid) : [...rects].reverse().find((r) => r.right < mid);
    if (!target) return undefined;
    return { x: target.left + 8, y: target.top + 56 };
  }
  if (event.code === "ArrowDown" || event.code === "ArrowUp") {
    event.preventDefault();
    return { x: collisionRect.left, y: collisionRect.top + (event.code === "ArrowDown" ? 40 : -40) };
  }
  return undefined;
};

function sortNewest(a: Lead, b: Lead) {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/** Pure move used for optimistic updates. */
export function moveInBoard(board: LeadBoard, lead: Lead, to: LeadStatus): LeadBoard {
  const from = lead.status;
  if (from === to) return board;
  const moved = { ...lead, status: to };
  return {
    columns: {
      ...board.columns,
      [from]: board.columns[from].filter((l) => l.id !== lead.id),
      [to]: [moved, ...board.columns[to]].sort(sortNewest),
    },
    counts: {
      ...board.counts,
      [from]: Math.max(0, (board.counts[from] ?? 1) - 1),
      [to]: (board.counts[to] ?? 0) + 1,
    },
  };
}

export function LeadsBoardView({
  board,
  writable,
  onMove,
  onOpen,
}: {
  board: LeadBoard;
  writable: boolean;
  onMove: (lead: Lead, to: LeadStatus) => void;
  onOpen: (id: string) => void;
}) {
  const [dragging, setDragging] = useState<Lead | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );

  const find = (id: string | number) => {
    for (const s of LEAD_STATUSES) {
      const l = board.columns[s]?.find((x) => x.id === id);
      if (l) return l;
    }
    return null;
  };
  const colName = (id: string | number | undefined) => (id ? LEAD_STATUS_SHORT[id as LeadStatus] ?? String(id) : "");

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const l = find(active.id);
      return l ? `หยิบการ์ด ${leadName(l)} จากคอลัมน์ ${colName(l.status)}` : "";
    },
    onDragOver: ({ over }) => (over ? `อยู่เหนือคอลัมน์ ${colName(over.id)}` : "ไม่ได้อยู่เหนือคอลัมน์ใด"),
    onDragEnd: ({ active, over }) => {
      const l = find(active.id);
      return over && l ? `วาง ${leadName(l)} ในคอลัมน์ ${colName(over.id)}` : "ยกเลิกการย้าย";
    },
    onDragCancel: () => "ยกเลิกการย้าย การ์ดกลับที่เดิม",
  };

  function onDragStart(e: DragStartEvent) {
    setDragging(find(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const lead = find(e.active.id);
    const to = e.over?.id as LeadStatus | undefined;
    if (lead && to && to !== lead.status) onMove(lead, to);
  }

  const columns = (
    <div className="adm-board" role="list" aria-label="บอร์ด Leads ตามสถานะ">
      {LEAD_STATUSES.map((s) => (
        <Column
          key={s}
          status={s}
          leads={board.columns[s] ?? []}
          count={board.counts[s] ?? 0}
          writable={writable}
          onMove={onMove}
          onOpen={onOpen}
          draggingId={dragging?.id ?? null}
        />
      ))}
    </div>
  );

  if (!writable) return columns;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "กด Space หรือ Enter เพื่อหยิบการ์ด ใช้ลูกศรซ้าย/ขวาเพื่อย้ายไปคอลัมน์อื่น กด Space หรือ Enter อีกครั้งเพื่อวาง หรือ Esc เพื่อยกเลิก หรือใช้ปุ่มเปลี่ยนสถานะบนการ์ดแทนได้",
        },
      }}
    >
      {columns}
      <DragOverlay dropAnimation={null}>{dragging ? <CardBody lead={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  leads,
  count,
  writable,
  onMove,
  onOpen,
  draggingId,
}: {
  status: LeadStatus;
  leads: Lead[];
  count: number;
  writable: boolean;
  onMove: (lead: Lead, to: LeadStatus) => void;
  onOpen: (id: string) => void;
  draggingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !writable });
  const headingId = `board-col-${status}`;
  return (
    <section ref={setNodeRef} className="adm-board-col" data-over={isOver || undefined} aria-labelledby={headingId} role="listitem">
      <header className="adm-board-col-head">
        <Badge tone={LEAD_STATUS_TONE[status]} dot>
          <span id={headingId}>{LEAD_STATUS_SHORT[status]}</span>
        </Badge>
        <span className="text-xs tabular-nums text-muted" aria-label={`${count} รายการ`}>
          {count.toLocaleString("th-TH")}
        </span>
      </header>
      <p className="px-3 pb-2 text-xs text-subtle">{COLUMN_HINT[status]}</p>
      <ul className="adm-board-list" aria-labelledby={headingId}>
        {leads.length === 0 ? (
          <li className="adm-board-empty">{writable ? "ลากการ์ดมาวางที่นี่" : "ไม่มีรายการ"}</li>
        ) : (
          leads.map((l) => (
            <li key={l.id}>
              {writable ? (
                <DraggableCard lead={l} onMove={onMove} onOpen={onOpen} hidden={draggingId === l.id} />
              ) : (
                <CardBody lead={l} onOpen={onOpen} />
              )}
            </li>
          ))
        )}
        {count > leads.length ? (
          <li className="px-1 pt-1 text-center text-xs text-muted">
            แสดง {leads.length} จาก {count.toLocaleString("th-TH")} — ใช้มุมมองตารางเพื่อดูทั้งหมด
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function DraggableCard({
  lead,
  onMove,
  onOpen,
  hidden,
}: {
  lead: Lead;
  onMove: (lead: Lead, to: LeadStatus) => void;
  onOpen: (id: string) => void;
  hidden: boolean;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({ id: lead.id });
  // Pointer/touch start anywhere on the card; keyboard only from the grip.
  const { onKeyDown, ...pointer } = (listeners ?? {}) as Record<string, (e: unknown) => void>;
  return (
    <CardBody
      lead={lead}
      onOpen={onOpen}
      cardRef={setNodeRef}
      cardProps={pointer}
      ghost={hidden}
      grip={
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="adm-board-grip"
          {...attributes}
          aria-roledescription="การ์ดที่ลากได้"
          aria-label={`ย้าย ${leadName(lead)}`}
          onKeyDown={onKeyDown as never}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      }
      menu={
        <Menu
          label={`เปลี่ยนสถานะของ ${leadName(lead)}`}
          trigger={(p) => (
            <button type="button" className="adm-icon-btn" data-size="sm" {...p} aria-label={`เปลี่ยนสถานะ ${leadName(lead)}`}>
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          )}
          items={[
            { type: "label", label: "ย้ายไปสถานะ" },
            ...LEAD_STATUSES.map((s) => ({
              label: LEAD_STATUS_SHORT[s],
              checked: s === lead.status,
              onSelect: () => s !== lead.status && onMove(lead, s),
            })),
          ]}
        />
      }
    />
  );
}

function CardBody({
  lead,
  onOpen,
  cardRef,
  cardProps,
  grip,
  menu,
  overlay,
  ghost,
}: {
  lead: Lead;
  onOpen?: (id: string) => void;
  cardRef?: (el: HTMLElement | null) => void;
  cardProps?: Record<string, unknown>;
  grip?: ReactNode;
  menu?: ReactNode;
  overlay?: boolean;
  ghost?: boolean;
}) {
  return (
    <article
      ref={cardRef}
      className={cx("adm-board-card", overlay && "adm-board-card-overlay", ghost && "opacity-40")}
      {...cardProps}
    >
      <div className="flex items-start gap-1.5">
        {grip}
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <button type="button" className="adm-board-title" onClick={() => onOpen(lead.id)}>
              {leadName(lead)}
            </button>
          ) : (
            <p className="adm-board-title">{leadName(lead)}</p>
          )}
          {lead.company ? (
            <p className="flex items-center gap-1 truncate text-xs text-muted">
              <Building2 size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{lead.company}</span>
            </p>
          ) : null}
        </div>
        {menu}
      </div>
      {lead.message ? <p className="mt-2 line-clamp-2 text-xs text-muted">{lead.message}</p> : null}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-subtle">
        <span className="flex min-w-0 items-center gap-1">
          <UserRound size={12} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{userLabel(lead.assigned_to)}</span>
        </span>
        <time dateTime={lead.created_at} className="shrink-0">
          {formatRelative(lead.created_at)}
        </time>
      </div>
    </article>
  );
}
