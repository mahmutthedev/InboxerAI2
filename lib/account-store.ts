import { promises as fs } from "fs"
import path from "path"

import type { Credentials } from "google-auth-library"

import type {
  GmailAccountProfile,
  GoogleUserProfile,
} from "@/lib/google-auth"

interface StoredGoogleAccount {
  email: string
  tokens: Credentials
  profile: GoogleUserProfile
  gmail: GmailAccountProfile
  updatedAt: string
}

interface AccountsFile {
  accounts: StoredGoogleAccount[]
}

const DATA_DIR = path.join(process.cwd(), "data")
const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json")

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function readAccountsFile(): Promise<AccountsFile> {
  try {
    const raw = await fs.readFile(ACCOUNTS_PATH, "utf8")
    const parsed = JSON.parse(raw) as Partial<AccountsFile>
    if (!Array.isArray(parsed?.accounts)) {
      return { accounts: [] }
    }
    return {
      accounts: parsed.accounts.map((entry) => ({
        email: entry.email,
        tokens: entry.tokens as Credentials,
        profile: entry.profile as GoogleUserProfile,
        gmail: entry.gmail as GmailAccountProfile,
        updatedAt: entry.updatedAt ?? new Date().toISOString(),
      })),
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { accounts: [] }
    }
    throw error
  }
}

export async function listStoredGoogleAccounts() {
  const file = await readAccountsFile()
  return file.accounts
}

export async function getStoredGoogleAccount(email: string) {
  if (!email) {
    return null
  }
  const file = await readAccountsFile()
  return file.accounts.find(
    (account) => account.email.toLowerCase() === email.toLowerCase()
  ) ?? null
}

export async function upsertStoredGoogleAccount({
  email,
  tokens,
  profile,
  gmail,
}: {
  email: string
  tokens: Credentials
  profile: GoogleUserProfile
  gmail: GmailAccountProfile
}) {
  if (!email) {
    throw new Error("Email is required to store Google account credentials.")
  }

  await ensureDataDir()

  const existingFile = await readAccountsFile()
  const accounts = [...existingFile.accounts]
  const index = accounts.findIndex(
    (account) => account.email.toLowerCase() === email.toLowerCase()
  )

  let mergedTokens = tokens

  if (index >= 0) {
    const existing = accounts[index]
    if (existing?.tokens && !tokens.refresh_token && existing.tokens.refresh_token) {
      mergedTokens = {
        ...existing.tokens,
        ...tokens,
        refresh_token: existing.tokens.refresh_token,
      }
    }
    accounts[index] = {
      email,
      tokens: mergedTokens,
      profile,
      gmail,
      updatedAt: new Date().toISOString(),
    }
  } else {
    accounts.push({
      email,
      tokens: mergedTokens,
      profile,
      gmail,
      updatedAt: new Date().toISOString(),
    })
  }

  await fs.writeFile(
    ACCOUNTS_PATH,
    JSON.stringify({ accounts }, null, 2),
    "utf8"
  )

  return accounts.find(
    (account) => account.email.toLowerCase() === email.toLowerCase()
  )!
}
