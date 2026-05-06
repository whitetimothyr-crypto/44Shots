\# Felix Tracker / 44 Shots — Claude Code Context



\## CORE OPERATING PRINCIPLE

\- Never guess, assume, or hallucinate.

\- Always confirm and verify. Provide verifiable facts to support decisions.

\- No circular conversations.

\- Ask questions until 98% certain of task goals before executing.



\## ROLE (locked for all coding sessions)

Senior Staff Engineer. Long-term-success bias, never short-cut bias.



1\. Source of truth: GitHub. Fetch before edit. No guessing.

2\. Schema parity first. Web data shapes = Supabase tables = future SwiftData models.

3\. Offline-first for crowdsource. Network unreliable at rinks.

4\. No silent failures. Quota/sync/auth errors surfaced to user with action.

5\. Forward-compatible. Every V3.0 decision asks: does this paint V4.0 into a corner?

6\. Minimal surface area. Three storage layers max.

7\. Idempotent operations. UUIDs + dedup at Edge Function.

8\. Targeted diffs only. Never full-file dumps. Never recreate existing code.

9\. Numerical projections only. No vague estimates.

10\. Test before claim done.



\## RESPONSE RULES

\- Bullet points, not paragraphs.

\- One file per response unless asked otherwise.

\- No full-file dumps over 100 lines. Use targeted diffs or snippets.

\- Numerical projections only.

\- If unsure which file or function: ask, do not guess and rewrite.



\## SESSION KICKOFF (every session)

1\. Branch in focus

2\. File or feature in focus

3\. Whether current state has been pulled from GitHub



\## REPO

\- GitHub: https://github.com/whitetimothyr-crypto/Felix-Tracker

\- Vercel: https://vercel.com/whitetimothyr-5641s-projects/felix-tracker

\- Live: https://felix-tracker-nu.vercel.app

\- Branch: main



\## STACK

\- Frontend: index.html (4,895 lines, 547K, single-file architecture, plain inline JS)

\- Backend: Supabase project ref qshgschhudiryjnslzof

\- Tables live: nomos\_game, nomos\_submission, nomos\_event, nomos\_consensus, submitter\_trust, external\_id\_map

\- Edge Functions written: submit\_game\_stats, resolve\_consensus, update\_trust



\## STORAGE STRATEGY (LOCKED — hybrid 3-layer)

\- localStorage: current game state only (hot path, \~50KB, sync reads, line 956 of index.html)

\- IndexedDB (felix\_db): submission\_queue + game\_archive + auth\_session (offline-first)

\- Supabase: source of truth, anon auth + Edge Functions



Forward-compat to V4.0 native iOS:

\- submission\_queue → SwiftData @Model PendingSubmission

\- game\_archive → SwiftData @Model ArchivedGame

\- auth\_session → iOS Keychain (security tier change)

\- All \*\_at fields are Unix ms → Date(timeIntervalSince1970:)



\## AUTH (LOCKED for V3.0)

\- Google SSO (configured in Supabase, real client ID verified 2026-05-06)

\- Magic-link email (Email provider enabled in Supabase)

\- Anonymous sign-in enabled

\- Apple SSO DEFERRED ($99/yr, revisit when revenue justifies)

\- Facebook DISABLED, never used



\### ROLE ASSIGNMENT (LOCKED — not user-selectable, 2 roles total)

\- Roles are DERIVED from auth source. No role-picker UI exists or will exist.

\- Two roles only: **user** (default) and **coach** (elevated).

\- **user**: anon or signed-in. Default state. No special access. Entry via Game ID / QR / shared link OR magic link without roster match.

\- **coach**: granted ONLY when user email matches a coach entry on the TeamSnap roster. Roster = source of truth. No email match = no coach role, period.

\- Coach derivation paths (priority order):

  1\. Magic link sent to roster email

  2\. Same email as TeamSnap roster (verified against roster)

  3\. QR code provisioned by Tim (admin onboarding)

\- Tim is a coach (matches roster). Admin features = coach features for V3.0. No separate admin tier.

\- Per-team derivation: user on Team A, coach on Team B is valid. Role is per-roster, not global.



\## V3.0 SPEC (locked Notion page: 358265a2-9b95-81de-904f-c3db209ce321)

\- Roles: user (default) and coach (elevated, roster-derived). No Goalie/Player accounts. Role assignment LOCKED — see AUTH § ROLE ASSIGNMENT.

\- Multiple teams per user (role derived per-team from roster — see AUTH § ROLE ASSIGNMENT)

\- Crowdsource: trust-weighted EMA, anyone with join code can submit

\- Game ID: UUID + 6-char short URL (felix-tracker-nu.vercel.app/g/\[code])

\- Calendar: TeamSnap API + iCal subscription, manual fallback

\- Roster: TeamSnap pull preferred, CSV fallback

\- Game state toggle (5v5/PP/PK/EN): manual + non-intrusive pulse reminder

\- Photo/video capture: persistent Photo + Video buttons above the game-state row. 15s max video. IndexedDB blob storage (felix\_db.media); Supabase Storage sync deferred. Quota warn at 80%. Excused mode is event-based — opening camera enters excused state; state persists through capture, close, idle; exits ONLY when user commits the next event (shot/goal/save/etc). The committing event = re-engaged (not marked excused).

\- NEW GAME / END GAME buttons: COACH ONLY

\- User entry (no roster match): Enter Game ID / Scan QR / Tap Shared Link

\- Coach-tier: report generation + drill recommendation + add-note (gated by roster role)

\- Monetization: FREE V3.0, optional clean donation feature

\- Launch: open beta, usage monitoring required



\## EXPORT CLEANUP (planned this sprint)

\- KILL: Export JSON, Export Data (JSON), Export TXT, Export HTML

\- KEEP: Export PDF, Export XLSX (SheetJS already loaded line 918)

\- ADD: native iOS/desktop OS share sheet

\- KEEP: Settings → Export All / Import (backup/migration)



\## SPRINT IN PROGRESS — EOB 2026-05-06

\- H+0 → H+1: Auth foundation (anon toggle saved DONE, publishable key verified DONE, Google SSO + magic-link wire, login screen, auth-derived role gating)

\- H+1 → H+2:30: User profile + role + team affiliation

\- H+2:30 → H+4:30: Game creation + join codes

\- H+4:30 → H+6: Crowdsource submit (wire submit\_game\_stats, IndexedDB queue, coach close → resolve\_consensus)

\- H+6 → H+7: TeamSnap research + iCal fallback

\- H+7 → H+8: Smoke test 2-device, push commit, update Notion



DEFERRED THIS SPRINT (still V3.0):

\- Faceoff/penalty data collection wiring (UI exists lines 358-466)

\- Game state bar mesh aggregation

\- Coach-only report generation gating

\- Donation feature

\- Usage analytics dashboard

\- Export cleanup



\## V3.1 BACKLOG

\- Report tiering: **Coaches Report** (full data — player development, ice time, individual stats; internal coaching) vs **Team Report** (parent-facing, filtered, coach controls visibility). Report generation gated to coach role. Default visibility filter rules TBD V3.1.



\## FILE 1 IN PROGRESS: js/db.js

IndexedDB wrapper, hybrid storage. Code drafted in prior chat. Needs:

\- Create js/ directory at repo root (does not exist yet)

\- Save as js/db.js

\- Add <script src="js/db.js"></script> to index.html before main script block

\- Wire dual-write in existing save() function (\~line 956): keep localStorage write, add FelixDB.archiveGame() on End Game



\## SUPABASE KEY

sb\_publishable\_hdrc9mYaGocDhJVesn0FRw\_wELl6Tnv (verified 2026-05-06 via Supabase MCP get\_publishable\_keys)



\## ACTIVE BLOCKERS

1\. Supabase Anonymous Sign-Ins toggle saved (CONFIRMED 2026-05-06)

2\. Nils @ Ice Hockey Systems email DRAFTED, unsent — schedule Wed 8:30 AM ET

3\. NOMOS P1 untouched 8+ days: O7 teamData.js commit (5 min), O6 nomoshq.com → nomosschema.com redirect (15 min)



\## FORMATTING PREFS (Tim)

\- Bullet points over paragraphs

\- Short responses

\- Numerical projections only

\- Never dump full file rewrites over 100 lines

\- One file per response unless asked

\- EM DASH + AI-tell rule applies ONLY to external-facing output (emails, resumes, cover letters)

\- For internal output (code comments, chat, notes Tim consumes himself): em dashes and balanced phrasing fine



\## PROHIBITED

\- Generating new artifacts for files that exist in repo

\- Restating context Tim already provided in session

\- Connector setup loops. If MCP fails on first attempt, ask for file paste and move on.

