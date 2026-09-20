import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "../components/landing/SiteFooter";
import { GretelMark } from "../components/landing/brand-marks";
import { ISSUES_URL } from "../components/landing/landing-data";
import { canonical } from "../site";

export const metadata: Metadata = {
  title: "Privacy Policy · Gretel",
  description:
    "How Gretel handles your data: a local-first desktop app that stores profiles, history, and saved videos on your computer and keeps sign-in to a minimum.",
  alternates: canonical("/privacy")
};

const EFFECTIVE_DATE = "September 19, 2026";

export default function PrivacyPage() {
  return (
    <div className="legal">
      <header className="legal-topbar">
        <Link className="site-brand" href="/" aria-label="Gretel home">
          <GretelMark size={24} />
          <span>Gretel</span>
        </Link>
        <nav aria-label="Legal">
          <Link href="/privacy" aria-current="page">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </header>

      <main className="legal-doc" id="main">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Effective {EFFECTIVE_DATE}</p>

        <p>
          Gretel is a local-first, source-available desktop app. This page explains what data leaves your
          device and how to remove it.
        </p>

        <h2>The short version</h2>
        <ul>
          <li>Your profiles, saved videos, likes, watch history, and settings are stored on your computer.</li>
          <li>This website has no advertising cookies or cross-site trackers.</li>
          <li>Signing in with Google is used to verify your identity for managed embeddings. Gretel does not receive your Google password or access to your YouTube account.</li>
          <li>Gretel does not sell your personal information.</li>
        </ul>

        <h2>Data on your device</h2>
        <p>
          Gretel keeps the following in its app-data folder on the device where it is installed, in a
          local SQLite database and local files:
        </p>
        <ul>
          <li>Profiles, including each profile&apos;s topics and channels.</li>
          <li>Saved videos, liked videos, and watch history, including watch progress.</li>
          <li>Application settings, including your embedding mode.</li>
          <li>If you use bring-your-own-key mode, your OpenRouter API key, stored as plain text in <code>data/user-settings.json</code> so Gretel&apos;s bundled local server can use it.</li>
          <li>Cached thumbnails and local application logs.</li>
        </ul>
        <p>
          This data stays until you delete it. You can delete a profile in Gretel, or remove all local
          data by uninstalling Gretel and deleting its app-data folder.
        </p>

        <h2>Accounts and connected services</h2>
        <p>
          Gretel offers three ways to reach its embedding service. A Google sign-in or an access code
          creates a Gretel account held in our authentication provider, Supabase. For a Google sign-in,
          Supabase receives the basic identity information needed to create that account, such as your
          Google account identifier and email address. Access-code sessions are anonymous and are not
          linked to a permanent identity.
        </p>
        <p>To build and rank a feed, Gretel also connects to:</p>
        <ul>
          <li>
            <strong>YouTube.</strong> To search for channels and videos, load metadata and comments,
            fetch thumbnails, and play videos in the embedded player. YouTube receives the network
            information and player data normally associated with those requests, under Google&apos;s own
            privacy policy.
          </li>
          <li>
            <strong>Supabase.</strong> For Google sign-in, access-code sessions, managed-embedding
            quotas, usage records, and a shared embedding cache. Supabase receives account identifiers,
            request counts, text hashes, and embedding vectors. Gretel does not store the submitted text
            in those usage records or in the shared embedding cache.
          </li>
          <li>
            <strong>OpenRouter.</strong> To generate semantic embeddings. Gretel sends configured topic
            text and limited video text, which can include configured transcript excerpts, to an
            embedding model. Requests use either Gretel&apos;s server-side credential for managed access
            or an API key you supply, and are subject to OpenRouter&apos;s and the model provider&apos;s
            policies.
          </li>
          <li>
            <strong>Google.</strong> When you choose Continue with Google, Google provides Supabase with
            the basic identity information needed to create your Gretel account.
          </li>
        </ul>
        <p>
          Gretel requests the minimum it needs for these features. It does not ask for your Google
          password, and it does not request access to your YouTube account or your Gmail.
        </p>

        <h2>How data is used</h2>
        <p>
          Gretel uses your local data only to run the app: to build feeds, remember your choices, and
          show your saved videos and history. Account and usage data held by Supabase is used to
          authenticate you, enforce embedding quotas, prevent abuse, and operate the shared embedding
          cache. We do not use Google user data or your feed activity for advertising, and we do not
          transfer it to data brokers or information resellers.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Supabase usage records are kept only as needed to operate quotas, prevent abuse, and meet legal
          obligations. To request deletion of Supabase account information, open an issue using the link
          below. Do not include private information in a public issue.
        </p>

        <h2>Security</h2>
        <p>
          Data sent to connected services is protected in transit with HTTPS. Session credentials and
          local files are protected by your operating-system account. You can further limit risk by
          using a dedicated OpenRouter key with a spending limit and revoking it if the device is lost or
          shared.
        </p>

        <h2>Children</h2>
        <p>
          Gretel is not directed to children under 13, and we do not knowingly collect personal
          information from them. If you believe a child has provided information through Gretel, contact
          us so we can remove it.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy as Gretel changes. When we do, we will revise the effective date at
          the top of this page. Material changes that affect how Google user data is handled will be
          disclosed, and we will ask for consent where required.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about privacy can be raised at{" "}
          <a href={ISSUES_URL} rel="noreferrer">github.com/Relic-a/Gretel/issues</a>. For a security
          vulnerability, use GitHub&apos;s private vulnerability reporting for the repository rather than
          posting secret material publicly.
        </p>

        <p className="legal-footnote">
          This policy describes Gretel&apos;s handling of Google user data in line with the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
