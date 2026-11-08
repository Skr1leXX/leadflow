import { StatusBadge } from "./status-badge";

/** Marks outcomes that came from the built-in demo client, so they are never mistaken for a real portal's answer. */
export function DemoTag() {
  return <StatusBadge tone="neutral">демо</StatusBadge>;
}
