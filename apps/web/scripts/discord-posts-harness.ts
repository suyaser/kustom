/**
 * M14.61: the Discord posts as Discord would lay them out, from the real builders' JSON.
 *
 *   node --conditions=react-server --import tsx scripts/discord-posts-harness.ts [out.html]
 *
 * Builds every post in `lib/discord/` from 05-design section 10's worked examples
 * (`lib/testing/discordGame4.ts`) and writes one HTML page that imitates Discord's dark-theme
 * embed styling (the designer's `redesign/screens/discord/discord-posts.html`, same CSS), with
 * the payloads inlined as JSON. Nothing here is hand-written: change a builder, re-run, re-shoot.
 * The two images (avatar, result badge) point at the PNGs our `/og` routes render, saved beside
 * the page as `built-avatar.png` and `built-badge-{red,blue}.png`. Writes nothing else, posts
 * nothing, needs no credentials.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recapPayload } from '../lib/discord/aiEdit';
import {
  fearlessEmbed,
  fearlessResetEmbed,
  leaderboardEmbed,
  resultEmbed,
  teamsEmbed,
  type WebhookPayload,
  windowSummaryEmbed,
} from '../lib/discord/embeds';
import { ratingsResetEmbed } from '../lib/discord/ratingsReset';
import { testPostBody } from '../lib/discord/testPost';
import { kustomAvatarUrl } from '../lib/siteUrl';
import {
  GAME4_ORIGIN,
  GAME4_RECAP,
  GAME4_STORYLINE,
  game4Fearless,
  game4Identity,
  game4Nightly,
  game4RatingsReset,
  game4Result,
  game4ResultNotRated,
  game4Teams,
  game4TeamsRule,
  game4Weekly,
} from '../lib/testing/discordGame4';

interface Post {
  id: string;
  label: string;
  time: string;
  payload: WebhookPayload | ReturnType<typeof testPostBody>;
}

const posts: Post[] = [
  { id: 'teams', label: 'Teams (10.4)', time: 'Today at 21:12', payload: teamsEmbed(game4Teams()) },
  {
    id: 'teams-rule',
    label: 'Teams with a rule (10.9)',
    time: 'Today at 22:20',
    payload: teamsEmbed(game4TeamsRule()),
  },
  {
    id: 'result',
    label: 'Result with the AI recap edit (10.5)',
    time: 'Today at 21:44',
    payload: recapPayload(resultEmbed(game4Result()), GAME4_RECAP),
  },
  {
    id: 'result-not-rated',
    label: 'Result, not rated, with the rule check (10.5)',
    time: 'Today at 22:58',
    payload: resultEmbed(game4ResultNotRated()),
  },
  {
    id: 'weekly',
    label: 'Sunday weekly, with the M16.5 storyline slot (10.6)',
    time: 'Sunday at 06:00',
    payload: windowSummaryEmbed(game4Weekly({ storyline: GAME4_STORYLINE })),
  },
  {
    id: 'weekly-plain',
    label: 'Sunday weekly, no storyline (10.6)',
    time: 'Sunday at 06:00',
    payload: windowSummaryEmbed(game4Weekly()),
  },
  {
    id: 'nightly',
    label: 'Nightly board (10.7)',
    time: 'Today at 23:59',
    payload: leaderboardEmbed(game4Nightly()),
  },
  {
    id: 'fearless',
    label: 'Fearless pool (10.8)',
    time: 'Today at 21:45',
    payload: fearlessEmbed(game4Fearless()),
  },
  {
    id: 'fearless-reset',
    label: 'Fearless reset (10.8)',
    time: 'Today at 18:00',
    payload: fearlessResetEmbed({ identity: game4Identity(), url: game4Fearless().url }),
  },
  {
    id: 'ratings-reset',
    label: 'Ratings reset (10.10)',
    time: 'Today at 18:02',
    payload: ratingsResetEmbed(game4RatingsReset()),
  },
  {
    id: 'test-post',
    label: 'Test post (10.10)',
    time: 'Today at 17:30',
    payload: testPostBody(kustomAvatarUrl(GAME4_ORIGIN)),
  },
];

const CSS = `
  :root { --chat:#313338; --embed:#2B2D31; --text:#DBDEE1; --head:#F2F3F5; --muted:#949BA4; --link:#00A8FC; --code:#1E1F22; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--chat); color:var(--text); font:15px/1.375 "Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif; }
  .page { padding:16px 0 32px; }
  .post { padding-bottom:12px; }
  .label { margin:28px 16px 8px; padding-top:12px; border-top:1px solid #3F4147; color:var(--muted); font-size:12px; letter-spacing:.02em; text-transform:uppercase; font-weight:700; }
  .post:first-child .label { border-top:0; margin-top:4px; }
  .msg { display:grid; grid-template-columns:40px 1fr; column-gap:12px; padding:2px 16px; }
  .avatar { width:40px; height:40px; border-radius:50%; background:#5865F2; overflow:hidden; }
  .avatar img { width:40px; height:40px; display:block; }
  .who { font-weight:600; color:var(--head); }
  .tag { font-size:10px; font-weight:600; background:#5865F2; color:#fff; padding:1px 4px; border-radius:3px; margin:0 4px; vertical-align:2px; }
  .time { color:var(--muted); font-size:12px; }
  .content { margin-top:2px; }
  .embed { position:relative; max-width:520px; background:var(--embed); border-radius:4px; border-left:4px solid var(--c); padding:8px 16px 16px 12px; margin-top:4px; display:grid; grid-template-columns:1fr auto; column-gap:0; }
  .embed.has-thumb { column-gap:16px; }
  .embed .body { min-width:0; }
  .thumb { width:80px; height:80px; border-radius:4px; margin-top:8px; object-fit:contain; }
  .author { margin-top:8px; font-size:14px; font-weight:600; color:var(--head); }
  .title { margin-top:8px; font-size:16px; font-weight:600; color:var(--head); }
  a { color:var(--link); text-decoration:none; }
  .author a { color:inherit; }
  .title.linked a { color:var(--link); }
  .desc { margin-top:8px; font-size:14px; white-space:normal; }
  .line { min-height:1em; overflow-wrap:anywhere; }
  .sub { font-size:12px; color:var(--muted); }
  .fields { display:grid; grid-template-columns:repeat(12,1fr); gap:8px; margin-top:8px; }
  .field { grid-column:1 / 13; font-size:14px; }
  .field.inline { grid-column:span 4; }
  .fname { font-weight:600; color:var(--head); margin-bottom:2px; }
  .footer { margin-top:8px; font-size:12px; color:var(--muted); font-weight:500; }
  code { background:var(--code); border-radius:3px; padding:0 .2em; font:0.85em/1.1 Consolas,"Andale Mono WT","Andale Mono",Menlo,monospace; }
  .emoji { font-size:1.15em; line-height:1; letter-spacing:1px; }
  @media (max-width: 600px) {
    body { font-size:16px; }
    .msg { padding:2px 12px 2px 14px; }
    .embed { padding:8px 12px 12px 10px; }
    .desc, .field { font-size:15px; }
    .field.inline { grid-column:1 / 13; }
  }
`;

/** The page's script: Discord's markdown subset over the payloads, nothing composed. */
const SCRIPT = String.raw`
const IMAGES = (url) => {
  if (!url) return null;
  if (url.includes('/og/kustom/avatar')) return 'built-avatar.png';
  if (url.endsWith('/badge')) return null; // chosen per embed colour below
  return url;
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function inline(raw){
  // Backslash escapes first, into placeholders, so an escaped * or _ prints as itself.
  const held = [];
  let s = raw.replace(/\\([\\\x60*_~|\[\]<>#])/g, (_, c) => { held.push(c); return '\u0000' + (held.length - 1) + '\u0000'; });
  s = esc(s)
    .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/((?:\u{1F7E6}|\u{1F7E5})+)/gu, '<span class="emoji">$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => esc(held[Number(i)]));
}
function md(text){
  return text.split('\n').map((raw) => {
    const sub = raw.startsWith('-# ');
    const s = inline(sub ? raw.slice(3) : raw);
    return '<div class="line' + (sub ? ' sub' : '') + '">' + (s || '&nbsp;') + '</div>';
  }).join('');
}
function embed(e){
  const badge = e.thumbnail ? (e.color === 3054591 ? 'built-badge-blue.png' : 'built-badge-red.png') : null;
  const author = e.author ? '<div class="author">' + (e.author.url ? '<a href="' + e.author.url + '">' + esc(e.author.name) + '</a>' : esc(e.author.name)) + '</div>' : '';
  const title = e.title ? '<div class="title' + (e.url ? ' linked' : '') + '">' + (e.url ? '<a href="' + e.url + '">' + inline(e.title) + '</a>' : inline(e.title)) + '</div>' : '';
  const desc = e.description ? '<div class="desc">' + md(e.description) + '</div>' : '';
  const fields = e.fields ? '<div class="fields">' + e.fields.map((f) => '<div class="field' + (f.inline ? ' inline' : '') + '"><div class="fname">' + inline(f.name) + '</div>' + md(f.value) + '</div>').join('') + '</div>' : '';
  const footer = e.footer ? '<div class="footer">' + esc(e.footer.text) + '</div>' : '';
  return '<div class="embed' + (badge ? ' has-thumb' : '') + '" style="--c:' + hex(e.color) + '"><div class="body">' + author + title + desc + fields + footer + '</div>' + (badge ? '<img class="thumb" src="' + badge + '" alt="">' : '') + '</div>';
}
function message(post){
  const p = post.payload;
  const img = IMAGES(p.avatar_url);
  const avatar = '<div class="avatar">' + (img ? '<img src="' + img + '" alt="">' : '') + '</div>';
  return '<section class="post" id="' + post.id + '"><div class="label">' + esc(post.label) + '</div><div class="msg">' + avatar + '<div>'
    + '<span class="who">' + esc(p.username) + '</span><span class="tag">APP</span><span class="time">' + post.time + '</span>'
    + '<div class="content">' + (p.content ? md(p.content) : '') + (p.embeds || []).map(embed).join('') + '</div></div></div></section>';
}
document.getElementById('root').innerHTML = POSTS.map(message).join('');
`;

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? '../../redesign/screens/discord/built-posts.html');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kustom Discord posts, as built (M14.61)</title>
<style>${CSS}</style>
</head>
<body>
<!-- Generated by apps/web/scripts/discord-posts-harness.ts from the real builders. Do not edit. -->
<div class="page" id="root"></div>
<script>
const POSTS = ${JSON.stringify(posts, null, 1).replace(/</g, '\\u003c')};
${SCRIPT}
</script>
</body>
</html>
`;
  await writeFile(out, html);
  console.log(`wrote ${out}: ${posts.length} posts`);
}

await main();
