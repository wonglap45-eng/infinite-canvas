# EONS AI Image Studio

EONS AI Image Studio is an internal AI image workspace for company team use. This repository is intended to be deployed from a private GitHub repository to Railway with Docker.

This first-stage branch only adapts deployment and basic internal branding. It does not change image generation logic, OpenAI-compatible configuration logic, video functionality, storage architecture, or authentication.

## Internal Use

- Use this repository as an independent private repository under your GitHub account or organization.
- Do not deploy directly from the upstream author's repository.
- Do not commit real API keys or employee credentials.
- The employee-facing interface is branded as EONS AI Image Studio.

## Railway Deployment

Current Railway production information:

- Project display name: `EONS生图无限画布`
- Service name: `eons-ai-image-studio`
- Environment: `production`
- GitHub repository: `wonglap45-eng/infinite-canvas`
- Production URL: `https://eons-ai-image-studio-production.up.railway.app`

The Railway project display name is for administrator use only. The employee-facing product name remains `EONS AI Image Studio`.

1. Create a private GitHub repository in your GitHub account or organization.
2. Push this code to that private repository.
3. Open Railway and create a new project.
4. Choose **Deploy from GitHub Repo**.
5. Select your private repository.
6. Railway will use the root `Dockerfile` to build the service.
7. After deployment succeeds, open the Railway-provided domain.
8. If deployment fails, check `PORT`, the Dockerfile, the container start command, and Railway build logs first.

The Docker image starts the Next.js standalone server with:

```bash
HOSTNAME=${HOSTNAME:-0.0.0.0} PORT=${PORT:-3000} node server.js
```

Railway injects `PORT`; local Docker uses the default `3000`.

## Local Docker Test

```bash
docker build -t eons-ai-image-studio .
docker run --rm -p 3000:3000 eons-ai-image-studio
```

Then open:

```text
http://localhost:3000
```

## Environment Variables

The first-stage minimum environment is:

```env
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_IMAGE_API_KEY=
OPENAI_IMAGE_BASE_URL=
OPENAI_IMAGE_MODELS=openai/gpt-image-2
OPENAI_IMAGE_GENERATIONS_PATH=/images
OPENAI_TEXT_API_KEY=
OPENAI_TEXT_BASE_URL=
OPENAI_TEXT_MODELS=openai/gpt-5.5
```

`OPENAI_API_KEY` is the fallback key. If one provider token cannot access every model, set the model-specific keys instead:

- `OPENAI_IMAGE_API_KEY` for image endpoints such as `openai/gpt-image-2`.
- `OPENAI_TEXT_API_KEY` for text/prompt endpoints such as `openai/gpt-5.5`.
- `OPENAI_IMAGE_MODELS` and `OPENAI_TEXT_MODELS` are comma-separated model names used for routing.
- The model-specific base URLs are optional; if omitted, `OPENAI_BASE_URL` is used.
- OpenRouter image generation uses `/images`, so set `OPENAI_IMAGE_GENERATIONS_PATH=/images` when using `https://openrouter.ai/api/v1`.

Do not place real API keys in source files or `.env.example`. Employees do not configure API keys in the browser.

## Repository Notes

- Root `package.json`: not present in this project.
- Web app package: `web/package.json`.
- Docker deployment: root `Dockerfile`.
- Railway config: `railway.json`.
- Local compose files: `docker-compose.yml` and `docker-compose.local.yml`.

## Internal Documentation

- Employee user manual: `docs/USER_MANUAL_CN.md`
- Administrator guide: `docs/ADMIN_GUIDE_CN.md`

## Open Source Compliance

This project is based on the upstream open source project `basketikun/infinite-canvas`, licensed under the GNU Affero General Public License v3.0.

Compliance information is retained in:

- `LICENSE`
- `ATTRIBUTION.md`
- `/license` in the deployed web app

Do not remove required license, copyright, attribution, or source notices. Internal branding changes are intended to avoid exposing upstream project branding in the ordinary employee workflow; they are not intended to present the software as fully self-developed.
