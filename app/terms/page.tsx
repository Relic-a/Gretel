import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "../components/landing/SiteFooter";
import { GretelMark } from "../components/landing/brand-marks";
import { ISSUES_URL, RELEASES_URL } from "../components/landing/landing-data";
import { canonical } from "../site";

export const metadata: Metadata = {
  title: "Terms of Service · Gretel",
  description:
    "Simple terms for using the Gretel desktop application and website, including acceptable use, third-party services, and the source license.",
  alternates: canonical("/terms")
};

const EFFECTIVE_DATE = "September 19, 2026";

export default function TermsPage() {
  return (
    <div className="legal">
      <header className="legal-topbar">
        <Link className="site-brand" href="/" aria-label="Gretel home">
          <GretelMark size={24} />
          <span>Gretel</span>
        </Link>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms" aria-current="page">Terms</Link>
        </nav>
      </header>

      <main className="legal-doc" id="main">
        <h1>Terms of Service</h1>
        <p className="legal-meta">Effective {EFFECTIVE_DATE}</p>

        <p>
          These simple terms apply to the Gretel desktop app and website. By using Gretel, you agree to
          them. If you do not agree, do not use Gretel.
        </p>

        <h2>What Gretel is</h2>
        <p>
          Gretel is a local-first desktop application that builds a focused YouTube feed around profiles
          you create. Gretel is a client: it searches YouTube, ranks the results, and plays videos through
          YouTube&apos;s embedded player. It is not a video host and does not provide YouTube content
          itself.
        </p>

        <h2>Public beta</h2>
        <p>
          Gretel is currently in public beta. Features may change, break, or be removed, and installers
          are unsigned. The app is provided as-is, without warranties.
        </p>

        <h2>Your account and data</h2>
        <p>
          You must be at least 13 and old enough to agree to these terms where you live. You are
          responsible for your device, account, credentials, local data, and any charges from an
          OpenRouter key you add. Unlinked access-code sessions cannot be recovered after sign-out or
          local-data deletion.
        </p>

        <h2>Use Gretel responsibly</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use Gretel in violation of any law, or of YouTube&apos;s or Google&apos;s terms and policies.</li>
          <li>Circumvent, disable, or overload quota, rate, or security controls, including those on the managed embedding service.</li>
          <li>Attempt to access another person&apos;s account or data, or use Gretel to harass or harm others.</li>
          <li>Resell, disrupt, or reverse engineer the managed embedding service.</li>
        </ul>

        <h2>Third-party services</h2>
        <p>
          Gretel connects to services we do not control, including YouTube, Google, Supabase, and
          OpenRouter. Your use of those services is governed by their own terms and privacy policies. We
          are not responsible for third-party content, availability, or data practices. The Privacy Policy
          explains what Gretel sends to these services.
        </p>

        <h2>No warranty</h2>
        <p>
          Gretel is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of
          any kind, whether express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. We do not warrant that Gretel will be uninterrupted, error-free,
          or free of harmful components, or that any feed will meet your expectations.
        </p>

        <h2>Liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, special,
          consequential, or punitive damages, or for lost data, lost profits, or service interruptions
          arising from your use of Gretel. Where liability cannot be excluded, it is limited to the amount
          you paid for Gretel in the previous twelve months.
        </p>

        <h2>Changes</h2>
        <p>
          We may modify, suspend, or discontinue Gretel or the managed embedding service at any time. We
          may update these terms; when we do, we will revise the effective date above. Continued use after
          a change means you accept the updated terms. You may stop using Gretel at any time.
        </p>

        <h2>Source and license</h2>
        <p>
          Gretel&apos;s source is available on GitHub. Your rights to use it come from the license included in
          the repository, not from these terms. Gretel&apos;s name and logo are not licensed for reuse.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms can be raised at{" "}
          <a href={ISSUES_URL} rel="noreferrer">github.com/Relic-a/Gretel/issues</a>. Release downloads
          are listed at <a href={RELEASES_URL} rel="noreferrer">github.com/Relic-a/Gretel/releases</a>.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
