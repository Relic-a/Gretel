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
        <p className="legal-kicker">Privacy Policy</p>
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Effective {EFFECTIVE_DATE}</p>

        <p>
          Gretel is a local-first desktop application for building a focused YouTube feed. This policy
          explains what Gretel stores, when it connects to another service, and the choices you have. It
          applies to the Gretel desktop app and this website.
        </p>

        <h2>1. The short version</h2>
        <ul>
          <li>Your profiles, saved videos, likes, watch history, and settings are stored on your computer.</li>
          <li>Gretel does not run an advertising or tracking business on this website.</li>
          <li>Signing in with Google is used to verify your identity for managed embeddings. Gretel does not receive your Google password or access to your YouTube account.</li>
          <li>Gretel does not sell your personal information.</li>
        </ul>

        <h2>2. Data stored on your device</h2>
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
          On macOS and Linux, Gretel restricts the app-data directory and settings file to the current
          operating-system user. On Windows, these files inherit the access controls of your AppData
          directory.
        </p>

        <h2>3. Account and sign-in data</h2>
        <p>
          Gretel offers three ways to reach its embedding service. A Google sign-in or an access code
          creates a Gretel account held in our authentication provider, Supabase. For a Google sign-in,
          Supabase receives the basic identity information needed to create that account, such as your
          Google account identifier and email address. Access-code sessions are anonymous and are not
          linked to a permanent identity.
        </p>
        <p>
          Session credentials are stored by the application webview so you stay signed in. Signing out
          removes the local Supabase session. If you use an anonymous access-code session, it cannot be
          recovered after you sign out or delete the local data.
        </p>

        <h2>4. Embeddings and connected services</h2>
        <p>To build and rank a feed, Gretel connects directly to a small number of services:</p>
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

        <h2>5. How we use data</h2>
        <p>
          Gretel uses your local data only to run the app: to build feeds, remember your choices, and
          show your saved videos and history. Account and usage data held by Supabase is used to
          authenticate you, enforce embedding quotas, prevent abuse, and operate the shared embedding
          cache. We do not use Google user data or your feed activity for advertising, and we do not
          transfer it to data brokers or information resellers.
        </p>

        <h2>6. Analytics</h2>
        <p>
          Developer analytics are off by default. If you enable them, Gretel records performance
          telemetry in your local database, and it stays there. Managed-embedding usage accounting is
          always recorded for abuse prevention and quota enforcement.
        </p>

        <h2>7. What we do not collect</h2>
        <ul>
          <li>We do not collect your Google password.</li>
          <li>We do not access the videos you watch on YouTube outside Gretel.</li>
          <li>We do not sell your personal information.</li>
          <li>We do not place advertising cookies or cross-site trackers on this website.</li>
        </ul>

        <h2>8. Data retention</h2>
        <p>
          Local data remains until you delete it. Usage records held by Supabase are retained for as long
          as needed to operate quotas, prevent abuse, and meet our legal obligations.
        </p>

        <h2>9. Deleting your data</h2>
        <p>
          You can delete a profile from inside Gretel. To remove all local Gretel data, uninstall the
          application and delete its app-data folder. To ask us to delete the account information held by
          Supabase, contact us using the details below.
        </p>

        <h2>10. Security</h2>
        <p>
          Data sent to connected services is protected in transit with HTTPS. Session credentials and
          local files are protected by your operating-system account. You can further limit risk by
          using a dedicated OpenRouter key with a spending limit and revoking it if the device is lost or
          shared.
        </p>

        <h2>11. Children</h2>
        <p>
          Gretel is not directed to children under 13, and we do not knowingly collect personal
          information from them. If you believe a child has provided information through Gretel, contact
          us so we can remove it.
        </p>

        <h2>12. Changes to this policy</h2>
        <p>
          We may update this policy as Gretel changes. When we do, we will revise the effective date at
          the top of this page. Material changes that affect how Google user data is handled will be
          disclosed, and we will ask for consent where required.
        </p>

        <h2>13. Contact</h2>
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
