import {
  fetchGmailMessageDetail,
  fetchGmailThreadDetail,
  fetchGmailHistoryMessages,
  createDraftReply,
} from "@/lib/google-auth"
import { getStoredGoogleAccount, upsertStoredGoogleAccount } from "@/lib/account-store"
import { readIngestState, updateIngestState } from "@/lib/ingest-state"
import { searchKnowledgeBase } from "@/lib/knowledge"
import {
  generateReplyFromKnowledge,
  shouldRespondToMessage,
} from "@/lib/openai"

export async function processGmailHistoryNotification(
  email: string,
  historyId: string
) {
  console.info("[gmail-automation] Received notification", {
    email,
    historyId,
  })

  if (!email || !historyId) {
    console.warn("[gmail-automation] Missing email or historyId", {
      email,
      historyId,
    })
    return { processed: 0, details: [] as string[] }
  }

  const account = await getStoredGoogleAccount(email)
  if (!account) {
    console.warn("No stored account for Gmail notification", email)
    return { processed: 0, details: [] as string[] }
  }

  const ingestState = await readIngestState()
  const startHistoryId = ingestState.historyId
  const replyInstructions = ingestState.replyInstructions ?? ""
  console.info("[gmail-automation] Current history cursor", {
    startHistoryId,
  })

  const incomingHistory = parseHistoryId(historyId)
  if (!incomingHistory) {
    console.warn("[gmail-automation] Unable to parse historyId", { historyId })
    return { processed: 0, details: ["Invalid historyId received."] }
  }

  // If we don't have a baseline history ID yet, store the current one and exit.
  if (!startHistoryId) {
    await updateIngestState({ historyId })
    console.info(
      "[gmail-automation] Initialized ingest state history cursor",
      historyId
    )
    return { processed: 0, details: ["Initialized history cursor."] }
  }

  const startHistory = parseHistoryId(startHistoryId)

  if (startHistory && incomingHistory <= startHistory) {
    console.info("[gmail-automation] Notification is older than cursor; ignoring.", {
      historyId,
      startHistoryId,
    })
    return {
      processed: 0,
      details: ["Notification already processed; cursor ahead."],
    }
  }

  if (startHistoryId === historyId) {
    console.info("[gmail-automation] History already up to date")
    return { processed: 0, details: ["History already up to date."] }
  }

  const historyMessages = await fetchGmailHistoryMessages(
    account.tokens,
    startHistoryId
  )
  console.info("[gmail-automation] History delta size", {
    count: historyMessages.length,
  })

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

  console.info("[gmail-automation] Unique new messages", {
    count: uniqueByMessage.size,
  })

  const threadCache = new Map<string, Awaited<ReturnType<typeof fetchGmailThreadDetail>>>()

  for (const [messageId, threadId] of Array.from(uniqueByMessage.entries())) {
    try {
      console.info("[gmail-automation] Processing message", {
        messageId,
        threadId,
      })

      const messageResult = await fetchGmailMessageDetail(
        account.tokens,
        messageId
      )

      const messageDetail = messageResult.detail
      const labelIds = messageResult.labelIds ?? []

      // Only respond to messages that are currently in the inbox (incoming mail).
      if (!labelIds.includes("INBOX")) {
        console.debug(
          "[gmail-automation] Skipping message not in inbox",
          messageId
        )
        processedDetails.push(
          `[skip] Message ${messageId} not labelled as INBOX.`
        )
        continue
      }

      if (messageDetail.from.toLowerCase().includes(accountEmail)) {
        console.debug(
          "[gmail-automation] Skipping self-sent message",
          messageId
        )
        processedDetails.push(
          `[skip] Message ${messageId} was sent by the account itself.`
        )
        continue
      }

      const thread =
        threadCache.get(threadId) ??
        (await fetchGmailThreadDetail(account.tokens, threadId))
      threadCache.set(threadId, thread)
      console.debug("[gmail-automation] Loaded thread summary", {
        threadId,
        subject: thread.subject,
      })

      const threadMessagesForPrompt = Array.isArray(thread.messages)
        ? [...thread.messages]
        : []

      if (
        messageDetail &&
        !threadMessagesForPrompt.some((message) => message.id === messageDetail.id)
      ) {
        threadMessagesForPrompt.push(messageDetail)
      }

      const shouldReply = await shouldRespondToMessage({
        threadSubject: thread.subject ?? messageDetail.subject,
        latestMessage: messageDetail,
        threadMessages: threadMessagesForPrompt,
        instructions: replyInstructions,
      })

      if (!shouldReply) {
        console.debug(
          "[gmail-automation] Classifier opted not to respond to message",
          messageId
        )
        processedDetails.push(
          `[skip] Classifier skipped automated reply for message ${messageId}.`
        )
        continue
      }

      const qaPairs = await searchKnowledgeBase(
        `${thread.subject ?? ""}\n${messageDetail.bodyText}`,
        { limit: 6 }
      )
      console.debug("[gmail-automation] Retrieved knowledge pairs", {
        count: qaPairs.length,
      })

      const replyBody = await generateReplyFromKnowledge({
        threadSubject: thread.subject ?? messageDetail.subject,
        latestMessageFrom: messageDetail.from,
        latestMessageBody: messageDetail.bodyText ?? "",
        qaPairs,
        threadMessages: threadMessagesForPrompt,
        latestMessageId: messageDetail.id,
        fallback: "I don't know the answer.",
        instructions: replyInstructions,
      })

      console.debug("[gmail-automation] Generated reply body length", {
        length: replyBody.length,
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
      console.error("[gmail-automation] Draft creation failed", {
        messageId,
        threadId,
        error,
      })
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
  console.info("[gmail-automation] Updated history cursor", { historyId })

  // Persist any token refreshes (Google SDK mutates credentials in place).
  await upsertStoredGoogleAccount({
    email: account.email,
    tokens: account.tokens,
    profile: account.profile,
    gmail: account.gmail,
  })

  console.info("[gmail-automation] Processing complete", {
    processedCount,
  })

  return { processed: processedCount, details: processedDetails }
}

function parseHistoryId(value?: string | null): bigint | null {
  if (!value) {
    return null
  }
  try {
    return BigInt(value)
  } catch {
    return null
  }
}
