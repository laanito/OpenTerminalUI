const path = require("node:path");
const fs = require("node:fs");
const { defineConfig, devices } = require("./frontend/node_modules/@playwright/test");

const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 4173);
const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8010);
const USE_EXISTING_SERVER = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === "1";
const WITH_BACKEND = process.env.PLAYWRIGHT_WITH_BACKEND !== "0";

let ROOT_DIR = process.cwd();
if (!fs.existsSync(path.join(ROOT_DIR, "data")) && fs.existsSync(path.join(ROOT_DIR, "..", "data"))) {
  ROOT_DIR = path.resolve(ROOT_DIR, "..");
}
const VENV_PYTHON = path.join(ROOT_DIR, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const PYTHON_COMMAND = process.env.PLAYWRIGHT_PYTHON || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : process.platform === "win32" ? "python" : "python3");
// A process-scoped database prevents a previous local run from changing the
// next run's starting state. The files are ignored by the repository's *.db
// rule and can be inspected after a failure.
const SQLITE_PATH = path.join(ROOT_DIR, "data", `playwright-e2e-${process.pid}.db`).replace(/\\/g, "/");
const SQLITE_URL = `sqlite:///${SQLITE_PATH}`;
const DATABASE_URL = SQLITE_URL.replace("sqlite:///", "sqlite+aiosqlite:///");
const AUTH_STATE_PATH = process.env.PLAYWRIGHT_AUTH_STATE_PATH || path.join(ROOT_DIR, "frontend", "test-results", ".auth", "user.json");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${E2E_FRONTEND_PORT}`;
const CHROMIUM_LAUNCH_OPTIONS = {
  args: ["--disable-gpu"],
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
};

export default defineConfig({
  testDir: path.join(ROOT_DIR, "frontend", "tests", "e2e"),
  timeout: 60_000,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: path.join(ROOT_DIR, "frontend", "test-results"),
  globalSetup: path.join(ROOT_DIR, "frontend", "tests", "e2e", "global-setup.ts"),
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    storageState: AUTH_STATE_PATH,
  },
  webServer: USE_EXISTING_SERVER ? undefined : [
    ...(WITH_BACKEND ? [{
      command: `${PYTHON_COMMAND} -m uvicorn backend.main:app --host 127.0.0.1 --port ${E2E_BACKEND_PORT}`,
      cwd: ROOT_DIR,
      port: E2E_BACKEND_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        ...process.env,
        AUTH_MIDDLEWARE_ENABLED: "0",
        E2E_DEV_AUTH: "1",
        OPENTERMINALUI_CORS_ORIGINS: `http://127.0.0.1:${E2E_FRONTEND_PORT},http://localhost:${E2E_FRONTEND_PORT}`,
        OPENTERMINALUI_SQLITE_URL: SQLITE_URL,
        DATABASE_URL,
      },
    }] : []),
    {
      command: `npm --prefix frontend run build && npm --prefix frontend run preview -- --host 127.0.0.1 --port ${E2E_FRONTEND_PORT} --strictPort`,
      cwd: ROOT_DIR,
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `http://127.0.0.1:${E2E_BACKEND_PORT}/api`,
        VITE_PROXY_TARGET: `http://127.0.0.1:${E2E_BACKEND_PORT}`,
        VITE_E2E_AUTO_LOGIN: "1",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
      },
    },
    {
      name: "mobile-chromium",
      testMatch: ["**/mobile-interactions.spec.ts", "**/terminal-shell-go-bar.spec.ts"],
      use: {
        ...devices["Pixel 7"],
        launchOptions: CHROMIUM_LAUNCH_OPTIONS,
      },
    },
  ],
});
