import { NextResponse } from "next/server"

import { GOOGLE_OAUTH_SESSION_COOKIE } from "@/lib/google-auth"

export async function POST() {
  const response = NextResponse.json({ success: true })

  response.cookies.set({
    name: GOOGLE_OAUTH_SESSION_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  })

  return response
}

