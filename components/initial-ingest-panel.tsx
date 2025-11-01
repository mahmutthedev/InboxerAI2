"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface InitialIngestPanelProps {
  gmailThreadCount?: number
  initialIngestMaxThreads?: number | null
}

const PREVIEW_CONCURRENCY = Math.max(
  1,
  Number(process.env.NEXT_PUBLIC_INITIAL_PREVIEW_CONCURRENCY ?? "5")
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

interface IngestStateSummary {
  processedThreads: number
  historyId: string | null
  totalThreadsDetected: number | null
  lastFullIngestAt: string | null
  lastPreviewAt: string | null
  lastUpdatedAt: string | null
  rules: string
  previewMaxThreads: number | null
}

export function InitialIngestPanel({
  gmailThreadCount,
  initialIngestMaxThreads,
}: InitialIngestPanelProps) {
  const initialPreviewLimit =
    typeof initialIngestMaxThreads === "number" &&
    Number.isFinite(initialIngestMaxThreads) &&
    initialIngestMaxThreads > 0
      ? Math.floor(initialIngestMaxThreads)
      : null
  const [pointCount, setPointCount] = useState<number | null>(null)
  const [isFetchingStats, setIsFetchingStats] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusVariant, setStatusVariant] = useState<"info" | "error" | "success">(
    "info"
  )
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [ingestState, setIngestState] = useState<IngestStateSummary | null>(null)
  const [rulesValue, setRulesValue] = useState("")
  const [rulesDraft, setRulesDraft] = useState("")
  const [isRulesEditing, setIsRulesEditing] = useState(false)
  const [isSavingRules, setIsSavingRules] = useState(false)
  const [previewLimitValue, setPreviewLimitValue] = useState<number | null>(
    initialPreviewLimit
  )
  const [previewLimitDraft, setPreviewLimitDraft] = useState(
    initialPreviewLimit ? String(initialPreviewLimit) : ""
  )
  const [isPreviewLimitEditing, setIsPreviewLimitEditing] = useState(false)
  const [isSavingPreviewLimit, setIsSavingPreviewLimit] = useState(false)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressCurrent, setProgressCurrent] = useState(0)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const latestPreviewThreadIdsRef = useRef<string[]>([])
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

  const loadIngestState = useCallback(async () => {
    try {
      const response = await fetch("/api/ingest/state")
      if (!response.ok) {
        throw new Error("Failed to load ingest state")
      }
      const data = await response.json()
      setIngestState(data)
    } catch (error) {
      console.error("Unable to load ingest state", error)
    }
  }, [])

  const syncIngestState = useCallback(
    async (payload: {
      processedThreadIds?: string[]
      historyId?: string | null
      totalThreadsDetected?: number | null
      lastFullIngestAt?: string | null
      lastPreviewAt?: string | null
      rules?: string | null
      previewMaxThreads?: number | null
    }): Promise<IngestStateSummary | null> => {
      try {
        const response = await fetch("/api/ingest/state", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload ?? {}),
        })

        if (!response.ok) {
          throw new Error("Failed to update ingest state")
        }

        const data = await response.json()
        if (data?.state) {
          const summary = data.state as IngestStateSummary
          setIngestState(summary)
          return summary
        }
        return null
      } catch (error) {
        console.error("Unable to update ingest state", error)
        throw error
      }
    },
    []
  )

  useEffect(() => {
    refreshStats().catch(() => {
      /* ignored */
    })
    loadIngestState().catch(() => {
      /* ignored */
    })
  }, [refreshStats, loadIngestState])

  useEffect(() => {
    if (
      gmailThreadCount &&
      ingestState?.totalThreadsDetected !== gmailThreadCount
    ) {
      syncIngestState({ totalThreadsDetected: gmailThreadCount }).catch(() => {
        /* ignored */
      })
    }
  }, [gmailThreadCount, ingestState?.totalThreadsDetected, syncIngestState])

  useEffect(() => {
    const currentRules = ingestState?.rules ?? ""
    if (rulesValue !== currentRules) {
      setRulesValue(currentRules)
    }
  if (!isRulesEditing && rulesDraft !== currentRules) {
    setRulesDraft(currentRules)
  }
}, [
  ingestState?.rules,
  isRulesEditing,
  rulesDraft,
  rulesValue,
])

  useEffect(() => {
    const savedLimit =
      typeof ingestState?.previewMaxThreads === "number"
        ? ingestState.previewMaxThreads
        : null
    const resolvedLimit = savedLimit ?? initialPreviewLimit ?? null

    if (previewLimitValue !== resolvedLimit) {
      setPreviewLimitValue(resolvedLimit)
    }

    if (!isPreviewLimitEditing) {
      setPreviewLimitDraft(resolvedLimit ? String(resolvedLimit) : "")
    }
  }, [
    ingestState?.previewMaxThreads,
    initialPreviewLimit,
    isPreviewLimitEditing,
    previewLimitValue,
  ])

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const handleStartEditingRules = () => {
    setIsRulesEditing(true)
    setRulesDraft(rulesValue)
  }

  const handleCancelRules = () => {
    setIsRulesEditing(false)
    setRulesDraft(rulesValue)
  }

  const handleSaveRules = async () => {
    const trimmed = rulesDraft.trim()
    setIsSavingRules(true)
    try {
      const summary = await syncIngestState({ rules: trimmed })
      const updatedRules = summary?.rules ?? trimmed
      setRulesValue(updatedRules)
      setRulesDraft(updatedRules)
      setStatusVariant("success")
      setStatusMessage("Rules saved.")
      setIsRulesEditing(false)
    } catch (error) {
      console.error("Failed to save rules", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to save rules."
      )
    } finally {
      setIsSavingRules(false)
    }
  }

  const handleStartEditingPreviewLimit = () => {
    setIsPreviewLimitEditing(true)
    const current =
      typeof previewLimitValue === "number" && previewLimitValue > 0
        ? previewLimitValue
        : initialPreviewLimit
    setPreviewLimitDraft(current ? String(current) : "")
  }

  const handleCancelPreviewLimit = () => {
    setIsPreviewLimitEditing(false)
    const current =
      typeof previewLimitValue === "number" && previewLimitValue > 0
        ? previewLimitValue
        : initialPreviewLimit
    setPreviewLimitDraft(current ? String(current) : "")
  }

  const handleSavePreviewLimit = async () => {
    const trimmed = previewLimitDraft.trim()
    const parsed = Number.parseInt(trimmed, 10)

    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatusVariant("error")
      setStatusMessage("Preview limit must be a positive integer.")
      return
    }

    setIsSavingPreviewLimit(true)
    try {
      const summary = await syncIngestState({ previewMaxThreads: parsed })
      const updatedLimit =
        typeof summary?.previewMaxThreads === "number"
          ? summary.previewMaxThreads
          : parsed
      setPreviewLimitValue(updatedLimit)
      setPreviewLimitDraft(String(updatedLimit))
      setIsPreviewLimitEditing(false)
      setStatusVariant("success")
      setStatusMessage(
        `Preview limit saved (${updatedLimit.toLocaleString()} threads).`
      )
    } catch (error) {
      console.error("Failed to save preview limit", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to save preview limit."
      )
    } finally {
      setIsSavingPreviewLimit(false)
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
    setStatusMessage("Fetching thread list…")
    setPreview(null)
    setProgressTotal(0)
    setProgressCurrent(0)
    const instructionsForPreview = rulesValue.trim()
    const limitForPreview =
      typeof previewLimitValue === "number" && previewLimitValue > 0
        ? previewLimitValue
        : initialPreviewLimit
    const listRequestPayload =
      limitForPreview && Number.isFinite(limitForPreview)
        ? { maxThreads: limitForPreview }
        : {}

    try {
      const listResponse = await fetch("/api/gmail/threads/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(listRequestPayload),
      })

      if (!listResponse.ok) {
        const data = await listResponse.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to list Gmail threads.")
      }

      const listData = await listResponse.json()
      const threadIds: string[] = listData.threadIds ?? []
      latestPreviewThreadIdsRef.current = threadIds

      if (!threadIds.length) {
        setStatusVariant("info")
        setStatusMessage("No Gmail threads remaining to ingest.")
        await syncIngestState({
          lastPreviewAt: new Date().toISOString(),
          totalThreadsDetected: gmailThreadCount ?? null,
        })
        return
      }

      setProgressTotal(threadIds.length)
      setProgressCurrent(0)
      setStatusMessage(`Processing threads 0/${threadIds.length}…`)

      const results: Array<{ order: number; thread: PreviewThread }> = []
      let processedThreadsLocal = 0
      let threadsWithQuestionsLocal = 0
      let totalQuestionsLocal = 0
      const processedThreadIdsLocal: string[] = []
      let currentIndex = 0

      const worker = async () => {
        while (true) {
          const idx = currentIndex++
          if (idx >= threadIds.length) {
            break
          }
          const threadId = threadIds[idx]

          try {
            const response = await fetch(
              `/api/gmail/thread/${encodeURIComponent(threadId)}/qa`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(
                  instructionsForPreview
                    ? { instructions: instructionsForPreview }
                    : {}
                ),
              }
            )

            if (!response.ok) {
              continue
            }

            const threadData = await response.json()
            const questions = (threadData.questions ?? []).filter(
              (qa: { question?: string; answer?: string }) =>
                Boolean(qa?.question && qa?.answer)
            )

            if (!questions.length) {
              continue
            }

            threadsWithQuestionsLocal += 1
            totalQuestionsLocal += questions.length

            results.push({
              order: idx,
              thread: {
                threadId,
                subject: threadData.subject ?? "Untitled thread",
                createdAt: threadData.createdAt ?? null,
                messageCount: threadData.messageCount ?? questions.length,
                questions,
              },
            })
          } catch (error) {
            console.error("Failed to preview thread", threadId, error)
          } finally {
            processedThreadsLocal += 1
            processedThreadIdsLocal.push(threadId)
            setProgressCurrent((prev) => {
              const next = prev + 1
              setStatusMessage(`Processing threads ${next}/${threadIds.length}…`)
              return next
            })
          }
        }
      }

      const workers = Array.from(
        { length: Math.min(PREVIEW_CONCURRENCY, threadIds.length) },
        () => worker()
      )

      await Promise.all(workers)

      const processedThreadIds = Array.from(new Set(processedThreadIdsLocal))
      latestPreviewThreadIdsRef.current = processedThreadIds

      const sortedThreads = results
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.thread)

      const summary: PreviewResult = {
        processedThreads: processedThreadsLocal,
        threadsWithQuestions: threadsWithQuestionsLocal,
        totalQuestions: totalQuestionsLocal,
        maxThreads: listData.maxThreads ?? threadIds.length,
        threads: sortedThreads,
      }

      setPreview(summary)

      await syncIngestState({
        lastPreviewAt: new Date().toISOString(),
        totalThreadsDetected: gmailThreadCount ?? null,
      })

      if (threadsWithQuestionsLocal === 0) {
        setStatusVariant("info")
        setStatusMessage("No questions detected in the scanned threads.")
      } else {
        setStatusVariant("success")
        setStatusMessage(
          `Processed ${processedThreadsLocal.toLocaleString()} threads and extracted ${totalQuestionsLocal.toLocaleString()} questions.`
        )
      }
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
      setStatusVariant("error")
      setStatusMessage("Generate a preview before ingesting.")
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

    const uniqueThreadIds = Array.from(
      new Set(preview.threads.map((thread) => thread.threadId))
    )
    const processedThreadIds = Array.from(
      new Set(
        latestPreviewThreadIdsRef.current.length
          ? latestPreviewThreadIdsRef.current
          : uniqueThreadIds
      )
    )

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
      await syncIngestState({
        processedThreadIds,
        lastFullIngestAt: new Date().toISOString(),
        totalThreadsDetected: gmailThreadCount ?? null,
      })
      setPreview(null)
      setProgressCurrent(0)
      setProgressTotal(0)
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
      threads: preview.threads
        .map((thread) =>
          thread.threadId === threadId
            ? {
                ...thread,
                questions: thread.questions.filter((_, qaIndex) => qaIndex !== index),
              }
            : thread
        )
        .filter((thread) => thread.questions.length > 0),
    })
  }

  const hasExistingData = !!pointCount && pointCount > 0

  const processedThreadsCount = ingestState?.processedThreads ?? 0
  const totalThreadsDetected =
    gmailThreadCount ?? ingestState?.totalThreadsDetected ?? null
  const coveragePercentage = totalThreadsDetected
    ? Math.min((processedThreadsCount / totalThreadsDetected) * 100, 100)
    : null
  const effectivePreviewLimit =
    typeof previewLimitValue === "number" && previewLimitValue > 0
      ? previewLimitValue
      : initialPreviewLimit

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

      <div className="mt-4">
        <label
          htmlFor="initial-ingest-thread-limit"
          className="text-sm font-medium text-foreground"
        >
          Preview thread limit
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Control how many threads are fetched during preview generation.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Input
            id="initial-ingest-thread-limit"
            type="number"
            min={1}
            inputMode="numeric"
            pattern="[0-9]*"
            value={isPreviewLimitEditing ? previewLimitDraft : effectivePreviewLimit ? String(effectivePreviewLimit) : ""}
            onChange={(event) => setPreviewLimitDraft(event.target.value)}
            disabled={!isPreviewLimitEditing || isSavingPreviewLimit}
            placeholder="200"
            className="w-32"
          />
          {isPreviewLimitEditing ? (
            <>
              <Button
                size="sm"
                onClick={handleSavePreviewLimit}
                disabled={isSavingPreviewLimit}
              >
                {isSavingPreviewLimit ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Save limit"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelPreviewLimit}
                disabled={isSavingPreviewLimit}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStartEditingPreviewLimit}
            >
              Edit limit
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label
          htmlFor="initial-ingest-rules"
          className="text-sm font-medium text-foreground"
        >
          Rules
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Provide optional instructions to guide extraction. Saved rules are appended to the LLM prompt.
        </p>
        <Textarea
          id="initial-ingest-rules"
          value={isRulesEditing ? rulesDraft : rulesValue}
          onChange={(event) => setRulesDraft(event.target.value)}
          disabled={!isRulesEditing || isSavingRules}
          placeholder="Add high-level directives for the extractor..."
          className="mt-2 h-28 resize-y"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isRulesEditing ? (
            <>
              <Button
                size="sm"
                onClick={handleSaveRules}
                disabled={isSavingRules}
              >
                {isSavingRules ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Saving
                  </span>
                ) : (
                  "Save rules"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelRules}
                disabled={isSavingRules}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStartEditingRules}
            >
              Edit rules
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
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
        <div className="rounded-lg border border-border bg-background/60 p-4">
          <dt className="text-muted-foreground">Processed threads</dt>
          <dd className="mt-1 text-base font-semibold text-foreground">
            {processedThreadsCount.toLocaleString()}
          </dd>
        </div>
      </dl>

      {totalThreadsDetected ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Coverage: {processedThreadsCount.toLocaleString()} /
          {" "}
          {totalThreadsDetected.toLocaleString()} threads
          {coveragePercentage !== null
            ? ` (${coveragePercentage.toFixed(1)}%)`
            : null}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          {effectivePreviewLimit
            ? `Preview scans up to ${effectivePreviewLimit.toLocaleString()} threads.`
            : "Preview scans your entire inbox."}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleGeneratePreview} disabled={isGenerating || isIngesting || isRulesEditing || isSavingRules || isPreviewLimitEditing || isSavingPreviewLimit}>
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
            disabled={isGenerating || isIngesting || selectedQuestions === 0 || isRulesEditing || isSavingRules || isPreviewLimitEditing || isSavingPreviewLimit}
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

      {isGenerating && progressTotal > 0 ? (
        <p className="text-xs text-muted-foreground">
          Preview progress: {Math.min(progressCurrent, progressTotal)} /
          {" "}
          {progressTotal}
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
            className="space-y-4 overflow-y-auto rounded-lg border border-border bg-background/60 p-4"
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
