# Jev (TypeSafe AI): does Kustom have a use for it?

Research note, 2026-10-04. Not a plan. Nothing here is in `docs/02-milestones.md`, and nothing gets built without a
decision row.

> **Verdict.** Jev is real and cheap, but it is a *classifier*. It answers yes/no, pick-one and score questions
> with probabilities. It does not write text and it does not balance teams.
> Kustom has one plausible use for it: an extra tone gate on the Premium AI lines that Claude already writes.
> That use is only worth building if the M16.20 real-group read shows mean lines getting past the checker. Today
> there is no use case that Claude and our deterministic code don't already cover, so wait.

## 1. What Jev is

- **The maker.** [TypeSafe AI](https://typesafe.ai) launched Jev on 2026-09-15, when the company came out of
  stealth. The CEO is Diogo Almeida, an ex-OpenAI researcher who co-invented RLHF/InstructGPT. A ~$40M seed
  round led by DCVC is reported
  ([winzheng](https://www.winzheng.com/en/article/typesafe-ai-jev-system-one-model-launch),
  [blogdumoderateur](https://www.blogdumoderateur.com/jev-modele-ia/),
  [Blockchain Council](https://www.blockchain-council.org/ai/when-was-jev-ai-launched/)). Only one product uses
  the name in AI. "Typesafe" the old Scala company (Lightbend) is unrelated.
- **What it does.** TypeSafe calls Jev a "System One model". It is not an LLM and it generates no prose. You send
  a text `state` plus up to 10 typed questions, and they are answered in parallel in one call
  ([docs](https://docs.typesafe.ai), [Score primitive](https://docs.typesafe.ai/primitives/score.md)). There are
  three question types:
  - **Noul**: P(true), from 0 to 1.
  - **Choice**: one of the options you name, with a probability for each.
  - **Score**: a position on 2 to 10 ordered levels you describe, with probabilities and a confidence value.
- **Specs.** These are from the official [models page](https://docs.typesafe.ai/models.md):
  - Model `jev-1.13.0`, input text only.
  - English is primary. Other languages work, with lower accuracy.
  - Up to 64k tokens per request. Press coverage says 32k, so the two disagree.
  - Rate limits are 100K tokens/s and 80 requests/s.
  - No fine-tuning.
  - No streaming ([LiteLLM docs](https://docs.litellm.ai/docs/pass_through/typesafe)).
- **Latency.** TypeSafe claims 70 to 500 ms per call. Its homepage puts it at "193.6x faster" than LLMs on its
  own workflows ([typesafe.ai](https://typesafe.ai)). Those are vendor benchmarks, not independent ones.
- **Price.** $0.042 per million input tokens, and output is free
  ([models page](https://docs.typesafe.ai/models.md),
  [eesel pricing write-up](https://www.eesel.ai/blog/typesafe-jev-pricing)).
- **Access.** TypeSafe's own console paused new signups on 2026-09-22
  ([flaviocopes](https://flaviocopes.com/jev-api-key/)). Jev is also on **Vercel AI Gateway** as
  `typesafe-ai/jev`, at the same price, billed through Vercel. That route works with the TypeSafe SDK, with plain
  HTTP, or with the AI SDK's generic evaluation API
  ([Vercel docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)). Vercel says it was adopted fast,
  but that figure is reported and we have not verified it
  ([aiweekly](https://aiweekly.co/alerts/typesafes-jev-hits-13-of-vercel-paid-teams-in-24-hours)). The 13% figure
  is quoted from Vercel in [36kr](https://eu.36kr.com/en/p/3997208294643586).
- **Data terms.**
  - TypeSafe will "not train or fine tune any … models on your prompts or other Input."
  - Hosting is in the US.
  - Retention is only "as long as reasonably necessary". No period is stated
    ([privacy policy](https://typesafe.ai/legal/privacy-policy)).
  - Zero data retention is offered to enterprise customers only ([legal](https://docs.typesafe.ai/legal.md)).
  - The [Master Customer Agreement](https://typesafe.ai/legal/mca) has the usual US-embargo clause. Egypt is not
    embargoed, so nothing blocks us there.
  - The MCA's liability cap is the greater of 12 months of fees or $50.
  - The service is provided "as is".

## 2. What Kustom already does with AI

Premium (M16) has Claude write three things, through `apps/web/lib/ai/`:

- the game recap line, the weekly storyline and the scouting report, all on `claude-sonnet-5-5` (`meter.ts`);
- the input is a fact list with `{Pn}` tokens, so no names or PUUIDs go to the model;
- a deterministic checker (`check.ts`) runs nine checks covering numbers, champions, absolutes, loser barbs and
  so on, and it is "deterministic code, no second model";
- a reserve-before-call meter enforces caps of $2 per group and $20 global;
- there is a kill switch and a per-player opt-out.

Tone is enforced by what goes into the fact list plus a deny-list (decisions M16.1 D5 and the M16.7 tone ruling
in `docs/04-decisions.md`). M16.20, the real-group read, is still open.

Jev cannot replace any of this. Every one of these features *writes text*, and Jev cannot.

## 3. Use cases, ranked

### 1. Tone gate on Premium lines (worth trying later, only if M16.20 shows a need)

Claude would still write the line. The deterministic checker would still run first. If it passes, one Jev call
asks a few Noul questions about the tokenised line:

- Does it mock a player from the losing side?
- Does it say a winner was carried, lucky or boosted?
- Does it talk about its own writing?
- Does it read like the same template as these earlier lines?

Any P above a threshold drops the line. That matches the checker's rule that a false rejection only costs one line.

- **Value.** The deny-list catches words. It cannot catch phrasing like a sarcastic `still dropped 3 kills`,
  which needed M16.16 and M16.17 to handle with fact-list work. A semantic gate would catch the cases the
  deny-list misses, and in a friend group one mean line costs more than ten missing ones.
- **Compared with Claude.** We could do the same thing with a second Claude call (a Haiku judge). That costs
  ~$0.0005 to $0.001 per line and takes about a second, and it returns free text we would have to parse. Jev
  costs ~$0.00002 per line, returns typed probabilities and takes under half a second. Jev is the better tool for
  this job. That said, latency doesn't matter for an async recap, and cost is far under the cap either way.
- **Cost and effort.**
  - Spend is negligible: a few hundred lines a month is fractions of a cent.
  - Engineering is about a day: a `lib/ai/judge.ts` behind the same gate and kill switch, a new `CheckCode`, and
    threshold tuning on the stored rejected and accepted lines.
  - It reverses the "no second model" stance, so it needs a decision row.
- **Risks.**
  - *Privacy.* Jev only ever sees the already-tokenised line, which carries less than what we send Anthropic
    today. No PUUIDs, no names.
  - *Retention.* TypeSafe states no retention period, and zero retention is enterprise-only.
  - *Calibration.* Thresholds are a judgment call. Jev's calibration is the vendor's claim, so we would tune
    against our own labelled lines.
  - *Lock-in.* Low if we call it through Vercel AI Gateway's generic evaluation API, which also supports fallback
    to another model.
  - *Riot.* None. This is post-game text about stored data.

### 2. Picking the best of several recap drafts (no)

Claude would write two or three candidates and Jev would score each for "specific / engaging / not repetitive".
This would attack the M16.15 repetition and M16.19 "engaging 3.0" scores. But it multiplies the Claude spend,
which is the cost that actually matters, against a $2 cap. The fixes that worked so far were in the fact builder
and the prompt, so keep improving those first.

### 3. Moderating group names at `/new` (marginal)

A Noul question on "is this group name or link offensive". Groups are public by link but there is no list of
them, so nobody stumbles on one. A deny-list is enough for our scale. Not worth adding a vendor for.

### 4. Guessing roles for backfilled games (no: the product refuses it)

Match history doesn't say who played support, and Jev could guess roles from stats with probabilities. But
`docs/00-product.md` says plainly: "Guessing a role to hand somebody a bonus is the sort of thing this product
refuses everywhere else." It would also put a network model into a rating path.

### 5. Team formation or win prediction (no)

This is the overlap with the two parallel research tasks.

- **Team formation.** The balancer scores all 126 splits deterministically and writes a receipt (principle 3:
  "fair by numbers, and it shows its work"). A Jev Choice over splits would be non-reproducible and
  unexplainable, and it would be a black box picking teams. That is exactly the "rigged" accusation the product
  exists to end. Whatever the AI-assisted team-formation research suggests, Jev should not be the thing that picks.
- **Rating.** Jev's probabilities are judgments about text, not a skill model. OpenSkill plus the calibration line
  already gives honest, testable odds. `packages/core` must stay pure (no network), so Jev could never sit in the
  rating or balancer path anyway. At most, someone could run an offline experiment comparing Jev's win
  probabilities against OpenSkill's calibration. That would be research, not product, and it is not recommended.

## 4. Bottom line

- Jev is the right *shape* for one job we have: a semantic yes/no check on text Claude already wrote. It is not
  the shape for writing, balancing or rating.
- Don't build anything now. Revisit after M16.20: if real Premium weeks show a line a friend would want hidden
  getting past `check.ts`, try use case 1 through Vercel AI Gateway.
  - If we do, add a decision row that amends "no second model".
  - Benchmark Jev against a Haiku judge on the stored lines before choosing.
- Watch for these before relying on Jev:
  - signups reopening, or a stable gateway listing;
  - a stated retention period;
  - independent benchmarks beyond TypeSafe's own.
