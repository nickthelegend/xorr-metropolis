"""
REVIEW.md from the capture manifest and the scores given in review (2026-10-07).

    python3 e2e/web/review.py        # reads docs/screens/manifest.json, writes docs/screens/REVIEW.md

The scores are a person's judgement against the rubric below, written here once so the review and the screens cannot
drift: every screen in the manifest is listed, and one without a score fails the run rather than being left out.
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'screens')
manifest = json.load(open(os.path.join(ROOT, 'manifest.json')))

# Scores for the redesigned app as first captured on 7 Oct (route, or route + state), and — where a screen scored 3 or
# less — what was wrong and the score after its fix.
SCORES = {
    '/welcome': 5, '/wallet': 4, '/fund': 4, '/delegate': 4, '/goals': 4, '/proposal': 4,
    '/': 5, '/catchup': 4, '/explore': 4, '/inbox': 4, '/more': 4, '/notifications': 4, '/profile': 4,
    '/asset/MON': 4, '/chart/MON': 4, '/coverage': 4, '/crosscheck/MON': 4, '/markets': 4, '/markets/crypto': 4,
    '/order/WMON': 4, '/route/MON': 4, '/sources': 4, '/swap': 4,
    '/auto-close/*': 4, '/deposit': 4, '/export': 4, '/flatten': 4, '/holdings': 4, '/portfolio': 4, '/position/*': 4,
    '/sell-everything': 4, '/send': 4, '/tokens': 4, '/watchlist': 4, '/withdraw-everything': 4,
    '/agent/momentum-scout': 4, '/agent/new': 4, '/agent/risk': 4, '/agent/strategies': 4, '/bot': 4,
    '/bot/*/backtest': 4, '/bot/*/intro': 4, '/bot/*/settings': 4, '/bot/leaderboard': 4, '/bot/roster': 4,
    '/judge': 4, '/roster-compare': 4, '/schedule': 4, '/strategies': 4, '/strategy-library/*': 4, '/strategy/*': 4,
    '/strategy/dca': 4, '/strategy/grid': 4, '/voice': 4,
    '/council': 5, '/perpl': 5, '/perps': 5,
    '/activity': 4, '/audit/*': 4, '/audit/anchor': 4, '/audit/chain': 4, '/explain/*': 4, '/history': 4,
    '/metrics': 4, '/network': 4, '/networks': 4, '/runs': 4, '/runs/*': 5, '/system': 4, '/verify': 4,
    '/alerts': 4, '/alerts/new': 4, '/business': 4, '/delegation': 4, '/legal/terms': 4, '/limits': 4,
    '/policy': 4, '/safety': 5, '/settings': 4,
    'states:/activity': 4, 'states:/council': 4, 'states:/portfolio': 4, 'states:/': 4,
    'states:/safety': 5,
}
POLISHED = {
    '/briefing': (2, 4, 'Skeletons and nothing else for the ~12 s the briefing takes to read the news: it looked stuck.',
                  'Says what it is doing while it reads ("Reading what moved and what each agent did…").', 'briefing'),
    '/search': (3, 4, 'The browser drew its square blue focus box around the rounded field.',
                'A focused field is ringed in the accent, following its corners — on every field in the app.', 'search'),
    '/venues': (3, 4, 'Two bare addresses: nothing said which venue was which.',
                'Each venue is named by the executor (Uniswap v3 · SwapRouter02; Kuru · KuruVenue) above its full address.', 'venues'),
    '/disposals': (3, 4, 'One grey sentence alone at the top of a black screen read as half-drawn.',
                   'The shared empty state: a lit mark, the sentence, and its action as a pill.', 'disposals'),
    '/pnl': (3, 4, 'Bare empty state.', 'The shared empty state, with its link as a pill.', 'pnl'),
    '/agent/basket': (3, 4, 'A paragraph alone at the top of an empty screen.', 'The shared empty state.', 'agent-basket'),
    '/proposals': (3, 4, 'Bare empty state.', 'The shared empty state.', 'proposals'),
    '/risk': (3, 4, 'Bare empty state.', 'The shared empty state.', 'risk'),
    '/allowlist': (3, 4, 'Bare empty state.', 'The shared empty state.', 'allowlist'),
    'safety:not-here': (2, 4, 'The page for a hidden route offered "Trade stocks" on Monad, where no stocks are listed — a dead end.',
                        'Offers the markets this build has ("See the markets").', 'not-here'),
    '/approvals': (2, 4, 'Each unlimited allowance printed as its raw 78-digit uint256, pushing the card’s button down.',
                   'Named instead: "2²⁵⁶ − 1 — the most a token can allow"; a limited one still shows its exact value.', 'approvals'),
    '/recovery': (2, 4, 'A passkey account was told "Your email is the way back" and offered a key export with nothing to export.',
                  'For a passkey account: "Your passkey is the way back", and why there is nothing to write down.', 'recovery'),
    'states:/history': (3, 4, 'Bare empty state.', 'The shared empty state.', 'history-empty'),
    'states:/runs': (3, 4, 'Bare empty state.', 'The shared empty state.', 'runs-empty'),
}

AREA_TITLES = {
    'onboarding': 'Onboarding', 'home': 'Home', 'trade': 'Trade', 'money': 'Money', 'agents': 'Agents and strategies',
    'council': 'Council', 'perps': 'Perps on Perpl', 'history': 'History and audit', 'safety': 'Safety and settings',
    'states': 'States — empty, offline, stopped',
}


def key_for(s):
    r = s['route']
    if s['area'] == 'states':
        return f"states:{r}"
    if s['name'] == 'not-here':
        return 'safety:not-here'
    for pattern in ('/auto-close/', '/position/', '/strategy-library/', '/audit/', '/explain/', '/runs/'):
        if r.startswith(pattern) and r not in ('/audit/anchor', '/audit/chain'):
            return pattern + '*'
    if r.startswith('/bot/') and r.count('/') == 3:
        return '/bot/*/' + r.split('/')[-1]
    if r.startswith('/strategy/') and r not in ('/strategy/dca', '/strategy/grid'):
        return '/strategy/*'
    return r


rows, missing, scored, final = [], [], [], []
for s in manifest['screens']:
    k = key_for(s)
    if k in POLISHED:
        before, after, why, fix, _ = POLISHED[k]
        scored.append(before)
        final.append(after)
        rows.append((s, before, after, why, fix))
    elif k in SCORES:
        scored.append(SCORES[k])
        final.append(SCORES[k])
        rows.append((s, SCORES[k], SCORES[k], '', ''))
    else:
        missing.append(k)
if missing:
    sys.exit(f'no score for: {", ".join(sorted(set(missing)))}')

avg = lambda xs: sum(xs) / len(xs)
dist = lambda xs: ' · '.join(f'{n} at {score}' for score, n in sorted(Counter(xs).items(), reverse=True))
out = []
out.append('# Screen review — every screen of xorr, scored (7 Oct)\n')
out.append(f"""Every screen of the running app, photographed on the local fork of Monad mainnet with a real account (test funds,
the permission, a $20 buy routed between Kuru and Uniswap, a council round, an open Perpl long) at 390 × 844 and
1440 × 900 — {len(manifest['screens'])} screens, in `docs/screens/<area>/`, by `e2e/web/capture.mjs`. Contact sheets per area are
in `sheets/`, the gallery is `index.html`, and this file is written by `e2e/web/review.py` from the same manifest.

## Rubric

Each screen is scored 1–5 on the whole of: **hierarchy** (the one thing the screen is about is the first thing seen),
**spacing** (the scale, nothing cramped or floating), **type** (roles used for what they mean, numbers tabular), **copy**
(one true sentence, no dead ends, nothing that names another build), **states** (loading, empty and failure each say
what they are), and **mobile fit** (390 px with no sideways scroll; the desktop stage at 1440).

| Score | Means |
|---|---|
| 5 | A hero moment: the screen's point is unmistakable and it has life — light, a figure that matters, motion that answers. |
| 4 | Clean and consistent with the system; nothing wrong a user would notice. |
| 3 | Works, with a visible weakness: a bare empty state, raw data, weak hierarchy. **Polished.** |
| 2 | A defect a user would notice: wrong copy for this account, raw machine values, a dead end, a stuck-looking load. **Polished.** |
| 1 | Broken. (None.) |

## Result

- **First capture of the redesigned app: average {avg(scored):.2f}** — {dist(scored)}.
- **After polishing every screen at 3 or less: average {avg(final):.2f}** — {dist(final)}. Nothing is left at 3 or below.
- {len(POLISHED)} screens polished, each re-captured; before and after are in `polish/<screen>-{{before,after}}-{{mobile,desktop}}.png`
  and side by side in `sheets/polished.png`.
- **The redesign itself** (6–7 Oct, the owner's "the UI is stale"): the same 38 screens on the UI before it and today are
  in `sheets/then-and-now.png` and `before/`. Before it, the app scored about 3 on this rubric almost everywhere — flat
  grey cards on black, a white order ticket and a lavender Messages drawer in a black app, no accent, no motion — with the
  Run screen and the theme breaks at 2.

## Polished
""")
out.append('| Screen | Before | After | What was wrong | The fix |')
out.append('|---|---|---|---|---|')
for s, b, a, why, fix in rows:
    if why:
        out.append(f"| `{s['route']}`{' (' + s['note'] + ')' if s['note'] else ''} | {b} | {a} | {why} | {fix} |")
out.append('''
## Notes

- **`/bot/<agent>/backtest` is photographed loading.** The replay reads daily closes from CoinGecko, which answered
  429 (rate-limited) to this machine throughout the capture — several projects share its address. The screen's own
  answer to that is a retryable "warming" message after the executor's 12 s budget; the wait now says what it is doing
  ("Replaying the window on real daily closes…"). With CoinGecko answering, it draws the equity curve, as in
  `before/agents/03-bot-momentum-scout-backtest-mobile.png`.
- **The offline states** are the app with every executor request refused by the browser; the console errors those
  refusals log are expected and are the only ones in the run.
''')
out.append('\n## Every screen\n')
for area, title in AREA_TITLES.items():
    items = [r for r in rows if r[0]['area'] == area]
    if not items:
        continue
    out.append(f'### {title}\n')
    out.append('| # | Screen | Score | Phone | Desktop |')
    out.append('|---|---|---|---|---|')
    for s, b, a, why, fix in items:
        n = os.path.basename(s['files']['mobile']).split('-')[0]
        score = f'{b} → **{a}**' if why else str(a)
        label = f"`{s['route']}`" + (f" — {s['note']}" if s['note'] else '')
        out.append(f"| {n} | {label} | {score} | [phone]({s['files']['mobile']}) | [desktop]({s['files']['desktop']}) |")
    out.append('')
open(os.path.join(ROOT, 'REVIEW.md'), 'w').write('\n'.join(out) + '\n')
print(f'REVIEW.md: {len(rows)} screens, average {avg(scored):.2f} -> {avg(final):.2f}, {len(POLISHED)} polished')
