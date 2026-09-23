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

Set up the local Convex backend:

```bash
bun run dev:setup
```

This starts the backend, updates `CONVEX_SELF_HOSTED_ADMIN_KEY` in
`packages/backend/.env.local`, applies the function settings from both that
file and the root `.env`, and pushes the functions. It does not print the admin
key.
Pass `mac` or `nvidia` on a fresh setup for that development mode, for example
`bun run dev:setup mac`. Later runs keep the mode of the existing backend.

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

### Apple Silicon development

`bun run dev:mac` runs the stem and lyrics workers natively on Apple Silicon. Stem separation uses
MLX on the Metal GPU; startup evaluates a small MLX operation and stops if the GPU is unavailable.
The separation model stays loaded in a persistent child process between jobs, and the worker health
response reports the effective backend and device.

The default stem settings favor local iteration speed while retaining FLAC outputs:

- `STEM_MDX_OVERLAP=0.1` controls the overlap between MDX inference windows. Increase it toward
  `0.25` if a quality comparison reveals boundary artifacts.
- `STEM_MDX_BATCH_SIZE=2` batches MLX inference windows. Reduce it to `1` if memory pressure is high.
- `STEM_WRITE_WORKERS=2` writes the instrumental and vocal FLAC files concurrently.

Docker and NVIDIA modes continue to use `audio-separator`. They reuse one loaded model across jobs
and skip the upstream MDX match-mix transform when its result would otherwise be discarded.

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

This removes the Convex database and downloaded model volumes. Run
`bun run dev:setup` again (or `bun run dev:setup mac` / `nvidia` for that mode)
to generate and save the replacement admin key, restore the function settings,
and push the functions.

Open [http://localhost:5173](http://localhost:5173) in your browser to see the web application.
Your app will connect to the local self-hosted Convex backend automatically.

## Coolify

Deploy `docker-compose.yaml` as the production stack and route the `web` service to port `3000`.
Set the web, Convex, Google Form, and Google Sheets values listed in `.env.example` in Coolify before
building; the two `PUBLIC_CONVEX_*` values are build arguments and require a rebuild when changed.
The `backend-deploy` service automatically applies the Convex function environment and deploys the
functions after the backend is healthy. It reads the generated instance credentials from the
persistent `data` volume, so no admin key needs to be copied into Coolify.

Development commands also merge `docker-compose.dev.yaml`, which disables the containerized `web`
service so Vite continues to run on the host with HMR.

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
