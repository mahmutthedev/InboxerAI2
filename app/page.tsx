import { cookies } from "next/headers"

import { ConnectGoogleButton } from "@/components/connect-google-button"
import { GmailThreadList } from "@/components/gmail-thread-list"
import { SyncThreadsPanel } from "@/components/sync-threads-panel"
import { siteConfig } from "@/config/site"
import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchRecentGmailThreads,
  type GmailAccountProfile,
  type GmailThreadSummary,
  type GoogleUserProfile,
} from "@/lib/google-auth"

interface IndexPageProps {
  searchParams?: Record<string, string | string[]>
}

export default async function IndexPage({ searchParams = {} }: IndexPageProps) {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get(GOOGLE_OAUTH_SESSION_COOKIE)
  const session = sessionCookie?.value
    ? decodeOAuthSessionCookie(sessionCookie.value)
    : null

  const profile: GoogleUserProfile | null = session?.profile ?? null
  const gmail: GmailAccountProfile | null = session?.gmail ?? null
  const status = mapGoogleQueryToStatus(searchParams)

  let recentThreads: GmailThreadSummary[] = []
  let threadsError: string | null = null

  if (session?.tokens) {
    try {
      recentThreads = await fetchRecentGmailThreads(session.tokens, {
        maxResults: 10,
      })
    } catch (error) {
      console.error("Failed to fetch recent Gmail threads", error)
      threadsError =
        "We could not load your Gmail threads. Refresh the page to try again."
    }
  }

  return (
    <main className="container flex flex-col gap-12 pb-12 pt-8">
      <section className="grid gap-10 lg:grid-cols-[1.7fr,1fr]">
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-sm font-medium text-primary">
              {siteConfig.tagline}
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Build a reply-ready inbox with AI-powered context.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              InboxerAI connects to Gmail, understands every thread with large
              language models, and stores question &amp; answer summaries that
              power automated, context-aware replies.
            </p>
          </div>
          <div className="space-y-4">
            <ConnectGoogleButton profile={profile} gmail={gmail} />
            {status ? (
              <p
                className={`text-sm ${
                  status.variant === "success"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : status.variant === "info"
                    ? "text-muted-foreground"
                    : "text-destructive"
                }`}
              >
                {status.message}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              You will be prompted to grant Gmail read access. We request
              offline access so InboxerAI can periodically ingest new threads.
            </p>
            {profile ? (
              <SyncThreadsPanel threads={recentThreads} />
            ) : null}
          </div>
        </div>
        <aside className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Recent Gmail threads
            </h2>
            {gmail ? (
              <span className="text-xs text-muted-foreground">
                {gmail.threadsTotal.toLocaleString()} total threads
              </span>
            ) : null}
          </div>
          <div className="space-y-3">
            {profile ? (
              <GmailThreadList threads={recentThreads} error={threadsError} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect your Gmail account to preview the latest threads here.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Only metadata is shown here. Full message bodies stay in Gmail until
            they are processed by the ingestion pipeline.
          </p>
        </aside>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        {FEATURE_POINTS.map((feature) => (
          <div
            key={feature.title}
            className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm"
          >
            <h3 className="text-lg font-semibold text-foreground">
              {feature.title}
            </h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </section>
    </main>
  )
}

const FEATURE_POINTS = [
  {
    title: "Thread Intelligence",
    description:
      "Extract question & answer pairs from every Gmail conversation so replies reflect the full history.",
  },
  {
    title: "Vector Knowledge Base",
    description:
      "Push structured summaries into Qdrant for fast semantic retrieval when new messages arrive.",
  },
  {
    title: "Composable Prompts",
    description:
      "Tune the prompting library and processing settings directly in InboxerAI as your workflows evolve.",
  },
]

function mapGoogleQueryToStatus(
  params: Record<string, string | string[]>
):
  | {
      variant: "success" | "error" | "info"
      message: string
    }
  | null {
  const google = getQueryValue(params.google)
  const reason = getQueryValue(params.reason)

  if (!google) {
    return null
  }

  switch (google) {
    case "connected":
      return {
        variant: "success",
        message:
          "Google account connected. Your inbox is ready to be ingested.",
      }
    case "disconnected":
      return {
        variant: "info",
        message: "Google account disconnected. Connect again when you're ready.",
      }
    case "error":
      return {
        variant: "error",
        message: describeError(reason),
      }
    default:
      return null
  }
}

function getQueryValue(
  value: string | string[] | undefined
): string | undefined {
  if (!value) {
    return undefined
  }

  return Array.isArray(value) ? value[0] : value
}

function describeError(reason?: string): string {
  switch (reason) {
    case "missing_code":
      return "We could not read the authorization code from Google."
    case "invalid_state":
      return "The Google sign-in attempt was interrupted. Please try again."
    case "oauth_failure":
      return "Google rejected the sign-in request. Confirm your credentials and try again."
    default:
      return "We could not connect to Google. Please try again."
  }
}
