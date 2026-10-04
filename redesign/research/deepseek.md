# Would DeepSeek save us money on the AI lines?

Research note, 2026-10-04. Not a plan. No product code changed and no paid API was called. Prices were read
from the providers' own pages on 2026-10-04. Re-read them before you act on this note.

**Verdict, in plain English:**
1. **Stay on Claude for now.** DeepSeek is about 85-95% cheaper per line. For our one group that is about
   **$0.83 a month (~$10 a year)**, and the $2 / $20 caps are nowhere near binding.
2. The model we would switch to is a non-reasoning "Flash" model. Its data is stored in China under Chinese
   law, and our prompts, checker and refusal rates were all tuned on Sonnet. Switching would mean redoing
   M16.8-M16.19 to save pocket change.
3. Look again when Premium reaches about **15-20 groups**, the point where the $20 global cap starts to
   bind. Try Claude prompt caching first. Then A/B **DeepSeek V4.1 Flash on a US host** (Fireworks US,
   Together, or Vercel AI Gateway pinned to US providers), not DeepSeek's own API, using the plan in section 8.

## 1. Cost table

Per attempt (one model call), per group-month (5 games a night, 5 nights a week, about 10 scouting reports a
week, 1 storyline a week, and today's retry rate), and how many groups fit under the $20 global cap.

| Option | Game line | Storyline | Scouting | Per group-month | Saving vs today | Groups at $20 | Data location |
|---|---|---|---|---|---|---|---|
| **Claude Sonnet 5.5, today** ($2 / $10) | $0.00578 | $0.00441 | $0.00499 | **$0.97** (measured $0.94) | — | **21** | US (Anthropic) |
| Sonnet 5.5 + prompt caching, cache always warm (read $0.20) | $0.00396 | $0.00284 | $0.00332 | $0.66 | 32% (best case) | 30 | US |
| Claude Haiku 4.5 (reference only; 2.8/5 on our eval, retiring) | $0.00289 | $0.00220 | $0.00249 | $0.49 | 50% | 41 | US |
| **DeepSeek V4.1 Flash, direct, peak, no cache hit** ($0.30 / $1.20) | $0.00085 | $0.00064 | $0.00073 | **$0.14** | 85% | **139** | **PRC** |
| DeepSeek direct, peak, system prompt cached ($0.006 hit) | $0.00056 | $0.00038 | $0.00046 | $0.09 | 90% | 216 | PRC |
| DeepSeek direct, off-peak, cached (50% off) | $0.00028 | $0.00019 | $0.00023 | $0.05 | 95% | 433 | PRC |
| V4.1 Flash on Fireworks, **US** region ($0.45 / $0.009 / $1.80), cached | $0.00084 | $0.00057 | $0.00068 | $0.14 | 86% | 144 | US (Fireworks) |
| V4.1 Flash on Together ($0.30 / $0.006 / $1.20), cached | $0.00056 | $0.00038 | $0.00046 | $0.09 | 90% | 216 | US (Together) |

**What the saving is worth in absolute terms** (against today's $0.97 modelled cost; the cheapest
realistic row, DeepSeek or a US host at about $0.09-$0.14):

| Groups | Claude today / month | DeepSeek-class / month | Saved / month | Saved / year |
|---|---|---|---|---|
| 1 | $0.97 | $0.09-0.14 | ~$0.85 | ~$10 |
| 10 | $9.70 | $0.90-1.40 | ~$8.50 | ~$100 |
| 21 (where today's $20 cap binds) | $20 | $2-3 | ~$17 | ~$210 |
| 100 | $97 | $9-14 | ~$85 | ~$1,000 |

At 100 groups the real choice is no longer "save $85 a month". It is "raise the global cap to about $100",
which is a one-row change, or "support 100 groups inside $20". Either way it is a business decision for when
Kustom has paying groups, not a cost problem today.

**Sources:**
[DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing) ·
[DeepSeek V4.1-Flash release, 2026-09-10](https://api-docs.deepseek.com/news/news260910) ·
[Fireworks serverless pricing](https://docs.fireworks.ai/serverless/pricing) ·
[Together pricing](https://www.together.ai/pricing) ·
[Vercel AI Gateway: DeepSeek V4.1 Flash](https://vercel.com/ai-gateway/models/deepseek-v4.1-flash) ·
Claude prices from `apps/web/lib/ai/meter.ts` (`AI_PRICES_CHECKED = 2026-10-04`, from
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)); Claude cache read is 0.1x and
cache write 1.25x (5 min TTL) or 2x (1 h TTL), with a 512-token minimum on Sonnet 5.5.

### How the numbers were made (assumptions)

- **Token counts per attempt** come from the eval ledgers in the M16.8 scratchpad (`m1615-games3/4.json`,
  `m1613-after*.json`, `m1619-p1/p2.json`). Those files record cost per attempt and the text, but not token
  counts. I estimated output tokens as characters / 3.6 and solved for input tokens from Sonnet's $2 / $10.
  Result: **game ≈ 2,690 in / 40 out, storyline ≈ 1,780 in / 85 out, scouting ≈ 2,180 in / 63 out.** This
  model gives $0.97 per group-month against the measured $0.94, so it is within about 4%.
- **The cacheable prefix** is the system prompt (`systemPrompt()` in `lib/ai/facts.ts`). It is identical
  for every call of a kind: game ≈ 1,010 tokens, storyline ≈ 870, scouting ≈ 930 (4,362 / 3,746 / 4,012
  characters). The user turn (facts, angles, recent lines) differs on every call and never caches.
- **DeepSeek's tokenizer is assumed to count English about like Claude's.** A ±20% error moves the DeepSeek
  rows by cents per group-year and does not change the verdict.
- **Volume:** 25 games a week = 108.6 game lines a month; 4.3 storylines; 43 scouting reports.
- **Attempts per subject today:** game 1.12, storyline 1.19, scouting 1.14 (the M16.13 / M16.15 / M16.19
  reruns).
- **Caching realism.** DeepSeek caches automatically on disk and keeps the cache "a few hours to a few days".
  One API key serves every group, so the shared system prompt should usually hit. Claude needs explicit
  `cache_control`, and its 5-minute window misses most game lines, which come about 35 minutes apart. The
  "always warm" Claude row only holds at many groups, or with the 1-hour TTL (2x write, 3+ reads to break
  even).
- **DeepSeek peak hours** are 01:00-04:00 and 06:00-10:00 UTC on weekdays; every other hour is half price.
  Our nights fall in European, Middle Eastern or US evenings, mostly off-peak. The meter should still price
  at peak, which is the safe side.
- **Reasoning tokens are excluded.** DeepSeek turns **thinking on by default at `high` effort**. If it is
  not switched off, reasoning tokens are billed as output, blow through our `max_tokens` of 150-400, and
  every line ends in `max_tokens`, which the checker rejects. All the numbers above assume thinking is off.

## 2. Retries and lost lines

A cheaper model that gets refused more often still costs little, because two attempts is the maximum.
The real price of a refusal is a missing line. DeepSeek direct, peak, no cache:

| First-attempt refusal | Retry refusal | Per group-month | Lines lost for good |
|---|---|---|---|
| 12% (about today) | 12% | $0.143 | 1.4% |
| 25% | 50% | $0.159 | 12.5% |
| 40% | 50% | $0.178 | 20% |
| 60% | 60% | $0.204 | 36% |

Even a model refused 60% of the time costs a fifth of Sonnet. **Cost is not the risk. Quality is.** Today
we lose 0-4% of game lines for good, 0-12% of storylines and about 6% of scouting reports, at 4.2/5.
Our checker is strict on numbers bound to the right token, singular units, banned idioms, meta-text, the
loser tease and the length cap. It was tuned against Sonnet's habits over eleven milestones. A model that
binds numbers to the wrong token, writes `1 deaths`, or reaches for "dominated" fails it more often.
Section 8's bar is set so that this shows up before anything ships.

## 3. The DeepSeek models today

- **`deepseek-flash` = DeepSeek-V4.1-Flash** (released 2026-09-10). A 552B mixture-of-experts model with
  about 16B parameters active, MIT-licensed open weights, 1M context and 384K max output. Thinking mode
  can be switched on or off (`thinking: {type: "enabled"|"disabled"}`; on by default at effort `high`).
  Legacy names such as `deepseek-v4-flash` are routed to it.
- **`deepseek-v4-pro` (V4-Pro-0813)** is listed at $1.32 / $3.96 peak ($0.044 cache hit). **The docs
  contradict each other:** the 2026-09-10 announcement says `deepseek-v4-pro` requests route to V4.1-Flash
  from 2026-09-14, but the pricing page still lists Pro separately. Treat Flash as the model and confirm
  Pro's status before relying on it.
- There is no separate "chat vs reasoner" pair any more. `deepseek-chat` / `deepseek-reasoner` (V3.x)
  became one model with a thinking switch.
- **Rate limits:** concurrency only, 2,500 concurrent requests on Flash and 500 on Pro per account, with
  429 beyond that. No token-per-minute limit is published. A request that has not started inference after
  10 minutes is closed, and the server sends keep-alive blank lines in the meantime. Our 20-second timeout
  turns that queueing into a transient failure. That is safe, but under DeepSeek load it means missing lines.
  ([rate limits](https://api-docs.deepseek.com/quick_start/rate_limit))

## 4. Quality: what we can and cannot know

- **Writing quality.** There is no trustworthy public measure for our task: 150-character, rule-bound,
  funny-but-kind recaps. Artificial Analysis puts **V4.1 Flash (non-reasoning) at 25** on its intelligence
  index, #1 among open-weight non-reasoning models of its size. **Sonnet 5.5 scores 56** (#2 of 224, as a
  reasoning model). That is not a like-for-like comparison, but it is a big gap. The same source flags
  Flash as **verbose** (45M output tokens on the index against a 9.8M median), which works against a
  220-character cap. Chatbot Arena's creative-writing score for V4 Flash (1402) is respectable but a
  generation old. IFEval for V4.1 Flash is "coming soon".
  ([AA V4.1 Flash](https://artificialanalysis.ai/models/deepseek-v4-1-flash-non-reasoning),
  [AA Sonnet 5.5](https://artificialanalysis.ai/models/claude-sonnet-5-5),
  [BenchLM](https://benchlm.ai/md/models/deepseek-v4-1-flash.md))
- **Strict rules** (no invented numbers, number bound to the right `{Pn}`, tokens preserved, length cap):
  nothing published measures exactly this. Our own history is the best guide. Haiku 4.5 passed the checker
  but wrote box scores (2.8/5). A cheap model's failure mode on our stack is usually **bland and safe, not
  wrong**, because the checker makes wrong lines impossible to publish. Expect "engaging" to be the score
  that drops. Product already rates it 2.6-3.2 on Sonnet, at the floor.
- **The only answer that counts is our eval** (section 8), on the same 16 games, the synthetic month and
  the 18 scouting players.

## 5. Latency and reliability

- **Latency.** Non-reasoning V4.1 Flash on DeepSeek's API: about 0.95 s to first token and about 207
  tokens/s (Artificial Analysis). Our 40-90-token lines would take about 1.2-1.5 s. Add roughly 0.15-0.25 s
  per round trip from Vercel's US region (`iad1`) to DeepSeek's servers in China (estimate, not measured).
  That is comparable to Sonnet with thinking off, and far inside our 20 s `AI_TIMEOUT_MS` and the 30 s
  Sunday-post budget. With thinking left on, time to first token is 11 s (AA, max effort). One more reason
  it must be off.
- **Reliability.** Third-party monitors count **16 DeepSeek outages in two years, about 23 h in total**.
  2026 incidents include 30 March (7 h 13 min), 22 April (about 1 h) and 8 May (33 min). Our design already
  tolerates a missing line (silent, one immediate retry for a game line, a 6-day retry window for the weekly
  kinds), so an outage costs lines, not errors. The US hosts add their own, independent uptime.
  ([pingoru](https://pingoru.io/providers/deepseek/outage-history),
  [isdown](https://isdown.app/status/deepseek/outage-history))

## 6. Data, privacy and legal

**What we would send** (from `buildPrompt` in `lib/ai/facts.ts`, the same for any provider):
- The system prompt: style rules and made-up examples.
- The fact list, with players as `{P1}..{Pn}`: champion names, roles, kills, deaths, assists, CS, damage,
  vision, game length, side and win, places, points, win streaks, duo records, personal bests, first-time
  champions.
- Up to 6 recent lines with tokens masked as `someone` and digits as `N`.
- On a retry, the checker's reason.

What we would **not** send: Riot IDs, summoner names, PUUIDs, Discord names, the group name, or any
`players.id`. The token map stays on our server.

The request also carries our API key, so it is tied to our account. DeepSeek also sees Vercel's IP address
and request timing. If the eval read a hosted export, the prompt would hold **real games' stat lines**.
They are pseudonymous, but a determined party holding other data could link them. It is low-sensitivity
data, but it is not nothing.

**DeepSeek direct:**
- **Stored in the PRC.** The privacy policy (updated 2026-02-10) says DeepSeek "collect[s], process[es] and
  store[s] your Personal Data in People's Republic of China".
  ([privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html))
- **Training on inputs.** The privacy policy gives users an opt-out from training. The Open Platform terms
  (effective 2026-04-29) give no explicit training right over API inputs and assign outputs to us, but
  they also **publish no retention period, no storage location and no zero-retention tier** for API calls.
  The safe reading is: assume API inputs may be kept and used, with no contractual limit.
  ([Open Platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html))
- **Governed by PRC law**, with disputes heard in Hangzhou courts. PRC law can compel disclosure to
  authorities, and the policy allows sharing with "law enforcement agencies, public authorities".
- **We would have to label output as AI.** The terms require telling end users that output is
  AI-generated. We already do this (`AI recap` / `AI scouting report`, decision M16.1 D3).
- **Payment and account.** A prepaid top-up with a card goes to a Chinese company.

**Legal for a hobby app.** No law stops a private hobby project from calling DeepSeek's API. The bans in
force are on **government** devices and networks: Commerce, the Navy and DISA federally, at least 17 US
states, and actions by regulators such as Italy's. What does apply:
- Our privacy note would need to name a PRC processor. Under GDPR / UK GDPR, a transfer to China has no
  adequacy decision. Our data is tokenised, which lowers the exposure, but a careful reading still calls it
  pseudonymous personal data.
- There is **supply risk**: US bills to restrict DeepSeek have been introduced, and a future rule could cut
  off the API at short notice.

Neither applies to the open weights served by a US company.

**US hosts (Fireworks, Together, Baseten, and others via Vercel AI Gateway).** They run the same open
weights in US data centres under US terms. DeepSeek the company never sees the traffic. Their pricing pages
did not state retention. Each publishes a no-training / zero-retention policy in its terms or as an option,
which **must be read and confirmed before use** (not verified here). Fireworks' US-pinned price is 1.5x its
default ($0.45 / $1.80); the default region is not stated on the pricing page. Groq lists no V4.x DeepSeek
model today.

**Vercel AI Gateway** lists `deepseek/deepseek-v4.1-flash` with 14+ providers and lets a request pin or
order providers. Its page showed DeepSeek-direct at $0.02 in / $0.383 out, which **contradicts DeepSeek's
own price list**. Treat Gateway prices as unverified until checked in the dashboard.

## 7. What switching would take in code

- **The Anthropic SDK can stay.** DeepSeek serves an Anthropic-compatible endpoint
  (`https://api.deepseek.com/anthropic`). It supports `system`, `max_tokens`, `stop_sequences`, `metadata.user_id`
  and `thinking` (with `budget_tokens` ignored). It ignores `cache_control`, and it maps `claude-sonnet-*` to
  `deepseek-flash`. So `anthropicTransport` could take a `baseURL`, and "nothing else imports the SDK"
  (`client.test.ts`) still holds. The test that forbids `api.anthropic.com` outside `client.ts` would need
  a sibling rule for the new host. The US hosts are **OpenAI-compatible only**: they would need a second
  transport (`openai` SDK or `fetch`) behind the same `AiTransport` interface, with its own zod schema for
  `choices[0].message.content`, `finish_reason` and `usage.prompt_tokens` / `completion_tokens` /
  `prompt_cache_hit_tokens`. ([Anthropic API compatibility](https://api-docs.deepseek.com/guides/anthropic_api))
- **Thinking.** Today `AI_MODELS[...].disableThinking` sends `thinking: {type: 'between_tools'}`, which
  only Sonnet 5.5 accepts. DeepSeek needs `{type: 'disabled'}`. Make it a per-model `thinkingOff` payload
  rather than a boolean, and add a test that a DeepSeek request never omits it, because the default is on.
- **`parseMessage`.** It must be verified against a real DeepSeek reply: the `id` format, `type: 'message'`,
  and the usage field names (the Anthropic-shape endpoint may not return cache counts). The meter
  over-counting cached tokens at the full price is the safe side.
- **Meter.** Add the model with peak prices to `AI_MODELS`. The worst-case reservation (`inputTokenUpperBound`
  = bytes + 64) still holds for any byte-level BPE tokenizer. Confirm it once on real `usage` numbers.
  `factHash` includes the model, so a switch does not reuse old lines (correct).
- **Prompts and checker.** None of these files has to change. But M16.8-M16.19 tuned the wording to
  Sonnet's failure modes, so expect a round or two of prompt work on the new model.
- **Size:** about 1-2 days of platform work plus review, before any eval spend.

## 8. If we test it: a safe A/B plan (not run)

**When:** only when Premium groups ≥ about 15, or global AI spend ≥ $15 a month for two months running.
Before that, the saving does not pay for the work.

**Step 0, free Claude lever first.** Add `cache_control` on the system prompt. It is one breakpoint, and
our system prompts (870-1,010 tokens) clear Sonnet 5.5's 512-token minimum. Measure
`cache_read_input_tokens`. This saves up to about 30% at scale with no change in quality.

**Step 1, the arm.** DeepSeek V4.1 Flash on a **US host** (Fireworks US or Together, or Vercel Gateway
pinned to them), thinking off, behind an eval-only flag (`--model deepseek-flash`) on `ai-eval` and
`ai-eval-month`. Production `AI_FEATURES` is untouched, and no database writes are made (the scripts
already use a memory store and meter).

**Step 2, the runs** (the same inputs as the Sonnet baselines already on disk, so no new Sonnet spend):
- `pnpm --filter web ai-eval --source scenarios --model deepseek-flash`: the 16 games (1 real + 15
  scenarios), plus the weeks and players.
- `pnpm --filter web ai-eval-month --kinds game,week,player`: 150 games / 16-50 weeks / 18 players.

**Step 3, scoring.** Product scores a shuffled, unlabelled mix of Sonnet and DeepSeek lines for the same
subjects, with the M16.8 rubric.

**Bar to switch (all must hold):**
- Overall ≥ **4.2/5**, accuracy ≥ 4.9, tone ≥ 4.8, engaging ≥ 3.0 per feature (M16.19 / M16.20 floor).
- Refused attempts at or below today: game ≤ 17%, storyline ≤ 19%, scouting ≤ 17%. Lost for good:
  game ≤ 4.2%, storyline ≤ 12.5%, scouting ≤ 5.6%.
- M16.15's repetition limits hold ("in a row" ≤ 20%, top opening ≤ 10%).
- Zero lines a friend would want hidden, and zero `max_tokens` stops (the thinking-off check).
- p95 latency ≤ 5 s from `iad1`.

**If it nearly passes:** test the **hybrid**. DeepSeek writes the first attempt and Sonnet writes the retry
(the one with the checker's reason). Cost is about DeepSeek's attempt + r × Sonnet's attempt: at 30%
first-attempt refusal that is about $0.0026 a game line, still about 55% cheaper, with lost-for-good near
Sonnet's. "Cheap draft, then Claude polishes" is **not** worth testing: Claude still reads the whole input,
so it costs more than Claude alone.

**Budget for the user to approve:**
- About **$1 of model spend**: around 140 subjects × 1.3 attempts × $0.0009, run three times for prompt
  iterations, comes to about $0.50.
- Plus the host's minimum prepaid top-up, if any.
- Plus an optional fresh Sonnet baseline (about $1.10) if the stored ones are judged stale.
- **Approve $3 in total, with `--budget` capped per run.**

**Decision:** pass all → move one feature at a time (the game line first) with a decision row. Miss any →
stay on Claude and record why.
