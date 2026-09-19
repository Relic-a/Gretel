import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "../components/landing/SiteFooter";
import { GretelMark } from "../components/landing/brand-marks";
import { ISSUES_URL, RELEASES_URL } from "../components/landing/landing-data";
import { canonical } from "../site";

export const metadata: Metadata = {
  title: "Terms of Service · Gretel",
  description:
    "The terms for using the Gretel desktop application and website, including acceptable use, the beta disclaimer, third-party services, and the open-source license.",
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
        <p className="legal-kicker">Terms of Service</p>
        <h1>Terms of Service</h1>
        <p className="legal-meta">Effective {EFFECTIVE_DATE}</p>

        <p>
          These terms govern your use of the Gretel desktop application and this website (together,
          &ldquo;Gretel&rdquo;). Gretel is provided by Ezana (&ldquo;we&rdquo; or &ldquo;us&rdquo;). By
          downloading or using Gretel, you agree to these terms. If you do not agree, do not use Gretel.
        </p>

        <h2>1. The service</h2>
        <p>
          Gretel is a local-first desktop application that builds a focused YouTube feed around profiles
          you create. Gretel is a client: it searches YouTube, ranks the results, and plays videos through
          YouTube&apos;s embedded player. It is not a video host and does not provide YouTube content
          itself.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 13 years old to use Gretel, and old enough in your jurisdiction to agree to
          these terms. If you use Gretel on behalf of an organization, you confirm that you are allowed to
          accept these terms for it.
        </p>

        <h2>3. Public beta</h2>
        <p>
          Gretel is currently in public beta. Features may change, break, or be removed, and installers
          are unsigned. The app is provided as-is, without warranties, as described in Section 8.
        </p>

        <h2>4. Your account and sign-in</h2>
        <p>
          Managed embeddings require signing in with Google or redeeming an access code. You are
          responsible for activity under your account and for keeping your device and credentials secure.
          Access-code sessions that have not been linked to a permanent identity cannot be recovered after
          sign-out or local-data deletion.
        </p>

        <h2>5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use Gretel in violation of any law, or of YouTube&apos;s or Google&apos;s terms and policies.</li>
          <li>Circumvent, disable, or overload quota, rate, or security controls, including those on the managed embedding service.</li>
          <li>Attempt to access another person&apos;s account or data, or use Gretel to harass or harm others.</li>
          <li>Reverse engineer or resell the managed service, or use it to build a competing service.</li>
          <li>Upload or submit content you do not have the right to submit.</li>
        </ul>

        <h2>6. Third-party services</h2>
        <p>
          Gretel connects to services we do not control, including YouTube, Google, Supabase, and
          OpenRouter. Your use of those services is governed by their own terms and privacy policies. We
          are not responsible for third-party content, availability, or data practices. To use embeddings,
          submit text to those providers, and use your own OpenRouter key where applicable.
        </p>

        <h2>7. Local data and your responsibility</h2>
        <p>
          Profiles, saved videos, history, and settings are stored on the device where Gretel runs. You are
          responsible for that device and for any local data on it. If you use bring-your-own-key mode, you
          are responsible for the OpenRouter key you configure, including any spending it incurs.
        </p>

        <h2>8. Disclaimer of warranties</h2>
        <p>
          Gretel is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of
          any kind, whether express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. We do not warrant that Gretel will be uninterrupted, error-free,
          or free of harmful components, or that any feed will meet your expectations.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, special,
          consequential, or punitive damages, or for lost data, lost profits, or service interruptions
          arising from your use of Gretel. To the extent liability cannot be excluded, our total liability
          is limited to the greater of the amount you paid us for Gretel in the previous twelve months or
          ten US dollars.
        </p>

        <h2>10. Changes and termination</h2>
        <p>
          We may modify, suspend, or discontinue Gretel or the managed embedding service at any time. We
          may update these terms; when we do, we will revise the effective date above. Continued use after
          a change means you accept the updated terms. You may stop using Gretel at any time.
        </p>

        <h2>11. Open-source license</h2>
        <p>
          Gretel&apos;s source code is copyright © 2026 Ezana, all rights reserved, and is made available
          for viewing. No license is granted to use, copy, modify, distribute, sublicense, or sell the
          software except as permitted by applicable law or with prior written permission. These terms do
          not grant you any rights to the Gretel name, logo, or other brand assets.
        </p>

        <h2>12. Governing law</h2>
        <p>
          These terms are governed by the laws applicable at the provider&apos;s principal place of
          business, without regard to conflict-of-law rules, and subject to any mandatory consumer
          protections in your country of residence.
        </p>

        <h2>13. Contact</h2>
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
