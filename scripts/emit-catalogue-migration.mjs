// Emits a Little Joy Arcade catalogue migration from this project's arcade manifest.
// Mirrors the shape of the portal's 0018_gemstorm_3d.sql so `supabase db push` and this
// emitter produce the same row. Idempotent: safe to re-run.
import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = 'Deploy/arcade-manifest.json'
const OUT = process.argv[2]
const SORT_ORDER = Number(process.argv[3] ?? 201)

if (!OUT) {
  console.error('usage: node emit-catalogue-migration.mjs <out.sql> [sortOrder]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// Only the keys the portal's insert reads. Anything extra would be noise in the diff.
const manifest = {
  id: raw.id,
  name: raw.name,
  tagline: raw.tagline,
  description: raw.description,
  categories: raw.categories,
  runtime: raw.runtime,
  version: raw.version,
  updated: raw.updated,
  status: raw.status,
  featured: raw.featured,
  playUrl: raw.playUrl,
  siteUrl: raw.siteUrl,
  repoUrl: raw.repoUrl,
  releasesUrl: raw.releasesUrl,
  downloads: raw.downloads ?? [],
  cover: raw.cover,
  highlights: raw.highlights,
  howToPlay: raw.howToPlay,
  saveKey: raw.saveKey,
}
if (raw.levels) manifest.levels = raw.levels

const json = JSON.stringify(manifest, null, 2)

const sql = `-- ${manifest.name} joins the Little Joy Arcade catalogue.
-- Generated from ${MANIFEST} by emit-catalogue-migration.mjs - edit the manifest, then re-run it.
-- Idempotent: safe to re-run, and safe for supabase db push after this row already exists.

with m as (
  select $manifest$${json}$manifest$::jsonb as j
)
insert into public.games (
  id, name, description, status, featured, sort_order, version, play_url, site_url, repo_url,
  categories, tagline, runtime, cover, highlights, how_to_play, levels, save_key, downloads,
  updated_on, manifest
)
select
  j->>'id',
  j->>'name',
  j->>'description',
  case when j->>'status' = 'coming-soon' then 'coming_soon' else coalesce(j->>'status', 'live') end::public.game_status,
  coalesce((j->>'featured')::boolean, false),
  ${SORT_ORDER},
  coalesce(j->>'version', '0.0.0'),
  j->>'playUrl',
  j->>'siteUrl',
  j->>'repoUrl',
  array(select jsonb_array_elements_text(coalesce(j->'categories', '[]'::jsonb))),
  j->>'tagline',
  coalesce(j->>'runtime', 'Phaser 3'),
  j->'cover',
  array(select jsonb_array_elements_text(coalesce(j->'highlights', '[]'::jsonb))),
  array(select jsonb_array_elements_text(coalesce(j->'howToPlay', '[]'::jsonb))),
  j->>'levels',
  j->>'saveKey',
  coalesce(j->'downloads', '[]'::jsonb),
  (j->>'updated')::date,
  j
from m
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  featured = excluded.featured,
  sort_order = excluded.sort_order,
  version = excluded.version,
  play_url = excluded.play_url,
  site_url = excluded.site_url,
  repo_url = excluded.repo_url,
  categories = excluded.categories,
  tagline = excluded.tagline,
  runtime = excluded.runtime,
  cover = excluded.cover,
  highlights = excluded.highlights,
  how_to_play = excluded.how_to_play,
  levels = excluded.levels,
  save_key = excluded.save_key,
  downloads = excluded.downloads,
  updated_on = excluded.updated_on,
  manifest = excluded.manifest,
  updated_at = now()
returning id, name, version, status, sort_order;
`

writeFileSync(OUT, sql)
console.log('wrote', OUT, `(${Buffer.byteLength(sql)} bytes), id=${manifest.id}, sort_order=${SORT_ORDER}`)
