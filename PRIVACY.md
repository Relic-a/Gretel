# Gretel privacy

Gretel is a local-first desktop application. Profiles, topics, subscriptions, saved videos, likes, watch history, performance diagnostics, cached thumbnails, and application logs are stored in Gretel's app-data directory on your device.

## Third-party services

Gretel connects directly to:

- **YouTube** to search for channels and videos, load metadata and comments, fetch thumbnails, and play videos in the embedded YouTube player. YouTube receives the network information and player data normally associated with those requests.
- **OpenRouter** to generate semantic embeddings. Gretel sends configured topic text and limited video text, including configured transcript excerpts, to the selected embedding model. Requests use the OpenRouter API key supplied by the user and are subject to OpenRouter's and the selected model provider's policies.

Gretel does not operate a developer-controlled analytics or account service. Developer analytics are disabled by default and, when enabled, remain in the local Gretel database.

## API-key storage

The OpenRouter key is stored as plain text in `data/user-settings.json` so Gretel's bundled local server can use it. On macOS and Linux, Gretel restricts the app-data directory and settings file to the current OS user. On Windows, the file inherits the access controls of the user's AppData directory.

Use a dedicated OpenRouter key with an account spending limit. Revoke it through OpenRouter if the computer is lost, compromised, or shared with an untrusted user.

## Deleting local data

Profiles can be deleted from Gretel. To remove all Gretel data, uninstall the application and delete its app-data directory listed in the project README.

## Questions and reports

Open an issue at <https://github.com/Relic-a/Gretel/issues>. For a security vulnerability, use GitHub's private vulnerability reporting for the repository rather than posting secret material in a public issue.
