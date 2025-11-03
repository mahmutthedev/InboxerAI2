"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface AccountSummary {
  email: string
  updatedAt: string
}

interface IngestStateSummary {
  replyInstructions: string
  watchRegisteredAt: string | null
  watchExpiration: string | null
}

interface GoogleWatchPanelProps {
  defaultEmail?: string | null
  hasPubsubTopic: boolean
}

export function GoogleWatchPanel({
  defaultEmail,
  hasPubsubTopic,
}: GoogleWatchPanelProps) {
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [ingestState, setIngestState] = useState<IngestStateSummary | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<string | null>(
    defaultEmail ?? null
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusVariant, setStatusVariant] = useState<
    "success" | "error" | "info"
  >("info")
  const [replyValue, setReplyValue] = useState("")
  const [replyDraft, setReplyDraft] = useState("")
  const [isReplyEditing, setIsReplyEditing] = useState(false)
  const [isSavingReply, setIsSavingReply] = useState(false)

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)

    Promise.all([
      fetch("/api/accounts")
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load stored accounts.")
          }
          return response.json()
        })
        .then((data) => {
          if (!isMounted) return
          const list: AccountSummary[] = Array.isArray(data.accounts)
            ? data.accounts
            : []
          setAccounts(list)
          if (!selectedEmail && list.length > 0) {
            setSelectedEmail(list[0].email)
          }
        }),
      fetch("/api/ingest/state")
        .then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load ingest state.")
          }
          return response.json()
        })
        .then((data) => {
          if (!isMounted) return
          const summary: IngestStateSummary = {
            replyInstructions:
              typeof data.replyInstructions === "string"
                ? data.replyInstructions
                : "",
            watchRegisteredAt:
              typeof data.watchRegisteredAt === "string"
                ? data.watchRegisteredAt
                : null,
            watchExpiration:
              typeof data.watchExpiration === "string"
                ? data.watchExpiration
                : null,
          }
          setIngestState(summary)
          setReplyValue(summary.replyInstructions)
          setReplyDraft(summary.replyInstructions)
        }),
    ])
      .catch((error) => {
        console.error("Unable to load configuration", error)
        if (!isMounted) return
        setStatusVariant("error")
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Unable to load configuration."
        )
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [selectedEmail])

  const watchExpiration =
    ingestState?.watchExpiration &&
    new Date(ingestState.watchExpiration).getTime()
      ? ingestState.watchExpiration
      : null
  const watchRegisteredAt = ingestState?.watchRegisteredAt ?? null

  const hasActiveWatch = useMemo(() => {
    if (watchExpiration) {
      return new Date(watchExpiration).getTime() > Date.now()
    }
    return Boolean(watchRegisteredAt)
  }, [watchExpiration, watchRegisteredAt])

  const disableRegister = useMemo(() => {
    if (!hasPubsubTopic) return true
    if (!accounts.length) return true
    if (!selectedEmail) return true
    if (isRegistering) return true
    if (hasActiveWatch) return true
    return false
  }, [
    accounts.length,
    hasActiveWatch,
    hasPubsubTopic,
    isRegistering,
    selectedEmail,
  ])

  const watchStatusLabel = useMemo(() => {
    if (hasActiveWatch) {
      return watchExpiration
        ? `Active — expires ${new Date(watchExpiration).toLocaleString()}`
        : "Active"
    }
    if (watchRegisteredAt) {
      return `Inactive (last registered ${new Date(
        watchRegisteredAt
      ).toLocaleString()})`
    }
    return "No active watch"
  }, [hasActiveWatch, watchExpiration, watchRegisteredAt])

  const handleRegisterWatch = async () => {
    if (!selectedEmail) {
      setStatusVariant("error")
      setStatusMessage("Select an account before registering a watch.")
      return
    }

    setIsRegistering(true)
    setStatusMessage(null)
    try {
      const response = await fetch("/api/gmail/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: selectedEmail,
          labelIds: ["INBOX"],
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          data?.error ??
          "Failed to register Gmail watch. Confirm environment configuration."
        throw new Error(message)
      }

      const expirationIso = data?.expiration
        ? new Date(Number(data.expiration)).toISOString()
        : null

      setIngestState((prev) => ({
        replyInstructions: prev?.replyInstructions ?? "",
        watchRegisteredAt: new Date().toISOString(),
        watchExpiration: expirationIso,
      }))

      const expirationDisplay = expirationIso
        ? new Date(expirationIso).toLocaleString()
        : null

      setStatusVariant("success")
      setStatusMessage(
        `Watch registered for ${selectedEmail}.${
          expirationDisplay ? ` Expires ${expirationDisplay}.` : ""
        }`
      )
    } catch (error) {
      console.error("Failed to register Gmail watch", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to register Gmail watch."
      )
    } finally {
      setIsRegistering(false)
    }
  }

  const handleStopWatch = async () => {
    if (!selectedEmail) {
      setStatusVariant("error")
      setStatusMessage("Select an account before ending the watch.")
      return
    }

    setIsStopping(true)
    setStatusMessage(null)
    try {
      const response = await fetch("/api/gmail/watch/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selectedEmail }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          data?.error ?? "Failed to stop Gmail watch. Try again shortly."
        throw new Error(message)
      }

      setIngestState((prev) => ({
        replyInstructions: prev?.replyInstructions ?? "",
        watchRegisteredAt: null,
        watchExpiration: null,
      }))

      setStatusVariant("info")
      setStatusMessage("Gmail watch ended. You can re-register at any time.")
    } catch (error) {
      console.error("Failed to stop Gmail watch", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to stop Gmail watch."
      )
    } finally {
      setIsStopping(false)
    }
  }

  const handleSaveReplyPrompt = async () => {
    setIsSavingReply(true)
    setStatusMessage(null)
    try {
      const response = await fetch("/api/ingest/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyInstructions: replyDraft }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data?.error ?? "Failed to save customer support prompt."
        )
      }

      setReplyValue(replyDraft)
      setIsReplyEditing(false)
      setIngestState((prev) => ({
        replyInstructions: replyDraft,
        watchRegisteredAt: prev?.watchRegisteredAt ?? null,
        watchExpiration: prev?.watchExpiration ?? null,
      }))
      setStatusVariant("success")
      setStatusMessage("Customer support prompt saved.")
    } catch (error) {
      console.error("Failed to save reply instructions", error)
      setStatusVariant("error")
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to save customer support prompt."
      )
    } finally {
      setIsSavingReply(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Gmail webhook
          </h2>
          <p className="text-sm text-muted-foreground">
            Register a Gmail watch so new emails arrive via Pub/Sub.
          </p>
        </div>
        {hasPubsubTopic ? (
          <span className="inline-flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Pub/Sub topic detected
          </span>
        ) : (
          <span className="text-xs text-destructive">
            Set GMAIL_PUBSUB_TOPIC in your environment.
          </span>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading connected accounts…
          </p>
        ) : accounts.length ? (
          <>
            <label
              htmlFor="watch-email-select"
              className="text-sm font-medium text-foreground"
            >
              Choose an account
            </label>
            <select
              id="watch-email-select"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={selectedEmail ?? ""}
              onChange={(event) => setSelectedEmail(event.target.value || null)}
            >
              {accounts.map((account) => (
                <option key={account.email} value={account.email}>
                  {account.email}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Status: {watchStatusLabel}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No stored Gmail accounts found. Connect an account first.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={handleRegisterWatch} disabled={disableRegister}>
          {isRegistering ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Registering…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="size-4" />
              Register Gmail watch
            </span>
          )}
        </Button>
        {hasActiveWatch ? (
          <Button
            variant="destructive"
            onClick={handleStopWatch}
            disabled={isStopping}
          >
            {isStopping ? "Ending…" : "End watch"}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Watches target the `INBOX` label by default.
        </p>
      </div>

      <div className="mt-6 space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="reply-instructions"
            className="text-sm font-medium text-foreground"
          >
            Customer support reply prompt
          </label>
          {isReplyEditing ? null : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReplyDraft(replyValue)
                setIsReplyEditing(true)
              }}
            >
              Edit prompt
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          These instructions are appended to every AI-generated response draft.
        </p>
        <Textarea
          id="reply-instructions"
          className="mt-2 h-32 resize-y"
          value={isReplyEditing ? replyDraft : replyValue}
          onChange={(event) => setReplyDraft(event.target.value)}
          disabled={!isReplyEditing || isSavingReply}
          placeholder="Add tone, escalation rules, or other customer support guidelines..."
        />
        {isReplyEditing ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveReplyPrompt}
              disabled={isSavingReply}
            >
              {isSavingReply ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                "Save prompt"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReplyDraft(replyValue)
                setIsReplyEditing(false)
              }}
              disabled={isSavingReply}
            >
              Cancel
            </Button>
          </div>
        ) : null}
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
    </div>
  )
}
