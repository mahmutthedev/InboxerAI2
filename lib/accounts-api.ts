import { listStoredGoogleAccounts } from "@/lib/account-store"

export async function getAccountsSummary() {
  const accounts = await listStoredGoogleAccounts()
  return accounts.map((account) => ({
    email: account.email,
    updatedAt: account.updatedAt,
  }))
}
