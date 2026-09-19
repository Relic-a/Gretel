# Gretel privacy

Gretel is a local-first desktop application. Profiles, topics, subscriptions, saved videos, likes, watch history, performance diagnostics, cached thumbnails, and application logs are stored in Gretel's app-data directory on your device.

## Third-party services

Gretel connects directly to:

- **YouTube** to search for channels and videos, load metadata and comments, fetch thumbnails, and play videos in the embedded YouTube player. YouTube receives the network information and player data normally associated with those requests.
- **Supabase** for Google-based authentication, access-code sessions, managed-embedding quotas, usage records, and a shared embedding cache. Supabase receives account identifiers, request counts, text hashes, and embedding vectors. Gretel does not store the submitted text in Supabase's usage records or embedding cache.
- **OpenRouter** to generate semantic embeddings. Gretel sends configured topic text and limited video text, including configured transcript excerpts, to the selected embedding model. Requests use either Gretel's server-side OpenRouter credential or an API key supplied by the user and are subject to OpenRouter's and the selected model provider's policies.
- **Google** when the user chooses Continue with Google. Google provides Supabase with basic identity information needed to create the Gretel account. Gretel does not request access to the user's YouTube account or Google password.

Developer analytics are disabled by default and, when enabled, remain in the local Gretel database. Managed-embedding usage accounting is always recorded for abuse prevention and quota enforcement.

## API-key storage

The OpenRouter key is stored as plain text in `data/user-settings.json` so Gretel's bundled local server can use it. On macOS and Linux, Gretel restricts the app-data directory and settings file to the current OS user. On Windows, the file inherits the access controls of the user's AppData directory.

Use a dedicated OpenRouter key with an account spending limit. Revoke it through OpenRouter if the computer is lost, compromised, or shared with an untrusted user.

Supabase session credentials are stored by the application webview so Gretel can keep the user signed in. Signing out removes the local Supabase session. Access-code sessions that have not been linked to a permanent identity cannot be recovered after sign-out or local-data deletion.

## Deleting local data

Profiles can be deleted from Gretel. To remove all Gretel data, uninstall the application and delete its app-data directory listed in the project README.

## Questions and reports

Open an issue at <https://github.com/Relic-a/Gretel/issues>. For a security vulnerability, use GitHub's private vulnerability reporting for the repository rather than posting secret material in a public issue.
