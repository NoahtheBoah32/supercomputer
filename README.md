# Supercomputer — original 0.2.0

The original local creative app with Claude Code chat, image/video generation,
and the embedded Blender connector. This is the October 2, 2026 baseline confirmed
by its owner. It predates DiviDr, EDITH, TRACE and the newer workflow canvas.

The original `app/server` and `app/web` files are preserved unchanged. This repo
adds portable startup instructions, an isolated workspace, and a smoke test.

## Run

Install **Node.js 20 or newer**. On Windows, double-click **Start Supercomputer.cmd**.
Or, from this folder, run:

```sh
npm run setup
npm start
```

The app opens at **http://127.0.0.1:8797/**. Keep the terminal running; Ctrl+C
stops the server. If another Supercomputer version is using that port, close it
or set `SUPACOMPUTA_PORT` to a free port before starting this copy.

In the app:

1. Sign in to **your own Claude account** through the login screen. The original
   Agent SDK installs its platform-specific Claude executable during setup.
2. Add your own generation provider keys in Settings. You can skip this for UI
   exploration; image/video generation needs an account with the relevant provider.
3. Install Blender, then connect it under Connections. Python 3 and FFmpeg should
   also be available on PATH for the local pipeline tools and video processing.

Windows is the tested environment for the embedded Blender window. The original
macOS/Linux fallbacks are included but were not verified in this recovery.

## Local data and credentials

By default this launcher keeps private settings, chats, uploads and a writable
copy of the pipeline in **`~/.supercomputer-original/`**, outside the repo.
The source pipeline template stays clean. Existing workspace files are preserved
on subsequent starts.

Claude manages its own local login. No Claude credentials, provider keys, browser
sessions, personal chats, generated projects or personal briefs are included.
Every recipient signs in and supplies their own provider keys. Never add these
private files to Git, even in a private repository. The original app stores its
provider settings locally; protect your operating-system account and data folder.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `SUPACOMPUTA_HOME` | Private app data directory |
| `SUPACOMPUTA_PIPELINE` | Writable pipeline workspace |
| `SUPACOMPUTA_PORT` | Local port, default 8797 |
| `SUPACOMPUTA_CLAUDE` | Optional Claude executable path |
| `BLENDER_PATH` | Optional Blender executable path for discovery |

## Verify

```sh
npm run setup
npm test
```

The smoke test uses a temporary workspace and a free loopback port. It checks
startup, the original UI and Blender routes, chat creation/persistence/deletion,
and isolation from existing user data. It does not buy generation credits or run
a paid model request. Provider generation still depends on the recipient's login,
account access, current provider API behavior and installed tools.

## Source layout

- `app/` — original 0.2.0 app and pinned dependency lockfile.
- `pipeline-template/` — original Markdown instructions, tools and examples.
- `scripts/` — repo startup and smoke-test helpers.

The source was recovered from a preserved 0.2.0 distribution. Its historical app
lockfile still labels the package 0.1.0; it was retained verbatim to preserve its
dependency versions. The app's package manifest identifies 0.2.0.
The old packaged desktop installer/build scripts are not included; this repository
runs the original app from source. Historical packaging notes in `app/README.md`
describe that earlier distribution and do not replace the instructions above.
