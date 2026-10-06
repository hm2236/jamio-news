import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertSchema} from './contract.mjs';
import {validate} from './content.mjs';
import {canonical} from './production.mjs';
import {editionIdentity} from './edition.mjs';

export const seriesContract = JSON.parse(fs.readFileSync(new URL('../contracts/series.schema.json', import.meta.url), 'utf8'));
const fail = message => { throw new Error(`Series: ${message}`); };
const normalizeLF = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : Array.isArray(value) ? value.map(normalizeLF) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,normalizeLF(item)])) : value;
export const digest = value => createHash('sha256').update(canonical(normalizeLF(value))).digest('hex');
const byId = (a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export function readSeries(root) {
  const folder = path.join(root, 'data/series');
  if (!fs.existsSync(folder)) return [];
  if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) fail('registry must be a regular directory');
  return fs.readdirSync(folder).sort().map(filename => {
    const file = path.join(folder, filename);
    if (!filename.endsWith('.json') || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('registry accepts regular JSON files only');
    const series = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (filename !== `${series.id}.json`) fail('id/filename mismatch');
    return series;
  });
}

// Stage 1 consumes only the reviewed registry in the checkout. No proposal input.
export function validateSeries(registry, {articles, editions, config}) {
  validate(articles, editions, config); // Retain existing date/variant/front matter rules.
  const ids = new Map(), primary = new Set();
  for (const series of registry) {
    assertSchema(series, seriesContract, 'series');
    if (ids.has(series.id)) fail('duplicate id');
    ids.set(series.id, series);
    const entities = new Set();
    for (const entity of series.entities) {
      const key = canonical([entity.type, entity.key]);
      if (entities.has(key)) fail('duplicate entity');
      entities.add(key);
    }
    const ended = ['completed', 'discontinued'].includes(series.status);
    if (ended !== Object.hasOwn(series, 'endedAt')) fail('status/endedAt mismatch');
    for (const field of ['expectedEndAt', 'endedAt']) if (series.startedAt && series[field] && Date.parse(series[field]) < Date.parse(series.startedAt)) fail('end precedes start');
    const events = new Set(), seenArticles = new Set();
    let published = -Infinity, editionPublished = -Infinity;
    for (const [index, member] of series.members.entries()) {
      if (member.sequence !== index + 1) fail('sequence must be ordered, unique and continuous 1..N');
      if ((index === 0) !== (member.relation === 'start')) fail('only sequence=1 is start');
      if ((index > 0) !== Object.hasOwn(member, 'delta')) fail('delta required only after start');
      if (member.delta && [...member.delta.summary].length > 160) fail('delta exceeds 160 Unicode code points');
      if (events.has(member.eventKey)) fail('duplicate eventKey');
      events.add(member.eventKey);
      if (primary.has(member.article)) fail('duplicate article / multiple primary series');
      primary.add(member.article);
      const article = articles.find(a => a.slug === member.article);
      const issues = editions.filter(e => e.articles.includes(member.article));
      if (!article || article.kind !== 'news' || issues.length !== 1 || issues[0].kind !== 'daily') fail('member must be published news in exactly one daily edition');
      const issue = issues[0], identity = editionIdentity(issue.slug);
      if (!article.slug.startsWith(issue.slug + '-') || article.published.slice(0,10) !== identity.date || Date.parse(article.published) > Date.parse(issue.published)) fail('member date/variant mismatch');
      if (Date.parse(article.published) < published || Date.parse(issue.published) < editionPublished) fail('article/edition published order decreases');
      published = Date.parse(article.published); editionPublished = Date.parse(issue.published);
      if (member.milestone?.ordinal && series.expectedCount && member.milestone.ordinal > series.expectedCount) fail('milestone exceeds expectedCount');
      if (member.relation === 'correction') {
        if (!seenArticles.has(member.correctsArticle)) fail('correction must reference an earlier article in the same series');
      } else if (Object.hasOwn(member, 'correctsArticle')) fail('correctsArticle only allowed for correction');
      seenArticles.add(member.article);
    }
  }
  for (const series of registry) {
    const seen = new Set([series.id]);
    let parent = series.parentSeriesId;
    while (parent) {
      if (seen.has(parent)) fail('parent self reference / cycle');
      if (!ids.has(parent)) fail('parent absent');
      seen.add(parent); parent = ids.get(parent).parentSeriesId;
    }
  }
  return registry;
}

// Transition checks do not grant daily write permission: daily guard still rejects
// every sidecar change. Reorganisation requires a separate reviewed revision.
export function assertSeriesTransition(base, candidate, {mode = 'maintenance'} = {}) {
  if (!['maintenance', 'append'].includes(mode)) fail('invalid transition mode');
  const next = new Map(candidate.map(s => [s.id, s]));
  for (const before of base) {
    const after = next.get(before.id);
    if (!after) fail('stable series id cannot be removed');
    if (canonical(before) === canonical(after)) continue;
    const {members: oldMembers, ...oldDefinition} = before;
    const {members: newMembers, ...newDefinition} = after;
    if (!newMembers.length && oldMembers.length) fail('only new registration may have empty members');
    const prefix = newMembers.length >= oldMembers.length && canonical(newMembers.slice(0, oldMembers.length)) === canonical(oldMembers);
    const definitionSame = canonical(oldDefinition) === canonical(newDefinition);
    if (mode === 'append' || (definitionSame && prefix)) {
      if (!definitionSame || !prefix || newMembers.length <= oldMembers.length) fail('append requires unchanged definition and prefix');
      if (before.status !== 'active') fail('inactive series cannot append');
      let ordinal = oldMembers.filter(m => m.milestone?.ordinal).at(-1)?.milestone.ordinal || 0;
      for (const member of newMembers.slice(oldMembers.length)) {
        if (member.milestone?.ordinal < ordinal) fail('ordinary append milestone decreases');
        ordinal = member.milestone?.ordinal || ordinal;
      }
    } else if (after.revision !== before.revision + 1 || Date.parse(after.updatedAt) <= Date.parse(before.updatedAt) || after.changeNote === before.changeNote) fail('maintenance requires next revision, later updatedAt and changed review note');
  }
  for (const series of candidate) if (!base.some(s => s.id === series.id) && (mode === 'append' || series.revision !== 1)) fail('new series requires reviewed registration at revision=1');
}

export function seriesViews(registry, repository, base = repository.config.url) {
  validateSeries(registry, repository);
  const visible = registry.slice().sort(byId).filter(s => s.members.length);
  const relative = series => ({id:series.id, title:series.title, url:new URL(`series/${series.id}/`,base).href});
  return visible.map(series => {
    const members = series.members.map((member, index) => {
      const article = repository.articles.find(a => a.slug === member.article);
      const edition = repository.editions.find(e => e.articles.includes(member.article));
      const url = slug => new URL(`articles/${slug}/`, base).href;
      return {...member, title: article.title, published: article.published, status: article.status, url: url(article.slug), edition: {...editionIdentity(edition.slug), published: edition.published, url: new URL(`editions/${edition.slug}/`, base).href}, previous: index ? url(series.members[index-1].article) : null, next: index+1 < series.members.length ? url(series.members[index+1].article) : null};
    });
    const parent = visible.find(s => s.id === series.parentSeriesId);
    const relatives = {parent:parent ? relative(parent) : null, children:visible.filter(s => s.parentSeriesId === series.id).map(relative)};
    const view = {series, url: new URL(`series/${series.id}/`, base).href, members, relatives};
    return {...view, navigationDigest: digest(view)};
  });
}
export const registryDigest = registry => digest(registry.slice().sort(byId));
export function seriesManifest(registry, views, commit, base) {
  if (commit !== null && !/^[a-f0-9]{40}$/.test(commit || '')) fail('manifest requires exact commit');
  return {version: 1, commit, registryDigest: registryDigest(registry), url: new URL('series/', base).href, series: views.map(view => ({id: view.series.id, revision: view.series.revision, url: view.url, navigationDigest: view.navigationDigest}))};
}
