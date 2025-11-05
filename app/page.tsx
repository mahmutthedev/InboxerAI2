import { cookies } from "next/headers"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  type GmailAccountProfile,
  type GoogleUserProfile,
} from "@/lib/google-auth"
import { ConnectGoogleButton } from "@/components/connect-google-button"
import { GoogleWatchPanel } from "@/components/google-watch-panel"
import { InitialIngestPanel } from "@/components/initial-ingest-panel"

const HAS_PUBSUB_TOPIC = Boolean(process.env.GMAIL_PUBSUB_TOPIC)

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
  const defaultEmail = profile?.email ?? gmail?.emailAddress ?? null
  const status = mapGoogleQueryToStatus(searchParams)

  return (
    <main className="container flex flex-col gap-12 pb-12 pt-8">
      <section className="grid gap-6">
        {status ? (
          <div
            className={`rounded-lg border border-border px-4 py-3 text-sm ${
              status.variant === "success"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : status.variant === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted/60 text-muted-foreground"
            }`}
          >
            {status.message}
          </div>
        ) : null}
        <ConnectGoogleButton profile={profile} gmail={gmail} />
        {profile ? (
          <>
            <GoogleWatchPanel
              defaultEmail={defaultEmail}
              hasPubsubTopic={HAS_PUBSUB_TOPIC}
            />
            <InitialIngestPanel
              gmailThreadCount={gmail?.threadsTotal}
            />
          </>
        ) : null}
      </section>
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
