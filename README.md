# partyroom

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines SvelteKit, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **SvelteKit** - Web framework for building Svelte apps
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Convex** - Reactive backend-as-a-service platform
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
bun run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

Create the two root development secrets:

```bash
cp .env.example .env
```

Everything else, including local ports, worker addresses, resource limits, and
model names, has a development default in the Compose files.

Then, run the development server:

```bash
bun run dev
```

This rebuilds the local Docker Compose services using Docker's build cache, waits for them to
become healthy, and then starts the Turborepo development tasks. The containers, Convex data, and
downloaded AI models remain available between development sessions. The first separation and
transcription download their configured models into the `stem_models` and `lyrics_models` volumes.

To stop the local containers without deleting their data:

```bash
bun run dev:down
```

To stop the containers and permanently reset their local data:

```bash
bun run dev:reset
```

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.
Your app will connect to the local self-hosted Convex backend automatically.

## Project Structure

```
partyroom/
├── apps/
│   ├── media-worker/ # yt-dlp and FFmpeg worker
│   ├── stem-worker/  # Local stem-separation worker
│   ├── lyrics-worker/ # Local transcription and alignment worker
│   └── web/          # Frontend application (SvelteKit)
├── packages/
│   └── backend/      # Convex backend functions and schema
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:setup`: Setup and configure your Convex project
- `bun run check-types`: Check TypeScript types across all apps
