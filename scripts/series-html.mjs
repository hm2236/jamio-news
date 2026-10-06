import {escape as esc, labels} from './content.mjs';

const status = {active:'追跡中',paused:'中断中',completed:'完結',discontinued:'終了'};
const href = url => new URL(url).pathname;
const anchor = (url, text, attributes='') => `<a href="${esc(href(url))}"${attributes}>${esc(text)}</a>`;
export const seriesMetadata = view => `<meta name="jamio-series-id" content="${view.series.id}"><meta name="jamio-series-revision" content="${view.series.revision}"><meta name="jamio-navigation-digest" content="${view.navigationDigest}">`;
export function seriesHeading(view, member) {
  return `<p class="series-heading">${anchor(view.url, view.series.title)}${member.milestone ? ` · ${esc(member.milestone.label)}` : ''} · 掲載順 ${member.sequence}</p>`;
}
export function seriesNavigation(view, member) {
  const before = view.members[member.sequence-2], after = view.members[member.sequence];
  return `<nav class="series-navigation" aria-label="このニュースシリーズ" data-series-id="${view.series.id}" data-navigation-digest="${view.navigationDigest}"><p class="small">現在の追跡ナビ · ${esc(status[view.series.status])}</p><p aria-current="page">現在の記事: 掲載順 ${member.sequence}</p>${member.delta ? `<p class="series-delta">前回掲載からの差分: ${esc(member.delta.summary)}</p>` : ''}<div class="series-links">${before ? anchor(before.url, `← 前の記事: ${before.title}`, ' rel="prev"') : '<span>前の記事なし</span>'}${anchor(view.url, 'シリーズ一覧')}${after ? anchor(after.url, `次の記事: ${after.title} →`, ' rel="next"') : '<span>次の記事は未掲載</span>'}</div>${member.correctsArticle ? `<p>訂正対象: ${anchor(view.members.find(m => m.article === member.correctsArticle).url, view.members.find(m => m.article === member.correctsArticle).title)}</p>` : ''}</nav>`;
}
export function seriesList(view) {
  const series = view.series;
  const {parent, children} = view.relatives;
  const facts = `<dl class="series-facts"><dt>対象</dt><dd>${series.entities.map(entity=>esc(entity.label)).join(' / ')}</dd>${[['startedAt','確認した開始'],['expectedEndAt','予定終了'],['endedAt','確認した終了']].filter(([key])=>series[key]).map(([key,label])=>`<dt>${label}</dt><dd><time datetime="${series[key]}">${series[key]}</time></dd>`).join('')}</dl>`;
  return `<section class="series-list" data-series-id="${series.id}" data-navigation-digest="${view.navigationDigest}"><div class="page-title"><h1>${esc(series.title)}</h1><p>${esc(status[series.status])} · ${view.members.length}記事${series.expectedCount ? ` · 発表側の予定 ${series.expectedCount}回` : ''}</p><p>${esc(series.canonicalTopic.scope)}</p></div>${facts}<p>${series.coverage.mode === 'partial' ? '部分掲載' : '開始から追跡'}: ${esc(series.coverage.note)}</p><p class="small">現在の追跡ナビ。掲載順と発表側のDay番号は別です。人手での再編成により掲載順が変わる場合があります（revision ${series.revision}）。</p>${parent ? `<p>親シリーズ: ${anchor(parent.url, parent.title)}</p>` : ''}${children.length ? `<p>派生シリーズ: ${children.map(v => anchor(v.url, v.title)).join(' / ')}</p>` : ''}<ol>${view.members.map(member => `<li><p class="small">掲載順 ${member.sequence}${member.milestone ? ` · ${esc(member.milestone.label)}` : ''} · <time datetime="${esc(member.published)}">${esc(member.published)}</time> · ${esc(labels[member.status])}</p><h2>${anchor(member.url, member.title)}</h2><p>${anchor(member.edition.url, `${member.edition.date} · ${member.edition.variant === 'legacy' ? '旧形式号' : {morning:'朝刊',noon:'昼刊',evening:'夕刊'}[member.edition.variant]}`)}</p>${member.delta ? `<p class="series-delta">前回掲載からの差分: ${esc(member.delta.summary)} ${anchor(member.previous, '前回掲載を読む')}</p>` : '<p>当サイトの追跡開始</p>'}${member.correctsArticle ? `<p>訂正対象: ${anchor(view.members.find(m => m.article === member.correctsArticle).url, view.members.find(m => m.article === member.correctsArticle).title)}</p>` : ''}</li>`).join('')}</ol><details><summary>登録・再編成メモ</summary><p>${esc(series.changeNote)}</p><p><time datetime="${series.updatedAt}">${series.updatedAt}</time></p></details>${anchor(new URL('../', view.url).href, '全シリーズ一覧')}</section>`;
}
export const registryMetadata = manifest => `<meta name="jamio-series-registry-digest" content="${manifest.registryDigest}">`;
export function seriesIndex(views, manifest) {
  const groups = Object.keys(status).map(state => {
    const selected = views.filter(view => view.series.status === state).sort((a,b) => b.members.at(-1).published.localeCompare(a.members.at(-1).published) || (a.series.id < b.series.id ? -1 : 1));
    return selected.length ? `<section><h2>${status[state]}</h2><ul>${selected.map(view => `<li>${anchor(view.url, view.series.title)} <span>${view.members.length}記事 · 最終掲載 <time datetime="${view.members.at(-1).published}">${view.members.at(-1).published.slice(0,10)}</time></span></li>`).join('')}</ul></section>` : '';
  }).join('');
  return `<section class="series-index" data-registry-digest="${manifest.registryDigest}"><div class="page-title"><h1>ニュースシリーズ</h1><p>連続する出来事を、掲載順に読み返す。</p></div>${views.length ? groups : '<p>人手承認済みの公開シリーズはまだありません。</p>'}</section>`;
}
