"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import {
  type GmailThreadDetail,
  type GmailThreadSummary,
} from "@/lib/google-auth"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface GmailThreadListProps {
  threads: GmailThreadSummary[]
  error?: string | null
}

export function GmailThreadList({ threads, error }: GmailThreadListProps) {
  const [open, setOpen] = useState(false)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, GmailThreadDetail>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const cachedThread = useMemo(
    () => (selectedThreadId ? details[selectedThreadId] : undefined),
    [details, selectedThreadId]
  )

  useEffect(() => {
    if (!open || !selectedThreadId || cachedThread) {
      return
    }

    const controller = new AbortController()
    setIsLoading(true)
    setDetailError(null)

    fetch(`/api/gmail/thread/${encodeURIComponent(selectedThreadId)}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error ?? "Unable to load thread")
        }

        return response.json()
      })
      .then((data: GmailThreadDetail) => {
        setDetails((prev) => ({ ...prev, [data.id]: data }))
      })
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return
        }

        console.error(fetchError)
        setDetailError(
          fetchError instanceof Error
            ? fetchError.message
            : "Unable to load thread"
        )
      })
      .finally(() => {
        setIsLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [open, selectedThreadId, cachedThread])

  const selectedThread = cachedThread ?? null

  const handleOpenThread = (threadId: string) => {
    setSelectedThreadId(threadId)
    setOpen(true)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setDetailError(null)
      setIsLoading(false)
    }
  }

  return (
    <>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : threads.length ? (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => handleOpenThread(thread.id)}
                className="w-full rounded-lg border border-border bg-background p-4 text-left transition hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {thread.subject}
                  </p>
                  {thread.lastMessageDate ? (
                    <span className="text-xs text-muted-foreground">
                      {formatThreadDate(thread.lastMessageDate)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {thread.from}
                  </span>{" "}
                  <span className="text-muted-foreground">{"->"}</span>{" "}
                  <span className="font-medium text-foreground">
                    {thread.to}
                  </span>
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {thread.messageCount}{" "}
                    {thread.messageCount === 1 ? "message" : "messages"}
                  </span>
                  {thread.snippet ? (
                    <span className="line-clamp-1">{thread.snippet}</span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          We could not find recent Gmail threads in your inbox.
        </p>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedThread?.subject ?? "Thread preview"}
            </DialogTitle>
            <DialogDescription>
              Detailed messages from your Gmail conversation.
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading thread...
            </div>
          ) : detailError ? (
            <p className="py-6 text-sm text-destructive">{detailError}</p>
          ) : selectedThread ? (
            <div className="space-y-4">
              {selectedThread.messages.map((message) => (
                <article
                  key={message.id}
                  className="rounded-lg border border-border bg-muted/30 p-4"
                >
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {formatThreadDate(message.date ?? "") || "Unknown date"}
                    </span>
                    <span className="text-left sm:text-right">
                      {message.from}{" "}
                      <span className="text-muted-foreground">{"->"}</span>{" "}
                      {message.to}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {message.subject}
                  </p>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {message.bodyText || "No message body available."}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              Select a thread to view its messages.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatThreadDate(rawDate: string): string {
  if (!rawDate) {
    return ""
  }
  const parsed = new Date(rawDate)
  if (Number.isNaN(parsed.getTime())) {
    return rawDate
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
