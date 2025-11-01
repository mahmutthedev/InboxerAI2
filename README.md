# InboxerAI

InboxerAI connects to Gmail, analyzes every thread with LLMs, and stores structured question & answer pairs for downstream automations.

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and add your Google OAuth credentials and OpenAI key:

   ```bash
   cp .env.example .env.local
   ```

   ```env
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_RESPONSE_MODEL=gpt-4o-mini
   OPENAI_EMBEDDING_MODEL=text-embedding-3-small
   NEXT_PUBLIC_SYNC_CONCURRENCY=5 # Optional: max concurrent LLM runs
   INITIAL_INGEST_MAX_THREADS=200 # Server-side safety limit
   NEXT_PUBLIC_INITIAL_INGEST_MAX_THREADS=200 # Display hint for the UI
   NEXT_PUBLIC_INITIAL_PREVIEW_CONCURRENCY=5 # Optional: preview extraction concurrency
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=your-qdrant-api-key # optional when running locally
   QDRANT_COLLECTION=inboxerai_threads
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

4. Visit `http://localhost:3000` and click **Connect Google Mail** to complete the OAuth flow.

## Google OAuth setup

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Enable the **Gmail API** for the project.
3. Configure an OAuth consent screen (include the `gmail.readonly` scope).
4. Create OAuth 2.0 credentials with an authorized redirect URI of:
   - `http://localhost:3000/api/auth/google/callback` for local development.
5. Copy the Client ID and Client Secret into `.env.local`.

The prototype stores tokens in an HTTP-only cookie for convenience. Replace this with secure, server-side storage before shipping to production.

## Tech stack

- Next.js 13 App Router
- Tailwind CSS
- Google APIs (`googleapis`)
- OpenAI Responses API (`openai`)
- Qdrant vector store (`@qdrant/js-client-rest`)
- TypeScript

## Scripts

- `npm run dev` - start the local development server
- `npm run lint` - run ESLint
- `npm run build` - create a production build
