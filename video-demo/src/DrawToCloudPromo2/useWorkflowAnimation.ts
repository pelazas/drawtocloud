import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { AI_RESPONSE } from "./constants";

export const useWorkflowAnimation = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const STARTUP_START = 172;
  const startupFrame = frame - STARTUP_START;
  const STARTUP_PASTE_AT = 95; // 25 frames after Claude block appears at local 70
  const THINKING_DELAY = 20;
  const THINKING_DURATION = 80;
  const RESPONSE_START = STARTUP_START + STARTUP_PASTE_AT + THINKING_DELAY + THINKING_DURATION;
  // SceneWorkflow starts at global frame 90, so local 590 ~= global 680.
  const RETURN_TO_FORM_START = 590;
  const RETURN_TO_FORM_END = 596; // faster rise

  const sceneOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const panelSpring = spring({
    frame: frame - 34,
    fps,
    config: { damping: 28, stiffness: 120 },
    durationInFrames: 28,
  });
  const aiHelperOpen = frame >= 34 && frame < 504;
  const aiHelperProgress = aiHelperOpen ? panelSpring : 0;

  const copyConfirmed = frame >= 74 && frame < 188;

  const formOpacity = frame < 166 ? 1 : frame < RETURN_TO_FORM_START ? 0 : 1;
  const formReturnTranslateY = frame >= RETURN_TO_FORM_START
    ? interpolate(frame, [RETURN_TO_FORM_START, RETURN_TO_FORM_END], [980, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 0;
  // Keep IDE visible behind while DrawToCloud window rises, then hide it once covered.
  const aiPanelOpacity = frame < 166 ? 0 : frame < RETURN_TO_FORM_END ? 1 : 0;
  const aiPanelTranslateY = interpolate(frame, [166, 172], [860, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const aiPanelScale = interpolate(frame, [166, 172], [0.2, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const showStartup = startupFrame >= 0 && startupFrame < 488;
  const startupLocalFrame = startupFrame;

  // Faster by request: 25-frame move for this cursor section.
  const startupCursorX = interpolate(startupFrame, [8, 33], [989, 344], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const startupCursorY = interpolate(startupFrame, [8, 33], [1033, 366], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const startupCursorScale = startupFrame >= 33 && startupFrame <= 37
    ? interpolate(startupFrame, [33, 35, 37], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showStartupCursor = startupFrame >= 8 && startupFrame <= 37;

  const startupClaudeCursorX = 0;
  const startupClaudeCursorY = 0;
  const startupClaudeCursorScale = 1;
  const showStartupClaudeCursor = false;
  const startupPasted = startupFrame >= STARTUP_PASTE_AT;

  const promptOpacity = interpolate(frame, [RESPONSE_START, RESPONSE_START + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const responseLen = Math.floor(
    interpolate(frame, [RESPONSE_START, RESPONSE_START + 120], [0, AI_RESPONSE.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  const responseText = AI_RESPONSE.slice(0, responseLen);
  const showAICursor = frame >= RESPONSE_START && frame < RESPONSE_START + 122;
  const startupResponseDone = frame >= RESPONSE_START + 120;
  // Global anchors requested by user:
  // Global 578 => local 488 (SceneWorkflow starts at global 90)
  // Global 700 => local 610
  const postSeqStart = 488;
  // Post-response copy click target (clipboard icon, left side above "Brewed for 47s").
  // Tune these two values to align the cursor tip exactly with the icon.
  const POST_COPY_TARGET_X = 267;
  const POST_COPY_TARGET_Y = 805;
  const postCopyMoveStart = postSeqStart + 2;
  const postCopyMoveEnd = postSeqStart + 22; // slower than before (was +14)
  const postCopyClickStart = postCopyMoveEnd;
  const postCopyClickMid = postCopyMoveEnd + 2;
  const postCopyClickEnd = postCopyMoveEnd + 4;
  const postCopyCursorEnd = postCopyMoveEnd + 10;
  const selectionFraction = interpolate(frame, [RESPONSE_START + 120, RESPONSE_START + 140], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showCopiedAI = false;

  const postCopyCursorX = interpolate(frame, [postCopyMoveStart, postCopyMoveEnd], [980, POST_COPY_TARGET_X], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const postCopyCursorY = interpolate(frame, [postCopyMoveStart, postCopyMoveEnd], [700, POST_COPY_TARGET_Y], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const postCopyCursorScale = frame >= postCopyClickStart && frame <= postCopyClickEnd
    ? interpolate(frame, [postCopyClickStart, postCopyClickMid, postCopyClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showPostCopyCursor = frame >= postCopyMoveStart && frame <= postCopyCursorEnd;
  const postCopied = frame >= postCopyClickEnd;

  // 100-frame transition after copy click: cursor to bottom -> dock -> chrome click -> app launch.
  // Start immediately after post-copy cursor phase so there is no cursor disappearance gap.
  const transitionStart = postCopyCursorEnd + 1; // global ~611
  const transitionEnd = transitionStart + 100;
  const moveToBottomStart = transitionStart;
  const moveToBottomEnd = moveToBottomStart + 40; // requested: 40 frames
  const bottomHoldEnd = moveToBottomEnd + 5; // requested: wait 5 frames at bottom
  const dockAppearStart = bottomHoldEnd;
  const dockAppearEnd = dockAppearStart + 8;
  const moveToChromeStart = dockAppearEnd;
  const moveToChromeEnd = moveToChromeStart + 16;
  const chromeClickStart = moveToChromeEnd;
  const chromeClickMid = chromeClickStart + 2;
  const chromeClickEnd = chromeClickStart + 4;
  const CHROME_ICON_X = 932;
  const CHROME_ICON_Y = 1033;
  const DESC_BOX_X = 700;
  const DESC_BOX_Y = 300;

  const postDockCursorX = frame < moveToBottomEnd
    ? interpolate(frame, [moveToBottomStart, moveToBottomEnd], [POST_COPY_TARGET_X, 960], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : frame < moveToChromeStart
      ? 960
      : interpolate(frame, [moveToChromeStart, moveToChromeEnd], [960, CHROME_ICON_X], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const postDockCursorY = frame < moveToBottomEnd
    ? interpolate(frame, [moveToBottomStart, moveToBottomEnd], [POST_COPY_TARGET_Y, 1076], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : frame < moveToChromeStart
      ? 1076
      : interpolate(frame, [moveToChromeStart, moveToChromeEnd], [1076, CHROME_ICON_Y], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const postDockCursorScale = frame >= chromeClickStart && frame <= chromeClickEnd
    ? interpolate(frame, [chromeClickStart, chromeClickMid, chromeClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showPostDockCursor = frame >= moveToBottomStart && frame <= chromeClickEnd;

  const postDockProgress = interpolate(frame, [dockAppearStart, dockAppearEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showPostDock = frame >= dockAppearStart && frame <= transitionEnd;

  // After clicking Chrome: move to description box, click, and paste AI response.
  const returnCursorMoveStart = chromeClickEnd + 1;
  const returnCursorMoveEnd = returnCursorMoveStart + 18;
  const returnCursorClickStart = returnCursorMoveEnd;
  const returnCursorClickMid = returnCursorClickStart + 2;
  const returnCursorClickEnd = returnCursorClickStart + 4;
  const returnPasteDelay = 20;
  const returnCursorX = interpolate(frame, [returnCursorMoveStart, returnCursorMoveEnd], [CHROME_ICON_X, DESC_BOX_X], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const returnCursorY = interpolate(frame, [returnCursorMoveStart, returnCursorMoveEnd], [CHROME_ICON_Y, DESC_BOX_Y], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const returnCursorScale = frame >= returnCursorClickStart && frame <= returnCursorClickEnd
    ? interpolate(frame, [returnCursorClickStart, returnCursorClickMid, returnCursorClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showReturnCursor = frame >= returnCursorMoveStart && frame <= returnCursorClickEnd + returnPasteDelay + 6;

  // Global 750 => local 660 (SceneWorkflow starts at global 90).
  // Move from description box to "Early Traction", click, then select it.
  const tractionMoveStart = 660;
  const tractionMoveEnd = tractionMoveStart + 16;
  const tractionClickStart = tractionMoveEnd;
  const tractionClickMid = tractionClickStart + 2;
  const tractionClickEnd = tractionClickStart + 4;
  const EARLY_TRACTION_X = 980;
  const EARLY_TRACTION_Y = 515;
  const tractionCursorX = frame < tractionMoveStart
    ? DESC_BOX_X
    : interpolate(frame, [tractionMoveStart, tractionMoveEnd], [DESC_BOX_X, EARLY_TRACTION_X], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const tractionCursorY = frame < tractionMoveStart
    ? DESC_BOX_Y
    : interpolate(frame, [tractionMoveStart, tractionMoveEnd], [DESC_BOX_Y, EARLY_TRACTION_Y], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const tractionCursorScale = frame >= tractionClickStart && frame <= tractionClickEnd
    ? interpolate(frame, [tractionClickStart, tractionClickMid, tractionClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showTractionCursor = frame >= returnCursorClickEnd + returnPasteDelay && frame <= tractionClickEnd + 8;

  // Global 780 => local 690. Move to "High Availability", click, then select it.
  const uptimeMoveStart = 690;
  const uptimeMoveEnd = uptimeMoveStart + 16;
  const uptimeClickStart = uptimeMoveEnd;
  const uptimeClickMid = uptimeClickStart + 2;
  const uptimeClickEnd = uptimeClickStart + 4;
  const HIGH_AVAIL_X = 700;
  const HIGH_AVAIL_Y = 900;
  const uptimeCursorX = frame < uptimeMoveStart
    ? EARLY_TRACTION_X
    : interpolate(frame, [uptimeMoveStart, uptimeMoveEnd], [EARLY_TRACTION_X, HIGH_AVAIL_X], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const uptimeCursorY = frame < uptimeMoveStart
    ? EARLY_TRACTION_Y
    : interpolate(frame, [uptimeMoveStart, uptimeMoveEnd], [EARLY_TRACTION_Y, HIGH_AVAIL_Y], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const uptimeCursorScale = frame >= uptimeClickStart && frame <= uptimeClickEnd
    ? interpolate(frame, [uptimeClickStart, uptimeClickMid, uptimeClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;
  const showUptimeCursor = frame >= tractionClickEnd + 2 && frame <= uptimeClickEnd + 8;

  // Global 825 => local 735.
  // Scroll down, click budget, type "45", then click Generate.
  const budgetSeqStart = 735;
  const scrollEnd = budgetSeqStart + 12;
  const budgetMoveStart = scrollEnd + 1;
  const budgetMoveEnd = budgetMoveStart + 16;
  const budgetClickStart = budgetMoveEnd;
  const budgetClickMid = budgetClickStart + 2;
  const budgetClickEnd = budgetClickStart + 4;
  const budgetTypeStart = budgetClickEnd + 2;
  const budgetTypeEnd = budgetTypeStart + 10;
  const generateMoveStart = budgetTypeEnd + 2;
  const generateMoveEnd = generateMoveStart + 14;
  const generateClickStart = generateMoveEnd;
  const generateClickMid = generateClickStart + 2;
  const generateClickEnd = generateClickStart + 4;
  const BUDGET_INPUT_X = 690;
  const BUDGET_INPUT_Y = 900;
  const GENERATE_BTN_X = 900;
  const GENERATE_BTN_Y = 980;
  const budgetCursorX = frame < budgetMoveStart
    ? HIGH_AVAIL_X
    : frame < generateMoveStart
      ? interpolate(frame, [budgetMoveStart, budgetMoveEnd], [HIGH_AVAIL_X, BUDGET_INPUT_X], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
      : interpolate(frame, [generateMoveStart, generateMoveEnd], [BUDGET_INPUT_X, GENERATE_BTN_X], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  const budgetCursorY = frame < budgetMoveStart
    ? HIGH_AVAIL_Y
    : frame < generateMoveStart
      ? interpolate(frame, [budgetMoveStart, budgetMoveEnd], [HIGH_AVAIL_Y, BUDGET_INPUT_Y], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
      : interpolate(frame, [generateMoveStart, generateMoveEnd], [BUDGET_INPUT_Y, GENERATE_BTN_Y], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
  const budgetCursorScale = frame >= budgetClickStart && frame <= budgetClickEnd
    ? interpolate(frame, [budgetClickStart, budgetClickMid, budgetClickEnd], [1, 0.75, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : frame >= generateClickStart && frame <= generateClickEnd
      ? interpolate(frame, [generateClickStart, generateClickMid, generateClickEnd], [1, 0.75, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
      : 1;
  const showBudgetCursor = frame >= budgetSeqStart && frame <= generateClickEnd + 8;

  // Legacy return-to-form sequence disabled to avoid cursor/transition overlap.
  const description = frame >= returnCursorClickEnd + returnPasteDelay ? AI_RESPONSE : "";
  const scrollY = frame < budgetSeqStart
    ? 0
    : interpolate(frame, [budgetSeqStart, scrollEnd], [0, -220], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const selectedUsers = frame >= tractionClickEnd ? "Early Traction" : "";
  const selectedUptime = frame >= uptimeClickEnd ? "High Availability" : "";
  const budgetLen = Math.floor(interpolate(frame, [budgetTypeStart, budgetTypeEnd], [0, 2], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const budget = "45".slice(0, budgetLen);
  const spinAngle = (frame * 10) % 360;
  const isGenerating = frame >= generateClickEnd;

  const generateScale = frame >= generateClickStart && frame <= generateClickEnd
    ? interpolate(frame, [generateClickStart, generateClickMid, generateClickEnd], [1, 0.96, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    : 1;

  const cursorProgress = 0;
  const showMouseCursor = false;
  const mouseClick = 1;

  const ACCORDION_X = 1290;
  const ACCORDION_Y = 445;
  const CLIPBOARD_X = 1268;
  const CLIPBOARD_Y = 555;
  const DOCK_MID_X = 962;
  const DOCK_MID_Y = 1076;
  const VSCODE_X = 989;
  const VSCODE_Y = 1033;

  const introCursorX = frame < 33
    ? interpolate(frame, [8, 33], [760, ACCORDION_X], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : frame < 74
      ? interpolate(frame, [44, 74], [ACCORDION_X, CLIPBOARD_X], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : frame < 115
        ? interpolate(frame, [90, 115], [CLIPBOARD_X, DOCK_MID_X], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [142, 160], [DOCK_MID_X, VSCODE_X], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const introCursorY = frame < 33
    ? interpolate(frame, [8, 33], [680, ACCORDION_Y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : frame < 74
      ? interpolate(frame, [44, 74], [ACCORDION_Y, CLIPBOARD_Y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : frame < 115
        ? interpolate(frame, [90, 115], [CLIPBOARD_Y, DOCK_MID_Y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : interpolate(frame, [142, 160], [DOCK_MID_Y, VSCODE_Y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const introCursorScale = frame >= 33 && frame <= 37
    ? interpolate(frame, [33, 35, 37], [1, 0.75, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : frame >= 74 && frame <= 78
      ? interpolate(frame, [74, 76, 78], [1, 0.75, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : frame >= 160 && frame <= 164
        ? interpolate(frame, [160, 162, 164], [1, 0.75, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        : 1;
  const showIntroCursor = frame >= 8 && frame <= 170;

  const dockProgress = interpolate(frame, [130, 142], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showDock = frame >= 130 && frame <= 210;
  const vscodePress = spring({
    frame: frame - 160,
    fps,
    config: { damping: 12, stiffness: 220 },
    durationInFrames: 14,
  });
  const vscodeIconScale = frame >= 160 ? 1 - Math.sin(vscodePress * Math.PI) * 0.12 : 1;

  return {
    sceneOpacity,
    aiHelperProgress,
    copyConfirmed,
    formOpacity,
    aiPanelOpacity,
    aiPanelTranslateY,
    aiPanelScale,
    formReturnTranslateY,
    showStartup,
    startupLocalFrame,
    showStartupCursor,
    startupCursorX,
    startupCursorY,
    startupCursorScale,
    showStartupClaudeCursor,
    startupClaudeCursorX,
    startupClaudeCursorY,
    startupClaudeCursorScale,
    startupPasted,
    startupResponseDone,
    promptOpacity,
    responseText,
    showAICursor,
    showPostCopyCursor,
    postCopyCursorX,
    postCopyCursorY,
    postCopyCursorScale,
    postCopied,
    showPostDockCursor,
    postDockCursorX,
    postDockCursorY,
    postDockCursorScale,
    showPostDock,
    postDockProgress,
    showReturnCursor,
    returnCursorX,
    returnCursorY,
    returnCursorScale,
    showTractionCursor,
    tractionCursorX,
    tractionCursorY,
    tractionCursorScale,
    showUptimeCursor,
    uptimeCursorX,
    uptimeCursorY,
    uptimeCursorScale,
    showBudgetCursor,
    budgetCursorX,
    budgetCursorY,
    budgetCursorScale,
    selectionFraction,
    showCopiedAI,
    description,
    scrollY,
    selectedUsers,
    selectedUptime,
    budget,
    isGenerating,
    spinAngle,
    generateScale,
    cursorProgress,
    showMouseCursor,
    mouseClick,
    showIntroCursor,
    introCursorX,
    introCursorY,
    introCursorScale,
    showDock,
    dockProgress,
    vscodeIconScale,
  };
};
