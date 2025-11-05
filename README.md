# InboxerAI

InboxerAI connects to Gmail, extracts question/answer pairs with OpenAI, and stores them in Qdrant so every incoming email can be answered with context-aware AI drafts. This document walks an end user through the full setup and explains why each step matters.

---

## 1. Prerequisites

| Requirement | Why you need it |
|-------------|-----------------|
| **Node.js 20+** | Runs the Next.js application locally. |
| **npm** (ships with Node) | Installs JavaScript dependencies. |
| **Docker** (optional) | Provides a one-command way to launch Qdrant and the app. |
| **Google Cloud project** | Hosts OAuth credentials and Gmail push notifications. |
| **OpenAI API key** | Powers the LLM for extraction, embeddings, and reply drafting. |

The app writes runtime state to `data/accounts.json` and `data/ingest-state.json`. These files contain access tokens, Gmail history cursors, and prompt settings. They are `.gitignore`d on purpose; keep them safe.

---

## 2. Install the project

```bash
git clone <your-fork-or-repo-url>
cd InboxerAI
npm install
```

---

## 3. Configure environment variables

Copy `.env.example` to `.env` (or `.env.local`) and fill in each field:

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OPENAI_API_KEY=your-openai-api-key
OPENAI_RESPONSE_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
NEXT_PUBLIC_SYNC_CONCURRENCY=5
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=inboxerai_threads
GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>
GOOGLE_PUBSUB_VERIFICATION_TOKEN=choose-a-shared-secret
GMAIL_VERBOSE_LOGS=false
```

What and why:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Created in Google Cloud. Required for OAuth so users can grant Gmail access.
- `OPENAI_*`: Selects the models used for Q&A extraction (Responses API) and embeddings (searchable vectors).
- `NEXT_PUBLIC_SYNC_CONCURRENCY`: Caps the number of threads processed at once so you can throttle API usage (used for both preview and syncing).
- `QDRANT_*`: Points to your vector database. Keep the API key blank for local unsecured use.
- `GMAIL_PUBSUB_TOPIC`: The Gmail API sends push notifications to this Pub/Sub topic when new mail arrives.
- `GOOGLE_PUBSUB_VERIFICATION_TOKEN`: Shared secret appended to the webhook URL (`...?token=SECRET`). The webhook rejects requests without it.
- `GMAIL_VERBOSE_LOGS`: Set to `true` to enable per-message Gmail automation logs; `false` keeps the worker output concise.

---

## 4. Google Cloud setup

1. **Enable APIs**  
   In the [Google Cloud Console](https://console.cloud.google.com/), enable the **Gmail API** and **Pub/Sub API** for your project. Without them, OAuth cannot request Gmail scopes and watch notifications cannot be delivered.

2. **Configure the OAuth consent screen**  
   Add the following scopes so the app can read, draft, and manage email threads:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/userinfo.email`

3. **Create OAuth credentials**  
   - Type: **Web application**  
   - Redirect URI: `http://localhost:3000/api/auth/google/callback` (use the production URL later).  
   Paste the generated client ID and secret into your `.env`.

4. **Prepare Pub/Sub for Gmail watch**  
   - Create a **Pub/Sub topic** (e.g., `gmail-topic`).  
   - Grant `serviceAccount:gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on that topic. Gmail will use this service account.
   - Create a **push subscription** that posts to `https://<your-domain>/api/gmail/webhook?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>`.  
     For local testing, expose the dev server with a tunnel such as `ngrok http 3000` and use the public URL in the subscription.

---

## 5. Run Qdrant

InboxerAI stores embeddings in Qdrant. You can run it in two ways:

- **Docker compose (recommended for local dev)**  
  ```bash
  docker compose up --build
  ```
  This starts the Next.js app (http://localhost:3000) and Qdrant (http://localhost:6333) with persistent volumes under `./data` and `./qdrant_state`.

- **Standalone**  
  ```bash
  docker run -p 6333:6333 qdrant/qdrant:v1.9.0
  npm run dev
  ```
  Use this if you prefer to manage services separately.

---

## 6. First login and ingest

1. **Connect Gmail**  
   Visit `http://localhost:3000`, click **Connect Google Mail**, complete OAuth, and confirm the requested scopes. Tokens are encrypted and stored in `data/accounts.json`.

2. **Initial inbox ingest**  
   - Open the **Initial inbox ingest** card.  
   - Optionally add **Additional instructions** to steer the Q&A extraction (tone, business rules, etc.).  
   - Click **Generate preview** to review the latest threads and what the extractor found.  
   - Select the threads you want, then click **Ingest selected**. This embeds the Q&A pairs in Qdrant and records the Gmail thread IDs so the same content is not duplicated later.

3. **Review the result**  
   The processed threads appear at the top of the list with a live status indicator so you can track long-running extractions.

---

## 7. Keep the inbox in sync

1. **Register a Gmail watch**  
   In the **Gmail webhook** card:
   - Pick the connected email.
   - Click **Register Gmail watch**. The button becomes disabled while active, and an **End watch** button appears if you need to stop it.
   - The app records the watch timestamp and expiration in `data/ingest-state.json`. Gmail watches expire after ~7 days; the UI shows the remaining time.

2. **Customize the reply prompt**  
   Below the watch controls is the **Customer support reply prompt** editor. Anything you save here is appended to every AI-generated draft (tone, escalation policy, SLA reminders). Update it whenever your support guidelines change.

3. **Process new mail automatically**  
   When Gmail pushes a notification:
   - The webhook validates the shared token.
   - The history worker fetches any new messages since the last cursor.
   - The latest message is embedded and searched against Qdrant to fetch relevant Q&A pairs.
   - A lightweight classifier checks whether the sender is genuinely asking for help; newsletters and FYI updates are skipped.
   - OpenAI generates a context-aware reply draft using the whole thread context, the extracted knowledge, and your prompt instructions.
   - The draft is created in Gmail, and you can review it inside your mailbox or on the **Drafts** page in the app.

---

## 8. Qdrant collections and data model

- **Collection name**: Controlled by `QDRANT_COLLECTION` (defaults to `inboxerai_threads`).  
- **Point IDs**: The app uses UUIDs to avoid collisions even if you ingest the same thread multiple times.  
- **Payload**: Stores the Gmail `threadId`, extracted question, answer, and the date the thread was created.  
- **Upserts**: Existing entries for a thread are replaced when you re-run ingestion, so you will not accumulate duplicates.

If you plan to filter searches later (e.g., by date range or tag), add payload indexes through the Qdrant UI or API once you know the filters you need.

---

## 9. Troubleshooting guide

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Missing OPENAI_API_KEY` error | `.env` not reloaded after editing | Restart `npm run dev` or reload the environment. |
| Qdrant `ApiError: Not Found` | Collection missing | Trigger ingestion once; the app auto-creates the collection with sensible defaults. |
| Qdrant `Bad Request` about point ID | Old data using non-UUID IDs | Clear the collection (or let the app regenerate it) after updating. |
| Webhook retries endlessly | Token mismatch or earlier failure | Check server logs for `[gmail-webhook]` messages, confirm the `token` query parameter, and fix the underlying error. |
| Drafts never appear | Gmail message not in `INBOX`, Qdrant empty, or OpenAI rejected the request | Inspect `[gmail-automation]` logs to see which step failed; re-run ingest or adjust prompts. |

---

## 10. Useful npm scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Next.js development server. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run TypeScript checks. |
| `npm run build` | Produce a production build. |

---

## 11. Next steps

- Swap the `.env` values for production domains and managed secrets (Vault, Secret Manager, etc.).
- Move token storage from the local JSON files into a database or encrypted key store.
- Schedule periodic re-ingests or extend the webhook worker with retry queues for robustness.

With these steps complete, InboxerAI will continuously learn from your Gmail threads and draft responses that stay aligned with your support playbook. Enjoy the automation!
