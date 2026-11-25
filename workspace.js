'use strict';
(function workspace() {
  'use strict';
  const categories = {
    竞赛: { icon: 'award', color: 'amber' },
    项目: { icon: 'layers', color: 'pine' },
    志愿服务: { icon: 'heart', color: 'rose' },
    校园活动: { icon: 'flag', color: 'blue' },
    实习实践: { icon: 'case', color: 'violet' },
    其他: { icon: 'folder', color: 'slate' },
  };
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ??
    `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const copy = (value) => structuredClone(value);
  const emptyRecord = () => ({
    title: '',
    category: '其他',
    start: '',
    end: '',
    awarded: '',
    role: '',
    result: '',
    contribution: '',
    tags: [],
    refs: {},
  });
  const session = (id = uid()) => ({
    id,
    revision: 0,
    updated: new Date().toISOString(),
    draft: emptyRecord(),
    published: null,
    evidenceFirst: true,
    dirty: true,
    sources: [],
    messages: [],
  });
  const fmt = (date) => (date ? date.replace('-', '.') : '');
  const recordMonth = (r) => r.end || r.start || r.awarded || '';
  function period(record) {
    if (!record.start && !record.end)
      return record.awarded ? fmt(record.awarded) + '（颁证）' : '时间待补充';
    if (record.start && record.end && record.start !== record.end)
      return `${fmt(record.start)} — ${fmt(record.end)}`;
    return fmt(record.start || record.end);
  }
  let db = null;
  const transientFiles = new Map();
  const sessions = new Map();
  const profileKey = 'folio.personal-profile';
  const workflowKey = 'folio.workflow-mode';
  function workflowMode() {
    try { return localStorage.getItem(workflowKey) === 'auto' ? 'auto' : 'manual'; }
    catch { return 'manual'; }
  }
  function setWorkflowMode(mode) {
    localStorage.setItem(workflowKey, mode === 'auto' ? 'auto' : 'manual');
  }
  function autoCommand(text = '') {
    return /^(?:请帮我|帮我|请)?(?:重新|再次|开始)?(?:全自动整理|自动整理|重新整理)(?:一下)?(?:当前会话|这次材料|已有材料|这些材料|材料)?[。！!\s]*$/.test(text.trim());
  }
  function profile() {
    try {
      const p = JSON.parse(localStorage.getItem(profileKey) || '{}');
      return {name: typeof p?.name === 'string' ? p.name : '', school: typeof p?.school === 'string' ? p.school : ''};
    } catch { return {name: '', school: ''}; }
  }
  function saveProfile(name, school) {
    const data = {name: name.trim().slice(0, 80), school: school.trim().slice(0, 120)};
    if (data.name || data.school) localStorage.setItem(profileKey, JSON.stringify(data));
    else localStorage.removeItem(profileKey);
  }
  function identityMatch(reading, person = profile()) {
    if (!person.name || !reading) return '';
    const norm = s => s.normalize('NFKC').trim().replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '').replace(/\s+/g, ' ').toLocaleLowerCase();
    if (reading.uncertain || !reading.names.length) return 'unknown';
    if (!reading.names.some(n => norm(n) === norm(person.name))) return 'other';
    if (person.school && reading.school && norm(reading.school) !== norm(person.school)) return 'unknown';
    return 'match';
  }
  const conversationTitle = (s) => s.conversationName || s.draft.title;

  // A published experience keeps its evidence even after its conversation is deleted.
  function cardWithoutConversation(s) {
    const keep = new Set([...s.published.sourceIds, ...Object.values(s.published.record.refs || {})]);
    return {
      id: s.id, revision: s.revision + 1, updated: s.updated, cardOnly: true,
      published: s.published, sources: s.sources.filter((src) => keep.has(src.id)),
    };
  }
  function materialReview(s, src, protectedIds = protectedSources(s)) {
    if (protectedIds.has(src.id))
      return { kind: 'keep', reason: '已用作草稿依据或正式卡片附件', locked: true };
    if (!src.review?.manual && src.pictureReadings?.[0]) {
      const match = identityMatch(src.pictureReadings[0]);
      if (match === 'match') return {kind: 'keep', reason: '图片署名与个人信息相符'};
      if (match === 'other' || match === 'unknown') return {kind: 'review', reason: match === 'other' ? '证书署名为其他人' : '本人归属待核对'};
    }
    if (src.review) return src.review;
    if (/^(?:\.DS_Store|Thumbs\.db|desktop\.ini|~\$.+\.(?:docx?|xlsx?|pptx?))$/i.test(src.name))
      return { kind: 'discard', reason: '系统缓存或 Office 临时文件' };
    if (src.size === 0 && !src.text && !src.url)
      return { kind: 'discard', reason: '文件大小为零，没有可归档的内容' };
    if (evidenceName(src.name))
      return { kind: 'keep', reason: '文件名提示可能是证明材料，优先保留' };
    if (/\.doc$/i.test(src.name) && !src.text)
      return { kind: 'review', reason: '旧版 Word 文档，尚未读取正文' };
    return { kind: 'review', reason: '缺少足够依据，暂时保留' };
  }
  function evidenceName(name) {
    return !/模板|样例|示例|通知|空白|template|sample/i.test(name) &&
      /证书|证明|获奖名单|获奖公示|成绩单|验收报告|结项报告|certificate|award/i.test(name);
  }
  function protectedSources(s, includeDraftAttachments = true) {
    return new Set([...Object.values(s.draft?.refs || {}), ...(includeDraftAttachments ? s.resumeSources || [] : []), ...(s.published?.sourceIds || []),
      ...Object.values(s.published?.record.refs || {})]);
  }
  function trimMaterials(s, choices, automatic = false) {
    const locked = protectedSources(s, false);
    const previous = new Set(resumeSources(s));
    const discarded = new Set(), attachments = [], sources = [];
    for (const src of s.sources) {
      const choice = choices.get(src.id);
      if (!['attach', 'chat', 'remove'].includes(choice))
        throw new Error('材料清单已变化，请重新打开核对。');
      if (locked.has(src.id) && choice !== (previous.has(src.id) ? 'attach' : 'chat') && !(automatic && choice === 'attach'))
        throw new Error('这份材料已被草稿或简历引用，请重新核对。');
      if (choice === 'remove') {
        discarded.add(src.id);
        continue;
      }
      const attach = choice === 'attach';
      if (attach) attachments.push(src.id);
      const kind = materialReview(s, src, locked).kind;
      if (!automatic && !locked.has(src.id) && (attach !== previous.has(src.id) || kind === 'discard')) {
        const review = attach ? { kind: 'keep', reason: '你已选作简历附件' } : { kind: 'review', reason: '你已选择仅留会话' };
        sources.push({ ...src, review: { ...review, manual: true } });
      } else sources.push(src);
    }
    const messages = s.messages.map(m => {
      if (!m.ids?.some(id => discarded.has(id))) return m;
      const ids = m.ids.filter(id => !discarded.has(id));
      return { ...m, ids, removed: (m.removed || 0) + m.ids.length - ids.length };
    });
    const next = { ...s, evidenceFirst: true, sources, messages, revision: s.revision + 1, updated: new Date().toISOString() };
    const inferred = resumeSources(next);
    if (s.resumeSources || inferred.length !== attachments.length ||
        inferred.some(id => choices.get(id) !== 'attach')) next.resumeSources = attachments;
    if (previous.size !== attachments.length || attachments.some(id => !previous.has(id))) next.dirty = true;
    return next;
  }
  function publishDraft(s, log = true) {
    if (!s.draft.title.trim()) throw new Error('请先填写经历名称。');
    const sourceIds = resumeSources(s);
    const record = copy(s.draft);
    record.refs = Object.fromEntries(Object.entries(record.refs || {}).filter(([, id]) => sourceIds.includes(id)));
    s.published = { record, sourceIds };
    s.dirty = false;
    delete s.workflowHold;
    if (log) s.messages = [...s.messages, { type: 'reviewed' }];
  }
  async function finishAutomatic(s, index, reason = s.workflowHold || '') {
    const turn = s.messages[index];
    if (!turn || turn.workflowMode !== 'auto' || turn.workflow) return;
    if (!reason && turn.conflicts?.length) reason = '材料中的信息有冲突，请核对草稿。';
    const incoming = new Set(turn.ids);
    const previous = new Set(resumeSources(s));
    const locked = protectedSources(s, false);
    const choices = new Map();
    const unread = !turn.ai && s.sources.some(src => (!incoming.size || incoming.has(src.id)) &&
      !src.review && !src.pictureReadings?.[0] && !locked.has(src.id) && src.size > 0 &&
      !(/\.(txt|md)$/i.test(src.name) && src.size <= 1048576) && materialReview(s, src, locked).kind !== 'discard');
    if (unread) reason = '本轮仅使用本地规则，尚有附件未读取。连接 AI 后可以直接整理会话里的原件。';
    for (const src of s.sources) {
      let choice = previous.has(src.id) ? 'attach' : 'chat';
      const assess = incoming.has(src.id) || (!incoming.size && (turn.ai || !s.resumeSources));
      if (assess && !src.review?.manual) {
        const review = materialReview(s, src, locked);
        if (locked.has(src.id)) choice = 'attach';
        else if (review.kind === 'discard') choice = reason ? 'chat' : 'remove';
        else if (review.kind === 'keep' && (src.review || src.pictureReadings?.[0])) choice = 'attach';
        else choice = 'chat';
      }
      choices.set(src.id, choice);
    }
    const hold = reason;
    const r = s.draft;
    if (!reason && !s.published && !(r.refs?.title || r.role || r.result || r.contribution || r.start || r.end || r.awarded || (r.title && !s.initialTitle)))
      reason = '还缺少可收录的经历信息。请补充项目名称或本人参与情况。';
    await updateConversations(s, choices, !reason, { index, reason, hold: unread ? s.workflowHold : hold, needsAI: unread });
  }
  async function updateConversations(target, choices, publish = false, automatic = null) {
    function apply(rows, records, originals) {
      if (target && rows.find((s) => s.id === target.id)?.revision !== target.revision)
        throw new Error('会话已在其他窗口更新，请刷新后再试。');
      const retained = [];
      const discardedFiles = new Set();
      for (const row of rows) {
        const remove = target ? row.id === target.id : row.sample === true;
        if (!remove) {
          retained.push(row);
          continue;
        }
        if (choices) {
          const next = trimMaterials(row, choices, Boolean(automatic));
          if (publish) publishDraft(next, !automatic);
          if (automatic) {
            if (automatic.reason) {
              next.dirty = true;
              if (automatic.hold) next.workflowHold = automatic.hold;
              else delete next.workflowHold;
            }
            const turn = { ...next.messages[automatic.index] };
            next.messages[automatic.index] = turn;
            const sameCard = JSON.stringify(next.published) === JSON.stringify(row.published);
            const attached = resumeSources(next).length;
            turn.workflow = {
              status: automatic.reason ? 'draft' : !row.published ? 'created' : sameCard ? 'current' : 'updated',
              ...(automatic.needsAI ? {needsAI: true} : {}),
              reason: automatic.reason, attached, chat: next.sources.length - attached,
              removed: row.sources.filter(src => choices.get(src.id) === 'remove').map(src => src.name),
            };
            if (turn.ai) turn.ai = { ...turn.ai, status: 'done' };
          }
          for (const src of row.sources) if (choices.get(src.id) === 'remove') discardedFiles.add(src.id);
          retained.push(next);
          records?.put(next);
          continue;
        }
        for (const src of row.sources) discardedFiles.add(src.id);
        if (target && row.published) {
          const card = cardWithoutConversation(row);
          retained.push(card);
          records?.put(card);
        } else records?.delete(row.id);
      }
      if (discardedFiles.size) {
        for (const row of retained)
          for (const src of row.sources) discardedFiles.delete(src.id);
        for (const id of discardedFiles) originals.delete(id);
      }
      return retained;
    }
    let rows;
    if (db) {
      rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(['sessions', 'originals'], 'readwrite');
        const records = tx.objectStore('sessions');
        const request = records.getAll();
        let result, error;
        request.onsuccess = () => {
          try { result = apply(request.result, records, tx.objectStore('originals')); }
          catch (reason) { error = reason; tx.abort(); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(error || tx.error || new Error('更改未保存，请重试。'));
      });
    } else rows = apply([...sessions.values()], null, transientFiles);
    sessions.clear();
    for (const s of rows) sessions.set(s.id, s);
  }
  function removeConversation(s) {
    if (!s || s.cardOnly) throw new Error('会话不存在。');
    return updateConversations(s);
  }
  async function load() {
    try {
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('folio-experience-workspace-v1', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('sessions', { keyPath: 'id' });
          request.result.createObjectStore('originals');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await updateConversations(null);
    } catch {
      db?.close();
      db = null;
    }
  }
  function read(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function save(s, additions = []) {
    const next = {
      ...s,
      updated: new Date().toISOString(),
      revision: s.revision + 1,
    };
    if (db)
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['sessions', 'originals'], 'readwrite');
        const records = tx.objectStore('sessions');
        let failure = '浏览器存储写入失败，请保留原文件并重试。';
        const existing = records.get(s.id);
        existing.onsuccess = () => {
          if ((existing.result?.revision || 0) !== s.revision) {
            failure = '这段经历已在另一个窗口更新。请刷新后再试。';
            tx.abort();
            return;
          }
          // A new draft may reuse a file from another conversation.
          // Check it in the same transaction as the write in case that conversation was deleted.
          if (!s.revision && !additions.length) {
            for (const src of s.sources) {
              if (src.text !== undefined || src.url) continue;
              const key = tx.objectStore('originals').getKey(src.id);
              key.onsuccess = () => {
                if (key.result === undefined) {
                  failure = '原材料已被移除，请重新选择文件。';
                  tx.abort();
                }
              };
            }
          }
          records.put(next);
          for (const { id, file } of additions)
            tx.objectStore('originals').put(file, id);
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(new Error(failure));
        tx.onerror = () => {};
      });
    else {
      if ((sessions.get(s.id)?.revision || 0) !== s.revision)
        throw new Error('这段经历已有更新，请重新打开。');
      additions.forEach(({ id, file }) => transientFiles.set(id, file));
    }
    sessions.set(s.id, next);
    return next;
  }
  const getBlob = (id) =>
    db
      ? read(db.transaction('originals').objectStore('originals').get(id))
      : Promise.resolve(transientFiles.get(id));
  async function workspaceSnapshot() {
    if (!db) return { rows: [...sessions.values()], originals: new Map(transientFiles) };
    const tx = db.transaction(['sessions', 'originals']);
    const store = tx.objectStore('originals');
    const [rows, keys, blobs] = await Promise.all([
      read(tx.objectStore('sessions').getAll()), read(store.getAllKeys()), read(store.getAll()),
    ]);
    return { rows, originals: new Map(keys.map((key, i) => [key, blobs[i]])) };
  }
  async function restoreWorkspace(rows, originals) {
    if (!db) throw new Error('本机存储不可用，暂时无法导入。');
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'originals'], 'readwrite');
      let problem;
      const records = tx.objectStore('sessions');
      const count = records.count();
      count.onsuccess = () => {
        if (count.result > 0) {
          problem = '当前工作区已有经历。迁移包只能导入空工作区。';
          tx.abort();
          return;
        }
        for (const row of rows) records.add(row);
        for (const [id, blob] of originals) tx.objectStore('originals').put(blob, id);
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(new Error(problem || '导入未完成，请检查磁盘空间或迁移包。'));
    });
    sessions.clear();
    for (const row of rows) sessions.set(row.id, row);
  }
  const fileKey = (f) =>
    [f.webkitRelativePath || f.path || f.name, f.size, f.lastModified].join(
      '|',
    );
  const cleanTags = (value) => [
    ...new Set(
      value
        .split(/[,，、\n;；]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  const labelMap = {
    比赛名称: 'title',
    项目名称: 'title',
    活动名称: 'title',
    经历名称: 'title',
    分类: 'category',
    类别: 'category',
    我的角色: 'role',
    角色: 'role',
    奖项: 'result',
    获奖结果: 'result',
    成果: 'result',
    个人贡献: 'contribution',
    我的贡献: 'contribution',
    标签: 'tags',
  };
  function monthValues(text) {
    return [
      ...text.matchAll(
        /(19\d{2}|20\d{2})\s*[年./-]\s*(1[0-2]|0?[1-9])(?=月|[^0-9]|$)/g,
      ),
    ].map((x) => `${x[1]}-${x[2].padStart(2, '0')}`);
  }
  function readLabels(body) {
    const lines = body.split(/\r?\n/);
    const values = {};
    for (const line of lines) {
      const match = line.match(
        /^\s*(?:[-*]\s*)?([^:：]{1,10})[:：]\s*(.+?)\s*$/,
      );
      if (!match) continue;
      const label = match[1].trim(),
        value = match[2].trim();
      if (
        label === '活动时间' ||
        label === '比赛时间' ||
        label === '项目时间'
      ) {
        const dates = monthValues(value);
        if (dates.length) {
          values.start = dates[0];
          values.end = dates.at(-1);
        }
      } else if (Object.hasOwn(labelMap, label)) {
        const key = labelMap[label];
        if (key === 'category' && !Object.hasOwn(categories, value)) continue;
        values[key] = key === 'tags' ? cleanTags(value) : value;
      }
    }
    if (values.start && values.end < values.start) {
      delete values.start;
      delete values.end;
    }
    return values;
  }
  async function addTurn(
    s,
    files,
    text,
    isContribution = false,
    mode = 'local',
    workflow = workflowMode(),
  ) {
    const known = new Set(s.sources.map(fileKey));
    const additions = [];
    const proposals = new Map();
    if (workflow === 'auto') {
      for (const [field, value] of Object.entries(readLabels(text || '')))
        proposals.set(field, [{ id: null, value }]);
    }
    for (const file of files) {
      const key = fileKey(file);
      if (known.has(key)) continue;
      known.add(key);
      const id = uid();
      const src = {
        id,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      };
      s.sources.push(src);
      additions.push({ id, file });
      if (!/\.(txt|md)$/i.test(file.name) || file.size > 1048576) continue;
      const body = await file.text();
      const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines.length && lines.some(line => /模板|空表/.test(line)) &&
        lines.every(line => /^(?:[#\s]*(?:报名表|登记表|申请表)(?:模板|空表)|(?:姓名|队伍|队员|学号|日期|项目名称|团队名称|联系电话|联系方式)\s*[：:]\s*[_＿…\s]*)$/.test(line))) {
        src.review = { kind: 'discard', reason: '本地已读到空白表格，所有栏位均未填写' };
      }
      const values = readLabels(body);
      for (const [field, value] of Object.entries(values)) {
        const candidates = proposals.get(field) || [];
        candidates.push({ id, value });
        proposals.set(field, candidates);
      }
    }
    const different = [];
    for (const [field, candidates] of proposals) {
      const { id, value } = candidates.find(c => c.id) || candidates[0];
      const agreed = candidates.every(
        (c) => JSON.stringify(c.value) === JSON.stringify(value),
      );
      const current = s.draft[field];
      const empty =
        field === 'category'
          ? current === '其他'
          : field === 'title' && current === s.initialTitle ? true
          : Array.isArray(current)
            ? !current.length
            : !current;
      if (
        !agreed ||
        (!empty && JSON.stringify(current) !== JSON.stringify(value) && !candidates.some(c => c.id === null))
      ) {
        different.push(field);
        continue;
      }
      if (empty || JSON.stringify(current) !== JSON.stringify(value)) {
        s.draft[field] = value;
        if (id) s.draft.refs[field] = id;
        else delete s.draft.refs[field];
        if (field === 'title') delete s.initialTitle;
        s.dirty = true;
      }
    }
    if (!additions.length && !text) return additions;
    const contribution = Boolean(isContribution && text);
    if (contribution) {
      s.draft.contribution = text;
      delete s.draft.refs.contribution;
    }
    s.messages.push({
      type: 'turn',
      workflowMode: workflow,
      text,
      ids: additions.map((x) => x.id),
      conflicts: different,
      contribution,
      ...(mode === 'local' ? {} : { ai: { mode, status: 'pending' } }),
    });
    if (additions.length || contribution) s.dirty = true;
    return additions;
  }
  async function create(files, note, mode = 'local', workflow = workflowMode()) {
    const s = session();
    const additions = await addTurn(s, files, note, false, mode, workflow);
    if (!s.draft.title) {
      const folder = files[0]?.webkitRelativePath?.split('/')[0];
      const stem = files[0]?.name.replace(/\.[^.]+$/, '');
      s.draft.title =
        folder || (!autoCommand(note) && note.split('\n')[0]?.slice(0, 38)) || stem || '新的经历';
      s.initialTitle = s.draft.title;
    }
    return save(s, additions);
  }
  function draftFromSource(parent, source) {
    const s = session('source-' + source.id);
    s.sources = [copy(source)];
    s.resumeSources = [source.id];
    s.draft.title = source.name.replace(/\.[^.]+$/, '');
    s.initialTitle = s.draft.title;
    s.messages = [{ type: 'files', ids: [source.id] }];
    return s;
  }
  async function saveClip(sessionId, parentId, blob, title, region) {
    const old = sessions.get(sessionId), parent = old?.sources.find(src => src.id === parentId);
    if (!parent) throw new Error('原材料已变动，请重新打开。');
    const s = copy(old);
    const existing = s.sources.find(src => src.origin?.sourceId === parentId &&
      src.origin.part === region.part && JSON.stringify(src.origin.rect) === JSON.stringify(region.rect));
    if (existing) {
      const chosen = s.cardOnly ? s.published.sourceIds : s.resumeSources;
      if (chosen && !chosen.includes(existing.id)) {
        chosen.push(existing.id);
        if (!s.cardOnly) s.dirty = true;
        await save(s);
      }
      return existing;
    }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }[blob.type];
    if (!ext) throw new Error('无法保存此图片格式。');
    const name = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\.(png|jpg|jpeg|webp|gif|bmp)$/i, '').trim() + '.' + ext;
    const file = new File([blob], name, {type: blob.type});
    const src = {id: uid(), name, size: file.size, type: file.type, lastModified: file.lastModified,
      origin: {sourceId: parentId, name: parent.name, ...region}, review: {kind: 'keep', reason: '已选作证明附件', manual: true}};
    const reading = !region.rect && parent.pictureReadings?.[region.image || 0];
    if (reading) src.pictureReadings = {0: copy(reading)};
    s.sources.push(src);
    if (s.cardOnly) s.published.sourceIds.push(src.id);
    else {
      if (s.resumeSources) s.resumeSources.push(src.id);
      s.dirty = true;
      s.messages.push({type: 'files', ids: [src.id]});
    }
    await save(s, [{id: src.id, file}]);
    return src;
  }
  function resumeSources(s) {
    const selected = s.resumeSources && new Set(s.resumeSources);
    const locked = protectedSources(s);
    return s.sources.filter(src => selected ? selected.has(src.id) :
      !s.evidenceFirst || materialReview(s, src, locked).kind === 'keep').map(src => src.id);
  }
  function dateSort(a, b) {
    return (
      recordMonth(b).localeCompare(recordMonth(a)) ||
      (b.start || '').localeCompare(a.start || '') ||
      a.title.localeCompare(b.title, 'zh-CN')
    );
  }
  window.Folio = {
    workspaceSnapshot, restoreWorkspace,
    workflowKey, workflowMode, setWorkflowMode, autoCommand, finishAutomatic,
    profile, saveProfile, profileKey, identityMatch,
    categories,
    emptyRecord,
    sessions,
    load,
    save,
    getBlob,
    addTurn,
    create,
    draftFromSource,
    saveClip,
    resumeSources,
    copy,
    period,
    fmt,
    recordMonth,
    dateSort,
    removeConversation,
    materialReview,
    protectedSources,
    evidenceName,
    publishDraft,
    applyRetention(s, choices, publish = false) {
      if (!s || s.cardOnly || !(choices instanceof Map)) throw new Error('请重新打开材料清单。');
      return updateConversations(s, choices, publish);
    },
    conversationTitle,
    cleanTags,
    fileKey,
    isPersistent: () => Boolean(db),
  };
})();
