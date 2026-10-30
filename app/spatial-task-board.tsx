"use client";
import {useLayoutEffect, useRef, type ReactNode} from "react";

// Stable variation keeps a task's placement from changing on unrelated updates.
function variation(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

export default function SpatialTaskBoard({children}: {children: ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const board = ref.current!;
    let signature = "";
    const layout = () => {
      const cards = Array.from(board.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains("matrix-step"));
      const width = board.clientWidth;
      const next = `${width}|${cards.map(card => `${card.dataset.taskId}:${card.offsetWidth}:${card.offsetHeight}`).join("|")}`;
      if (next === signature || !width) return;
      signature = next;
      if (!cards.length) {board.style.removeProperty("height");return;}
      const available = width - 16;
      const measured = cards.map(card => {
        // Include the full translation and rotation envelope, not just the resting box.
        const safe = 20 + Math.ceil(Math.max(card.offsetWidth, card.offsetHeight) * .012);
        return {card, safe, width: card.offsetWidth + safe * 2, height: card.offsetHeight + safe * 2};
      });
      const rows: typeof measured[] = [];
      let row: typeof measured = [], used = 0;
      for (const item of measured) {
        if (row.length && used + 12 + item.width > available) {rows.push(row);row = [];used = 0;}
        used += (row.length ? 12 : 0) + item.width;
        row.push(item);
      }
      if (row.length) rows.push(row);
      let top = 8;
      for (const row of rows) {
        const key = row.map(item => item.card.dataset.taskId).join(":");
        const height = Math.max(...row.map(item => item.height)) + 28;
        const spare = Math.max(0, available - row.reduce((sum, item) => sum + item.width, 0) - (row.length - 1) * 12);
        const weights = Array.from({length: row.length + 1}, (_, i) => .25 + variation(`${key}:${i}`));
        const total = weights.reduce((a, b) => a + b, 0);
        let left = 8 + spare * weights[0] / total;
        for (const [i, item] of row.entries()) {
          item.card.style.left = `${left + item.safe}px`;
          item.card.style.top = `${top + item.safe + (height - item.height) * variation(`${item.card.dataset.taskId}:y`)}px`;
          left += item.width + 12 + spare * weights[i + 1] / total;
        }
        top += height + 12;
      }
      board.style.height = `${top + 8}px`;
    };
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    const observeCards = () => {
      resize.disconnect();resize.observe(board);
      for (const child of board.children) if (child.classList.contains("matrix-step")) resize.observe(child);
      layout();
    };
    const mutation = new MutationObserver(observeCards);
    mutation.observe(board, {childList:true, subtree:true, characterData:true});
    observeCards();
    return () => {cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();};
  }, []);
  return <div className="goal-list spatial-task-board" ref={ref}>{children}</div>;
}
