"use client";

import type { EveMessage, EveMessagePart, EveToolPart, Interaction } from "eve/react";
import type { DynamicToolUIPart } from "ai";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";

export type AgentAnswer = {
  readonly interactionId: string;
  readonly optionId?: string;
  readonly text?: string;
};

type OnAnswers = (answers: readonly AgentAnswer[]) => void | Promise<void>;

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onAnswers,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onAnswers: OnAnswers;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onAnswers={onAnswers}
            part={part}
            showCaret={isStreaming && message.role === "assistant" && index === lastTextIndex}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  onAnswers,
  part,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly onAnswers: OnAnswers;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return null;
    case "interaction":
      return <InteractionActions canRespond={canRespond} interaction={part} onAnswers={onAnswers} />;
    case "tool": {
      if (part.hidden) return null;
      const state = toolState(part);
      return (
        <Tool defaultOpen={state === "approval-requested" || state === "approval-responded"}>
          <ToolHeader state={state} title={part.label} toolName={part.name} type="dynamic-tool" />
          <ToolContent>
            <ToolInput input={part.input} />
            {part.interaction ? (
              <InteractionActions
                canRespond={canRespond}
                interaction={part.interaction}
                onAnswers={onAnswers}
              />
            ) : null}
            <ToolOutput errorText={part.error?.message} output={part.output} />
          </ToolContent>
        </Tool>
      );
    }
  }
}

function toolState(part: EveToolPart): DynamicToolUIPart["state"] {
  switch (part.state) {
    case "streaming":
      return "input-streaming";
    case "approval":
      return part.interaction?.answer ? "approval-responded" : "approval-requested";
    case "completed":
      return "output-available";
    case "failed":
      return "output-error";
    case "rejected":
    case "cancelled":
      return "output-denied";
    default:
      return "input-available";
  }
}

function InteractionActions({
  canRespond,
  interaction,
  onAnswers,
}: {
  readonly canRespond: boolean;
  readonly interaction: Interaction;
  readonly onAnswers: OnAnswers;
}) {
  const { answer, request } = interaction;
  const chosen = request.options?.find((option) => option.id === answer?.optionId);

  return (
    <div className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <p className="text-muted-foreground text-sm">{request.prompt}</p>
      {answer || interaction.status === "settled" ? (
        <p className="font-medium text-sm">
          Responded: {chosen?.label ?? answer?.text ?? interaction.outcome}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {request.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onAnswers([{ interactionId: interaction.interactionId, optionId: option.id }]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "tool":
      return part.callId;
    case "interaction":
      return part.interactionId;
    default:
      return `${part.type}:${index}`;
  }
}
