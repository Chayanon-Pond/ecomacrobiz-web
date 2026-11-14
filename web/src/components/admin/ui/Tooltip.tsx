import { useId, type ReactNode } from "react";

/**
 * CSS tooltip shown on hover and keyboard focus (hidden on touch devices).
 * `decorative`: the text duplicates an aria-label already on the child, so
 * the bubble is hidden from assistive tech. Otherwise the bubble is a
 * role=tooltip referenced by aria-describedby on the wrapper.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  decorative,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
  decorative?: boolean;
}) {
  const id = useId();
  return (
    <span className="adm-tip" data-side={side} aria-describedby={decorative ? undefined : id}>
      {children}
      <span
        className="adm-tip-bubble"
        id={id}
        role={decorative ? undefined : "tooltip"}
        aria-hidden={decorative || undefined}
      >
        {content}
      </span>
    </span>
  );
}
