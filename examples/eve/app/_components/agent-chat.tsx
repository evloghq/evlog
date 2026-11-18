"use client";

import { useEveAgent, type UseEveAgentReturn } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import { useEffect } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { EveLogo } from "./eve-logo";

const AGENT_NAME = "Clearbill Support";
const DEMO_TAGLINE = "Each turn → one evlog wide event (customer, order, refund, audit).";
const BETA_TERMS_HREF = "https://vercel.com/docs/release-phases/public-beta-agreement";

const STARTER_PROMPTS = [
  {
    label: "Double-charge — Acme Corp, order #4821 ($890, needs approval)",
    message:
      "Acme Corp says they were double-charged on order #4821. Look up the account and order, then issue a refund.",
  },
  {
    label: "Small refund — Startup Inc, order #1102 ($49, auto)",
    message:
      "Startup Inc wants a refund on order #1102 — wrong plan selected. Look everything up and refund if valid.",
  },
  {
    label: "Missing info — ask me first",
    message:
      "A customer wants a refund but I forgot to paste the order number. Help me through the workflow.",
  },
] as const;

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

function chatStatus(agent: UseEveAgentReturn): ChatStatus {
  if (agent.error) return "error";
  if (agent.status !== "busy") return "ready";
  return agent.messages.at(-1)?.metadata?.status === "streaming" ? "streaming" : "submitted";
}

export function AgentChat({
  embedded = false,
  onStatusChange,
}: {
  readonly embedded?: boolean;
  readonly onStatusChange?: (label: string) => void;
}) {
  const agent = useEveAgent();
  const status = chatStatus(agent);
  const isBusy = agent.status !== "idle";
  const isEmpty = agent.messages.length === 0;

  useEffect(() => {
    if (!onStatusChange) return;
    const label =
      status === "streaming"
        ? "Streaming"
        : status === "submitted"
          ? "Thinking"
          : status === "error"
            ? "Error"
            : "Ready";
    onStatusChange(label);
  }, [status, onStatusChange]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    await agent.send(text);
  };

  const sendStarter = async (message: string) => {
    if (isBusy) return;
    await agent.send(message);
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Describe a refund request…" />
      <PromptInputSubmit onStop={() => void agent.cancel()} status={status} />
    </PromptInput>
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden text-foreground",
        embedded ? "min-h-0 flex-1 bg-transparent" : "h-dvh bg-background",
      )}
    >
      {!embedded && isEmpty ? null : !embedded ? (
        <header className="flex h-14 shrink-0 items-center justify-center gap-3 pr-2 pl-4">
          <span className="flex min-w-0 items-center gap-2.5">
            <EveLogo size={22} />
            <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
            <StatusDot status={status} />
          </span>
          <a
            className="rounded-full border border-amber-500/30 px-2 py-0.5 font-medium text-amber-700 text-xs transition-colors hover:bg-amber-500/10 dark:text-amber-300"
            href={BETA_TERMS_HREF}
            rel="noreferrer"
            target="_blank"
          >
            Public preview
          </a>
        </header>
      ) : null}

      {agent.error ? (
        <div
          className={cn(
            "mx-auto w-full shrink-0 px-4 pt-3",
            embedded ? "max-w-none sm:px-5" : "max-w-3xl pt-2 sm:px-6",
          )}
        >
          <div className="flex items-start gap-3 border border-red-900/50 bg-red-950/30 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div>
              <p className="font-medium text-red-200">Request failed</p>
              <p className="mt-0.5 text-red-200/70">{agent.error.message}</p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? null : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent
            className={cn(
              "mx-auto w-full gap-6 py-5",
              embedded ? "max-w-none px-4 sm:px-5" : "max-w-3xl px-4 py-6 sm:px-6",
            )}
          >
            {agent.messages.map((message, index) => (
              <AgentMessage
                canRespond={agent.status !== "resuming"}
                isStreaming={status === "streaming" && index === agent.messages.length - 1}
                key={message.id}
                message={message}
                onAnswers={async (answers) => {
                  await agent.respond(answers);
                }}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div
        className={cn(
          "mx-auto w-full",
          embedded ? "shrink-0 px-4 pb-4 sm:px-5 sm:pb-5" : "px-4 sm:px-6",
          isEmpty
            ? embedded
              ? "flex min-h-0 flex-1 flex-col justify-center gap-6 py-6"
              : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
            : embedded
              ? "max-w-none shrink-0"
              : "max-w-3xl shrink-0 pb-6",
        )}
      >
        {isEmpty ? (
          <div
            className={cn(
              "flex w-full flex-col gap-5",
              embedded ? "text-left" : "items-center gap-6 text-center",
            )}
          >
            {!embedded ? (
              <div className="flex flex-col items-center gap-3">
                <EveLogo size={72} />
                <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                  evlog × eve demo
                </p>
                <h1 className="font-medium text-4xl tracking-tighter sm:text-5xl">{AGENT_NAME}</h1>
                <p className="max-w-md text-muted-foreground text-sm leading-relaxed">{DEMO_TAGLINE}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="font-medium text-sm text-zinc-200">Try a starter scenario</p>
                <p className="text-[13px] text-zinc-500 leading-relaxed">
                  Each completed turn emits one structured wide event — watch it appear in the
                  panel on the right.
                </p>
              </div>
            )}
            <div className="flex w-full flex-col gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  className={cn(
                    "border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50",
                    embedded
                      ? "border-[#333] bg-[#111] text-zinc-200 hover:border-[#555] hover:bg-[#161616]"
                      : "rounded-lg border-border bg-muted/30 hover:bg-muted/60",
                  )}
                  disabled={isBusy}
                  key={prompt.label}
                  onClick={() => void sendStarter(prompt.message)}
                  type="button"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            {!embedded ? (
              <a
                className="rounded-full border border-amber-500/30 px-2 py-0.5 font-medium text-amber-700 text-xs transition-colors hover:bg-amber-500/10 dark:text-amber-300"
                href={BETA_TERMS_HREF}
                rel="noreferrer"
                target="_blank"
              >
                Public preview
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="w-full">{composer}</div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { readonly status: ChatStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1 rounded-full transition-colors", tone)} />
    </span>
  );
}
