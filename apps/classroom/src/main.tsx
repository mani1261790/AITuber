import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function ClassroomApp() {
  return (
    <main className="shell">
      <p className="eyebrow">AITuber Classroom</p>
      <h1>講義の準備中です</h1>
      <p>教室コードを受け取ると、ここに教材、字幕、板書が表示されます。</p>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Classroom root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <ClassroomApp />
  </StrictMode>,
);
