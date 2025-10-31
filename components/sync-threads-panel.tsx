"use client"

import { useEffect, useMemo, useState } from "react"

import type { GmailThreadSummary } from "@/lib/google-auth"
import type { ThreadQAEntry } from "@/lib/openai"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface SyncThreadsPanelProps {
  threads: GmailThreadSummary[]
}

interface SyncResponse {
  processedThreads: number
  consolidated: ThreadQAEntry[]
  details: Array<{
    threadId: string
    subject: string
    createdAt?: string | null
    questions: ThreadQAEntry[]
  }>
}

type ThreadStatus =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "processing" }
  | { status: "success"; questions: ThreadQAEntry[] }
  | { status: "error"; error: string }

function createInitialStatusMap(
  threads: GmailThreadSummary[]
): Record<string, ThreadStatus> {
  return threads.reduce<Record<string, ThreadStatus>>((acc, thread) => {
    acc[thread.id] = { status: "idle" }
    return acc
  }, {})
}

export function SyncThreadsPanel({ threads }: SyncThreadsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [instructions, setInstructions] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResponse | null>(null)
  const [isIngesting, setIsIngesting] = useState(false)
  const [ingestMessage, setIngestMessage] = useState<string | null>(null)
  const [threadStatuses, setThreadStatuses] = useState<
    Record<string, ThreadStatus>
  >(() => createInitialStatusMap(threads))

  useEffect(() => {
    setThreadStatuses(createInitialStatusMap(threads))
  }, [threads])

  const resetState = () => {
    setInstructions("")
    setIsProcessing(false)
    setError(null)
    setResult(null)
    setIsIngesting(false)
    setIngestMessage(null)
    setThreadStatuses(createInitialStatusMap(threads))
  }

  const handleToggle = () => {
    if (expanded) {
      resetState()
    }
    setExpanded((prev) => !prev)
  }

  const handleProcess = async () => {
    if (!threads.length) {
      setError("No threads available to process.")
      return
    }

    setIsProcessing(true)
    setError(null)
    setResult(null)
    setThreadStatuses(
      threads.reduce<Record<string, ThreadStatus>>((acc, thread) => {
        acc[thread.id] = { status: "queued" }
        return acc
      }, {})
    )

    const processedResults: Array<{
      threadId: string
      subject: string
      createdAt?: string | null
      questions: ThreadQAEntry[]
    }> = []

    const concurrencyLimit = Math.max(
      1,
      Number(process.env.NEXT_PUBLIC_SYNC_CONCURRENCY ?? "5") || 5
    )

    let cursor = 0

    const processNextThread = async () => {
      const currentIndex = cursor
      cursor += 1
      const thread = threads[currentIndex]
      if (!thread) {
        return
      }

      setThreadStatuses((prev) => ({
        ...prev,
        [thread.id]: { status: "processing" },
      }))

      try {
        const response = await fetch(
          `/api/gmail/thread/${encodeURIComponent(thread.id)}/qa`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              instructions: instructions.trim() || undefined,
            }),
          }
        )

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error ?? "Failed to process this thread.")
        }

          const data = (await response.json()) as {
            threadId: string
            subject: string
            createdAt?: string | null
            questions: ThreadQAEntry[]
          }

        processedResults.push(data)
        setThreadStatuses((prev) => ({
          ...prev,
          [thread.id]: { status: "success", questions: data.questions },
        }))
      } catch (threadError) {
        console.error("Thread processing failed", thread.id, threadError)
        setThreadStatuses((prev) => ({
          ...prev,
          [thread.id]: {
            status: "error",
            error:
              threadError instanceof Error
                ? threadError.message
                : "Failed to process this thread.",
          },
        }))
      } finally {
        if (cursor < threads.length) {
          await processNextThread()
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrencyLimit, threads.length) },
      () => processNextThread()
    )

    await Promise.all(workers)

    const consolidated = processedResults.flatMap((result) => result.questions)

    setResult({
      processedThreads: processedResults.length,
      consolidated,
      details: processedResults,
    })

    setIsProcessing(false)
  }

  const statusOrder = useMemo(() => {
    return threads.map((thread) => ({
      thread,
      status: threadStatuses[thread.id] ?? { status: "idle" },
    }))
  }, [threads, threadStatuses])

  return (
    <div className="space-y-4">
      <Button onClick={handleToggle} disabled={!threads.length}>
        {expanded ? "Hide sync panel" : "Sync data"}
      </Button>
      {expanded ? (
        <div className="space-y-6 rounded-lg border border-border bg-card p-6">
          <div className="space-y-2">
            <label
              htmlFor="sync-instructions"
              className="text-sm font-medium text-foreground"
            >
              Additional instructions
            </label>
            <Textarea
              id="sync-instructions"
              placeholder="Add optional guidance for the LLM (e.g. focus on pricing questions, ignore automated notifications, etc.)."
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              The model will always return JSON with <code>question</code> and{" "}
              <code>answer</code> fields. Additional instructions are optional.
            </p>
          </div>

          {result ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium text-foreground">
                Processed {result.processedThreads} threads
              </p>
              <p className="text-sm text-muted-foreground">
                Extracted {result.consolidated.length} question &amp; answer
                pairs.
              </p>
              <pre className="max-h-64 overflow-y-auto rounded bg-background p-3 text-xs text-foreground">
                {JSON.stringify(result.consolidated, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleProcess} disabled={isProcessing}>
              {isProcessing ? "Processing..." : "Process"}
            </Button>
            {result && !isProcessing ? (
              <Button
                variant="secondary"
                disabled={isIngesting || !hasIngestableItems(result)}
                onClick={async () => {
                  if (!result) return

                  setIsIngesting(true)
                  setIngestMessage(null)

                  try {
                    const ingestItems = result.details.flatMap((detail) =>
                      detail.questions.map((qa) => ({
                        threadId: detail.threadId,
                        question: qa.question,
                        answer: qa.answer,
                        createdAt: detail.createdAt ?? null,
                      }))
                    )

                    if (!ingestItems.length) {
                      throw new Error(
                        "No question & answer pairs available for ingestion."
                      )
                    }

                    const response = await fetch("/api/qdrant/upsert", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ items: ingestItems }),
                    })

                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}))
                      throw new Error(
                        data.error ?? "Failed to upsert into Qdrant."
                      )
                    }

                    const data = await response.json()
                    setIngestMessage(
                      `Ingested ${data.upserted} items into collection "${data.collection}".`
                    )
                  } catch (ingestError) {
                    console.error("Failed to ingest into Qdrant", ingestError)
                    setIngestMessage(
                      ingestError instanceof Error
                        ? ingestError.message
                        : "Failed to ingest into Qdrant."
                    )
                  } finally {
                    setIsIngesting(false)
                  }
                }}
              >
                {isIngesting ? "Ingesting..." : "Ingest into Qdrant"}
              </Button>
            ) : null}
            <span className="text-sm text-muted-foreground">
              {threads.length} threads queued
            </span>
          </div>

          {ingestMessage ? (
            <p
              className={`text-sm ${
                ingestMessage.toLowerCase().startsWith("failed") ||
                ingestMessage.toLowerCase().includes("error")
                  ? "text-destructive"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {ingestMessage}
            </p>
          ) : null}

          <div className="max-h-72 space-y-3 overflow-y-auto">
            <p className="text-sm font-medium text-foreground">
              Thread progress
            </p>
            <ul className="space-y-2">
              {statusOrder.map(({ thread, status }) => (
                <li
                  key={thread.id}
                  className="flex items-start justify-between rounded-md border border-border bg-background p-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {thread.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {thread.from} {"->"} {thread.to}
                    </p>
                    {thread.createdAt ? (
                      <p className="text-xs text-muted-foreground">
                        Created {formatTimestamp(thread.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  <ThreadStatusBadge status={status} />
                </li>
              ))}
            </ul>
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  switch (status.status) {
    case "queued":
      return (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-muted" />
          Queued
        </span>
      )
    case "processing":
      return (
        <span className="flex items-center gap-2 text-xs text-primary">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          Processing...
        </span>
      )
    case "success":
      return (
        <span className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="size-2 rounded-full bg-emerald-500" />
          {status.questions.length
            ? `${status.questions.length} Q&A`
            : "No questions"}
        </span>
      )
    case "error":
      return (
        <span className="flex items-center gap-2 text-xs text-destructive">
          <span className="size-2 rounded-full bg-destructive" />
          {status.error}
        </span>
      )
    default:
      return (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-muted" />
          Pending
        </span>
      )
  }
}

function hasIngestableItems(result: SyncResponse) {
  return result.details.some((detail) => detail.questions.length > 0)
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
