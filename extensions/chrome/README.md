# JobOps Copilot — Chrome Extension (MV3)

Personal Chrome Manifest V3 extension for **JobOps Copilot**. Provides browser-level **Apply Copilot** capabilities: autofilling application form fields on supported ATS platforms (Greenhouse, Lever, Ashby, Workday) and automatically capturing submission confirmations into your JobOps CRM tracker.

---

## Features

- **Manifest V3 Compliant**: Built strictly following modern MV3 standards using ES modules and service worker architecture.
- **Secure PAT Authentication**: No passwords or Clerk authentication tokens enter the extension. Authentication uses a revocable Personal Access Token (PAT) generated in the web app settings, scoped solely to `/api/ext/*` endpoints.
- **Instant CRM Matching**: Automatically checks whether your active browser tab corresponds to a tracked job in your pipeline via `GET /api/ext/match?url=...`.
- **Application Pack Integration**: Accesses grounded answers, tailored resumes, cover letters, and contact blocks assembled by the Apply Copilot agent.
- **Automatic Submission Capture**: Detects completed job application submissions and updates the job status to `applied` in your CRM.
- **Human-in-the-Loop Invariant**: Never clicks the final "Submit Application" button. Fills fields for review and lets you submit manually.

---

## Directory Structure

```
extensions/chrome/
├── manifest.json            # MV3 manifest definition
├── package.json             # Workspace scripts and dependencies
├── tsconfig.json            # TypeScript configuration (DOM + Chrome types)
├── build.mjs                # esbuild bundle script
├── README.md                # Documentation & installation guide
├── icons/                   # 16px, 48px, 128px PNG icons
├── dist/                    # Compiled JavaScript bundles (generated)
│   ├── background.js
│   ├── options.js
│   └── popup.js
├── options/                 # Options page UI
│   ├── options.html
│   └── options.css
├── popup/                   # Browser action popup UI
│   ├── popup.html
│   └── popup.css
├── src/                     # TypeScript source code
│   ├── types.ts             # Message, payload, and data types
│   ├── background/
│   │   └── index.ts         # Service worker message router & lifecycle
│   ├── options/
│   │   └── options.ts       # Options logic and connection verification
│   ├── popup/
│   │   └── popup.ts         # Popup logic, active tab matcher, actions
│   └── shared/
│       ├── api.ts           # Client for JobOps API (/api/ext/*)
│       └── storage.ts       # chrome.storage helper with test fallback
└── test/                    # Unit tests
    └── api.test.ts          # Test suite for API client and storage
```

---

## Installation & Setup

### 1. Build the extension

From the project root:

```bash
# Build once
npm run build:extension

# Or watch for changes during development
cd extensions/chrome
npm run watch
```

### 2. Load unpacked extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** on in the upper-right corner.
3. Click the **Load unpacked** button in the top toolbar.
4. Select the `extensions/chrome` directory from this repository.
5. The **JobOps Copilot — Apply Assist** extension will appear in your extension list.

### 3. Generate a Personal Access Token (PAT)

1. Open your JobOps Copilot web application (e.g. `http://localhost:3000/settings`).
2. Scroll to the **Chrome extension access tokens** section.
3. Enter a label (e.g., *My Work Laptop*) and click **Create token**.
4. Copy the raw token string (`jop_...`). Note that tokens are shown only once upon generation.

### 4. Configure Extension Options

1. In Chrome, click the extension puzzle piece icon and open the **JobOps Copilot** options page (or right-click the extension icon and select **Options**).
2. Enter your **JobOps API URL** (default: `http://localhost:4000`).
3. Paste your **Personal Access Token**.
4. Click **Test Connection** to confirm connectivity. A green banner will display your authenticated user ID and token label.
5. Click **Save Settings**.

---

## Testing & Verification

Run the test suite:

```bash
# From repository root
npm run test:extension

# Or within the extension directory
cd extensions/chrome
npm test
```

Run TypeScript verification:

```bash
npm run typecheck:extension
```
