'use strict';
(() => {
  const F = window.Folio;
  const format = 'folio-workspace-v1';
  const validId = id => typeof id === 'string' && /^[\w-]{1,180}$/.test(id);
  const invalid = () => new Error('迁移包格式或附件不完整。请从原工作区重新导出。');

  async function exportWorkspace() {
    const { rows, originals } = await F.workspaceSnapshot();
    if (!rows.length) throw new Error('当前工作区没有可导出的经历。');
    const zip = new JSZip();
    const files = new Map();
    for (const row of rows) {
      for (const src of row.sources) {
        if (files.has(src.id)) continue;
        const blob = originals.get(src.id);
        if (!blob && src.text === undefined && !src.url) throw new Error('缺少附件原件：' + src.name);
        if (blob) {
          files.set(src.id, {id: src.id, type: blob.type, size: blob.size});
          zip.file('files/' + src.id, blob);
        }
      }
    }
    zip.file('workspace.json', JSON.stringify({format, rows, files: [...files.values()], profile: F.profile()}));
    const url = URL.createObjectURL(await zip.generateAsync({type: 'blob'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = '拾页-' + new Date().toISOString().slice(0, 10) + '.folio.zip';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return rows.length;
  }

  function validRecord(record) {
    return record && typeof record.title === 'string' && Object.hasOwn(F.categories, record.category) &&
      Array.isArray(record.tags) && record.tags.every(tag => typeof tag === 'string') &&
      ['start', 'end', 'awarded'].every(k => !record[k] || /^\d{4}-\d{2}$/.test(record[k]));
  }
  function validSession(row) {
    if (!row || !validId(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
        typeof row.updated !== 'string' || !Array.isArray(row.sources)) return false;
    if (!row.sources.every(s => s && validId(s.id) && typeof s.name === 'string' &&
        (!s.url || /^assets\/[\w.-]+$/.test(s.url)) && (!s.origin?.image || Number.isSafeInteger(s.origin.image)))) return false;
    if (row.published && (!validRecord(row.published.record) || !Array.isArray(row.published.sourceIds))) return false;
    if (row.cardOnly) return Boolean(row.published);
    return validRecord(row.draft) && Array.isArray(row.messages) && row.messages.every(m => {
      if (!m || (m.removed && !Number.isSafeInteger(m.removed))) return false;
      if (m.workflow && !(Number.isSafeInteger(m.workflow.chat) && Number.isSafeInteger(m.workflow.attached) &&
          Array.isArray(m.workflow.removed))) return false;
      return !m.ai?.clips || (Array.isArray(m.ai.clips) && m.ai.clips.every(c => Number.isSafeInteger(c.image)));
    });
  }
  async function importWorkspace(file) {
    if (F.sessions.size) throw new Error('当前工作区已有经历。迁移包只能导入空工作区。');
    const zip = await JSZip.loadAsync(file, {checkCRC32: true});
    const entry = zip.file('workspace.json');
    if (!entry) throw invalid();
    const {format: version, rows, files, profile} = JSON.parse(await entry.async('string'));
    if (version !== format || !Array.isArray(rows) || !rows.length || !rows.every(validSession) ||
        !Array.isArray(files) || new Set(rows.map(row => row.id)).size !== rows.length) throw invalid();
    const originals = new Map();
    const sources = new Map(rows.flatMap(row => row.sources.map(src => [src.id, src])));
    for (const f of files) {
      if (!f || !validId(f.id) || !sources.has(f.id) || originals.has(f.id)) throw invalid();
      const part = zip.file('files/' + f.id);
      if (!part) throw invalid();
      const blob = await part.async('blob');
      if (blob.size !== f.size) throw invalid();
      const src = sources.get(f.id);
      originals.set(f.id, new File([blob], src.name, {type: f.type || '', lastModified: src.lastModified || 0}));
    }
    for (const src of sources.values())
      if (!originals.has(src.id) && src.text === undefined && !src.url) throw invalid();
    await F.restoreWorkspace(rows, originals);
    if (profile && !F.profile().name && typeof profile.name === 'string' && typeof profile.school === 'string')
      F.saveProfile(profile.name, profile.school);
    return rows.length;
  }
  window.FolioTransfer = { exportWorkspace, importWorkspace };
})();
