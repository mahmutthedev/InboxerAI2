"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface AccountSummary {
  email: string
  updatedAt: string
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
  const [isLoading, setIsLoading] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<string | null>(
    defaultEmail ?? null
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusVariant, setStatusVariant] = useState<
    "success" | "error" | "info"
  >("info")

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)
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
      })
      .catch((error) => {
        console.error("Unable to load stored accounts", error)
        if (!isMounted) return
        setStatusVariant("error")
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Unable to load stored accounts."
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

  const disableRegister = useMemo(() => {
    if (!hasPubsubTopic) {
      return true
    }
    if (!accounts.length) {
      return true
    }
    if (!selectedEmail) {
      return true
    }
    if (isRegistering) {
      return true
    }
    return false
  }, [accounts.length, hasPubsubTopic, isRegistering, selectedEmail])

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
        headers: {
          "Content-Type": "application/json",
        },
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

      const expiration = data?.expiration
        ? new Date(Number(data.expiration)).toLocaleString()
        : null
      const historyId = data?.historyId ?? "unknown"

      setStatusVariant("success")
      setStatusMessage(
        `Watch registered for ${selectedEmail}. History ID ${historyId}${
          expiration ? `, expires ${expiration}` : ""
        }.`
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
              Watches expire after ~24 hours. Re-run this when necessary.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No stored Gmail accounts found. Connect an account first.
          </p>
        )}
      </div>

  <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={handleRegisterWatch}
          disabled={disableRegister}
        >
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
        <p className="text-xs text-muted-foreground">
          Watches target the `INBOX` label by default.
        </p>
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
