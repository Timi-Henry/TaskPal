# TaskPal

TaskPal is a browser-local task manager built with React, TypeScript, Tailwind CSS and Vite+. It supports creating, completing and deleting tasks, reading long titles in a scrollable paper dialog, and exporting or importing task backups. Each task keeps the animated shader appearance through a shared WebGL renderer.

## Run locally

Use Node.js 24.x and npm. Install the locked dependencies and start the development server:

```sh
npm ci
npm run dev
```

The project uses Vite+, including its local `vp` commands. The `vite` dependency is an alias for the Vite+ core package; use the package scripts instead of calling an unrelated global `vite` executable. The prepare script configures the project's Git hook integration. Staged checks are configured in `vite.config.ts` with `defineConfig` from `vite-plus`.

## Checks and production build

```sh
npm run check
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
```

Run browser coverage with:

```sh
npx playwright install chromium
npm run test:e2e
```

Use `npx playwright install --with-deps chromium` when a Linux test environment needs browser system dependencies. Unit tests cover data and application behavior. Browser tests cover interactions that depend on real layout, dialog focus and canvas rendering. The GitHub Actions workflow runs the repository checks for pushes and pull requests.

The build script runs TypeScript before `vp build`. Production files are written to `dist`. The preview command serves those files locally; it does not publish a deployment.

## Task storage and recovery

The first visit starts with an empty list. Tasks are stored in the current browser profile for the current site origin. There is no account, server-side task storage, encrypted vault or automatic cross-device sync. A different browser, profile, domain or localhost port has a separate list. Private browsing, clearing site data and browser cleanup can remove saved data.

The current persistence layer uses IndexedDB database `taskpal.tasks.v2`, database version 1, with `tasks` and `meta` stores. Mutations operate on individual task records in transactions. BroadcastChannel notifications and focus refresh keep other open tabs informed, so a stale tab does not replace the entire list when adding a task.

Existing `taskpal.tasks.v1` localStorage data is validated and migrated once inside a transaction. The migration marker prevents repeated import. The original localStorage bytes remain as a recovery snapshot; they are not the live updated task list after migration. Unreadable old data is retained until the user explicitly chooses how to proceed.

If saving fails, TaskPal displays one warning outside the task cards and keeps the current session usable. Retry saving retries pending changes. Export a backup before closing a page with unsaved changes. When previous saved data cannot be read, the recovery controls allow downloading those original bytes before choosing to keep the current tasks.

Use **Backup & storage** to export a version 1 JSON task file or import a validated backup. Import adds unknown task IDs while preserving existing tasks with matching IDs; it does not silently replace the current list. Backup files contain task text and should be stored privately. Deleting a task offers an undo window of approximately eight seconds.

## Structure

| Path                                      | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `src/App.tsx`                             | Page composition, task interactions, progress and recovery controls         |
| `src/useSavedTasks.ts`                    | React interface to task storage and save status                             |
| `src/taskStorage.ts`                      | Transactional persistence, migration, synchronization and recovery          |
| `src/components/TaskDetailsDialog.tsx`    | Native modal lifecycle and full task text                                   |
| `src/components/ShaderBackground.tsx`     | Shared WebGL resources, observers and drawing lifecycle                     |
| `src/index.css`                           | Existing responsive design, paper texture and accessible interaction states |
| `public/help.html`, `public/privacy.html` | Public, script-independent product and storage information                  |
| `vercel.json`                             | Production build settings and browser security headers                      |

## Design and external assets

The mobile geometry, two-line task previews, paper texture strength and shader artwork are retained. The renderer shares one WebGL context between task canvases, retains offscreen task images, stops continuous drawing for reduced motion and pauses work while the document is hidden. Task text remains ordinary React text, including strings that look like HTML.

Google Fonts serves Inter, Newsreader, Cinzel and IM Fell English. The HTML discovers the font stylesheet directly and preconnects to the font origins. The stylesheet uses `display=swap`. The public privacy page describes those external requests. No visitor-analytics SDK, session replay, advertising pixel or task-content telemetry is included.

`public/white-paper-texture.webp` is a high-quality conversion of the project's existing 2000×1333 paper JPEG. It is 232,906 bytes instead of 626,016 bytes, a 62.8% reduction, with the same dimensions and CSS blending strength. The original is retained in `design-assets/white-paper-texture.original.jpg` and is not copied into the production public directory.

The original source and license of the pre-existing paper image and shader artwork were not documented in the starter project. Confirm and record their provenance before redistributing them under a new license; this repository does not invent an attribution or license for those assets. The favicon uses the project's Lucide Sparkles icon; its license is retained at `public/licenses/lucide.txt`. Google-hosted fonts remain subject to their individual font licenses; retain those licenses if self-hosting them later.

## Public metadata and deployment

The production URL is currently `https://task-pal-eight.vercel.app/`. If that changes, update the canonical/social URLs in `index.html`, the canonical links in the static information pages, and `public/robots.txt`, `public/sitemap.xml` and `public/llms.txt` together. Only public product pages belong in these discovery files. Personal tasks must never be included in them or in public metadata.

Vercel uses `npm run build` and the `dist` output directory. Configure Node.js 24.x consistently with `package.json`. Committing local changes does not by itself prove they are deployed; verify the deployment produced by the project's connected repository workflow.

The production Content Security Policy permits scripts only from the same origin, disallows script attributes, framing and embedded objects, and permits the existing Google Fonts origins. `style-src-attr 'unsafe-inline'` is intentionally limited to style attributes so React can update the progress bar; it does not permit inline scripts or inline stylesheet blocks. MIME-sniffing, framing, referrer and unnecessary device-permission protections are configured alongside it. Vite's development server does not apply Vercel production response headers; validate the production build with those headers when changing asset origins or style behavior.

The public help and privacy pages are available without JavaScript. `llms.txt` is a lightweight pointer to those pages, not a promise of search indexing, AI citations or rankings. There is no invented rating, customer statistic or rich-result claim.

See [CHANGES.md](CHANGES.md) for the audit fixes, their reasons, verification scope and remaining limitations.
