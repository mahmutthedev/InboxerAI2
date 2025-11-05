import OpenAI from "openai"

import type { GmailMessageDetail, GmailThreadDetail } from "@/lib/google-auth"

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable")
  }

  return new OpenAI({
    apiKey,
  })
}

interface ExtractQuestionsOptions {
  instructions?: string
  model?: string
}

export interface ThreadQAEntry {
  question: string
  answer: string
}

const DEFAULT_RESPONSE_MODEL = process.env.OPENAI_RESPONSE_MODEL ?? "gpt-5-nano"
const DEFAULT_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"

export async function extractQuestionsAndAnswersFromThread(
  thread: GmailThreadDetail,
  { instructions, model = DEFAULT_RESPONSE_MODEL }: ExtractQuestionsOptions = {}
): Promise<ThreadQAEntry[]> {
  const client = getOpenAIClient()

  const prompt = buildPromptForThread(thread, instructions)

  const response = await client.responses.create({
    model,
    input: prompt,
  })

  const text = cleanModelOutput(response.output_text)

  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text) as ThreadQAEntry[]
    if (!Array.isArray(parsed)) {
      throw new Error("Expected JSON array response from model")
    }
    return parsed
      .map((entry) => ({
        question: entry.question?.trim() ?? "",
        answer: entry.answer?.trim() ?? "",
      }))
      .filter((entry) => {
        if (!entry.question || !entry.answer) {
          return false
        }
        const normalizedAnswer = entry.answer.toLowerCase()
        return normalizedAnswer !== "unknown" && normalizedAnswer !== "n/a"
      })
  } catch (error) {
    console.error("Failed to parse LLM response as JSON", text, error)
    throw new Error("Model returned an invalid response. Please try again.")
  }
}

export async function embedTexts(
  texts: string[],
  model = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  if (!texts.length) {
    return []
  }

  const client = getOpenAIClient()

  const { data } = await client.embeddings.create({
    model,
    input: texts,
  })

  return data.map((item) => item.embedding)
}

function buildPromptForThread(
  thread: GmailThreadDetail,
  instructions?: string
) {
  const condensedMessages = thread.messages.map((message) =>
    formatMessageForPrompt(message)
  )

  const instructionBlock = instructions
    ? `Additional instructions from the operator:\n${instructions}\n`
    : ""

  const prompt = `
You are an email analysis assistant. Given the messages of a Gmail thread, extract any explicit questions that were asked and provide the best available answers from the thread context. If a question is unanswered, ignore it and don't include as part of the list. If there are no questions, return an empty array.

${instructionBlock}

Respond strictly in JSON array format, where each entry has the shape:
[
  {
    "question": "Question text",
    "answer": "Answer text"
  }
]

Here is the formatted thread context:
${condensedMessages.join("\n\n---\n\n")}
`.trim()

  return prompt
}

function formatMessageForPrompt(message: GmailMessageDetail) {
  const header = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    message.date ? `Date: ${message.date}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const body =
    message.bodyText?.slice(0, 4000) ??
    "No body text available for this message."

  return `${header}\nSubject: ${message.subject}\n\n${body}`.trim()
}

function cleanModelOutput(raw?: string | null): string | null {
  if (!raw) {
    return null
  }

  let text = raw.trim()

  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }

  if (!text) {
    return null
  }

  return text
}

interface ShouldRespondOptions {
  threadSubject: string
  latestMessage: GmailMessageDetail
  threadMessages: GmailMessageDetail[]
  model?: string
  instructions?: string
}

interface GenerateReplyOptions {
  threadSubject: string
  latestMessageFrom: string
  latestMessageBody: string
  qaPairs: ThreadQAEntry[]
  threadMessages: GmailMessageDetail[]
  latestMessageId?: string
  fallback?: string
  model?: string
  instructions?: string
}

export async function shouldRespondToMessage({
  threadSubject,
  latestMessage,
  threadMessages,
  model = DEFAULT_RESPONSE_MODEL,
  instructions,
}: ShouldRespondOptions): Promise<boolean> {
  const client = getOpenAIClient()

  const { latestMessageText, historyText, isFirstMessage } =
    buildThreadPromptSegments(threadMessages, latestMessage.id, latestMessage)

  const instructionBlock = instructions
    ? `Additional operator instructions:\n${instructions.trim()}\n`
    : ""

  const historyBlock = isFirstMessage
    ? "There are no earlier messages in this thread."
    : historyText
    ? `Earlier messages in this thread (oldest to newest):\n${historyText}`
    : "Earlier messages are unavailable."

  const prompt = `
You are triaging incoming customer-support email threads to decide whether an automated agent should draft a reply.

Say \`true\` only when the latest message clearly expects a response from our team (questions, requests, clarifications, issues to address). Say \`false\` for newsletters, marketing blasts, system notifications, FYI updates, or anything that should not receive an automated reply.

Return a strict JSON object: {"shouldRespond": true|false, "reason": "brief justification"}.

Thread subject: ${threadSubject}

Latest message under review:
---
${latestMessageText}
---

${isFirstMessage ? "This is the first message in the thread." : "This is part of an ongoing conversation."}

${historyBlock}

${instructionBlock}`.trim()

  try {
    const response = await client.responses.create({
      model,
      input: prompt,
    })

    const text = cleanModelOutput(response.output_text)
    if (!text) {
      return false
    }

    const parsed = JSON.parse(text) as {
      shouldRespond?: boolean
    }

    return Boolean(parsed?.shouldRespond)
  } catch (error) {
    console.error("Failed to classify email for reply", error)
    return false
  }
}

export async function generateReplyFromKnowledge({
  threadSubject,
  latestMessageFrom,
  latestMessageBody,
  qaPairs,
  threadMessages,
  latestMessageId,
  fallback = "I'm not sure how to answer that right now.",
  model = DEFAULT_RESPONSE_MODEL,
  instructions,
}: GenerateReplyOptions): Promise<string> {
  const client = getOpenAIClient()

  const qaContext = qaPairs
    .map(
      (pair, index) =>
        `${index + 1}. Q: ${pair.question}\n   A: ${pair.answer}`
    )
    .join("\n")

  const { latestMessageText, historyText, isFirstMessage } =
    buildThreadPromptSegments(
      threadMessages,
      latestMessageId,
      threadMessages.find((message) => message.id === latestMessageId) ?? null
    )

  const instructionBlock = instructions
    ? `Additional instructions for the assistant:\n${instructions.trim()}\n`
    : ""

  const historyBlock = isFirstMessage
    ? "There are no earlier messages in this thread."
    : historyText
    ? `Earlier thread context (oldest to newest):\n${historyText}`
    : "Earlier messages are unavailable."

  const prompt = `
You are an email assistant tasked with drafting a professional reply based on prior question and answer knowledge extracted from the same thread.

Thread subject: ${threadSubject}
Latest message sender: ${latestMessageFrom}
Latest message body:
"""
${latestMessageBody.trim()}
"""

${instructionBlock}

Latest message requiring your reply:
---
${latestMessageText}
---

${isFirstMessage ? "This appears to be the first message in the thread." : "This message is part of an ongoing conversation."}

${historyBlock}

Relevant Q&A knowledge (${qaPairs.length} entries):
${qaContext || "No previous Q&A pairs available."}

Write the body of the email reply only. Keep it concise, helpful, and reference the knowledge base where applicable. If the knowledge base does not contain a suitable answer, respond with exactly: "${fallback}".
`.trim()

  try {
    const response = await client.responses.create({
      model,
      input: prompt,
    })

    const text = cleanModelOutput(response.output_text)
    if (!text) {
      return fallback
    }

    return text
  } catch (error) {
    console.error("Failed to generate reply from knowledge", error)
    return fallback
  }
}

function buildThreadPromptSegments(
  threadMessages: GmailMessageDetail[],
  latestMessageId?: string,
  latestFallback?: GmailMessageDetail | null
): {
  latestMessageText: string
  historyText: string
  isFirstMessage: boolean
} {
  const normalized = Array.isArray(threadMessages)
    ? [...threadMessages]
    : []

  if (
    latestFallback &&
    !normalized.some((message) => message.id === latestFallback.id)
  ) {
    normalized.push(latestFallback)
  }

  if (!normalized.length) {
    return {
      latestMessageText: "Latest message content unavailable.",
      historyText: "",
      isFirstMessage: true,
    }
  }

  let latestIndex =
    typeof latestMessageId === "string"
      ? normalized.findIndex((message) => message.id === latestMessageId)
      : normalized.length - 1

  if (latestIndex < 0) {
    latestIndex = normalized.length - 1
  }

  const latestMessage = normalized[latestIndex]
  const historyMessages = normalized.filter((_, index) => index !== latestIndex)
  const isFirstMessage = historyMessages.length === 0

  const historyLimit = 6
  const limitedHistory =
    historyMessages.length > historyLimit
      ? historyMessages.slice(historyMessages.length - historyLimit)
      : historyMessages

  const historyText = limitedHistory
    .map((message, index) => {
      return `History message ${index + 1}:\n${formatMessageForPrompt(message)}`
    })
    .join("\n\n---\n\n")

  return {
    latestMessageText: formatMessageForPrompt(latestMessage),
    historyText,
    isFirstMessage,
  }
}
