import { cookies } from "next/headers"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  type GmailAccountProfile,
  type GoogleUserProfile,
} from "@/lib/google-auth"
import { ConnectGoogleButton } from "@/components/connect-google-button"
import { InitialIngestPanel } from "@/components/initial-ingest-panel"
import { GoogleWatchPanel } from "@/components/google-watch-panel"

const INITIAL_INGEST_MAX_THREADS = Number(
  process.env.INITIAL_INGEST_MAX_THREADS ?? "200"
)
const NORMALIZED_INITIAL_INGEST_MAX_THREADS =
  Number.isFinite(INITIAL_INGEST_MAX_THREADS) && INITIAL_INGEST_MAX_THREADS > 0
    ? Math.floor(INITIAL_INGEST_MAX_THREADS)
    : null
const HAS_PUBSUB_TOPIC = Boolean(process.env.GMAIL_PUBSUB_TOPIC)

export default async function IndexPage() {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get(GOOGLE_OAUTH_SESSION_COOKIE)
  const session = sessionCookie?.value
    ? decodeOAuthSessionCookie(sessionCookie.value)
    : null

  const profile: GoogleUserProfile | null = session?.profile ?? null
  const gmail: GmailAccountProfile | null = session?.gmail ?? null
  const defaultEmail = profile?.email ?? gmail?.emailAddress ?? null

  return (
    <main className="container flex flex-col gap-12 pb-12 pt-8">
      <section className="grid gap-6">
        <ConnectGoogleButton profile={profile} gmail={gmail} />
        {profile ? (
          <>
            <GoogleWatchPanel
              defaultEmail={defaultEmail}
              hasPubsubTopic={HAS_PUBSUB_TOPIC}
            />
            <InitialIngestPanel
              gmailThreadCount={gmail?.threadsTotal}
              initialIngestMaxThreads={NORMALIZED_INITIAL_INGEST_MAX_THREADS}
            />
          </>
        ) : null}
      </section>
    </main>
  )
}
