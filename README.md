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

Client-side transposition uses AudioWorklet, which requires a secure browser context.
Use `localhost` on the development machine, or trusted HTTPS when testing from other
devices. Plain HTTP on a LAN IP address cannot transpose; native playback still works.

### LAN HTTPS and physical iPhone testing

Install [Caddy](https://caddyserver.com/docs/install) once (`brew install caddy` on macOS).
In macOS System Settings > General > Sharing, set the local hostname to `pmm`
so Bonjour advertises `pmm.local`. Choose another hostname if that name is already taken.
Both devices must be on the same network with Bonjour and device-to-device traffic allowed.

Set `DEV_HTTPS_HOST=pmm.local` in `apps/web/.env` (or the root `.env`), then run any
existing web development command, such as `bun run dev:mac`. Alternatively:

```bash
DEV_HTTPS_HOST=pmm.local bun run dev:mac
```

The web task starts Caddy alongside Vite and provides `https://pmm.local` for the
app and `https://pmm.local:8443` for Convex. Localhost remains available at
`http://localhost:5173`. No IP addresses or manual changes to `PUBLIC_CONVEX_*`
are needed. Startup leaves the backend's canonical `SITE_URL` unchanged and sets
local Convex's `DEV_SITE_URL` to allow the exact HTTPS origin alongside localhost.
Keep the normal Compose ports available and allow Caddy through the host firewall.
Port 5173 must be free; the task fails rather than silently switching ports.

On first startup, Caddy generates a persistent development CA under the ignored
`.cache/dev-https/` directory. The terminal prints the full path of `root.crt`.
AirDrop **only that public certificate** to your iPhone, install its profile,
and enable full trust in Settings > General > About > Certificate Trust Settings.
Never share the CA's private key. This trusts certificates issued by your local CA;
protect its keys and remove the profile when no longer needed.
On the Mac, import the same `root.crt` into Keychain Access and explicitly trust
it for SSL before opening the HTTPS URL in a browser. The dev server trusts it
automatically for its own backend requests; system trust is never changed by the script.

Open `https://pmm.local` in Safari without a certificate warning and sign in
separately from localhost. Test pitch up/down/reset, seeking, pause/resume,
and returning after locking the phone. A changing IP needs no certificate changes.
Do not delete `.cache/dev-https/` unless you intend to replace and re-trust the CA.

Ctrl-C stops Vite and Caddy together; Compose infrastructure remains available.
Unset `DEV_HTTPS_HOST` to return to the ordinary HTTP-only development workflow.
To revoke the extra local authentication origin, run
`bunx convex env remove DEV_SITE_URL --env-file .env.local` from `packages/backend`.
This setup affects development only, not production builds or deployments.

## Coolify

Deploy `docker-compose.yaml` as the production stack and route the `web` service to port `3000`.
Set the web, Convex, Google Form, and Google Sheets values listed in `.env.example` in Coolify before
building; the two `PUBLIC_CONVEX_*` values are build arguments and require a rebuild when changed.
The `backend-deploy` service automatically applies the Convex function environment and deploys the
functions after the backend is healthy. It reads the generated instance credentials from the
persistent `data` volume, so no admin key needs to be copied into Coolify.

Every long-running service has a Compose health check. Web and dashboard probes require a
successful HTTP response; worker probes also require `ok` and `started` to be true. The stem
and lyrics workers have a two-minute startup grace period for Python/accelerator initialization.
These checks verify local service readiness, not successful processing of a media job.

`backend-deploy` and `queue-release` are one-time jobs with `restart: "no"`, which
[Coolify excludes from overall health](https://github.com/coollabsio/coolify/blob/main/app/Traits/CalculatesExcludedStatus.php).
A completed job should show `Exited (0)`. Check their exit codes and deployment logs; a failed
`queue-release` now requires a redeploy or manual rerun rather than retrying indefinitely.
Coolify uses [the health checks in the Compose file](https://coolify.io/docs/applications/builds/docker-compose#health-checks),
so reload the Compose definition and redeploy to apply changes. Run
`bun test scripts/compose-health.test.ts` to verify the probe commands against ready, unready,
malformed, and unavailable HTTP responses.

### GPU build cache

The NVIDIA stem worker and lyrics worker install third-party dependencies in a separate image
layer, before copying local Python source. Changes to worker code reuse that layer; changes to
lockfiles, dependency metadata, accelerator, or base images rebuild it. The shared uv download
cache is locked during installation so concurrent worker builds can reuse completed downloads.
The first build after changing this layout still needs to populate the new layers.

Keep the same Docker builder and preserve its build cache between Coolify deployments. Check
host cleanup policies for `docker builder prune`, `docker buildx prune`, or
`docker system prune --all`; these can discard reusable build layers and download caches.
The runtime model volumes are separate and do not preserve Python dependency build caches.

To confirm reuse, inspect a second deployment with unchanged dependencies: the initial `uv sync`
and the runtime `COPY --from=dependencies .../.venv` should be `CACHED`. An edit to
`packages/activity-worker-python` source should rerun only the local install and subsequent
layers. Read-only host checks include `docker buildx ls` and `docker buildx du`.
Run `python3 scripts/check-worker-build-cache.py` to check this with an isolated source edit
and verify the shared package imports in the resulting stem-worker image. The check uses the
Docker host architecture; Apple silicon does not exercise the x86-only CUDA packages.

If builders are ephemeral, configure registry-backed `cache_from` and `cache_to` for each worker
using your private registry and supported builder. No registry cache is configured here because
its location and credentials depend on the deployment host. See
[Docker cache backends](https://docs.docker.com/build/cache/backends/) and
[uv Docker layer caching](https://docs.astral.sh/uv/guides/integration/docker/#intermediate-layers).

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
