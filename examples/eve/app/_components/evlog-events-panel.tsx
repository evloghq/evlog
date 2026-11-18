"use client";

/**
 * Demo-only wide-event panel — polls `.evlog/logs` via FS drain output.
 */

import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_EVENTS = 16;
const POLL_INTERVAL_MS = 2000;
const LOGS_URL = "/api/demo/logs";

export type LogsConnectionState = "waiting" | "loading" | "live" | "error";

type WideEventView = {
  timestamp?: string;
  level?: string;
  service?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  eve?: {
    sessionId?: string;
    turnId?: string;
    turnSequence?: number;
    phase?: string;
    sessionTurns?: number;
  };
  approval?: {
    status?: string;
    tool?: string;
  };
  customer?: { name?: string; slug?: string; plan?: string; mrr?: number };
  order?: { id?: string; amount?: number; currency?: string; product?: string };
  refund?: {
    orderId?: string;
    amount?: number;
    status?: string;
    requiresApproval?: boolean;
  };
  audit?: { action?: string; outcome?: string };
  gen_ai?: {
    calls?: number;
    tools?: Array<{ name?: string; success?: boolean; duration_ms?: number }>;
  };
};

type EventTag = {
  label: string;
  tone: "neutral" | "ok" | "warn" | "error";
};

type EventSummary = {
  turnLabel: string | null;
  headline: string;
  subline: string | null;
  tags: EventTag[];
};

export function EvlogEventsPanel({
  className,
  embedded = false,
  onConnectionChange,
}: {
  readonly className?: string;
  readonly embedded?: boolean;
  readonly onConnectionChange?: (state: LogsConnectionState) => void;
}) {
  const [events, setEvents] = useState<WideEventView[]>([]);
  const [connection, setConnection] = useState<LogsConnectionState>("waiting");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const updateConnection = useCallback(
    (state: LogsConnectionState) => {
      setConnection(state);
      onConnectionChange?.(state);
    },
    [onConnectionChange],
  );

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;

      try {
        const res = await fetch(LOGS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { events?: WideEventView[] };
        if (cancelled) return;

        const next = prepareEvents(body.events ?? []).slice(0, MAX_EVENTS);
        setEvents(next);
        updateConnection(next.length > 0 ? "live" : "waiting");
      } catch {
        if (!cancelled) updateConnection("error");
      }
    }

    updateConnection("loading");
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [updateConnection]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [events.length]);

  return (
    <aside className={cn("flex min-h-0 flex-col", embedded ? "flex-1" : "bg-background", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto" ref={listRef}>
        {events.length === 0 ? (
          <p className="px-4 py-10 font-mono text-[11px] text-zinc-600 leading-relaxed">
            {connection === "error"
              ? "Could not read .evlog/logs — retrying…"
              : connection === "loading"
                ? "Reading wide events from .evlog/logs…"
                : "No wide events yet — send a message in chat."}
          </p>
        ) : (
          <ul>
            {events.map((event, index) => {
              const id = eventKey(event, index);
              const expanded = expandedId === id;
              const summary = buildSummary(event);
              return (
                <li className="border-[#222] border-b last:border-b-0" key={id}>
                  <EventRow
                    event={event}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : id)}
                    summary={summary}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {events.length > 0 ? (
        <p className="shrink-0 border-[#222] border-t px-4 py-2 font-mono text-[10px] text-zinc-600">
          ↑ newest · current session only
        </p>
      ) : null}
    </aside>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  summary,
}: {
  readonly event: WideEventView;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly summary: EventSummary;
}) {
  const status = event.status ?? 0;
  const isError = status >= 400 || event.level === "error";

  return (
    <>
      <button
        className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-[#141414]"
        onClick={onToggle}
        type="button"
      >
        <ChevronRightIcon
          className={cn(
            "mt-1 size-3 shrink-0 text-zinc-600 transition-transform",
            expanded && "rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {summary.turnLabel ? (
                  <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {summary.turnLabel}
                  </span>
                ) : null}
                <span className="truncate text-[13px] text-zinc-100 leading-snug">
                  {summary.headline}
                </span>
              </div>
              {summary.subline ? (
                <p className="mt-1 truncate font-mono text-[10px] text-zinc-500 leading-snug">
                  {summary.subline}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <time className="block font-mono text-[10px] text-zinc-600 tabular-nums">
                {formatTime(event.timestamp)}
              </time>
              {isError ? (
                <span className="mt-0.5 block font-mono text-[10px] text-red-400 tabular-nums">
                  {status}
                </span>
              ) : null}
            </div>
          </div>
          {summary.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {summary.tags.map((tag) => (
                <span className={tagClass(tag.tone)} key={tag.label}>
                  {tag.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </button>
      {expanded ? (
        <pre className="overflow-x-auto border-[#222] border-t bg-[#080808] px-4 py-3 font-mono text-[10px] text-zinc-500 leading-relaxed">
          {JSON.stringify(event, null, 2)}
        </pre>
      ) : null}
    </>
  );
}

function tagClass(tone: EventTag["tone"]): string {
  const base = "rounded px-1.5 py-0.5 font-mono text-[9px] leading-none";
  switch (tone) {
    case "ok":
      return cn(base, "bg-emerald-950/60 text-emerald-400");
    case "warn":
      return cn(base, "bg-amber-950/60 text-amber-400");
    case "error":
      return cn(base, "bg-red-950/60 text-red-400");
    default:
      return cn(base, "bg-zinc-800/80 text-zinc-500");
  }
}

function prepareEvents(events: WideEventView[]): WideEventView[] {
  const deduped = dedupeEvents(events).filter(isInterestingEvent);
  const latestSession = deduped[0]?.eve?.sessionId;
  if (!latestSession) return deduped;
  return deduped.filter((event) => event.eve?.sessionId === latestSession);
}

function isInterestingEvent(event: WideEventView): boolean {
  if (event.audit?.action) return true;
  if (event.refund?.amount != null) return true;
  if (event.approval?.status) return true;
  if (event.customer?.name || event.customer?.slug) return true;
  if ((event.gen_ai?.tools?.length ?? 0) > 0) return true;
  if (event.eve?.phase) return true;
  return false;
}

function dedupeEvents(events: WideEventView[]): WideEventView[] {
  const byTurn = new Map<string, WideEventView>();

  for (const event of events) {
    const key = turnIdentity(event);
    const existing = byTurn.get(key);
    if (!existing || (event.timestamp ?? "") >= (existing.timestamp ?? "")) {
      byTurn.set(key, event);
    }
  }

  return [...byTurn.values()].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );
}

function turnIdentity(event: WideEventView): string {
  const session = event.eve?.sessionId;
  const turn = event.eve?.turnId;
  if (session && turn) return `${session}:${turn}`;
  return `${event.path ?? event.timestamp ?? ""}`;
}

function eventKey(event: WideEventView, index: number): string {
  const identity = turnIdentity(event);
  const ts = event.timestamp ?? "";
  return ts ? `${identity}:${ts}` : `${identity}:${index}`;
}

function buildSummary(event: WideEventView): EventSummary {
  const turnNum = event.eve?.turnSequence;
  const turnLabel = turnNum != null ? `Turn ${turnNum + 1}` : null;
  const customer = event.customer?.name ?? event.customer?.slug;
  const orderId = event.order?.id ?? event.refund?.orderId;
  const amount = event.refund?.amount ?? event.order?.amount;
  const currency = event.order?.currency ?? "USD";
  const money = amount != null ? formatMoney(amount, currency) : null;
  const contextLine =
    [customer, orderId ? `#${orderId}` : null, money].filter(Boolean).join(" · ") || null;

  const tags = buildTags(event);

  if (event.audit?.action === "refund.issued") {
    return {
      turnLabel,
      headline: "Refund issued",
      subline: contextLine,
      tags,
    };
  }

  if (event.approval?.status === "approved") {
    return {
      turnLabel,
      headline: "Refund approved",
      subline: contextLine,
      tags,
    };
  }

  if (event.approval?.status === "rejected" || event.eve?.phase === "rejected") {
    return {
      turnLabel,
      headline: "Refund rejected",
      subline: contextLine,
      tags,
    };
  }

  if (
    event.approval?.status === "pending"
    || event.eve?.phase === "awaiting-approval"
  ) {
    const tool = event.approval?.tool ?? "issue_refund";
    return {
      turnLabel,
      headline: `Waiting for approval — ${tool}`,
      subline: money ? `${customer ?? "Customer"} · ${money} over threshold` : contextLine,
      tags,
    };
  }

  if (event.eve?.phase === "failed" || (event.status ?? 0) >= 500) {
    return {
      turnLabel,
      headline: "Turn failed",
      subline: contextLine,
      tags,
    };
  }

  const tools = event.gen_ai?.tools?.map((tool) => tool.name).filter(Boolean) ?? [];
  if (tools.length > 0) {
    return {
      turnLabel,
      headline: tools.join(" → "),
      subline: contextLine,
      tags,
    };
  }

  if (customer) {
    return {
      turnLabel,
      headline: `Looked up ${customer}`,
      subline: contextLine,
      tags,
    };
  }

  return {
    turnLabel,
    headline: "Agent turn completed",
    subline: contextLine,
    tags,
  };
}

function buildTags(event: WideEventView): EventTag[] {
  const tags: EventTag[] = [];

  if (event.approval?.status === "pending") {
    tags.push({ label: "pending approval", tone: "warn" });
  } else if (event.approval?.status === "approved") {
    tags.push({ label: "approved", tone: "ok" });
  } else if (event.approval?.status === "rejected") {
    tags.push({ label: "rejected", tone: "error" });
  }

  const toolCount = event.gen_ai?.tools?.length ?? 0;
  if (toolCount > 0) {
    const failed = event.gen_ai?.tools?.filter((tool) => tool.success === false).length ?? 0;
    tags.push({
      label: failed > 0 ? `${toolCount} tools · ${failed} failed` : `${toolCount} tools`,
      tone: failed > 0 ? "error" : "neutral",
    });
  }

  if (typeof event.durationMs === "number" && event.durationMs > 0) {
    tags.push({ label: `${event.durationMs}ms`, tone: "neutral" });
  }

  return tags;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function formatTime(timestamp?: string): string {
  if (!timestamp) return "—";
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}
