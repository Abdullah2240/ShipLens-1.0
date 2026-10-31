# Playwright runner for the E2E stack. Build context is the repository root.
# The version must equal the exact @playwright/test devDependency in package.json
# (enforced by scripts/e2e-docker.test.mjs). Browsers come from this official image.
# Specs and the config are bind-mounted at run time, so editing a spec needs no rebuild.
ARG PLAYWRIGHT_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
WORKDIR /e2e
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --save-exact @playwright/test@${PLAYWRIGHT_VERSION}
