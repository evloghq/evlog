# The evlog voice

Load this before any rule file. Rules constrain a sentence that already exists. This generates the sentence.

## What the voice is

evlog writes to someone in the middle of doing something. They arrived with a question, they will leave to run a command, and the page is what happens in between. Everything follows from that.

**Active.** The system does things and the reader does things. Both are subjects of verbs. The pipeline retries. You accumulate context. Not "context can be accumulated", not "it is possible to configure".

**Action-based.** Every section moves the reader toward something they can run, decide, or stop worrying about. A section that only informs has to earn it by removing a decision the reader was about to get wrong.

**Answering an intent.** Before writing a paragraph, name the question it answers. Pages are not topics, they are answers. "Wide events" is a topic. "You have ten log lines per request and you still cannot tell which user hit the slow path" is an intent.

**Suggesting.** The reader does not know what to ask for next. Say it. Point at the page that handles the case they are about to hit. The docs suggest the next move rather than waiting to be searched.

**Specific about cost.** evlog is opinionated, and opinions have prices. Say what a choice costs: a dependency, a flag, a runtime constraint, a field you now have to maintain. A doc that only lists benefits reads like a landing page and gets trusted like one.

## What the voice is not

- Not neutral. A reference page still has a position on what you should do.
- Not enthusiastic. No exclamation marks, no emoji in prose, no "excited to announce".
- Not hedged. If the mechanism is deterministic, say it happens. `often`, `typically`, `generally` on a guaranteed behavior is a lie that sounds careful.
- Not abstract. Nothing "leverages", "empowers", or "unlocks". Things run, retry, drop, batch, fail.
- Not punctuated with dashes. No em dash, no en dash, anywhere. `U-14` ranks what goes in its place, and a semicolon is never on that list.

## The five tests

Apply these to a draft before any rule. They generate more than they filter.

**1. Intent.** Name the question the reader arrived with. Does this paragraph move toward the answer? A paragraph that cannot name its question is setup, and setup is the first thing to cut.

**2. Action.** After this section, what can the reader do that they could not do before? Run a command, pick between two options, stop doing something wrong. If the answer is "know a thing", the section needs a reason that outranks the reader's time.

**3. Substitution.** Replace `evlog` with `pino` or `winston`. Does the sentence still read true? Then it says nothing about evlog. "evlog gives you structured logging" survives substitution. "evlog emits one event per request with the context you accumulated, whether the request succeeded or threw" does not.

**4. Claim.** Every statement about behavior names its mechanism, its number, or the page that proves it. "Fast" is not a claim. "The drain batches and never blocks the response" is a claim, because it names what happens. "2.4x pino on the bench" is a claim, because it names a number and a source.

**5. Carry.** Read the short lines. A fragment, a two-beat close, a one-sentence paragraph: does it deliver a fact, a consequence, or a decision? These are part of the voice when they land something. They become slop the moment they carry only rhythm.

## Register by surface

The voice is one voice, but the distance changes.

- **Reference** (`8.reference/`, adapter and framework pages): closest to the machine. Short sentences, exact names, tables over prose. The opinion stays, the flourish goes.
- **Learn** (`2.learn/`, `5.use-cases/`): the reader is deciding whether a concept applies to them. This is where a concrete situation earns its place: a real request, a real cost, a real failure.
- **Start** (`1.start/`): the reader has not committed. Highest density of "here is what this costs you and what you get".
- **Blog**: the reader did not come for a task. The first paragraph has to earn the second, and nothing is owed a read.
- **Landing**: every claim is a promise a page has to keep. See `surfaces/landing.md`.

## When the voice and a rule disagree

The voice wins, and the rule gets a line in `corrections.md` explaining the case. A rule that keeps losing is wrong.
