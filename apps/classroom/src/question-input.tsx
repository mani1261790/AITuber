import { useLayoutEffect, useRef } from "react";

export function QuestionInput({ value, onChange, sending }: { value: string; onChange(value: string): void; sending: boolean }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      const height = Math.min(132, Math.max(36, input.scrollHeight));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > 132 ? "auto" : "hidden";
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value]);

  return <div className="chat-input">
    <textarea ref={inputRef} aria-label="質問" placeholder="質問を入力…" rows={1} maxLength={1000} value={value} onChange={event => onChange(event.target.value)} />
    <button type="submit" aria-label="質問を送る" disabled={sending || !value.trim()}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 18V6m-5 5 5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  </div>;
}
