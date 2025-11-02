import {
  fetchGmailMessageDetail,
  fetchGmailThreadDetail,
  fetchGmailHistoryMessages,
  createDraftReply,
} from "@/lib/google-auth"
import { getStoredGoogleAccount, upsertStoredGoogleAccount } from "@/lib/account-store"
import { readIngestState, updateIngestState } from "@/lib/ingest-state"
import { searchKnowledgeBase } from "@/lib/knowledge"
import { generateReplyFromKnowledge } from "@/lib/openai"

export async function processGmailHistoryNotification(
  email: string,
  historyId: string
) {
  if (!email || !historyId) {
    return { processed: 0, details: [] as string[] }
  }

  const account = await getStoredGoogleAccount(email)
  if (!account) {
    console.warn("No stored account for Gmail notification", email)
    return { processed: 0, details: [] as string[] }
  }

  const ingestState = await readIngestState()
  const startHistoryId = ingestState.historyId

  // If we don't have a baseline history ID yet, store the current one and exit.
  if (!startHistoryId) {
    await updateIngestState({ historyId })
    return { processed: 0, details: ["Initialized history cursor."] }
  }

  if (startHistoryId === historyId) {
    return { processed: 0, details: ["History already up to date."] }
  }

  const historyMessages = await fetchGmailHistoryMessages(
    account.tokens,
    startHistoryId
  )

  if (!historyMessages.length) {
    await updateIngestState({ historyId })
    return { processed: 0, details: ["No new messages in history range."] }
  }

  const accountEmail = account.email.toLowerCase()
  const processedDetails: string[] = []
  let processedCount = 0

  const uniqueByMessage = new Map<string, string>()
  for (const message of historyMessages) {
    uniqueByMessage.set(message.messageId, message.threadId)
  }

  const threadCache = new Map<string, Awaited<ReturnType<typeof fetchGmailThreadDetail>>>()

  for (const [messageId, threadId] of Array.from(uniqueByMessage.entries())) {
    try {
      const messageResult = await fetchGmailMessageDetail(
        account.tokens,
        messageId
      )

      const messageDetail = messageResult.detail
      const labelIds = messageResult.labelIds ?? []

      // Only respond to messages that are currently in the inbox (incoming mail).
      if (!labelIds.includes("INBOX")) {
        processedDetails.push(
          `[skip] Message ${messageId} not labelled as INBOX.`
        )
        continue
      }

      if (messageDetail.from.toLowerCase().includes(accountEmail)) {
        processedDetails.push(
          `[skip] Message ${messageId} was sent by the account itself.`
        )
        continue
      }

      const thread =
        threadCache.get(threadId) ??
        (await fetchGmailThreadDetail(account.tokens, threadId))
      threadCache.set(threadId, thread)

      const qaPairs = await searchKnowledgeBase(
        `${thread.subject ?? ""}\n${messageDetail.bodyText}`,
        { limit: 6 }
      )

      const replyBody = await generateReplyFromKnowledge({
        threadSubject: thread.subject ?? messageDetail.subject,
        latestMessageFrom: messageDetail.from,
        latestMessageBody: messageDetail.bodyText ?? "",
        qaPairs,
        fallback: "I don't know the answer.",
      })

      const references = messageDetail.referencesHeader
        ? messageDetail.referencesHeader.split(/\s+/).filter(Boolean)
        : []

      if (messageDetail.messageIdHeader) {
        references.push(messageDetail.messageIdHeader)
      }

      await createDraftReply(account.tokens, {
        threadId,
        to: messageDetail.from,
        subject: thread.subject ?? messageDetail.subject,
        body: replyBody,
        inReplyTo: messageDetail.messageIdHeader,
        references: references.length ? references : undefined,
      })

      processedCount += 1
      processedDetails.push(
        `[draft] Responded to ${messageDetail.from} in thread ${threadId}.`
      )
    } catch (error) {
      console.error("Failed to process message for draft reply", {
        email,
        messageId,
        threadId,
        error,
      })
      processedDetails.push(
        `[error] Unable to process message ${messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  await updateIngestState({ historyId })

  // Persist any token refreshes (Google SDK mutates credentials in place).
  await upsertStoredGoogleAccount({
    email: account.email,
    tokens: account.tokens,
    profile: account.profile,
    gmail: account.gmail,
  })

  return { processed: processedCount, details: processedDetails }
}
