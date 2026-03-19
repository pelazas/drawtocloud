import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { WorkflowAIPanel } from "./WorkflowAIPanel";
import { WorkflowFormCards } from "./WorkflowFormCards";
import { WorkflowFormHeader } from "./WorkflowFormHeader";
import { useWorkflowAnimation } from "./useWorkflowAnimation";

const cursorPath = "M4 2 L4 18 L8 14 L12 22 L14 21 L10 13 L16 13 Z";
const CURSOR_TIP_X = 4;
const CURSOR_TIP_Y = 2;

export const SceneWorkflow: React.FC = () => {
  const a = useWorkflowAnimation();

  const cursorX = interpolate(a.cursorProgress, [0, 1], [1200, 800], {
    easing: Easing.inOut(Easing.quad),
  });
  const cursorY = interpolate(a.cursorProgress, [0, 1], [580, 320], {
    easing: Easing.inOut(Easing.quad),
  });

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 50% 0%, rgb(15,23,42) 0%, rgb(2,4,12) 70%)",
        overflow: "hidden",
        opacity: a.sceneOpacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: "flex",
          justifyContent: "center",
          paddingTop: 56,
          paddingBottom: 64,
          transform: `translateY(${a.scrollY + a.formReturnTranslateY}px)`,
          opacity: a.formOpacity,
          background: "radial-gradient(ellipse at 50% 0%, rgb(15,23,42) 0%, rgb(2,4,12) 70%)",
        }}
      >
        <div style={{ width: 700, display: "flex", flexDirection: "column", gap: 20 }}>
          <WorkflowFormHeader
            description={a.description}
            aiHelperProgress={a.aiHelperProgress}
            copyConfirmed={a.copyConfirmed}
          />
          <WorkflowFormCards
            selectedUsers={a.selectedUsers}
            selectedUptime={a.selectedUptime}
            budget={a.budget}
            generateScale={a.generateScale}
            isGenerating={a.isGenerating}
            spinAngle={a.spinAngle}
          />
        </div>
      </div>

      <WorkflowAIPanel
        opacity={a.aiPanelOpacity}
        translateY={a.aiPanelTranslateY}
        scale={a.aiPanelScale}
        showStartup={a.showStartup}
        startupLocalFrame={a.startupLocalFrame}
        startupPasted={a.startupPasted}
        startupResponseDone={a.startupResponseDone}
        postCopied={a.postCopied}
        startupResponseText={a.responseText}
        startupShowCursor={a.showAICursor}
      />

      {a.showDock && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 14,
            transform: `translate(-50%, ${interpolate(a.dockProgress, [0, 1], [90, 0])}px)`,
            opacity: a.dockProgress,
            borderRadius: 22,
            padding: "10px 12px",
            backgroundColor: "rgba(17,24,39,0.75)",
            border: "1px solid rgba(148,163,184,0.25)",
            boxShadow: "0 14px 36px rgba(0,0,0,0.45)",
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "conic-gradient(#ea4335 0 90deg, #fbbc04 90deg 180deg, #34a853 180deg 300deg, #ea4335 300deg 360deg)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", inset: 10, borderRadius: "50%", backgroundColor: "white" }} />
            <div style={{ position: "absolute", inset: 15, borderRadius: "50%", backgroundColor: "#4285f4" }} />
          </div>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              backgroundColor: "#1f2937",
              display: "grid",
              placeItems: "center",
              transform: `scale(${a.vscodeIconScale})`,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28">
              <path d="M22 3.5L12 11.5L7.5 8L4.5 10.5L9.5 14L4.5 17.5L7.5 20L12 16.5L22 24.5V3.5Z" fill="#1f9cf0" />
              <path d="M22 3.5L12 11.5V16.5L22 24.5V3.5Z" fill="#0f7ac6" />
            </svg>
          </div>
        </div>
      )}

      {a.showIntroCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.introCursorX,
            top: a.introCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.introCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showStartupCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.startupCursorX,
            top: a.startupCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.startupCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showStartupClaudeCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.startupClaudeCursorX,
            top: a.startupClaudeCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.startupClaudeCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showMouseCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: cursorX,
            top: cursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.mouseClick})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showPostCopyCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.postCopyCursorX,
            top: a.postCopyCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.postCopyCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showPostDock && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 14,
            transform: `translate(-50%, ${interpolate(a.postDockProgress, [0, 1], [90, 0])}px)`,
            opacity: a.postDockProgress,
            borderRadius: 22,
            padding: "10px 12px",
            backgroundColor: "rgba(17,24,39,0.75)",
            border: "1px solid rgba(148,163,184,0.25)",
            boxShadow: "0 14px 36px rgba(0,0,0,0.45)",
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "conic-gradient(#ea4335 0 90deg, #fbbc04 90deg 180deg, #34a853 180deg 300deg, #ea4335 300deg 360deg)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", inset: 10, borderRadius: "50%", backgroundColor: "white" }} />
            <div style={{ position: "absolute", inset: 15, borderRadius: "50%", backgroundColor: "#4285f4" }} />
          </div>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              backgroundColor: "#1f2937",
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28">
              <path d="M22 3.5L12 11.5L7.5 8L4.5 10.5L9.5 14L4.5 17.5L7.5 20L12 16.5L22 24.5V3.5Z" fill="#1f9cf0" />
              <path d="M22 3.5L12 11.5V16.5L22 24.5V3.5Z" fill="#0f7ac6" />
            </svg>
          </div>
        </div>
      )}

      {a.showPostDockCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.postDockCursorX,
            top: a.postDockCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.postDockCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showReturnCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.returnCursorX,
            top: a.returnCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.returnCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showTractionCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.tractionCursorX,
            top: a.tractionCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.tractionCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showUptimeCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.uptimeCursorX,
            top: a.uptimeCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.uptimeCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

      {a.showBudgetCursor && (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: a.budgetCursorX,
            top: a.budgetCursorY,
            transform: `translate(${-CURSOR_TIP_X}px, ${-CURSOR_TIP_Y}px) scale(${a.budgetCursorScale})`,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
            pointerEvents: "none",
          }}
        >
          <path d={cursorPath} fill="white" stroke="#333" strokeWidth="1" />
        </svg>
      )}

    </AbsoluteFill>
  );
};
