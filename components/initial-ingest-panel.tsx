"use client"
/* eslint-disable tailwindcss/classnames-order */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface InitialIngestPanelProps {
  gmailThreadCount?: number
}

const MAX_THREADS_HINT = Number(
  process.env.NEXT_PUBLIC_INITIAL_INGEST_MAX_THREADS ?? "200"
)

interface PreviewThread {
  threadId: string
  subject: string
  createdAt?: string | null
  messageCount: number
  questions: { question: string; answer: string }[]
}

interface PreviewResult {
  processedThreads: number
  threadsWithQuestions: number
  totalQuestions: number
  maxThreads: number
  threads: PreviewThread[]
}

export function InitialIngestPanel({
  gmailThreadCount,
}: InitialIngestPanelProps) {
  const [pointCount, setPointCount] = useState<number | null>(null)
  const [isFetchingStats, setIsFetchingStats] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusVariant, setStatusVariant] = useState<"info" | "error" | "success">(
    "info"
  )
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStats = useCallback(async (suppressLoading = false) => {
    if (!suppressLoading) {
      setIsFetchingStats(true)
    }
    try {
      const response = await fetch("/api/qdrant/stats")
      if (!response.ok) {
        throw new Error("Failed to fetch Qdrant stats")
      }
      const data = await response.json()
      setPointCount(data.count ?? 0)
    } catch (error) {
      console.error("Unable to load Qdrant stats", error)
      setPointCount(null)
    } finally {
      if (!suppressLoading) {
        setIsFetchingStats(false)
      }
    }
  }, [])

  useEffect(() => {
    refreshStats().catch(() => {
      /* ignored */
    })
  }, [refreshStats])

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const selectedThreads = useMemo(() => {
    if (!preview) return 0
    return preview.threads.filter((thread) => thread.questions.length > 0).length
  }, [preview])

  const selectedQuestions = useMemo(() => {
    if (!preview) return 0
    return preview.threads.reduce((acc, thread) => acc + thread.questions.length, 0)
  }, [preview])

  const handleGeneratePreview = async () => {
    setIsGenerating(true)
    setStatusVariant("info")
    setStatusMessage("Preparing preview…")
    setPreview(null)

    try {
      const response = await fetch("/api/gmail/ingest/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to build preview.")
      }

      const data = (await response.json()) as PreviewResult
      setPreview(data)
      setStatusVariant("success")
      setStatusMessage(
        `Processed ${data.processedThreads.toLocaleString()} threads and extracted ${data.totalQuestions.toLocaleString()} questions.`
      )
    } catch (error) {
      console.error("Preview generation failed", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error ? error.message : "Preview generation failed."
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const handleIngestSelected = async () => {
    if (!preview) {
      return
    }

    const ingestItems = preview.threads.flatMap((thread) =>
      thread.questions.map((qa) => ({
        threadId: thread.threadId,
        question: qa.question,
        answer: qa.answer,
        createdAt: thread.createdAt ?? null,
      }))
    )

    if (!ingestItems.length) {
      setStatusVariant("error")
      setStatusMessage("Select at least one question before ingesting.")
      return
    }

    setIsIngesting(true)
    setStatusVariant("info")
    setStatusMessage("Ingesting selected pairs…")

    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        refreshStats(true).catch(() => {
          /* ignored */
        })
      }, 2000)
    }

    try {
      const response = await fetch("/api/qdrant/upsert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ items: ingestItems }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to ingest into Qdrant.")
      }

      const data = await response.json()
      setStatusVariant("success")
      setStatusMessage(
        `Ingested ${data.upserted} question & answer pairs into collection "${data.collection}".`
      )
      await refreshStats()
    } catch (error) {
      console.error("Failed to ingest into Qdrant", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to ingest into Qdrant."
      )
    } finally {
      stopPolling()
      setIsIngesting(false)
    }
  }

  const handleRemoveThread = (threadId: string) => {
    if (!preview) return
    setPreview({
      ...preview,
      threads: preview.threads.filter((thread) => thread.threadId !== threadId),
    })
  }

  const handleRemoveQuestion = (threadId: string, index: number) => {
    if (!preview) return
    setPreview({
      ...preview,
      threads: preview.threads.map((thread) =>
        thread.threadId === threadId
          ? {
              ...thread,
              questions: thread.questions.filter((_, qaIndex) => qaIndex !== index),
            }
          : thread
      ),
    })
  }

  const hasExistingData = !!pointCount && pointCount > 0

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            Initial inbox ingest
          </h2>
          <p className="text-sm text-muted-foreground">
            Prepare a full-question preview, curate results, then ingest into Qdrant.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            hasExistingData
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
          }`}
        >
          {hasExistingData ? "Ingested" : "Not indexed"}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background/60 p-4">
          <dt className="text-muted-foreground">Gmail threads detected</dt>
          <dd className="mt-1 text-base font-semibold text-foreground">
            {gmailThreadCount?.toLocaleString() ?? "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-background/60 p-4">
          <dt className="text-muted-foreground">Qdrant records</dt>
          <dd className="mt-1 text-base font-semibold text-foreground">
            {isFetchingStats && pointCount === null ? "…" : pointCount ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          {MAX_THREADS_HINT
            ? `Preview scans up to ${MAX_THREADS_HINT.toLocaleString()} threads.`
            : "Preview scans your entire inbox."}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleGeneratePreview} disabled={isGenerating || isIngesting}>
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Generating preview…
              </span>
            ) : (
              "Generate preview"
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={handleIngestSelected}
            disabled={isGenerating || isIngesting || selectedQuestions === 0}
          >
            {isIngesting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Ingesting…
              </span>
            ) : (
              `Ingest selected (${selectedQuestions})`
            )}
          </Button>
        </div>
      </div>

      {statusMessage ? (
        <p
          className={`mt-3 text-sm ${
            statusVariant === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : statusVariant === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {preview.processedThreads.toLocaleString()} threads processed - {preview.totalQuestions.toLocaleString()} questions detected
            </span>
            <span>
              {selectedThreads.toLocaleString()} threads selected - {selectedQuestions.toLocaleString()} questions selected
            </span>
          </div>
          <div
            className="overflow-y-auto space-y-4 rounded-lg border border-border bg-background/60 p-4"
            style={{ maxHeight: "28rem" }}
          >
            {preview.threads.length ? (
              preview.threads.map((thread) => (
                <article
                  key={thread.threadId}
                  className="rounded-lg border border-border bg-card/80 p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {thread.subject}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {thread.createdAt
                          ? `Created ${new Date(thread.createdAt).toLocaleString()}`
                          : "Creation date unavailable"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {thread.questions.length} question(s)
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveThread(thread.threadId)}
                    >
                      <Trash2 className="mr-2 size-4" /> Remove thread
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {thread.questions.map((qa, index) => (
                      <div
                        key={`${thread.threadId}-${index}`}
                        className="rounded border border-border bg-background/80 p-3"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2">
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">
                                Question
                              </p>
                              <p className="text-sm text-foreground">
                                {qa.question}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">
                                Answer
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {qa.answer}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveQuestion(thread.threadId, index)}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Remove question</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No questions detected in the preview.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
