import { promises as fs } from "fs"
import path from "path"

export interface GmailIngestState {
  historyId?: string
  processedThreadIds: string[]
  totalThreadsDetected?: number
  lastFullIngestAt?: string
  lastPreviewAt?: string
  lastUpdatedAt?: string
  rules?: string
}

const STATE_DIR = path.join(process.cwd(), "data")
const STATE_PATH = path.join(STATE_DIR, "ingest-state.json")

const defaultState: GmailIngestState = {
  processedThreadIds: [],
  rules: "",
}

async function ensureStateDir() {
  await fs.mkdir(STATE_DIR, { recursive: true })
}

export async function readIngestState(): Promise<GmailIngestState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8")
    const parsed = JSON.parse(raw) as Partial<GmailIngestState>
    return normalizeState(parsed)
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { ...defaultState }
    }
    throw error
  }
}

export async function writeIngestState(state: GmailIngestState) {
  await ensureStateDir()
  const normalized = normalizeState(state)
  normalized.lastUpdatedAt = new Date().toISOString()
  await fs.writeFile(STATE_PATH, JSON.stringify(normalized, null, 2), "utf8")
}

export async function updateIngestState(update: Partial<GmailIngestState>) {
  const current = await readIngestState()
  const merged = mergeState(current, update)
  await writeIngestState(merged)
  return merged
}

export async function addProcessedThreads(threadIds: string[]) {
  if (!threadIds?.length) {
    return readIngestState()
  }
  const state = await readIngestState()
  const set = new Set(state.processedThreadIds)
  for (const id of threadIds) {
    if (id) {
      set.add(id)
    }
  }
  state.processedThreadIds = Array.from(set)
  state.lastFullIngestAt = new Date().toISOString()
  await writeIngestState(state)
  return state
}

export function summarizeState(state: GmailIngestState) {
  return {
    processedThreads: state.processedThreadIds.length,
    historyId: state.historyId ?? null,
    totalThreadsDetected: state.totalThreadsDetected ?? null,
    lastFullIngestAt: state.lastFullIngestAt ?? null,
    lastPreviewAt: state.lastPreviewAt ?? null,
    lastUpdatedAt: state.lastUpdatedAt ?? null,
    rules: state.rules ?? "",
  }
}

function normalizeState(
  partial: Partial<GmailIngestState>
): GmailIngestState {
  return {
    processedThreadIds: Array.isArray(partial.processedThreadIds)
      ? Array.from(new Set(partial.processedThreadIds.filter(Boolean)))
      : [],
    historyId: partial.historyId,
    totalThreadsDetected: partial.totalThreadsDetected,
    lastFullIngestAt: partial.lastFullIngestAt,
    lastPreviewAt: partial.lastPreviewAt,
    lastUpdatedAt: partial.lastUpdatedAt,
    rules:
      typeof partial.rules === "string"
        ? partial.rules
        : "",
  }
}

function mergeState(
  current: GmailIngestState,
  update: Partial<GmailIngestState>
): GmailIngestState {
  const merged = { ...current }

  if (update.historyId) {
    merged.historyId = update.historyId
  }

  if (typeof update.totalThreadsDetected === "number") {
    merged.totalThreadsDetected = update.totalThreadsDetected
  }

  if (update.lastFullIngestAt) {
    merged.lastFullIngestAt = update.lastFullIngestAt
  }

  if (update.lastPreviewAt) {
    merged.lastPreviewAt = update.lastPreviewAt
  }

  if (Array.isArray(update.processedThreadIds)) {
    const set = new Set(merged.processedThreadIds)
    for (const id of update.processedThreadIds) {
      if (id) {
        set.add(id)
      }
    }
    merged.processedThreadIds = Array.from(set)
  }

  if (update.rules !== undefined) {
    merged.rules = update.rules ?? ""
  }

  return merged
}
