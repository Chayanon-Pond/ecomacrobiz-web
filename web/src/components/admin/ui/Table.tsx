import type { ReactNode, TableHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Scrollable table frame. Use plain <thead>/<tbody>/<th scope="col">/<td>
 * inside; `.adm-num` right-aligns numeric cells.
 *   <Table caption="รายชื่อผู้ใช้" minWidth="48rem">…</Table>
 */
export function Table({
  caption,
  minWidth,
  className,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { caption?: ReactNode; minWidth?: string }) {
  return (
    <div className="adm-table-wrap">
      <table className={cx("adm-table", className)} style={minWidth ? { minWidth } : undefined} {...rest}>
        {caption ? <caption className="adm-sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
