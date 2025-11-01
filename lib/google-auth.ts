import { randomBytes } from "crypto"

import { google } from "googleapis"
import type { gmail_v1 } from "googleapis"
import type { Credentials, OAuth2Client } from "google-auth-library"

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
]

export interface GoogleUserProfile {
  email: string
  name?: string
  picture?: string
}

export interface GmailAccountProfile {
  emailAddress: string
  messagesTotal: number
  threadsTotal: number
  historyId?: string
}

export interface GoogleOAuthSessionPayload {
  tokens: Credentials
  profile: GoogleUserProfile
  gmail: GmailAccountProfile
}

export interface GmailThreadSummary {
  id: string
  subject: string
  snippet?: string
  lastMessageDate?: string
  createdAt?: string
  from: string
  to: string
  messageCount: number
}

export interface GmailMessageDetail {
  id: string
  subject: string
  from: string
  to: string
  date?: string
  snippet?: string
  bodyText: string
}

export interface GmailThreadDetail extends GmailThreadSummary {
  messages: GmailMessageDetail[]
}

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state"
export const GOOGLE_OAUTH_SESSION_COOKIE = "google_oauth_session"

export function assertGoogleEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required Google OAuth environment variable: ${name}`)
  }

  return value
}

export function getGoogleOAuthClient(redirectUri: string): OAuth2Client {
  return createOAuthClient(redirectUri)
}

function createOAuthClient(redirectUri?: string): OAuth2Client {
  const clientId = assertGoogleEnv("GOOGLE_CLIENT_ID")
  const clientSecret = assertGoogleEnv("GOOGLE_CLIENT_SECRET")
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function createGoogleAuthUrl({
  redirectUri,
  state,
}: {
  redirectUri: string
  state: string
}) {
  const oauthClient = getGoogleOAuthClient(redirectUri)

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_OAUTH_SCOPES,
    prompt: "consent",
    include_granted_scopes: true,
    state,
  })
}

export async function exchangeGoogleCodeForTokens({
  code,
  redirectUri,
}: {
  code: string
  redirectUri: string
}): Promise<Credentials> {
  const oauthClient = getGoogleOAuthClient(redirectUri)
  const { tokens } = await oauthClient.getToken(code)

  if (!tokens) {
    throw new Error("Failed to exchange Google authorization code for tokens")
  }

  return tokens
}

export async function fetchGoogleProfile(tokens: Credentials): Promise<GoogleUserProfile> {
  const oauthClient = createOAuthClient()
  oauthClient.setCredentials(tokens)

  const oauth2 = google.oauth2({
    version: "v2",
    auth: oauthClient,
  })

  const { data } = await oauth2.userinfo.get()

  if (!data || !data.email) {
    throw new Error("Unable to retrieve Google account information")
  }

  return {
    email: data.email,
    name: data.name || undefined,
    picture: data.picture || undefined,
  }
}

export async function fetchGmailAccountProfile(
  tokens: Credentials
): Promise<GmailAccountProfile> {
  const oauthClient = createOAuthClient()
  oauthClient.setCredentials(tokens)

  const gmail = google.gmail({ version: "v1", auth: oauthClient })
  const { data } = await gmail.users.getProfile({ userId: "me" })

  if (!data.emailAddress) {
    throw new Error("Unable to fetch Gmail profile for this account")
  }

  return {
    emailAddress: data.emailAddress,
    messagesTotal: data.messagesTotal ?? 0,
    threadsTotal: data.threadsTotal ?? 0,
    historyId: data.historyId ?? undefined,
  }
}

export function createOAuthStateCookieValue() {
  return randomBytes(16).toString("hex")
}

export async function fetchRecentGmailThreads(
  tokens: Credentials,
  options: { maxResults?: number } = {}
): Promise<GmailThreadSummary[]> {
  const oauthClient = createOAuthClient()
  oauthClient.setCredentials(tokens)

  const gmail = google.gmail({ version: "v1", auth: oauthClient })
  const threadListResponse = await gmail.users.threads.list({
    userId: "me",
    labelIds: ["INBOX"],
    maxResults: options.maxResults ?? 10,
    includeSpamTrash: false,
  })

  const threadIds =
    threadListResponse.data.threads?.map((thread) => thread.id).filter(Boolean) ?? []

  if (!threadIds.length) {
    return []
  }

  const threadSummaries = await Promise.all(
    threadIds.map(async (threadId) => {
      try {
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: threadId!,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        })

        return buildThreadSummary(thread.data)
      } catch (error) {
        console.error("Unable to load Gmail thread", threadId, error)
        return null
      }
    })
  )

  return threadSummaries.filter(
    (summary): summary is GmailThreadSummary => summary !== null
  )
}

export async function fetchAllGmailThreadIds(
  tokens: Credentials,
  options: { maxThreads?: number; labelIds?: string[] } = {}
): Promise<string[]> {
  const oauthClient = createOAuthClient()
  oauthClient.setCredentials(tokens)

  const gmail = google.gmail({ version: "v1", auth: oauthClient })

  const maxThreads =
    options.maxThreads ??
    Number(process.env.INITIAL_INGEST_MAX_THREADS ?? "200")
  const labelIds = options.labelIds ?? ["INBOX"]

  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const response = await gmail.users.threads.list({
      userId: "me",
      labelIds,
      pageToken,
      maxResults: 100,
      includeSpamTrash: false,
    })

    const pageIds =
      response.data.threads?.map((thread) => thread.id).filter(Boolean) ?? []
    ids.push(...(pageIds as string[]))

    if (ids.length >= maxThreads) {
      return ids.slice(0, maxThreads)
    }

    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return ids
}

export async function fetchGmailThreadDetail(
  tokens: Credentials,
  threadId: string
): Promise<GmailThreadDetail> {
  const oauthClient = createOAuthClient()
  oauthClient.setCredentials(tokens)

  const gmail = google.gmail({ version: "v1", auth: oauthClient })
  const { data } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  })

  if (!data || !data.id) {
    throw new Error("Unable to load Gmail thread details")
  }

  const summary = buildThreadSummary(data)

  if (!summary) {
    throw new Error("Unable to derive summary for Gmail thread")
  }

  const messages = (data.messages ?? []).map((message) =>
    buildMessageDetail(message)
  )

  return {
    ...summary,
    messages,
  }
}

export function encodeOAuthSessionCookie(payload: GoogleOAuthSessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

export function decodeOAuthSessionCookie(
  value: string
): GoogleOAuthSessionPayload | null {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8")
    return JSON.parse(json) as GoogleOAuthSessionPayload
  } catch (error) {
    return null
  }
}

function buildThreadSummary(thread: gmail_v1.Schema$Thread): GmailThreadSummary | null {
  if (!thread.id) {
    return null
  }

  const messages = thread.messages ?? []
  if (!messages.length) {
    return {
      id: thread.id,
      subject: "No subject",
      snippet: thread.snippet ?? undefined,
      lastMessageDate: undefined,
      createdAt: undefined,
      from: "Unknown sender",
      to: "Unknown recipient",
      messageCount: 0,
    }
  }

  const lastMessage = messages[messages.length - 1]
  const headers = lastMessage?.payload?.headers ?? []
  const firstMessage = messages[0]
  const firstHeaders = firstMessage?.payload?.headers ?? []

  const subject = extractHeader(headers, "Subject") || "No subject"
  const from = formatAddressHeader(extractHeader(headers, "From"))
  const to = formatAddressHeader(extractHeader(headers, "To"))
  const date = extractHeader(headers, "Date") || undefined
  const createdAt = extractHeader(firstHeaders, "Date") || undefined

  return {
    id: thread.id,
    subject,
    snippet: lastMessage?.snippet ?? thread.snippet ?? undefined,
    lastMessageDate: date,
    createdAt,
    from,
    to,
    messageCount: messages.length,
  }
}

function buildMessageDetail(message: gmail_v1.Schema$Message): GmailMessageDetail {
  const headers = message.payload?.headers ?? []
  const subject = extractHeader(headers, "Subject") || "No subject"
  const from = formatAddressHeader(extractHeader(headers, "From"))
  const to = formatAddressHeader(extractHeader(headers, "To"))
  const date = extractHeader(headers, "Date") || undefined
  const snippet = message.snippet ?? undefined
  const bodyText = extractMessageBody(message.payload)

  return {
    id: message.id ?? cryptoRandomId(),
    subject,
    from,
    to,
    date,
    snippet,
    bodyText,
  }
}

function extractHeader(
  headers: gmail_v1.Schema$MessagePartHeader[],
  name: string
): string | undefined {
  const header = headers.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase()
  )
  return header?.value ?? undefined
}

function formatAddressHeader(rawValue?: string): string {
  if (!rawValue) {
    return "Unknown"
  }

  const addresses = parseAddressList(rawValue)
  if (!addresses.length) {
    return "Unknown"
  }

  if (addresses.length === 1) {
    return addresses[0]
  }

  if (addresses.length === 2) {
    return `${addresses[0]}, ${addresses[1]}`
  }

  return `${addresses[0]}, ${addresses[1]} +${addresses.length - 2}`
}

function parseAddressList(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => formatSingleAddress(entry))
}

function formatSingleAddress(value: string): string {
  const match = value.match(/^(.*)<(.+?)>$/)
  if (match) {
    const name = match[1].trim().replace(/^"(.+)"$/, "$1")
    const email = match[2].trim()
    return name ? `${name} <${email}>` : email
  }

  return value
}

function extractMessageBody(
  payload?: gmail_v1.Schema$MessagePart | null
): string {
  if (!payload) {
    return ""
  }

  const parts = flattenMessageParts(payload)

  const plain = parts.find(
    (part) => part.mimeType === "text/plain" && part.body?.data
  )
  if (plain?.body?.data) {
    return decodeMessageBody(plain.body.data)
  }

  const html = parts.find(
    (part) => part.mimeType === "text/html" && part.body?.data
  )
  if (html?.body?.data) {
    return stripHtml(decodeMessageBody(html.body.data))
  }

  if (payload.body?.data) {
    return decodeMessageBody(payload.body.data)
  }

  return ""
}

function flattenMessageParts(
  part: gmail_v1.Schema$MessagePart | null | undefined
): gmail_v1.Schema$MessagePart[] {
  if (!part) return []
  const parts: gmail_v1.Schema$MessagePart[] = [part]
  if (part.parts?.length) {
    for (const child of part.parts) {
      parts.push(...flattenMessageParts(child))
    }
  }
  return parts
}

function decodeMessageBody(data: string): string {
  const sanitized = data.replace(/-/g, "+").replace(/_/g, "/")
  try {
    return Buffer.from(sanitized, "base64").toString("utf8")
  } catch {
    return ""
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cryptoRandomId() {
  return randomBytes(8).toString("hex")
}
