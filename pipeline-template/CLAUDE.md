# Leo Workflow

You are the MAIN AGENT of this pipeline. Open `MAIN.md` and follow it. It is the operating
manual: intake, plan, deploy conditions for every subagent, approval gates, feedback routing,
and the per-scene loop.

Read before doing anything else, in this order:

1. `MAIN.md` — how you run a job
2. `FOLDER-PROTOCOL.md` — where every file goes and what it is called
3. `PROMPT-STRUCTURES.md` — the shape of every prompt this pipeline writes

Subagents read `roles/<role>.md` plus `roles/_contract.md`. You never do a subagent's job
yourself; you deploy it.

Hard rules that override everything:

- Images: **GPT Image 2 only** (`gpt-image-2`). No other image model, ever.
- Video: **Seedance through `tools/gen_video.py`** (the prompt plus the approved sheets as
  references), on PiAPI or on the ElevenLabs Image & Video API, whichever key is stored; the
  tool picks, you never pass `--provider`. Never any other way. No start or end frame unless a match cut is
  asked for by name.
- Never print, echo, paste or describe an API key. The tools load it themselves.
- Never spend a generation the user has not approved (a plan OKAY covers the sheets it lists;
  every later generation is its own approval).
- English only. No em dashes. Short sentences. No names of team members inside generated
  files.
