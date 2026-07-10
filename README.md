```text
  _____ _____  ______ _______ ______ _      
 / ____|  __ \|  ____|__   __|  ____| |     
| |  __| |__) | |__     | |  | |__  | |     
| | |_ |  _  /|  __|    | |  |  __| | |     
| |__| | | \ \| |____   | |  | |____| |____ 
 \_____|_|  \_\______|  |_|  |______|______|
```

# Gretel

Gretel is a desktop app for building a more intentional YouTube feed. Create profiles, add topics and channels you care about, and let Gretel build a personalized feed using YouTube data and OpenRouter embeddings.

> Current status: **alpha**. Expect rough edges, unsigned installers, and possible platform-specific bugs.

## Features

- Personalized YouTube feed by profile
- Topic and channel based discovery
- Saved videos, liked videos, and watch history
- Local SQLite storage
- OpenRouter-powered embeddings
- Desktop builds for Linux, Windows, and macOS through Electron

## Requirements

- Node.js 22+
- npm
- An OpenRouter API key

You can create an OpenRouter key at:

https://openrouter.ai/keys

## Development Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/Relic-a/gretel.git
cd gretel
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Then add your OpenRouter API key:

```env
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_SITE_URL=gretel://app
OPENROUTER_APP_NAME=Gretel
```

Run a renderer-only browser preview:

```bash
npm run dev
```

The browser preview does not provide the local desktop APIs. Use the Electron command for full functionality.

Run the Electron desktop app in development:

```bash
npm run electron:dev
```

## App Settings

You can also enter your OpenRouter API key inside the app settings UI. Gretel stores local settings in the app data directory, not in the public repo.

Approximate data locations:

- Linux: `~/.config/Gretel/data`
- Windows: `%APPDATA%/Gretel/data`
- macOS: `~/Library/Application Support/Gretel/data`

## Build Locally

Build Linux packages:

```bash
npm run dist:linux
```

Build Windows packages:

```bash
npm run dist:win
```

Build macOS packages:

```bash
npm run dist:mac
```

Notes:

- Linux builds produce `.AppImage` and `.deb` files.
- Windows builds produce `.exe` installers/portable builds.
- macOS builds require macOS for best results.
- Local builds are unsigned by default.

## Project Scripts

```bash
npm run dev            # Start the renderer-only Vite preview
npm run electron:dev   # Build and start the complete desktop app
npm run build          # Build the Vite renderer and Electron backend
npm run dist:linux     # Build Linux desktop packages
npm run dist:win       # Build Windows desktop packages
npm run dist:mac       # Build macOS desktop packages
npm test               # Run tests
npm run typecheck      # Check TypeScript
```
