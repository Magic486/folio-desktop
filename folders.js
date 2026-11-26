'use strict';
(() => {
  const F = window.Folio, UI = window.FolioUI, AI = window.FolioAI;
  const {esc, icon} = UI;
  const storageKey = 'folio.directory-history';
  const reports = new Map(), watchers = new Map(), outcomes = new Map();
  let onChange = () => {};
  let roots = [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    roots = saved.filter(root => typeof root.name === 'string' && /^[a-f0-9]{32}$/.test(root.id));
  } catch { /* First use or cleared history. */ }
  const rootById = id => roots.find(r => r.id === id);
  function remember(root, change = {}) {
    roots = [{...rootById(root.id), ...root, ...change}, ...roots.filter(r => r.id !== root.id)];
    localStorage.setItem(storageKey, JSON.stringify(roots));
  }
  async function select() {
    const {folder} = await AI.request('folders/select', {}, 600000);
    return folder;
  }
  async function start(root, instruction, workflow) {
    if (!F.isPersistent()) throw new Error('本机工作区不可写，无法归档证据。请重新打开桌面版。');
    const connection = await AI.connectionForSend();
    if (!connection.desktop) throw new Error('请在拾页桌面版中打开本地目录。');
    const result = await AI.request('folders/start', {root: root.id, mode: connection.mode, revision: connection.revision,
      workflow, instruction, person: F.profile()});
    remember(root, {run: result.run, instruction, workflow, finished:false});
    outcomes.delete(root.id);
    reports.set(root.id, {status: 'running', stage: '正在浏览目录', root: root.id, sent: [], done: 0, total: 0});
    onChange(root.id);
    watch(root.id);
  }
  const normalize = s => (s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '');
  const titleKey = title => normalize(title.replace(/(?:19|20)\d{2}\s*年?度?/g, ''));
  function target(report, group) {
    const candidates = [...F.sessions.values()];
    const samePerson = link => (link.owner || '') === report.person.name &&
      (!link.school || !report.person.school || link.school === report.person.school);
    const byLink = candidates.find(s => s.folderLinks?.[report.root]?.key === group.key && samePerson(s.folderLinks[report.root]));
    if (byLink) return byLink;
    const proofIds = new Set(group.sources.map(src => src.id));
    const matches = candidates.filter(s => {
      if (Object.values(s.folderLinks || {}).some(link => !samePerson(link))) return false;
      const r = s.published?.record || s.draft;
      const previousKey = s.folderLinks?.[report.root]?.key;
      const commonProof = s.sources.some(old => proofIds.has(old.id));
      if (commonProof && previousKey && previousKey.split('|')[0] === group.key.split('|')[0] &&
          (!previousKey.split('|')[1] || !group.year)) return true;
      if (titleKey(r.title) !== titleKey(group.record.title)) return false;
      const date = r.title.match(/(?:19|20)\d{2}/)?.[0] || F.recordMonth(r).slice(0, 4);
      if (date && group.year && date !== group.year) return false;
      return commonProof || (date && date === group.year) || group.sources.some(src =>
        s.sources.some(old => old.name === src.name && old.size === src.originalSize));
    });
    if (matches.length > 1) throw new Error('工作区中有多张同名、同年度卡片，请核对现有卡片后重新扫描。');
    return matches[0] || null;
  }
  async function proof(report, src) {
    const response = await fetch('/api/folders/proof', {method: 'POST', credentials: 'omit',
      headers: {'Content-Type': 'application/json', 'X-Folio-Client': 'workspace'},
      body: JSON.stringify({root: report.root, run: report.run, source: src.id})});
    if (!response.ok) throw new Error((await response.json()).error || '读取证明副本失败，请重新扫描。');
    return response.blob();
  }
  const mime = name => ({pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
    webp:'image/webp', bmp:'image/bmp', gif:'image/gif', txt:'text/plain;charset=utf-8'}[name.split('.').pop().toLowerCase()] || 'application/octet-stream');
  async function sameBlob(a, b) {
    if (!a || a.size !== b.size) return false;
    const hashes = await Promise.all([a,b].map(async blob => new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))));
    return hashes[0].every((value, i) => value === hashes[1][i]);
  }
  function verifyOwner(report) {
    const p = F.profile();
    if (p.name !== report.person.name || p.school !== report.person.school)
      throw new Error('个人信息已变化，请按当前姓名重新扫描。');
  }
  async function applyGroup(report, group) {
    verifyOwner(report);
    const original = target(report, group);
    const next = original ? F.copy(original) : F.newSession('directory-' + report.root + '-' + group.id);
    const prev = next.folderLinks?.[report.root];
    if (prev?.signature === group.signature && prev.owner === report.person.name) {
      // A previously reviewed card and any subsequent manual edits remain authoritative.
      if (report.workflow === 'auto' && prev.manual && !prev.reason && !next.cardOnly && next.dirty &&
          JSON.stringify(next.draft) === JSON.stringify(prev.baseline) &&
          JSON.stringify(F.resumeSources(next)) === JSON.stringify(prev.attachments)) {
        F.publishDraft(next);
        prev.manual = false;
        await F.save(next);
        return {id: next.id, status: original.published ? 'updated' : 'created'};
      }
      return {id: next.id, status: next.folderPending || (!next.cardOnly && next.dirty) ? 'draft' : 'current'};
    }
    const additions = [], ids = new Map();
    for (const item of group.sources) {
      let src = next.sources.find(s => s.id === item.id);
      if (!src) {
        const blob = await proof(report, item);
        const duplicate = next.sources.find(s => s.name === item.name && s.size === blob.size);
        if (duplicate && await sameBlob(await F.getBlob(duplicate.id), blob)) src = duplicate;
        else {
          const file = new File([blob], item.name, {type: mime(item.name)});
          src = {id: item.id, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
            path: item.path + (item.part === 'original' ? '' : ' · ' + item.location),
            review: {kind:'keep', reason:'已用于这段经历的证据'}, folderProof: {path:item.path, location:item.location}};
          next.sources.push(src);
          additions.push({id:src.id, file});
        }
      }
      ids.set(item.id, src.id);
    }
    const old = next.cardOnly ? next.published.record : next.draft;
    const currentAttachments = original ? next.cardOnly ? next.published.sourceIds : F.resumeSources(original) : [];
    const excluded = new Set((prev?.proofIds || []).filter(id => !currentAttachments.includes(id)));
    const record = F.copy(old);
    const reasons = group.reason ? [group.reason] : [];
    const claims = group.record.evidence.map(c => ({...c, sources:c.sources.map(id => ids.get(id)).filter(id => id && !excluded.has(id))}));
    record.evidence = (record.evidence || []).slice();
    const reviewedFields = [];
    for (const key of ['title','category','year','role','start','end','awarded','contribution','result']) {
      const value = group.record[key];
      if (!value) continue;
      if (prev?.reported?.[key] === value && old[key] !== value && original.published && !prev.reason) continue;
      const editable = !original || !record[key] || (key === 'category' && record.category === '其他') ||
        (key === 'title' && original.initialTitle === record.title);
      if (!editable && normalize(record[key]) !== normalize(value)) {
        const historical = prev?.baseline?.evidence?.filter(c => c.field === key) || [];
        const additive = historical.length && historical.every(c => claims.some(n => n.field === key && n.value === c.value));
        if (!prev || old[key] !== prev.baseline[key] || !additive) {
          reasons.push('请核对' + (UI.fieldNames[key] || key) + '。已有「' + old[key] + '」，本次证据为「' + value + '」。');
          // Preserve an actively edited draft. For a published card, put the proposed value in its review copy.
          if (next.dirty || !original.published) continue;
        }
      }
      if (claims.some(c => c.field === key && !c.sources.length)) {
        reasons.push('这项内容的原有证明已从附件移除，请核对后决定是否重新选入。');
        continue;
      }
      record[key] = value;
      const ref = claims.find(c => c.field === key)?.sources[0];
      if (ref) record.refs[key] = ref;
      reviewedFields.push(key);
    }
    record.evidence = [...record.evidence.filter(c => !reviewedFields.includes(c.field)),
      ...claims.filter(c => reviewedFields.includes(c.field))];
    if (original?.published && original.dirty && (!prev || JSON.stringify(original.draft) !== JSON.stringify(prev.baseline) ||
        JSON.stringify(currentAttachments) !== JSON.stringify(prev.attachments))) reasons.push('这张卡还有待确认的编辑，请一并核对。');
    const attached = [...new Set([...currentAttachments, ...[...ids.values()].filter(id => !excluded.has(id))])];
    const reason = [...new Set(reasons)].join(' ');
    const publish = report.workflow === 'auto' && !reason;
    const link = {key:group.key, signature:group.signature, owner:report.person.name, school:report.person.school,
      baseline:F.copy(record), reported:group.record,
      attachments:attached, proofIds:[...new Set(ids.values())], manual:report.workflow === 'manual', reason};
    next.folderLinks = {...next.folderLinks, [report.root]:link};
    if (next.cardOnly) {
      if (publish) { next.published = {record, sourceIds:attached}; delete next.folderPending; }
      else next.folderPending = {record, sourceIds:attached, reason};
    } else {
      next.draft = record;
      next.resumeSources = attached;
      delete next.initialTitle;
      next.dirty = true;
      if (reason) next.workflowHold = reason;
      else delete next.workflowHold;
      next.messages.push({type:'directory', root:report.root, text:[reason,...(group.notes || [])].filter(Boolean).join(' '), ids:[...new Set(ids.values())]});
      if (publish) F.publishDraft(next, false);
    }
    verifyOwner(report);
    await F.save(next, additions);
    return {id:next.id, status:publish ? original?.published ? 'updated' : 'created' : 'draft', reason};
  }
  async function acceptArchived(id) {
    const s = F.copy(F.sessions.get(id));
    if (!s?.cardOnly || !s.folderPending) return;
    const {record, sourceIds} = s.folderPending;
    s.published = {record, sourceIds};
    delete s.folderPending;
    await F.save(s);
  }
  async function watch(id) {
    if (watchers.has(id)) return watchers.get(id);
    const task = observe(id).catch(err => {
      reports.set(id, {...reports.get(id), status:'error', error:err.message});
      onChange(id);
    }).finally(() => watchers.delete(id));
    watchers.set(id, task);
    return task;
  }
  async function observe(id) {
    const root = rootById(id);
    if (!root) return;
    while (true) {
      const report = await AI.request('folders/status', {root:id});
      if (root.run && root.run !== report.run && report.status !== 'running')
        throw new Error('上次扫描已中断。重新扫描可以接着使用已完成的读取结果。');
      if (report.status === 'done') {
        const results = new Map();
        outcomes.set(id, results);
        if (root.finished && root.run === report.run && root.receipts) {
          for (const [key, result] of Object.entries(root.receipts)) results.set(key, result);
          reports.set(id, report);
          onChange(id);
          return;
        }
        reports.set(id, {...report, status:'archiving', stage:'正在保存证明副本'});
        onChange(id);
        for (const group of report.groups) {
          try { results.set(group.id, await applyGroup(report, group)); }
          catch (err) { results.set(group.id, {status:'error', reason:err.message}); }
        }
        remember(root, {run:report.run, finished:true, receipts:Object.fromEntries(results)});
      }
      reports.set(id, report);
      onChange(id);
      if (report.status !== 'running') return;
      await new Promise(resolve => setTimeout(resolve, 950));
    }
  }
  function chip(root) {
    return `<div class="staged directory-chip">${icon('folder',18)}<strong>${esc(root.name)}</strong><button type="button" class="icon-btn" data-act="unstage-directory" aria-label="移除目录">${icon('close',14)}</button></div>`;
  }
  function page(id) {
    const root = rootById(id);
    if (!root) {
      return `<section class="directory-page"><header><h1>本地文件夹</h1><button class="soft-button" data-act="choose-directory">${icon('folder',16)}选择文件夹</button></header>
      ${roots.map(r => `<a class="directory-row" href="#folders/${esc(r.id)}">${icon('folder',18)}<strong>${esc(r.name)}</strong>${icon('chev',16)}</a>`).join('') || '<p>选择一个比赛目录或包含多段经历的总目录。</p>'}</section>`;
    }
    const report = reports.get(id), active = ['running','archiving'].includes(report?.status);
    const results = outcomes.get(id) || new Map();
    const labels = {created:'已收录', updated:'已更新', current:'已收录', draft:'待核对', error:'保存失败', removed:'草稿已移除'};
    const rows = (report?.groups || []).map(g => {
      const result = results.get(g.id), s = F.sessions.get(result?.id);
      const pending = s?.folderPending || (s && !s.cardOnly && s.dirty);
      const status = result?.id && !s ? 'removed' : result?.status === 'draft' && !pending ? 'current' : result?.status;
      const action = s?.folderPending ? 'directory-archived' : pending ? 'draft' : 'detail';
      return {status, html:`<div class="directory-result"><div><span class="directory-status">${esc(labels[status] || '正在归档')}</span><strong>${esc(g.record.title)}</strong>
        <p>${esc(g.record.result || g.record.role || g.record.category)} · ${g.sources.length} 份依据</p>
        ${(g.notes || []).map(note => '<p>' + esc(note) + '</p>').join('')}
        ${(pending || !s) && (result?.reason || g.reason) ? '<p>' + esc(result?.reason || g.reason) + '</p>' : ''}</div>
        ${s ? `<button class="soft-button" data-act="${action}" data-session="${esc(s.id)}">${pending ? '核对草稿' : '查看卡片'}</button>` : ''}</div>`};
    });
    const log = report?.log || [], sent = report?.sent || [];
    const blocked = log.filter(e => ['未读','有未读内容','原件已移走'].includes(e.status));
    const present = entries => entries.map(e => `<li><strong>${esc(e.path)}</strong><span>${e.status ? esc(e.status) + ' · ' : ''}${esc(e.detail)}</span></li>`).join('');
    return `<section class="directory-page"><a href="#folders">本地文件夹</a><header><h1>${esc(root.name)}</h1>
      <button class="soft-button" data-act="rescan-directory" data-root="${esc(id)}" ${active ? 'disabled' : ''}>${icon('folder',16)}重新扫描</button></header>
      ${report?.instruction ? '<p class="directory-request">' + esc(report.instruction) + '</p>' : ''}
      ${active ? `<div class="directory-progress" role="status"><strong>${esc(report.stage)}</strong> ${report.done || 0} / ${report.total || 0}<progress max="${report.total || 1}" value="${report.done || 0}"></progress><p>${esc(report.current || '')}</p></div>` : ''}
      ${report?.status === 'error' ? '<p class="form-error" role="alert">' + esc(report.error) + '</p>' : ''}
      ${report?.status === 'done' ? `<h2>已收录 ${rows.filter(r=>['created','updated','current'].includes(r.status)).length} 段 · 待核对 ${rows.filter(r=>r.status==='draft').length} 段</h2>
      <p class="soft-copy">本轮读取 ${report.read} 份，复用 ${report.cached} 份。${blocked.length ? '有 ' + blocked.length + ' 份材料需留意。' : ''}${rows.some(r => r.status === 'error') ? '有 ' + rows.filter(r => r.status === 'error').length + ' 段保存失败，请查看下方原因并重试。' : ''}</p>` : ''}
      ${rows.map(r=>r.html).join('')}
      ${report?.status === 'done' && !rows.length ? '<p>本次没有找到符合要求的经历。可以查看读取记录，或补充证明后重新扫描。</p>' : ''}
      ${blocked.length ? `<details class="directory-log" open><summary>需要留意的材料 · ${blocked.length}</summary><ul>${present(blocked)}</ul></details>` : ''}
      ${sent.length ? `<details class="directory-log"><summary>本轮提交给 ${esc(report.provider)} 的内容 · ${new Set(sent.map(e=>e.path)).size} 份</summary><ul>${present(sent.map(e=>({path:e.path,detail:e.parts.join('、')})))}</ul></details>` :
        report?.status === 'done' ? '<p class="soft-copy">本轮未向远程 AI 提交材料。</p>' : ''}
      ${log.length ? `<details class="directory-log"><summary>本地读取记录 · ${log.length} 份</summary><ul>${present(log)}</ul></details>` : ''}
      </section>`;
  }
  window.FolioFolders = {select, start, watch, rootById, chip, page, acceptArchived,
    get hasRoots() { return roots.length > 0; },
    enter(id) { if (rootById(id) && !reports.has(id)) watch(id); },
    init(listener) { onChange = listener; for (const r of roots) if (r.run && !r.finished) watch(r.id); }};
})();
