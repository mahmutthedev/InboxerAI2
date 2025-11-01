import { cookies } from "next/headers"

import { siteConfig } from "@/config/site"
import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchRecentGmailThreads,
  type GmailAccountProfile,
  type GmailThreadSummary,
  type GoogleUserProfile,
} from "@/lib/google-auth"
import { ConnectGoogleButton } from "@/components/connect-google-button"
import { GmailThreadList } from "@/components/gmail-thread-list"
import { InitialIngestPanel } from "@/components/initial-ingest-panel"
import { SyncThreadsPanel } from "@/components/sync-threads-panel"

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
      {profile ? (
        <section className="grid gap-6">
          <InitialIngestPanel gmailThreadCount={gmail?.threadsTotal} />
        </section>
      ) : null}
    </main>
  )
}

function mapGoogleQueryToStatus(params: Record<string, string | string[]>): {
  variant: "success" | "error" | "info"
  message: string
} | null {
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
        message:
          "Google account disconnected. Connect again when you're ready.",
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
