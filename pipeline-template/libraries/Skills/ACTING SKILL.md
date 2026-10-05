# ACTING SYSTEM
## Character Performance for AI Video Generation (Seedance 2.5 first; holds on 2.0, Kling, Veo)

You are reading this because the pipeline needs **character acting** written inside video
prompts. Study this document, then apply it every time you write, review or fix the
performance layer of a video prompt. In this pipeline the acting lives in two places: the
scene card (the decisions, named internally) and the PERFORMANCE block of the sealed video
prompt (`PROMPT-STRUCTURES.md` §6.1, the observable result). The method names in this file
(Meisner, Laban, Lecoq, Chekhov, Hagen) stay on the card. They never reach a prompt. Only
the visible behavior does.

**The core axiom of this entire system: acting is BEHAVIOR under pressure, not a display of
emotion.** A character wants something, something is in the way, and they act to get it.
Emotion is a byproduct of that struggle. Never the thing you write directly. Everything
below unpacks this rule.

**The second axiom, from every situation we researched: people fight the state instead of
showing it.** They try to seem sober, hold back tears, keep anger quiet, hide pain. The
struggle against the state reads truer than the state itself.

**Evidence labels** used in the newer sections: `[OFFICIAL]` a model vendor's own guide,
`[FIELD]` a practitioner test with results shown, `[SCIENCE]` peer-reviewed behavior
research, `[CRAFT]` established acting or screen-acting teaching, `[ANECDOTAL]` reported but
untested. Sources are listed at the end of the file.

---

# PART I · THE CRAFT: WHAT GOOD ACTING IS

## 1. Definition

Acting is truthful behavior under imaginary circumstances. Not depicting emotions, not
reciting text, not "expressive faces." A person in the frame WANTS something, something
INTERFERES, and they ACT to get what they want.

| Bad acting | Good acting |
|---|---|
| Shows the emotion ("I am angry") | Pursues the objective ("I will make you return the money"); anger arises on its own |
| Waits for their cue | Listens and reacts to the partner every second |
| Body illustrates the words (gesture = word) | Body lives its own life, sometimes contradicts the words |
| All lines in one tempo and tone | Rhythm changes with every change of tactic |
| Emotion switches on at the line and off after | State is continuous: there is a "life before" and a "life after" the line |
| The face "performs": eyebrows, grimaces | The face thinks: the thought is readable in the eyes before the words |
| Shows the feeling | Fights the feeling, and loses a little |

## 2. The five pillars of every scene

Every character in every scene decomposes into five elements. If even one is missing, the
performance falls apart.

**2.1 Objective.** What the character wants IN THIS SCENE, RIGHT NOW, FROM A SPECIFIC
PERSON. Always a verb aimed at the partner: "make him confess", "beg a week's extension",
"convince her I'm not afraid". Never a state ("be angry", "feel guilty"); states cannot be
played directly. Behind the scene objective sits a super-objective: what the character
wants across the whole story. Every scene objective is a step toward it.

**2.2 Obstacle and stakes.** What prevents them from getting it: external (another
character wants the opposite; witnesses in the room; two hours to deadline) or internal
(pride won't let them beg; they don't believe their own words). Stakes: the higher the cost
of failure, the more taut the scene. Always answer "what happens if I do NOT get what I
want?" The answer must frighten the character.

**2.3 Tactics.** The concrete method of pursuing the objective right now. Tactics are
action verbs: to press, to charm, to shame, to plead, to provoke, to bargain, to threaten,
to stall. When a tactic fails, a living person CHANGES it. Dead acting is one tactic for the
whole scene.

**2.4 Beats.** The smallest unit of action: the stretch during which the character wants
one thing and pursues it one way. A beat ends when the objective is achieved, the tactic
fails, new information arrives, or the balance of power shifts. **Every beat change must be
VISIBLE in behavior**: a pause, a change of posture, a change of speech tempo, a shift of
gaze. A good scene has 2 to 4 beat changes; if behavior is unchanged for the whole duration,
the scene is played flat. On Seedance 2.5 a beat is at least 3 seconds, holds one core
action, and ends in a stated state `[FIELD]`.

**2.5 Subtext.** What the character actually thinks and wants, as opposed to what they say.
Subtext is NOT performed. It leaks out on its own when the character plays the true
objective while speaking the false text. Markers you can build into a scene: questions that
aren't questions; repetitions (asking the same thing: doesn't believe the answer); abrupt
topic changes; jokes at the wrong moment (shield against vulnerability); answers that are
too short ("Fine." "Sure." A closed door). On Seedance 2.5, subtext is also **written into
the prompt** as its own line after each beat's physical directions; the model acts better
when it knows the intent (§16.2) `[OFFICIAL]`.

## 3. The scene layer above the pillars

The five pillars are per character. They do not say what holds an ensemble together, which
is why scenes built from them alone can read as several good performances that are not in
the same scene. One layer sits above them.

**3.1 One scene direction, shared by everyone.** Usually unspoken: a silent agreement about
how this time will be lived. *Part without pain, stay positive* (a mother packing her son's
bag before he leaves). It belongs to everyone in the room at once. It is not the film's
theme; characters never play the theme, which happens through them as a byproduct.

**3.2 Each character's own motive, the fuel.** Same direction, different fuel. The son keeps
it painless *for his mother*; the mother keeps it painless out of *superstition* (tears
before a journey are a bad omen). The fuel makes each performance distinct while the scene
still reads unified. Skip it and the ensemble collapses into one note repeated. The
backstory constrains the motive: if they contradict, re-derive the motive.

| Layer | Whose | Example |
|---|---|---|
| Scene direction | Shared by all | *keep it painless* |
| Motive (fuel) | Each character's own | *superstition* / *for her* |
| Objective (2.1) | Each character's own | *send him off strong* |
| Tactic (2.3) | Each character's own | *pack ordinarily, steal looks* |

**3.3 Name the event from the ending.** Read how the scene ends before naming what it is
about. The last line or beat is the key you read the whole scene backward through. Watch for
the double-meaning last line, spoken about one thing and meant about another. **The test:
the event must contain EVERY character in the scene**, silent ones included. If a character
stands outside the named event, the event is named wrong. Rename it until they are all
inside.

**3.4 Every character gets a physical channel.** The surface activity (the terrain) stays as
the physical action, and each character pursues the event through it with their own
camera-readable behavior. One terrain (routine hospital rounds), one event (the search for
self-forgiveness), three channels: one character through remembering (eyes moving under
closed lids, a tear), one through duties done exactly right (double-checking an entry), one
through caring (gestures beyond the checklist). An invisible task with no visible channel
gives the model nothing to render.

**3.5 Contrast pairing for two-handers.** Each character carries one plus and one minus,
inverted relative to the partner, on one named essential axis the audience reads. Both still
push the same scene direction; the contrast lives underneath and leaks out through tactics.
The seeming trait is often scar tissue over its opposite: "careless" is hope lost, not care
absent. Direct the history, not the surface.

## 4. Listening and reaction: the main test of quality

Performance lives not in the lines but BETWEEN them. Observable markers of real listening:

1. **Reaction starts before the partner's line ends.** A person grasps the point mid-phrase;
   face and body already answer. A neutral face until the end of the partner's line, then
   "switching on", is dead acting.
2. **Thought before word.** Before a hard question there is a micro-pause: the person
   visibly decides what to say. Instant answers at uniform speed read as memorized text.
3. **The assessment moment.** When something important happens (news, threat, insult), the
   character needs time to digest it, from a fraction of a second to a long pause.
4. **Contagion from the partner.** Tempo, volume and energy shift in response: a shout is
   answered with a counter-shout or with pointed quiet, but answered, not continued over.
5. **A silent listener gets a task, not just markers.** A listener with nothing to do is
   where the dead face returns in a two-shot. Name the work: *decide whether he is serious,
   wait for the opening, protect the mood, catch him in the lie.*
6. **Every reaction has a visible cause.** Name the trigger, then the response after it,
   with a small delay. Never a reaction with no cause in frame or in the sound
   `[CRAFT]`. "He sets the cup down hard; a beat later her shoulders jump and her eyes go to
   his hands."
7. **Reactions arrive a half-beat late and build.** Smiles start small and grow; a flinch
   lands after the sound, not with it `[FIELD]`.

**Conversation timing, measured** `[SCIENCE]`:

- The normal gap between turns is about 0.2 s across languages. "Answers almost at once" is
  the default. A full 1 s gap reads as reluctance or trouble; use it on purpose.
- Listeners look at the speaker more than speakers look at the listener. Speakers look away
  at the start of their turn and come back to the partner near its end.
- A listener nods or gives a small "mm" roughly every 10 to 30 seconds, at the ends of the
  partner's phrases. Not constantly.
- Thinking makes people look away: up or to the side on a hard question, then back to
  answer.

## 5. The body: the character's physical life

**5.1 Physical state before psychology.** The body tells the story before the first line.
Set these for every character:

- **Center of gravity:** high (chest, chin: confidence, aggression, status) or low
  (shoulders, slouch: fatigue, fear, submission).
- **Tempo:** fast and ragged (nervousness, stimulant energy) or slow and economical (control,
  threat: the most dangerous people move least).
- **Openness:** squared shoulders and open palms vs crossed arms, dropped head, closed poses.
- **Breath:** the most honest indicator of state. Calm breathing is one slow, barely visible
  rise every 4 to 5 seconds. Stress moves it up into the chest: faster, shallower, shoulders
  lifting. A sigh is a reset: it comes at relief and after strain `[SCIENCE]`. Sound and
  physics must match: someone who just ran cannot speak on a steady voice.

**5.2 Effort: how the body spends energy.** `[CRAFT]` Give each character one dominant
effort, made of three choices: weight (strong or light), time (sudden or sustained), space
(direct or indirect). Write the three choices as plain words, never an emotion.

| Effort | Weight · time · space | Reads as | Prompt phrase |
|---|---|---|---|
| Press | strong · sustained · direct | authority, a guard, a negotiator | "pushes the folder across the desk slowly and firmly, eyes fixed on it" |
| Punch | strong · sudden · direct | aggressor, a drill voice | "jabs one finger at the map, stops dead" |
| Wring | strong · sustained · indirect | anxious, guilty, torn | "twists the cap in both hands, torso turning away" |
| Slash | strong · sudden · indirect | explosive, chaotic | "sweeps the papers off the table in one wide arc" |
| Glide | light · sustained · direct | composed, in control | "smooths the tablecloth in one even stroke, gaze level" |
| Float | light · sustained · indirect | dreamy, distracted, grieving | "drifts to the window, hand trailing along the wall" |
| Dab | light · sudden · direct | precise, fussy, clerical | "taps the screen twice, quick and exact" |
| Flick | light · sudden · indirect | playful, dismissive, nervous | "flicks crumbs off the sleeve, glancing away mid-flick" |

**Flow is the fourth dial.** Bound flow is held and can stop on a dime (fear, suspicion,
restraint). Free flow is continuous and hard to stop (relief, joy, drink). Changing only the
flow reads as a change of inner state. **Write an arc as an effort shift**, not an emotion:
"quick exact taps" becomes "the same hands now press, slow and heavy on the table."

**5.3 Tension: a 1 to 7 scale.** `[CRAFT]` Give each character a tension level per state.
The number lives on the card; the prompt gets the visible description.

| Level | Name | What the camera sees |
|---|---|---|
| 1 | Exhausted | no tone, slumped, heavy eyes, every move costs effort |
| 2 | Laid-back | loose joints, hip-shot posture, slow unhurried hands |
| 3 | Neutral | balanced, upright, economical, calm open eyes, ready |
| 4 | Alert | head and eyes scanning, weight shifting, small restless changes |
| 5 | Suspense | breath held on the in-breath, brows drawn, body coiled, reactions delayed |
| 6 | Passionate | tension bursting out, wide eyes, fast forceful movement, raised voice |
| 7 | Frozen | petrified, rigid, barely breathing |

Move one or two levels per state change, never 3 to 7 in one step, unless the trigger is a
real shock shown on screen. **Anyone not driving the moment sits at 3**: economical, still,
no idle gestures. This is the cure for over-acting background people.

**5.4 One body image per character.** `[CRAFT]` Each character gets one whole-body image of
what they want, written as a verb with a direction: pull in, push away, reach up, sink, open
out, close around. It is never performed in full; only its residue shows in posture, lean
and the habit of the hands. Wants control: "everything about her leans slightly forward and
down, as if pressing a lid shut." Wants escape: "chest lifted, weight on the balls of the
feet, body angled toward the exit." Add one texture word if useful: moving as if through
thick clay, flowing like water, lifting as if weightless, or radiating outward into the
room.

**5.5 Business: the physical task.** A character almost always needs a DOING: they don't
"have a conversation", they fix an engine, count money, cook, wipe a glass, and talk over
the top of it. Business kills fake theatricality, creates rhythm, and generates subtext (HOW
a person counts money says more than the words). **The interrupted-action rule:** the
strongest accent is when a character STOPS the business. If he was slicing bread and stopped
at a phrase, the phrase became an event. **Real doing, not indicated doing:** the task is
actually done, with real friction (the lid that resists, the needle threaded on the second
try). Never "pretends to." **Competence is economy:** a practiced hand reaches for the next
tool without looking.

**5.6 Objects carry history.** `[CRAFT]` Write the handling, not the meaning: weight,
temperature, care, avoidance. "Lifts the letter by one corner as if it were hot, sets it
face down." Every walk has a visible destination, and the eyes reach it before the body:
"her eyes land on the chair first, then she follows them."

**5.7 Entrances carry the moment before.** `[CRAFT]` The first second of a shot shows the
leftovers of what happened off screen, plus the conditions acting on the body (heat, cold,
fatigue, a tight shoe). "Enters still breathing hard from the stairs, coat wet at the
shoulders, wiping rain from her brow before she looks up." In this pipeline this is the
OPENING state on the card and the FIRST FRAME / BLOCKING block of the prompt.

**5.8 Proxemics: distance as drama.** Intimate zone (under 0.5 m): love or violence;
entering uninvited is aggression; a threat whispered 10 cm from a face is scarier than
shouting across a room. Personal (0.5 to 1.2 m): trust. Social (1.2 to 3.5 m): business,
wariness. Public (3.5 m and more): alienation, hierarchy. Scene drama is often the story of
distance: who closes it, who breaks it, who freezes. **A change of distance is a change of
beat**, and it is written in metres.

**5.9 Status: the invisible hierarchy.** Status is what you DO, not who you are. High status:
an immobile head, slow movements, long gazes, pauses before answering, taking up space,
touching other people's things. Low status: fussing, frequent self-touching (face, hair),
broken speech, filler laughter, asking permission with the eyes. The most interesting thing
in a performance is a **status break**: the boss who shows fear for one second; the
underling who suddenly stops smiling. Strong scene shapes: enter high and collapse, or enter
low and flip the room.

**5.10 Idle life, measured.** `[SCIENCE]` Standing people always sway a little; relaxed, it
is a faint slow weight shift. Afraid, the sway gets smaller and faster: the body locks rigid
with fine trembling adjustments. Self-touch (neck, lip, rubbing a thumb against the fingers)
rises with stress. Absorbed people go still; bored people fidget, shift, and prop the head on
a hand.

## 6. Speech: how good acting sounds

- Rhythm is written in the text; deliver it precisely. Fast does not mean mushy.
- Overlaps are normal (lines stepping on each other's tails), but key words stay clean.
- **Volume contrast: the most frightening things are said the quietest.** Shouting is the
  currency of the weak; the character who owns the scene lowers the volume and everyone
  leans in.
- Pauses are events, not holes: a pause is legal only if something happens inside it (an
  assessment, a decision, a refusal to answer).
- Real speech has litter: interruptions, half-heard words, repetitions, unfinished phrases.
  Perfectly built sentences kill street truth.
- **The gesture lands just before the word.** `[SCIENCE]` A gesture starts before the word
  it belongs to, and a small beat of the hand peaks just ahead of the stressed syllable. "Her
  hand begins the shape just before she says the word." A gesture after the word reads as
  dubbed.
- **Speakers look away more while searching for words** and look at the listener more
  while speaking fluently `[SCIENCE]`.

---

# PART II · WRITING THE ACTING: PROMPT ARCHITECTURE

## 7. The character acting master profile

Every recurring character gets ONE master profile: the permanent source of truth about how
they act. It is written once, then adapted per scene (§12). Target length: **150 to 220
words, one flowing paragraph**, all in English, fully observable and filmable.

**The template (block order is fixed):**

```
Character acting as [NAME]. [Age, build, physique, posture: the body as a document of their
biography]. [The psychological engine in one clause: the inner drive that explains the
physicality]. [Movement: the dominant effort as three plain words plus its flow, and the
one body image as its residue]. Vocal profile: [pitch and timbre, accent or origin, pace
and delivery manner, and how the voice breaks or shifts under emotion]. Key physical habits
and tics: [signature tic with its trigger; stress tic with its trigger; concealment
behavior: what they do to hide what they feel; the facial mask and the exact condition under
which it cracks]. Eye life: [baseline blink, gaze habit, eye task]. Walking style: [the gait
as characterization, named and specific, with weight, rhythm and foot placement]. However,
when [emotional trigger], [the transformation: how posture, gait and face change].
[Optional: the softening target, the one person or thing that makes the face genuinely
soften].
```

The card also records, outside the prose: the character's **baseline tension level** (§5.3)
and their **effort name** (§5.2). They steer the writing; they do not appear as labels in
the prompt.

**Rules for writing each block:**

1. **Only observable behavior.** Every inner state has a body marker. Never write "he is
   nervous"; write the trembling lower lip, the heavy swallow, the long inhale through the
   mouth and sharp exhale through pursed lips.
2. **Every tic has a trigger.** Not "he cracks his knuckles" but "he cracks his knuckles
   during small talk to fake confidence". Tics without triggers are decoration; tics with
   triggers are drama.
3. **Name the gait.** A coined name in quotes anchors the biomechanics: a "power-walk", a
   "battering-ram stride", a "dreadnought pace". Then unpack it: weight, step, what the torso
   and arms do, what the head does.
4. **Build in the mask AND the crack.** The conditional transformation is the single most
   cinematic device in a profile: the facade and the precise trigger that collapses it.
   **Every profile carries at least one "However, when X" clause.** A character playing two
   truths at once is the difference between a puppet and a person.
5. **One softening target.** Where it fits, exactly one person, animal or object for which
   the face genuinely softens. One, not two.
6. **No wardrobe.** Clothing lives in the reference sheet and the look block, never in the
   acting profile. The profile must survive any costume change. The sheet is the source of
   truth for face, body and wardrobe; prose that re-describes them fights the reference.
7. **No camera, no color.** Acting drives performance, face, voice and motion only.
8. **Physique carries biography.** Build and posture tell the backstory: shoulders
   "perpetually tense", a posture "over-corrected to project authority". Profession, old
   injuries and self-image are readable in the body.
9. **Give every emotion two or three alternative body cues**, not one stock pose. The same
   feeling shows differently in different moments `[SCIENCE]`; one fixed pose repeated
   across scenes reads as a loop.

## 8. Eye life: mandatory in every profile and every scene

Dead eyes are the number-one tell of AI-generated acting. Give every character continuous,
naturalistic ocular life.

**8.1 The baseline, measured** `[SCIENCE]`:

| State | Blinks | Gaze |
|---|---|---|
| At rest | about one every 3 to 4 s | drifts, settles, drifts |
| Speaking | more often, about one every 2 to 3 s | looks away to start the turn, returns near its end; looks away more while searching for words |
| Listening | steady, a little less than speaking | mostly on the speaker, short glances away |
| Concentrating, reading, working out an answer | few blinks, held | fixed on the task |
| The thought resolves | a short burst of blinks | gaze lifts |
| Anxious | fuller, quicker, more regular blinks | darting while the head stays still |

On a face, the eyes travel between the partner's eyes and mouth; most looking time lands
on the eyes.

**8.2 The rules:**

- **Gaze targeting and micro-saccades.** The gaze keeps moving: eyes drift, flick away in
  thought, scan to a detail and settle back. They never lock frozen on one point.
- **Give the eyes a task.** A catchlight is a render property, not a cure: a glassy stare
  with a beautiful catchlight is still a glassy stare. Dead eyes are fixed by giving the eyes
  a job aimed at the partner: *read whether she is lying, find the exit, wait for him to look
  up.*
- **Blink quality tied to state:** rapid bursts under stress; slow calm lids in control; a
  blink-and-glaze on a moment of dissociation. Cheapest life in a static shot: one lazy
  blink, then a quick double blink, then one hard reset blink.
- **Controlled stillness is chosen, never dead.** A predator calm keeps blinks rare, slow
  and deliberate (a decision, not a freeze), and the gaze still shifts slowly with intent.
- **Eyes lead the thought.** The eyes reach the target a touch before the head turns.
- **Eye life reacts to the beat**: blink rate and gaze steadiness shift when the beat shifts.
- **Live catchlights** so the eyes read as wet and lit, as a finish on top of the task.

**8.3 Close-ups: fewer blinks, never zero.** Screen-acting teaching says to hold the gaze and
barely blink in a close-up, keeping the eyes on one of the partner's eyes `[CRAFT]`. That
advice corrects human actors, who over-blink under nerves. Video models fail the other way:
they freeze. So in this pipeline a close-up gets **fewer, slower, deliberate blinks, each one
used as punctuation (news landing, a decision), and small eye movements that never stop.**
Hold the partner's nearer eye, with occasional drops to the mouth. Never write "unblinking"
for more than one beat.

## 9. Scale the performance to the shot size

`[CRAFT]` The size of the performance follows the frame, not the intensity of the scene. The
card's FOV and framing decide it.

| Frame | What carries the performance | Example |
|---|---|---|
| Wide | the whole body: posture, weight, distance, walk | "shoulders drop, weight sinks into one hip" |
| Medium | torso, hands, business | "she stops folding, both hands flat on the shirt" |
| Medium close-up | face and small gestures, a nod | "jaw tightens slightly, one slow nod" |
| Close-up and tighter | eyes and the thought only; head still | "head still, only the eyes move; a faint tightening at the corner of the mouth" |

- **In close-ups, lock the head.** Turns and nods belong to medium and wider.
- **The voice follows the frame.** In a close-up even fury comes out low and contained.
- **Put the expressive action inside the frame.** In a close-up, bring the hand up into
  frame ("fingers rise to press against the lips") or leave the hands out of the prompt.
- **Lip-sync shots read best as medium close-up or head-and-shoulders** with one restrained
  camera move `[OFFICIAL]` `[FIELD]`. Wide shots hide sync and lose the face.

## 10. Thinking on camera

`[CRAFT]` A thought is visible as a sequence, not an expression.

1. **The thought-change sequence:** stop; eyes go off the partner (down or to the side);
   refocus as if reading something there; return. The line starts after the return. "She
   pauses, her eyes drop to the table and refocus, then lift back to him before she speaks."
2. **Thought comes before the line.** Every important line gets a beat of visible thinking in
   front of it: "a half-second of searching in the eyes, a small intake of breath, then she
   answers."
3. **Active stillness, not blankness.** When the body is still, the eyes keep working (small
   shifts of focus) and the breath stays visible: "perfectly still, but the eyes keep
   working; a held breath released through the nose."
4. **The concentration blink pattern** `[SCIENCE]`: blinks stop while working something out,
   then two blinks as the thought resolves.

## 11. Emotion timing: how a feeling moves on a face

**11.1 Onset, peak, offset.** `[SCIENCE]` A genuine expression builds (a real smile takes
about half a second to arrive), peaks briefly, and fades gradually. A posed one snaps on,
holds at its peak, and snaps off. **Never hold an expression at its peak.** "The smile rises
slowly, peaks for a moment, and fades; it is not held."

**11.2 The real smile.** The cheeks lift and the outer eyes crinkle together with the mouth.
"Cheeks lift and the eyes crinkle at the corners as the mouth smiles." A mouth-only smile
reads as polite or false, which is useful when that is the point.

**11.3 Slight asymmetry.** Real expressions are a little uneven; one side leads by a
fraction. "One corner of the mouth moves first." Contempt is the one-sided expression by
nature: "one corner of his mouth tightens and lifts, the other stays still."

**11.4 Leaks are short.** A suppressed feeling escapes as a flicker of under half a second,
then the mask returns `[SCIENCE]`. "A flicker of disgust crosses her face for a split second,
then the neutral mask is back." Use it once per scene at most; it is rare in life.

**11.5 The arc inside one clip** `[ANECDOTAL]`, matching the official samples: trigger,
resistance, leakage, release, aftermath. Delay the peak, and keep the last 2 to 3 seconds for
the aftermath (an exhale, the gaze settling). The fight against the feeling is the longest
part.

**11.6 Two to four cues per transition.** `[ANECDOTAL]` More simultaneous cues read as
melodrama. "Eyes drop to the cup, one swallow, the thumb stops on the rim." Then stop.

**11.7 Low-force words on mouth and brows.** `[ANECDOTAL]` Forceful lip verbs distort the
mouth. "Gently catches the lower lip", not "bites hard". "The corner of the mouth lifts
almost imperceptibly" `[OFFICIAL]`.

**11.8 Tears are late and uneven.** The first tear is delayed; one eye goes first while the
other only glosses. Trying not to cry reads stronger than crying. "Tears welling but not
falling" is a state the model can render.

**11.9 Emotion in the whole body** `[SCIENCE]`: grief folds the upper body forward, slows and
reduces movement, the head goes down or into the hands. Anger leans in with large, abrupt
movements. Fear draws in, small and held back. Shame caves the shoulders and narrows the
chest, eyes down. Triumph lifts the chin, opens the chest, raises the arms. These hold
across cultures, and even in people blind from birth.

## 12. Scene adaptation: the master profile is rewritten, never pasted

The master profile is who the character IS. For each scene, REWRITE it into the moment:

1. **Present characters only.** An acting paragraph only for characters in the shot.
2. **Keep the constant core.** Identity, vocal profile, signature tics, eye life, effort and
   the emotional through-line stay the same in every scene. Never contradict the master.
3. **Re-express for this scene.** Select, emphasize, modify or drop behaviors to fit the
   scene's posture (seated, standing, running, hiding), action and beat, emotional state,
   tension level, shot size (§9) and time of day.
4. **Transform, don't delete.** A behavior that physically can't happen here is converted:
   a restless pacer slumped on a sofa keeps the same nervous engine displaced into micro-sway,
   wrist flicks and paper tearing. The energy is constant; its outlet changes.
5. **One flowing paragraph per character** in the character's register, no bullets inside
   the prompt.
6. **Lead with the character's @handle** so the model binds the acting to the right
   reference.
7. **Apply the situation playbook** (Part III) for the scene's situation.

## 13. Voice and dialogue

**13.1 The voice is locked.** Acting is rewritten per scene; **voice is not**. Each
character gets one Voice prompt, their permanent vocal identity, kept in one place (a voice
bible in the job's plan). Copy it, never retype it. **Not even a synonym:** swapping *warm*
for *rich*, or *gravelly* for *raspy*, moves the generated voice `[FIELD]`. If the character
appears but says nothing, omit it. Test the voice across generations like the look; a model
holds only a few voices per character, so drift is real.

**Voice prompt formula (1 to 2 sentences, quoted):**

```
"A [age]-year-old [origin / accent descriptor]. [Timbre and register]; [pace and delivery
manner]; [emotional character, and how it shifts under pressure]."
```

The vocal profile INSIDE the acting paragraph describes how speech behaves dramatically
(tempo shifts, breaking registers, whispers); the Voice prompt locks the sound. Both agree.

**13.2 Budget the words by seconds.** About 2.5 words per second of speech at most, and leave
silence before and after the line `[OFFICIAL]` `[FIELD]`. A 6-second clip holds one line of
about 8 to 12 words plus a reaction. This matches the exact word count the card already
carries.

**13.3 Write the line with its delivery, action first.** Language, accent, delivery, speaker,
then the line `[OFFICIAL]`: "English, soft Irish accent, flat and tired, the woman says: 'You're
late.'" Gate actions to words, not only to seconds: "only when he says 'now', she turns."
Break long sentences into short ones. Name speakers by their @handle or a visual
description, never a pronoun alone.

**13.4 Listeners keep their lips closed.** In any shot with more than one person, state that
only the named speaker talks and the others keep their lips closed `[FIELD]`. Without it,
listeners mouth along.

**13.5 The delivery note matches the voice.** A specific descriptor ("sardonic, measured")
gives tighter lip sync than "natural". Very heavy emotional inflection makes mouth shapes go
extreme or lag; keep it restrained `[FIELD]`.

## 14. States, not transitions (and the 2.5 exception)

Video models fail processes that reverse direction and nail states. Describe characters
already IN the action state (mid-throw, mid-punch, mid-argument), not the process of getting
there: "reaches into the bag, pulls out the knife, winds up" collapses; "mid-throw, arm
extended" lands. Chain states beat by beat.

**Scope:** simple motion in ONE direction that has to fill the clip is the other case: chain
2 to 3 connected same-direction actions, or the model spends the leftover seconds reversing
them. **On Seedance 2.5**, timestamps are honored to the second `[OFFICIAL]`, so an emotional
transition inside one clip is directable when each time slice ends in a stated state (§11.5).
On Seedance 2.0, Kling and Veo, timing is a hint only: keep to states.

## 15. Ensemble, space and crowds

- **Group reactions travel in a wave, never in sync.** One person gets the joke first, the
  second half a beat later, the third not at all.
- **The reaction is worth more than the action.** After every event, the most valuable frame
  is the face of the person who saw it.
- **Freeze at the threat.** Constant ensemble micro-movement, and at the key threat everything
  STOPS. Bustle into stillness is punctuation.
- **Movement equals motivation.** Nobody crosses a room without an impulse toward or away
  from something. Strong motivated events: closing in (escalation), turning one's back
  (dismissal or hiding the face), standing while the other sits (dominance grab), sitting
  down mid-conflict (paradoxical power), stopping in the doorway (the threshold is the
  decision point), starting to pack (ultimatum by body).
- **The strong are still and quiet; the weak fidget and shout.** Danger is played by the
  tension of everyone around the dangerous one. Violence arrives without wind-up.
- **Degradation accumulates.** A character worn down across a story carries it cumulatively:
  greyer, heavier, slower reactions, never resetting between scenes.
- **Only about three characters track reliably** across a shot. Write the wave for the lead
  pair or trio; everyone else is crowd, described as a mass at neutral tension (§5.3).

---

# PART III · SITUATION PLAYBOOK

Apply on top of Parts I and II. One rule runs under every situation: write what the camera
can see, in order: **baseline, trigger, one dominant visible change, settled state.** Never
stack mood words ("extremely terrified, devastated"); a stack, or a reaction that starts at
maximum, gives the waxy over-acted look `[FIELD]`.

### 16.1 Situations

**Grief, receiving bad news.** Nothing shows at first: a blank delay, a "this isn't real"
stillness. The body goes on with the task out of habit (still holding the mug). Breath
catches or stops, then a long uneven exhale. The wrong reaction is common: a short laugh, a
practical question. Tears come late or never.
*Cliché:* instant sobbing, collapse to the knees, a scream.
*Phrase:* "she keeps holding the mug, goes still, asks a small practical question, and only
her breath gives her away."

**Fear, danger.** Freeze first: the body stops, head locks toward the threat, breath held.
Eyes dart while the head stays still. Attention goes to the objective (find the child, reach
the door), not to the fear. The voice drops to a breathy whisper. Hands do small useless
things, like fumbling keys. Body rigid, with fine trembling.
*Cliché:* screaming with hands on the cheeks, wide-eyed mugging.
*Phrase:* "he freezes mid-step, head locked toward the sound, eyes flicking, breath held,
then reaches slowly behind him for her hand."

**Anger, arguments.** The person is trying to stay in control: the voice gets quieter and
slower, the jaw sets, the stare fixes, the words get short. Anger leaks through objects (a
cup set down too hard, a jacket yanked on). Sarcasm, a laugh in the wrong place. People cut
in on half-finished lines.
*Cliché:* nonstop shouting, finger-pointing, pacing.
*Phrase:* "his voice drops and slows, he sets the glass down a little too hard, and holds
her gaze."

**Comedy.** Characters don't know they are funny; they play the stakes completely straight.
The straight character takes a held, flat beat to let it sink in. Rhythm matters more than
the face. Underreact to the absurd; overcommit to small goals.
*Cliché:* mugging, winking at the camera, double takes.
*Phrase:* "she takes it in with a flat, held beat, blinks once, and goes back to folding the
towel as if nothing happened."

**Romance, intimacy (non-explicit).** Something gets in the way; wanting shows through
holding back: almost touching, a glance down then back up. The want is specific (to get the
other to admit something), not "love". Distance closes slowly; eyes go to one specific
feature. Real awkward details: a small laugh, a hand to the hair, a breath before speaking.
*Cliché:* the slow lean-in with eyes already closed, gazing with no reason.
*Phrase:* "he stops a hand's width away, looks at her mouth then her eyes, and lets out a
short nervous breath that is almost a laugh."

**Action, fights, exertion.** Breath follows effort: a sharp exhale on each strike, short
holds while straining. The one being hit sells it, the reaction landing exactly on contact
with a beat of pain after. Fights get messier and slower as fatigue sets in: clinching,
grabbing, lost footing. Recovery takes time: bent forward, hands on knees, mouth open,
shoulders heaving.
*Cliché:* endless clean combinations with no breath; talking normally right after a sprint.
*Phrase:* "after the last shove he bends forward, hands on knees, mouth open, chest heaving,
and takes three breaths before he can speak."

**Exhaustion.** Fighting to stay awake: eyelids drift shut, then a small jolt awake. Rubbing
the eyes, head propped on a hand, slack jaw. Simple tasks go slightly wrong. A pause before
standing up.
*Cliché:* big yawns and stretches, dramatic collapse.
*Phrase:* "her eyelids drift shut, her head dips, she catches herself with a small jolt and
rubs one eye with the heel of her hand."

**Pain, injury.** Guarding: the hurt limb is held still and protected; the other side is
favored every time. Shallow breathing, a sharp gasp on movement. The person tries to carry
on, and the pain breaks through at specific moments. The injury stays consistent: same
place, same intensity, scene to scene.
*Cliché:* constant moaning; clutching the wound only in the hero moment.
*Phrase:* "he keeps his left arm pinned to his side, breath shallow, and winces only when he
reaches for the door."

**Intoxication.** They try to seem sober: over-careful, too much concentration on simple
tasks. Loose jaw, slight slurring only at the ends of words. Louder, more confident. Small
balance corrections, a hand on the wall "casually".
*Cliché:* wobbling everywhere, hiccups, heavy slurring.
*Phrase:* "he concentrates very hard on putting the key in the lock, too slowly and too
carefully, then announces it a little too loudly."

**Lying, concealment.** Liars often hold eye contact MORE, trying to look credible. Hard
thinking stills the body: fewer gestures. A slight delay before answering, then a too-smooth
or over-detailed answer. The leak comes after: a glance at the hidden thing, a swallow, a
quiet exhale once the other turns away. (A held blink during the lie with a burst after is a
usable style choice; as lie detection the evidence is weak.)
*Cliché:* shifty eyes, sweating, touching the nose.
*Phrase:* "she holds his gaze steadily and answers smoothly, hands still, then exhales
quietly once he turns away."

**Waiting, boredom.** A small real activity: checking the phone, reading a bottle label,
picking at a cuticle. Weight shifts, posture changes now and then. Glances at the door or
clock, then away. Low energy, then attention snaps to any sound.
*Cliché:* statue stillness, or big sighs and watch-checking.
*Phrase:* "he shifts his weight, checks his phone without unlocking it, and glances at the
door each time it creaks."

**Hands on a real task.** Competence is economy: no wasted moves, the next tool reached for
without looking. Eyes on the work; talk happens while the hands keep going. Real friction.
The task sets the rhythm; lines fit around its pauses.
*Cliché:* hands hovering, miming in the air, looking up for every line.
*Phrase:* "she keeps chopping in a steady rhythm, eyes on the board, and answers without
looking up, pausing only to sweep the onions aside with the blade."

**Eating, drinking.** Small bites, real chewing; talk around the food or wait to swallow.
Food is something to do: the fork stops halfway when something lands. Drinks are sipped,
set down, picked up again; the level stays consistent. Real reactions to heat and taste.
*Cliché:* huge enthusiastic bites, instant swallowing, "mmm" product faces.
*Phrase:* "he takes a small bite, chews while listening, and stops with the fork halfway to
his mouth when she says it."

**Talking to camera (testimonial, presenter, demo).** Talk to one specific friend through the
lens, not to an audience. Hands gesture in front of the body; the product is held
naturally, not displayed like a trophy. Small imperfections: a restart mid-thought, a laugh.
In a demo the eyes go to the hands during the action, then back to the lens for the point.
*Cliché:* frozen sales smile, perfect delivery, product held beside the face.
*Phrase:* "she talks to the lens like a friend across the table, glances down at the jar as
she twists it open, then looks back up mid-sentence."

**Children.** They act on a task or a game, not an emotion. Attention jumps; they touch
everything, break off mid-action and come back. Whole-body reactions, little
self-monitoring.
*Cliché:* the cute precocious child.
*Phrase:* "the child keeps stacking blocks while answering, gets distracted by the dog, then
comes back."

**Elderly characters.** Careful rather than slow: they look where they step. Efficient
movement, a lot of stillness, full attention when they look up. They push through limits to
reach the goal: a hand on the furniture as they pass, turning despite a stiff back.
*Cliché:* the bent, shaking "old person".
*Phrase:* "he plants a hand on the chair back before turning, watching his feet, then looks
up with full attention."

**Animals reacting.** Stress signals are small: lip licking, a yawn, a shake-off, turning the
head away, sniffing the ground. Head turned away while the eyes stay on the thing, showing
the whites. Weight shifted back; approach in an arc. Animals react to sound and movement,
never to dialogue.
*Cliché:* human expressions on animals, reacting to the plot on cue.
*Phrase:* "the dog stops, licks its lips, turns its head away while keeping its eyes on the
stranger, and shifts its weight back."

**Crowds and background.** Most pedestrians move in pairs or small groups: pairs side by
side, threes in a loose V. Each person has a task and a destination; mixed speeds; some stop,
step aside, check a phone. Nobody looks at the camera or the lead without a reason.
Background sits at neutral tension (§5.3).
*Cliché:* identical speeds, everyone crossing on cue, everyone turning to watch the hero.
*Phrase:* "pairs and small groups drift past at different speeds, talking among themselves;
one man stops to check his phone; nobody looks at the couple."

**Phone calls, off-screen partner.** Listening gaps of uneven length; reactions before
speaking (a nod nobody sees, a frown, a breath to cut in). Something to do while on the call:
pacing, picking at a label, looking out of the window. The eyeline rests on an object, not
the lens.
*Cliché:* evenly spaced pauses; repeating the other side's line back.
*Phrase:* "she listens with her eyes on the window, nods to no one, starts to answer, gets
cut off, and presses her lips together."

**Silence, solo scenes.** A clear want, even if internal, shown through a task. Objects
carry the thought: how something is touched shows the state. Speed changes: clipped actions
for panic, slow measured ones for resignation. Private behavior people only do alone:
muttering, a scratch, slumping fully.
*Cliché:* staring meaningfully into space, sighing for the audience.
*Phrase:* "alone in the kitchen she straightens the photo on the fridge, stops, then turns
it face down and keeps wiping the counter."

### 16.2 The PERFORMANCE block in the sealed video prompt

How the work above lands in `PROMPT-STRUCTURES.md` §6.1:

1. **Open with one performance register line** for the whole clip `[OFFICIAL]` `[FIELD]`:
   "Performance: restrained and understated; shifting gaze, visible rise and fall of breath,
   small facial movements, no broad gestures."
2. **Then one paragraph per on-screen character** (§12), led by the @handle.
3. **In ACTION, each time slice carries the physical directions, then a subtext line**
   `[OFFICIAL]`: "2.0 to 4.0 s: her brow tightens slightly; lips part. Subtext: she is not
   accusing; she is waiting for an answer she already knows."
4. **Scene-specific locks, written as positive states**, naming this scene's likely collapse:
   "tears welling but not falling", "hands stay low and still", "only @doctor speaks; the
   others keep their lips closed". Pair any ban with the state the model should render
   instead `[FIELD]`.
5. **Let the sheets carry identity.** Spend the prompt's words on behavior, not on
   re-describing the face `[OFFICIAL]`.
6. **Reference sheets show a neutral, relaxed face.** Practitioners report the model averages
   the faces it is given, and one big smile on a sheet widens the cheeks for the whole clip
   `[ANECDOTAL]`. This is already the sheet standard in `PROMPT-STRUCTURES.md`.

---

# PART IV · QUALITY CONTROL

## 17. Atlas of bad acting: recognize and fix in the prompt

| # | Symptom | How it looks | Prompt-level fix |
|---|---|---|---|
| 1 | Indication (mugging) | The face "depicts" the emotion: arched brows, grimaces | Remove the face from the task; write the objective and give the hands business |
| 2 | Playing the result | The character plays the outcome from second one | Write only what the character knows NOW |
| 3 | Waiting for the cue | Empty face while the partner speaks | Reaction starts mid-line; give the listener a task (§4) |
| 4 | Monotactics | One color for the whole scene | Mark the beats; a new tactic verb for each |
| 5 | Gesture illustration | Gesture duplicates the word | Gesture comes just before the word, contradicts it, or is absent |
| 6 | Free emotion | Tears or rage with no build-up or trigger | Build the ladder: trigger, resistance, leak, release (§11.5) |
| 7 | Body false to biography | A thug with a dancer's posture | Set center of gravity, tempo, effort, wear |
| 8 | Speech too clean for the character | Street character in literary sentences | Litter the speech: interruptions, dropped endings, repeats |
| 9 | Threat signaling | "Menacing" pauses and slow turns before violence | Threat is mundane; violence without wind-up |
| 10 | Synchronized ensemble | Everyone reacts identically and at once | Stagger in a wave, vary strength |
| 11 | Dead pauses | Silence in which nothing happens | Fill with assessment or business, or cut |
| 12 | Emotional reset | Instant recovery after a strong event | States have inertia; keep the last seconds for aftermath |
| 13 | Commenting the role | The performance winks at the viewer | Full belief; comedy played dead serious |
| 14 | Close-up overload | Active mimicry in a close-up | Scale to the frame (§9): head still, eyes only |
| 15 | Dead eyes | Frozen stare, no blinks, no saccades | §8 in full; give the eyes a task |
| 16 | Held expression | A smile or frown parked at its peak | Onset, brief peak, gradual fade (§11.1) |
| 17 | Adjective stacking | "Devastated, terrified, heartbroken" | One trigger, two to four cues, one dominant change |
| 18 | Mouthing listeners | Non-speakers move their lips | "Only @x speaks; the others keep their lips closed" |
| 19 | Mouth distortion | Lips warp on a strong verb | Low-force verbs: "gently", "almost imperceptibly" |
| 20 | Tension jump | Calm to hysterical in one cut | One or two tension levels per change |
| 21 | Over-acting background | Extras gesturing and reacting | Background at neutral tension, a task each, no looks at the lead |
| 22 | Mimed task | Hands hover, nothing really happens | Real doing with real friction (§5.5) |
| 23 | Reaction without cause | A flinch or smile with no trigger | Name the trigger first, the response after |

## 18. The performance scale (self-check)

- **0 · Mannequin.** Text delivered, behavior absent.
- **1 · Declaimer.** "Expressive" text, indicated emotions, illustrating body.
- **2 · Diligent.** An objective can be guessed, but one tactic, late reactions, empty pauses.
- **3 · Craftsman.** Objective and beats present, listens, body makes sense. Missing:
  subtext, surprising tactics, inertia of states.
- **4 · Alive.** Continuous behavior, contrasting tactics, subtext diverging from text,
  status in the body, reactions ahead of lines, at least one unexpected-but-true choice.
- **5 · Magnet.** All of 4 plus paradox: the character combines incompatibles: funny and
  frightening, cruel and charming, lying and touching. **The two-truths rule: at level 5 the
  character always plays TWO truths at once** (helps, and hates it; apologizes, and defends;
  loves, and has already left). One clean emotion with no contradiction reads as synthetic in
  a close-up.

Aim every hero shot at 4 or higher; a paragraph that self-checks at 2 or below gets
rewritten before it ships.

## 19. Pre-send checklist

- [ ] Scene direction named; each character's motive (fuel) named; the event includes everyone
- [ ] Objective as a verb aimed at a partner, for every character in frame
- [ ] Obstacle and stakes exist; the cost of failure is real
- [ ] 2 to 4 beat changes, each visible (pause, posture, tempo, gaze); each beat ends in a state
- [ ] Reactions begin before the partner's lines end; every reaction has a visible cause
- [ ] Every silent listener has a task
- [ ] Every character has business, really done; the interrupted-action accent used deliberately
- [ ] Effort and tension level chosen per character; changes move one or two levels
- [ ] Distances change, are motivated, and are written in metres; status is in the body
- [ ] All tics carry triggers; the mask has its crack ("However, when X")
- [ ] Eye life explicit: an eye task, saccades, blink quality; close-ups get fewer blinks, never none
- [ ] Performance scaled to the frame (§9)
- [ ] Expressions build, peak briefly, fade; two to four cues per transition; no adjective stacks
- [ ] Situation playbook applied (Part III); the character fights the state
- [ ] Voice copied verbatim from the voice bible if the character speaks; omitted if silent
- [ ] Dialogue within about 2.5 words per second; listeners' lips closed
- [ ] States, not reversing transitions; on 2.5 each time slice ends in a state
- [ ] PERFORMANCE block opens with the register line; subtext line per beat; locks as positive states
- [ ] No wardrobe, camera, color or method names inside the acting
- [ ] Scale check: would this score 4 or higher?

## 20. When a take's acting fails

Diagnose before rerolling (`MAIN.md` §4.3b). If the defect is the face itself (identity,
a smile baked into the sheet), it lives in the sheet. If it is behavior, it lives in the
prompt. **After two failed rerolls on the same acting defect, stop rolling and change the
prompt or the inputs** `[FIELD]`: practitioners report further rolls add new quirks without
fixing the old one. This matches the pipeline's two-strike rule. Change one thing per
attempt: the eye task, the tension level, the frame size, or the number of cues.

---

# PART V · WORKED EXAMPLE (invented character, use as a pattern)

## 21. Master profile

```
Character acting as VIKTOR. Early 60s male, a retired night-shift taxi driver and former
amateur boxer; heavy, thick-necked build gone soft at the middle, with a flat-nosed face and
old scar tissue over both eyebrows; sits and stands with a low, grounded center of gravity,
weight always on the whole foot. Runs on a single engine: decades of waiting, for fares, for
rounds, for trouble, have made patience his weapon. He moves with strong, sustained, direct
effort and bound flow, everything about him settled down and in, as if holding a door shut
with his back. Vocal profile: low, hoarse, unhurried baritone with a working-class rasp,
short sentences delivered flat and economical, dropping to a slower, quieter register the
more serious things get; he never speeds up. Key physical habits and tics: rolls an old coin
across his knuckles when sizing a situation up; a slow, audible nose-breath before he says
no; when lying is happening in front of him, he goes completely still and lets a long
silence do the pressing; his default face is a heavy-lidded, bored mask that conceals total
attention. Eye life: sleepy, hooded eyes with slow deliberate blinks and constant quiet
scanning of mirrors, hands and exits, the gaze settling on a speaker a beat before his head
turns. Walking style: a heavy, rolling "old boxer's walk," short economical steps, shoulders
level, hands loose and ready, never hurrying. However, when someone raises a hand near him,
the sleepy mask vanishes in a half-second: the chin drops, the hands rise halfway, the feet
find their old stance; then he catches himself and folds it away, embarrassed. His face only
truly softens for stray dogs, which he feeds from his coat pocket.
```

Card notes (not in the prompt): effort press, bound flow; baseline tension 3; body image
"holding a door shut with his back."

**Voice (copy verbatim when VIKTOR speaks):** "A 60-year-old ex-boxer and night-cab driver,
working-class city accent. Low, hoarse, unhurried baritone; short flat economical sentences
with long comfortable pauses; calm and faintly amused, going quieter, never louder, as things
get serious."

## 22. Scene adaptation example

Scene: VIKTOR sits in his parked cab at night; a nervous young passenger in the back seat is
lying about having money for the fare. Medium close-up from the passenger seat, 6 seconds.
Scene direction: *keep it civil.* VIKTOR's fuel: he has been that kid. The passenger's fuel:
shame.

```
Performance: restrained and understated; slow gaze shifts, visible breath, no broad gestures.

@viktor sits motionless in the driver's seat, heavy and grounded, his head still, watching
the passenger in the rear-view mirror instead of turning around; his hooded eyes move
between the mirror, the passenger's hands and the door lock in slow, quiet scans, blinks
rare and deliberate. The old coin walks across his knuckles on the seat-rest, unhurried.

0.0 to 2.0 s: the coin rolls; his eyes hold the mirror. Subtext: he already knows.
2.0 to 4.0 s: as the passenger's story falls apart, the coin stops mid-roll; he takes one
slow, audible breath through the nose. Subtext: he is giving the kid a chance to stop.
4.0 to 6.0 s: the passenger's voice cracks; the mask eases a fraction: a long exhale, one
slow blink, the coin resumes its roll. Subtext: patience choosing, for now, to be kind.

Locks: his head stays still; only the eyes and the coin hand move; the passenger is the only
one who speaks, and @viktor keeps his lips closed.
```

What happened here: the walk is irrelevant (seated), so its energy moved into stillness and
the coin; the signature tics kept their triggers (coin for sizing up, stopped coin as
interrupted action, nose-breath as refusal, stillness and silence as pressure on a liar);
the eye life obeys the master, re-targeted to mirror, hands and lock, and scaled to the
medium close-up (head still); the beat changes are visible (coin stops, breath, softening),
each with its subtext line; the listener has a task (watching the story fall apart) and a
closed mouth; the voice stayed untouched, ready to copy verbatim if he speaks.

---

# FINAL AXIOMS

1. Acting is behavior under pressure, not a demonstration of feelings.
2. People fight the state; the fight is what the camera believes.
3. Listening matters more than speaking; reacting matters more than declaiming.
4. Emotion is the consequence of a won or lost struggle, and it is expensive.
5. The body is smarter than the words: when text and body conflict, the viewer believes the body.
6. The strong are still and quiet; the weak fuss and shout. Exceptions are events.
7. Every tic needs a trigger; every mask needs a crack; every reaction needs a cause.
8. Every scene is somebody's defeat. If nobody lost, there was no scene.
9. Subtext is not shown; it fails to be hidden.
10. The frame sets the size of the performance; the tighter the shot, the less moves.
11. Nothing holds at its peak: feelings arrive, crest and leave.
12. States, not transitions; the model films what is, not what becomes.
13. When in doubt, cut. Less acting means more truth.

---

# SOURCES

Craft: Laban movement analysis (en.wikipedia.org/wiki/Laban_movement_analysis;
movescapecenter.com/2017/06/06/labans-eight-basic-actions); Lecoq levels of tension
(invisibleropes.com/jacques-lecoq-seven-levels-of-tension); Chekhov psychological gesture
(actorfuel.com/michael-chekhov-technique); Meisner (stagemilk.com/a-guide-to-the-sanford-meisner-method);
Hagen (stagemilk.com/the-uta-hagen-technique); screen acting scale and inner monologue
(routledge.com, Secrets of Screen Acting; thealchemyofscreenacting.com/resources/screen-acting-technique;
actorstoolkit.co.uk/inner-monologue; actingmagazine.com/2020/05/what-is-the-pick-an-eye-technique).

Science: blink rates (doi 10.1002/mds.870120629); blinks and lying or load
(doi 10.1007/s10919-008-0051-0); gaze in conversation (Kendon 1967,
sciencedirect.com/science/article/abs/pii/0001691867900054); gaze aversion when thinking
(doi 10.3758/BF03195338); turn gaps across languages (pnas.org/doi/10.1073/pnas.0903616106);
gesture timing (frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1345906;
pmc.ncbi.nlm.nih.gov/articles/PMC7493208); smile dynamics (Krumhuber and Kappas 2005;
frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00202); micro-expression
duration (Yan et al., "How Fast Are the Leaked Facial Expressions"); breathing and sighs
(pubmed.ncbi.nlm.nih.gov/9342646; sciencedirect.com/science/article/abs/pii/S0301051112002633);
postural sway (pmc.ncbi.nlm.nih.gov/articles/PMC10277644); self-touch
(ncbi.nlm.nih.gov/pmc/articles/PMC3573003); body and emotion (Wallbott 1998,
doi 10.1002/(SICI)1099-0992(1998110)28:6<879::AID-EJSP901>3.0.CO;2-W; Tracy and Matsumoto
2008 on pride and shame). Caveat: several emotion-body findings come from actors portraying
emotions, and numbers vary widely between people. Treat them as ranges.

AI video: Seedance 2.5 guides (lumalabs.ai/learning-center/articles/seedance-2-5-complete-guide;
github.com/smixs/visual-skills video/references/seedance-25.md; higgsfield.ai/blog/seedance-2-5-prompting-guide;
higgsfield.ai/blog/ai-video-prompt-mistakes; suno.bi/en/blog/seedance-2-5-prompt-guide);
Seedance vs Kling acting test (curiousrefuge.com/blog/seedance-2-vs-kling-3); lip sync
(crepal.ai/blog/aivideo/blog-seedance-2-0-lip-sync-voiceover-fix); Kling dialogue
(kling.ai/blog/kling-video-3-omni-native-lip-sync-audio-guide); Wan
(alibabacloud.com/help/en/model-studio/wan3-video-generation-prompt-guide); Sora
(developers.openai.com/cookbook/examples/sora/sora2_prompting_guide). Several Seedance
"official" points are quoted from the vendor guide by secondary sources.

Situations: whatsyourgrief.com; backstage.com (fear, arguments, comedy, eating); stagemilk.com
(crying, drunk); castingnetworks.com (fights); animationmentor.com (exhaustion);
spsp.org (lying); actingcoachscotland.co.uk (props); aspcapro.org and akcpetinsurance.com
(dog signals); journals.plos.org doi 10.1371/journal.pone.0010047 (pedestrian groups);
lemonlight.com (UGC); studiobinder.com (phone calls); nyfa.edu (solo scenes).

The scene layer (§3), the silent-listener task, the eye-task fix and the voice-synonym rule
are adapted from the Higgsfield acting skill (github.com/OSideMedia/higgsfield-ai-prompt-skill,
skills/higgsfield-acting, MIT licence).
