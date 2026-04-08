import React from "react";
import { FF, MONO } from "./constants";
import { WorkflowIDEStartup } from "./WorkflowIDEStartup";

const code = [
  [1, "from fastapi import FastAPI, BackgroundTasks", "#d4d4d4"],
  [2, "from supabase import create_client", "#d4d4d4"],
  [3, "import asyncio, json, os", "#d4d4d4"],
  [4, "", "#d4d4d4"],
  [5, "app = FastAPI()", "#d4d4d4"],
  [6, 'supabase = create_client(os.environ["SUPABASE_URL"],', "#d4d4d4"],
  [7, '                         os.environ["SUPABASE_KEY"])', "#d4d4d4"],
  [8, "", "#d4d4d4"],
  [9, '@app.post("/ingest")', "#4ec9b0"],
  [10, "async def ingest_edit(edit: EditPayload, bg: BackgroundTasks):", "#dcdcaa"],
  [11, "    bg.add_task(enrich_and_store, edit)", "#d4d4d4"],
  [12, '    return {"ok": True}', "#d4d4d4"],
] as const;

interface Props {
  opacity: number;
  translateY: number;
  scale: number;
  showStartup: boolean;
  startupLocalFrame: number;
  startupPasted: boolean;
  startupResponseDone: boolean;
  postCopied: boolean;
  startupResponseText: string;
  startupShowCursor: boolean;
}

export const WorkflowAIPanel: React.FC<Props> = ({
  opacity,
  translateY,
  scale,
  showStartup,
  startupLocalFrame,
  startupPasted,
  startupResponseDone,
  postCopied,
  startupResponseText,
  startupShowCursor,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      backgroundColor: "#1e1e1e",
      opacity,
      display: "flex",
      flexDirection: "column",
      transform: `translateY(${translateY}px) scale(${scale})`,
      transformOrigin: "989px 1033px",
    }}
  >
    <div style={{ height: 36, backgroundColor: "#323233", display: "flex", alignItems: "center", padding: "0 14px", gap: 7 }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: c }} />)}
      <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", fontFamily: FF, color: "#cccccc", fontSize: 12 }}>
        wikipedia-globe-dashboard - Visual Studio Code
      </span>
    </div>

    <div style={{ display: "flex", flex: 1 }}>
      <div style={{ width: 48, background: "#333", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingTop: 8 }}>
        {["#cccccc", "#6e6e6e", "#6e6e6e", "#6e6e6e"].map((c, i) => <div key={i} style={{ width: 18, height: 18, borderRadius: 4, border: `1px solid ${c}` }} />)}
      </div>

      <div style={{ width: 195, backgroundColor: "#252526", borderRight: "1px solid #3c3c3c", fontFamily: FF, fontSize: 13 }}>
        <div style={{ fontSize: 11, color: "#bbbbbe", letterSpacing: "0.08em", textTransform: "uppercase", padding: "10px 12px 4px" }}>EXPLORER</div>
        {["v wikipedia-globe", "v src", "main.py", "ingest.py", "worker.js", "schema.sql", "v frontend", "globe.tsx", "hooks.ts", "package.json", ".env.example"].map((row) => (
          <div key={row} style={{ color: row === "main.py" ? "#fff" : "#9d9d9d", backgroundColor: row === "main.py" ? "#094771" : "transparent", padding: row.startsWith("v ") ? "3px 14px" : row.endsWith(".tsx") || row.endsWith(".py") || row.endsWith(".js") || row.endsWith(".sql") ? "3px 30px" : "3px 18px" }}>
            {row}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: 35, borderBottom: "1px solid #3c3c3c", background: "#2d2d2d", display: "flex" }}>
          <div style={{ background: "#1e1e1e", color: "#fff", borderTop: "1px solid #0078d4", padding: "0 16px", display: "flex", alignItems: "center", fontSize: 13, fontFamily: FF }}>main.py</div>
          <div style={{ color: "#9d9d9d", padding: "0 16px", display: "flex", alignItems: "center", fontSize: 13, fontFamily: FF }}>ingest.py</div>
        </div>

        <div style={{ height: 238, background: "#1e1e1e", display: "flex" }}>
          <div style={{ width: 40, paddingTop: 10, color: "#5a5a5a", textAlign: "right", paddingRight: 8, fontSize: 12, fontFamily: MONO }}>
            {code.map(([n]) => <div key={n} style={{ height: 19 }}>{n}</div>)}
          </div>
          <div style={{ paddingTop: 10, fontFamily: MONO, fontSize: 13 }}>
            {code.map(([n, t, c]) => <div key={n} style={{ height: 19, color: c as string, whiteSpace: "pre" }}>{t}</div>)}
          </div>
        </div>

        <div style={{ flex: 1, borderTop: "2px solid #3c3c3c", background: "#1e1e1e", display: "flex", flexDirection: "column" }}>
          <div style={{ height: 32, backgroundColor: "#252526", display: "flex", alignItems: "center", gap: 20, padding: "0 12px", fontFamily: FF, fontSize: 11 }}>
            <span style={{ color: "#fff", borderBottom: "1px solid #fff" }}>TERMINAL</span>
            <span style={{ color: "#9d9d9d" }}>OUTPUT</span>
            <span style={{ color: "#9d9d9d" }}>DEBUG CONSOLE</span>
          </div>

          <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
            {showStartup && (
              <WorkflowIDEStartup
                localFrame={startupLocalFrame}
                startupPasted={startupPasted}
                responseDone={startupResponseDone}
                postCopied={postCopied}
                responseText={startupResponseText}
                showResponseCursor={startupShowCursor}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);
