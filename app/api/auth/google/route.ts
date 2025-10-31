import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_STATE_COOKIE,
  createGoogleAuthUrl,
  createOAuthStateCookieValue,
} from "@/lib/google-auth"

export async function GET(request: NextRequest) {
  const state = createOAuthStateCookieValue()
  const callbackUrl = new URL("/api/auth/google/callback", request.nextUrl.origin)
  const authorizationUrl = createGoogleAuthUrl({
    redirectUri: callbackUrl.toString(),
    state,
  })

  const response = NextResponse.redirect(authorizationUrl)

  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: state,
    maxAge: 60 * 10,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  })

  return response
}

