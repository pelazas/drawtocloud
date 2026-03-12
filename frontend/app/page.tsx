"use client";

import { useState } from "react";
import Chat from "@/components/Chat";
import Canvas from "@/components/Canvas";
import Questionnaire from "@/components/Questionnaire";
import StatusBar from "@/components/StatusBar";
import OutputPanel from "@/components/OutputPanel";
import AgentActivityFeed from "@/components/AgentActivityFeed";
import { useCanvasPipeline } from "@/lib/useCanvasPipeline";

type AppState = "questionnaire" | "canvas";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("questionnaire");
  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, string | string[]>>({});

  const {
    nodes,
    edges,
    fitViewTrigger,
    messages,
    pipelineStatus,
    terraformFiles,
    costEstimate,
    archDescription,
    isGenerating,
    agentLogs,
    generationElapsed,
    onNodesChange,
    onEdgesChange,
    handleSend,
  } = useCanvasPipeline(appState, questionnaireAnswers);

  function handleQuestionnaireComplete(answers: Record<string, string | string[]>) {
    setQuestionnaireAnswers(answers);
    setAppState("canvas");
  }

  if (appState === "questionnaire") {
    return <Questionnaire onComplete={handleQuestionnaireComplete} />;
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Chat panel — left */}
      <div className="w-80 flex-shrink-0">
        <Chat onSend={handleSend} messages={messages} />
      </div>

      {/* Canvas — center */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <StatusBar message={pipelineStatus} />
        <div className="flex-1 overflow-hidden relative">
          <Canvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitViewTrigger={fitViewTrigger}
          />
          <AgentActivityFeed
            logs={agentLogs}
            isGenerating={isGenerating}
            nodeCount={nodes.length}
            fileCount={terraformFiles.length}
            costTotal={costEstimate?.monthly_total ?? null}
            generationElapsed={generationElapsed}
          />
        </div>
      </div>

      {/* Output Panel — right */}
      <OutputPanel
        terraformFiles={terraformFiles}
        costEstimate={costEstimate}
        archDescription={archDescription}
        isGenerating={isGenerating}
      />
    </div>
  );
}
