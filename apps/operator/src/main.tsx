import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function OperatorApp() {
  return (
    <main className="shell">
      <p className="eyebrow">AITuber Operator</p>
      <h1>講義を作成・開始</h1>
      <p>教材生成と授業運営の画面を、この入口から実装します。</p>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Operator root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <OperatorApp />
  </StrictMode>,
);
