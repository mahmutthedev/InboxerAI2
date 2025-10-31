export type SiteConfig = typeof siteConfig

export const siteConfig = {
  name: "InboxerAI",
  tagline: "LLM-powered Gmail ingestion",
  description:
    "Connect your Gmail inbox, extract structured answers from every thread, and feed Qdrant for AI-powered replies.",
  mainNav: [
    {
      title: "Inbox",
      href: "/",
    },
  ],
  links: {
    github: "#",
    docs: "#",
  },
}
