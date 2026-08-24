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

Create the local environment files:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp packages/backend/.env.example packages/backend/.env.local
```

Generate distinct values for the two secrets in `.env` and
`BETTER_AUTH_SECRET` in `packages/backend/.env.local`. For example:

```bash
openssl rand -hex 32
```

Start the backend and generate its local admin key:

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --wait backend
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml \
  exec -T backend ./generate_admin_key.sh
```

Put the generated value in `CONVEX_SELF_HOSTED_ADMIN_KEY` in
`packages/backend/.env.local`. Then restore the function settings from that
file and push the backend:

```bash
cd packages/backend
bunx convex env set SITE_URL http://localhost:5173
bunx convex env set BETTER_AUTH_SECRET
bunx convex env set WORKER_CONVEX_CLOUD_ORIGIN http://backend:3210
cd ../..
bun run dev:setup
```

The secret command prompts for the value; paste the `BETTER_AUTH_SECRET` from
`packages/backend/.env.local`. Compose supplies `ACTIVITY_WORKER_TOKEN` and
`WORKER_SIGNING_SECRET` directly from the root `.env`.

Everything else, including local ports, worker addresses, resource limits, and
model names, has a development default in the Compose files.

Then, run the development server:

```bash
bun run dev
```

This reuses the existing local Docker Compose images, waits for the services to become healthy,
and then starts the Turborepo development tasks. Use `bun run dev:build` when the images need to be
rebuilt; Docker's build cache is still used. The containers, Convex data, and downloaded AI models
remain available between development sessions. The first separation and transcription download
their configured models into the `stem_models` and `lyrics_models` volumes.

### NVIDIA development

The stem-separation and lyrics workers can use an NVIDIA GPU through Linux CUDA containers. This
mode works on Linux with the NVIDIA Container Toolkit and on Windows with Docker Desktop's WSL 2
backend. On Windows, update the NVIDIA driver and WSL before starting Docker Desktop:

```powershell
wsl --update
```

Verify that Docker can access the GPU before starting Partyroom:

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

Then start the NVIDIA development mode:

```bash
bun run dev:nvidia
```

Use `bun run dev:nvidia:host` instead to expose the Vite development server on the local network.
Use `bun run dev:nvidia:build` or `bun run dev:nvidia:host:build` to rebuild the Compose images
before starting the corresponding mode.
Both NVIDIA workers validate CUDA during startup and stop rather than silently falling back to CPU.
The lyrics worker defaults to one concurrent activity in this mode to limit GPU memory pressure;
set `LYRICS_WORKER_CONCURRENCY` explicitly to override it.

The NVIDIA images use CUDA 12.8 PyTorch packages. The host does not need the CUDA toolkit installed,
but its NVIDIA driver must support the container's CUDA runtime. Docker Desktop GPU support on
Windows requires the WSL 2 backend; native Windows containers are not supported by this setup.

To stop the local containers without deleting their data:

```bash
bun run dev:down
```

To stop the containers and permanently reset their local data:

```bash
bun run dev:reset
```

This removes the Convex database and downloaded model volumes. The replacement
Convex backend generates a new admin key, so repeat the backend start, admin-key
generation, three `convex env set` commands, and `dev:setup` steps above. Only
`CONVEX_SELF_HOSTED_ADMIN_KEY` gets a new value; the other values are merely
restored after their stored copies were erased.

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

- `bun run dev`: Start all applications using existing Compose images
- `bun run dev:build`: Rebuild Compose images and start all applications
- `bun run dev:mac`: Start macOS mode using existing Compose images
- `bun run dev:mac:build`: Rebuild Compose images and start macOS mode
- `bun run dev:mac:host`: Start macOS mode and expose Vite on the local network
- `bun run dev:mac:host:build`: Rebuild Compose images and start exposed macOS mode
- `bun run dev:nvidia`: Start NVIDIA mode using existing Compose images
- `bun run dev:nvidia:build`: Rebuild Compose images and start NVIDIA mode
- `bun run dev:nvidia:host`: Start NVIDIA mode and expose Vite on the local network
- `bun run dev:nvidia:host:build`: Rebuild Compose images and start exposed NVIDIA mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:setup`: Setup and configure your Convex project
- `bun run check-types`: Check TypeScript types across all apps
