import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  encodeOAuthSessionCookie,
  exchangeGoogleCodeForTokens,
  fetchGmailAccountProfile,
  fetchGoogleProfile,
} from "@/lib/google-auth"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")
  const storedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value

  if (!code) {
    return buildErrorResponse(request, "missing_code")
  }

  if (!storedState || storedState !== state) {
    return buildErrorResponse(request, "invalid_state")
  }

  const callbackUrl = new URL("/api/auth/google/callback", request.nextUrl.origin).toString()

  try {
    const tokens = await exchangeGoogleCodeForTokens({ code, redirectUri: callbackUrl })
    const profile = await fetchGoogleProfile(tokens)
    const gmail = await fetchGmailAccountProfile(tokens)

    const response = NextResponse.redirect(
      buildRedirectUrl(request, { google: "connected" })
    )

    response.cookies.set({
      name: GOOGLE_OAUTH_SESSION_COOKIE,
      value: encodeOAuthSessionCookie({ tokens, profile, gmail }),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    })

    response.cookies.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: "",
      maxAge: 0,
      path: "/",
    })

    return response
  } catch (error) {
    console.error("Google OAuth callback error", error)
    return buildErrorResponse(request, "oauth_failure")
  }
}

function buildErrorResponse(request: NextRequest, reason: string) {
  const response = NextResponse.redirect(
    buildRedirectUrl(request, { google: "error", reason })
  )

  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  })

  response.cookies.set({
    name: GOOGLE_OAUTH_SESSION_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  })

  return response
}

function buildRedirectUrl(request: NextRequest, params: Record<string, string>) {
  const redirectUrl = new URL("/", request.nextUrl.origin)

  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value)
  }

  return redirectUrl
}
