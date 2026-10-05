# START HERE

This folder is the Leo Workflow pipeline that Supacomputah drives. Supacomputah put it here and
keeps the manual, roles, tools and libraries current when a new version is opened. Your work stays:
`jobs/`, `briefs/`, `scratch/` are never touched by an update.

## Open it

Double-click **Supacomputah.app** in the Supacomputah folder. The server runs in the background;
the app opens as its own Chrome window. First time only:

1. **Log in to Claude.** The app opens a Terminal window for the login. Finish it there, then come
   back. (If no window appears, double-click `Log in to Claude.command` in the Supacomputah folder.)
2. **Paste a generation key** in Settings: ElevenLabs, Higgsfield or fal. The key is checked with
   a free call, stored in your own home folder, and never shown again.

## Say this

Type one message. Something like:

```
images only. new job: a doctor shows an old lady her chest x-ray in a small clinic,
warm and hopeful, three scenes.
```

`images only` keeps the video step off, so no video credits are touched. Drop those two words
when you want clips.

## Or run the comparison test

```
run briefs/window-map-scene-1.md
```

That brief is Scene 1 of The Window Map with the kit author's own prompts, verbatim, images
only. It skips the questions it already answers.

## What happens next

The agent reads `MAIN.md` on its own, asks what it needs, plans, and stops at a gate before every
generation. Before the first render of any set it asks whether to find reference images first;
say yes and it browses Pinterest, Pexels and Google Images in the side panel, you keep the ones
you like, and they ride along with the render.

Every generated file lands in `jobs/<date>-<name>/`. The Jobs button in the app opens it in Finder.

## To stop it

Double-click `Stop Supacomputah.command` in the Supacomputah folder. Otherwise the server simply
stops when you log out.

## Blender (optional)

If Blender is installed, open the sidebar > **See more** > **Connections** and press **Connect** on
the Blender card. From then on, a shot with a choreographed camera move (a cinebot orbit, a push
into a label, a drone fly-through) can be built as a low-poly motion previz first: the agent writes
the Blender script in the chat, you approve the render (free, on this machine), and the clip is the
motion reference Seedance follows. The Blender tab in the side panel shows the real scene while it
works. Ask for it directly with "Create a new blender project ..." or say yes when the agent asks.

## If you prefer VS Code

Open this folder in VS Code with the Claude Code extension and talk to it there. Same manual,
same tools, same job folders.
