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

  const handleProcess = async () => {
    if (!threads.length) {
      setError("No threads available to process.")
      return
    }

    setIsProcessing(true)
    setError(null)
    setResult(null)
    setIngestMessage(null)
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

    const consolidated = processedResults.flatMap((detail) => detail.questions)

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

  const ingestAvailable =
    !!result && !isProcessing && hasIngestableItems(result)

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            Preview & manual ingest
          </h2>
          <p className="text-sm text-muted-foreground">
            Run targeted extractions on the most recent {threads.length} inbox
            threads. Tune the prompt before ingesting into Qdrant.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Manual
        </span>
      </div>

      <div className="mt-6 space-y-2">
        <label
          htmlFor="manual-instructions"
          className="text-sm font-medium text-foreground"
        >
          Additional instructions
        </label>
        <Textarea
          id="manual-instructions"
          placeholder="Add optional guidance for the LLM (e.g. emphasize pricing updates, ignore signatures, etc.)."
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          We store only the extracted question and answer for each thread.
        </p>
      </div>

      {result ? (
        <div className="mt-6 space-y-2 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium text-foreground">
            Processed {result.processedThreads} threads
          </p>
          <p className="text-sm text-muted-foreground">
            Extracted {result.consolidated.length} question &amp; answer pairs.
          </p>
          <pre className="max-h-48 overflow-y-auto rounded bg-background p-3 text-xs text-foreground">
            {JSON.stringify(result.consolidated, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={handleProcess} disabled={isProcessing}>
          {isProcessing ? "Processing..." : "Process recent threads"}
        </Button>
        {ingestAvailable ? (
          <Button
            variant="secondary"
            disabled={isIngesting}
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
            {isIngesting ? "Ingesting..." : "Ingest shown results"}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {threads.length} threads queued • concurrency{" "}
          {process.env.NEXT_PUBLIC_SYNC_CONCURRENCY ?? "5"}
        </span>
      </div>

      {ingestMessage ? (
        <p
          className={`mt-3 text-sm ${
            ingestMessage.toLowerCase().includes("failed") ||
            ingestMessage.toLowerCase().includes("error")
              ? "text-destructive"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {ingestMessage}
        </p>
      ) : null}

      <div className="mt-8 space-y-3">
        <p className="text-sm font-medium text-foreground">Thread progress</p>
        <div className="rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {statusOrder.map(({ thread, status }) => (
              <li
                key={thread.id}
                className="flex flex-col gap-2 bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
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
      </div>

      {error ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
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
