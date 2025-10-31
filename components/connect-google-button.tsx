/* eslint-disable @next/next/no-img-element */
"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import type {
  GmailAccountProfile,
  GoogleUserProfile,
} from "@/lib/google-auth"

interface ConnectGoogleButtonProps {
  profile?: GoogleUserProfile | null
  gmail?: GmailAccountProfile | null
}

export function ConnectGoogleButton({ profile, gmail }: ConnectGoogleButtonProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDisconnect = async () => {
    setError(null)
    setIsDisconnecting(true)

    try {
      const response = await fetch("/api/auth/google/disconnect", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to disconnect from Google")
      }

      window.location.href = "/?google=disconnected"
    } catch (disconnectError) {
      console.error(disconnectError)
      setError("We could not disconnect your account. Please try again.")
      setIsDisconnecting(false)
    }
  }

  if (profile) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-3">
          {profile.picture ? (
            <img
              src={profile.picture}
              alt={profile.name ?? profile.email}
              className="size-10 rounded-full border border-border"
              referrerPolicy="no-referrer"
            />
          ) : (
          <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold uppercase">
              {profile.email.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-foreground">
              Connected as {profile.name ?? profile.email}
            </p>
            {profile.name ? (
              <p className="text-sm text-muted-foreground">{profile.email}</p>
            ) : null}
            {gmail ? (
              <p className="text-xs text-muted-foreground">
                {gmail.threadsTotal.toLocaleString()} threads •{" "}
                {gmail.messagesTotal.toLocaleString()} messages indexed
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? "Disconnecting..." : "Disconnect"}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <Button
      className="flex items-center gap-3 bg-white text-foreground shadow-sm transition hover:bg-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
      asChild
    >
      <a href="/api/auth/google">
        <GoogleMark />
        <span>Connect Google Mail</span>
      </a>
    </Button>
  )
}

function GoogleMark() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 533.5 544.3"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M533.5 278.4c0-18.5-1.5-37-4.6-55H272v104h146.9c-6.3 34-25.8 63-55 82.1v68.1h88.8c52.1-48.1 80.8-119 80.8-199.2z"
        fill="#4285f4"
      />
      <path
        d="M272 544.3c74.7 0 137.4-24.7 183.2-67.5l-88.8-68.1c-24.7 16.6-56.3 26-94.4 26-72.5 0-134-48.9-155.9-114.6H24.6v71.8c45.3 89.4 137.8 152.4 247.4 152.4z"
        fill="#34a853"
      />
      <path
        d="M116.1 320.1c-11.5-34-11.5-70.2 0-104.2v-71.8H24.6c-49.6 98.9-49.6 216.9 0 315.8l91.5-71.8z"
        fill="#fbbc04"
      />
      <path
        d="M272 107.7c39.4-.6 77.5 14.7 106.1 42.6l79.3-79.3C432.3 24.5 358.2-4 272 0 162.4 0 69.9 63 24.6 152.4l91.5 71.8C138 156.1 199.5 107.7 272 107.7z"
        fill="#ea4335"
      />
    </svg>
  )
}
