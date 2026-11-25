'use strict';
(function app() {
  'use strict';
  const F = window.Folio,
    UI = window.FolioUI,
    AI = window.FolioAI;
  const { esc, icon } = UI;
  const get = (id) => document.getElementById(id);
  const panel = get('panel'),
    sourceDialog = get('source-dialog');
  const state = {
    page: 'work',
    id: null,
    settingsOrigin: '',
    homeFiles: [],
    homeNote: '',
    replyFiles: [],
    replyNote: '',
    answering: false,
    query: '',
    category: '全部',
    year: '',
  };
  const composerMemory = new Map();
  let deferredAuto = null;
  const readingStatus = new Map();
  const narrowScreen = matchMedia('(width < 768px)');
  const sidebar = get('sidebar'),
    sidebarToggle = get('sidebar-toggle');
  const sidebarPreferenceKey = 'folio.sidebar';
  let desktopSidebarOpen = true;
  let mobileSidebarOpen = false;
  let busy = false,
    noticeTimer = null,
    sourceURL = null,
    sourceRequest = 0,
    highlightId = null;
  let preview = { rows: [], selected: new Set(), name: '', focus: '' };
  let releaseClip = null;
  const recognizing = new Map();
  async function readSavedPicture(sessionId, id, manual = false) {
    if (recognizing.has(id)) return recognizing.get(id);
    const work = (async () => {
      const src = F.sessions.get(sessionId)?.sources.find(item => item.id === id);
      if (!src || (!manual && src.pictureReadings?.[0])) return;
      const connection = await AI.connectionForSend();
      if (connection.mode === 'local' && !manual) return;
      const reading = await AI.recognizeImage(src, connection);
      const stored = F.sessions.get(sessionId);
      if (!stored?.sources.some(item => item.id === id)) return;
      const next = F.copy(stored), target = next.sources.find(item => item.id === id);
      (target.pictureReadings ||= {})[0] = reading;
      await F.save(next);
      refreshAIThread(sessionId);
    })();
    recognizing.set(id, work);
    try { await work; } finally { recognizing.delete(id); }
  }
  function readAfterCapture(s, src) {
    return readSavedPicture(s.id, src.id).catch(error => notify('图片已保存。' + error.message));
  }
  function notify(text) {
    const el = get('toast');
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => el.classList.remove('visible'), 3800);
  }
  function updateNavLayout() {
    const mobile = narrowScreen.matches;
    const open = mobile ? mobileSidebarOpen : desktopSidebarOpen;
    const label = open ? '收起侧边栏' : '展开侧边栏';
    if (!open && sidebar.contains(document.activeElement)) {
      sidebarToggle.focus({ preventScroll: true });
    }
    document.body.classList.toggle('nav-open', open);
    sidebar.inert = !open;
    get('main-content').inert = mobile && open;
    document.querySelector('.skip-link').inert = mobile && open;
    sidebarToggle.setAttribute('aria-expanded', String(open));
    sidebarToggle.setAttribute('aria-label', label);
    sidebarToggle.title = label;
  }
  function closeMobileNav() {
    if (!mobileSidebarOpen) return;
    mobileSidebarOpen = false;
    updateNavLayout();
    sidebarToggle.focus({ preventScroll: true });
  }
  const current = () => F.sessions.get(state.id);
  function render() {
    document.body.dataset.page = state.page;
    sidebar.innerHTML = UI.rail(state);
    get('topbar').innerHTML = UI.topbar(state);
    const view = get('view');
    if (state.page === 'settings') {
      document.title = '设置 · 拾页 Folio';
      if (!get('ai-settings')) {
        view.innerHTML = UI.settingsPage();
        AI.mount(get('ai-settings'));
      }
      return;
    }
    AI.unmount();
    view.innerHTML =
      state.page === 'session'
        ? UI.sessionPage(state, current())
        : state.page === 'work'
          ? UI.home(state)
          : UI.library(state);
    syncComposer();
    if (highlightId && (state.page === 'resume' || state.page === 'timeline')) {
      const item = [
        ...get('view').querySelectorAll('[data-act="detail"]'),
      ].find((x) => x.dataset.session === highlightId);
      item?.classList.add('newly-confirmed');
    }
    document.title = `${state.page === 'session' ? F.conversationTitle(current()) : state.page === 'work' ? '整理台' : '经历简历'} · 拾页 Folio`;
  }
  function syncRoute(event) {
    const previousPage = state.page;
    if (state.page === 'session' && current() && !current().cardOnly)
      composerMemory.set(state.id, {
        files: state.replyFiles,
        note: state.replyNote,
        answering: state.answering,
      });
    const hash = location.hash.slice(1);
    if (hash === 'settings') {
      let origin = history.state?.settingsOrigin;
      if (typeof origin !== 'string') {
        origin = '';
        if (event?.type === 'hashchange' && state.page !== 'settings') {
          origin = state.id ? UI.sessionLink(state.id) : '#' + state.page;
        }
        history.replaceState({ ...history.state, settingsOrigin: origin }, '');
      }
      state.settingsOrigin = origin;
    }
    const id = hash.startsWith('session/') ? hash.slice(8) : '';
    const routed = F.sessions.get(id);
    state.id = routed && !routed.cardOnly ? id : null;
    state.page = state.id
      ? 'session'
      : ['resume', 'timeline', 'settings'].includes(hash)
        ? hash
        : routed?.cardOnly ? 'resume' : 'work';
    if (id && !state.id) history.replaceState(null, '', '#' + state.page);
    const stash = composerMemory.get(state.id);
    state.replyFiles = stash?.files || [];
    state.replyNote = stash?.note || '';
    state.answering = stash?.answering || false;
    if (sourceDialog.open) sourceDialog.close();
    if (panel.open) panel.close();
    closeMobileNav();
    render();
    if (deferredAuto && state.page !== 'settings') {
      const pending = deferredAuto;
      deferredAuto = null;
      if (previousPage === 'settings' && state.id === pending.id && current().revision === pending.revision)
        mutate(() => organizeExisting(current(), false));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    const log = document.querySelector('.conversation-turns');
    if (log) log.scrollTop = log.scrollHeight;
    if (state.page === 'settings') {
      get('main-content').focus({ preventScroll: true });
    } else if (matchMedia('(pointer: fine)').matches) {
      document
        .querySelector('#message-composer textarea')
        ?.focus({ preventScroll: true });
    }
  }
  function go(route) {
    const hash = route.startsWith('#') ? route : '#' + route;
    if (location.hash === hash) syncRoute();
    else location.hash = hash;
  }
  function openPanel(html, style = 'center-panel') {
    panel.className = style;
    panel.innerHTML = html;
    if (!panel.open) panel.showModal();
    panel.scrollTop = 0;
  }
  function smallPanel(title, content) {
    return `<div class="panel-head"><span>${icon('lab', 16)}拾页 Folio</span><button class="icon-btn" data-act="close-panel" aria-label="关闭">${icon('close')}</button></div><div class="about-body"><h2 id="panel-title">${esc(title)}</h2>${content}</div>`;
  }
  function syncComposer(refreshFiles = false) {
    const form = get('message-composer');
    if (!form) return;
    const home = state.page === 'work';
    const files = home ? state.homeFiles : state.replyFiles,
      note = home ? state.homeNote : state.replyNote;
    const target = get(home ? 'home-staged' : 'reply-staged');
    if (target && refreshFiles) target.innerHTML = UI.staged(files);
    const button = get(home ? 'create-btn' : 'reply-btn');
    if (button)
      button.disabled =
        busy || AI.running.has(state.id) || (!files.length && !note.trim());
    form.setAttribute('aria-busy', String(busy));
    form.querySelector('textarea').readOnly = busy;
  }
  function stageFiles(files) {
    if (busy || !files.length) return;
    const home = state.page === 'work';
    if (!home && state.page !== 'session') return;
    const collection = home ? state.homeFiles : state.replyFiles;
    const keys = new Set(collection.map(F.fileKey));
    const stored = new Set(
      (home ? [] : current()?.sources || []).map(F.fileKey),
    );
    let added = 0;
    for (const file of files) {
      const key = F.fileKey(file);
      if (keys.has(key) || stored.has(key)) continue;
      keys.add(key);
      collection.push(file);
      added++;
    }
    syncComposer(true);
    if (!added) notify('这组材料已添加');
  }
  function unstage(index) {
    if (busy) return;
    (state.page === 'work' ? state.homeFiles : state.replyFiles).splice(
      index,
      1,
    );
    syncComposer(true);
  }
  async function mutate(action) {
    if (busy) return;
    busy = true;
    syncComposer();
    try {
      await action();
    } catch (error) {
      const message = error?.message || '暂时无法保存，请重试。';
      if (panel.open) {
        const el = panel.querySelector('.form-error');
        if (el) el.textContent = message;
        else notify(message);
      } else notify(message);
    } finally {
      busy = false;
      syncComposer();
    }
  }
  function requestedFigure(note) {
    const match = note.match(/^(?:请|帮我)?(?:提取|保存|截取|截图)\s*(?:第?\s*(\d+)\s*张(?:图片|图|证书|奖状)?|图\s*(\d+))(?:为证明附件|作为证明|到简历|并识别)?[。！!]?$/);
    return match ? Number(match[1] || match[2]) : null;
  }
  async function extractFigure(s, number) {
    const turnIds = new Set(s.messages.at(-1)?.ids || []);
    const docs = s.sources.filter(src => /\.docx$/i.test(src.name));
    const added = docs.filter(src => turnIds.has(src.id));
    const choices = added.length ? added : docs;
    if (choices.length !== 1) throw new Error('请打开对应的 Word 原件，选择要提取的图片。');
    const src = choices[0], word = await FolioEvidence.readWord(await F.getBlob(src.id), src.name);
    const item = word.images.find(i => i.number === number);
    if (!item) throw new Error(`这份 Word 有 ${word.images.length} 张可选图片，请核对图号。`);
    const hint = s.messages.flatMap(m => m.ai?.clips || []).reverse().find(c => c.sourceId === src.id && c.image === number);
    const clip = await F.saveClip(s.id, src.id, await word.image(item), hint?.label || src.name.replace(/\.docx$/i, '') + ' · 图 ' + number,
      {image: number, part: item.path, rect: null});
    notify(`图 ${number} 已在证明附件中`);
    readAfterCapture(s, clip);
  }
  async function create() {
    const files = [...state.homeFiles],
      note = state.homeNote.trim();
    if (!files.length && !note) return;
    const figure = requestedFigure(note);
    const command = F.autoCommand(note);
    if (command && !files.length) return notify('先添加这段经历的材料，或打开已有会话整理。');
    const workflow = command ? 'auto' : figure === null ? F.workflowMode() : 'manual';
    const connection = figure === null ? await AI.connectionForSend() : {mode: 'local'};
    const s = await F.create(files, note, connection.mode, workflow);
    state.homeFiles = [];
    state.homeNote = '';
    if (state.page === 'work') go(UI.sessionLink(s.id));
    if (figure !== null) {
      await extractFigure(s, figure);
      if (state.id === s.id) render();
    } else if (connection.mode !== 'local')
      organizeTurn(s, s.messages.length - 1, connection);
    else if (workflow === 'auto') {
      await F.finishAutomatic(s, s.messages.length - 1);
      refreshAIThread(s.id);
    }
  }
  async function reply() {
    const s = F.copy(current());
    const note = state.replyNote.trim();
    const files = [...state.replyFiles];
    if (!files.length && !note) return;
    const command = F.autoCommand(note);
    const filled = Boolean(note && state.answering && !command);
    const figure = filled ? null : requestedFigure(note);
    const workflow = command ? 'auto' : figure === null ? F.workflowMode() : 'manual';
    const index = s.messages.length;
    const connection = figure === null ? await AI.connectionForSend() : {mode: 'local'};
    const additions = await F.addTurn(s, files, note, filled, connection.mode, workflow);
    if (s.messages.length === index) return notify('这组材料已在会话中');
    const saved = await F.save(s, additions);
    if (figure !== null) {
      try { await extractFigure(saved, figure); }
      catch (error) { notify(error.message); }
    } else if (connection.mode !== 'local')
      organizeTurn(saved, index, connection);
    else if (workflow === 'auto') await F.finishAutomatic(saved, index);
    composerMemory.delete(s.id);
    if (state.id !== s.id) return;
    state.replyFiles = [];
    state.replyNote = '';
    if (filled || command) state.answering = false;
    render();
    const thread = document.querySelector('.conversation-turns');
    if (thread) thread.scrollTop = thread.scrollHeight;
    if (matchMedia('(pointer: fine)').matches)
      get('reply-note').focus({ preventScroll: true });
  }
  function refreshAIThread(id) {
    if (state.id !== id || state.page !== 'session') return;
    const log = document.querySelector('.conversation-turns');
    if (!log) return;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const s = current();
    if (!s || s.cardOnly) return;
    log.innerHTML = UI.messages(s);
    if (atEnd) log.scrollTop = log.scrollHeight;
    document.querySelector('.thread-head h1').textContent = F.conversationTitle(s);
    document.querySelector('.thread-tools').innerHTML = UI.threadTools(s);
    document.title = F.conversationTitle(s) + ' · 拾页 Folio';
    syncComposer();
  }
  function syncMaterialCount(form) {
    const counts = { attach: 0, chat: 0, remove: 0 };
    for (const select of form.querySelectorAll('[name="material-destination"]')) counts[select.value]++;
    form.querySelector('.material-count').textContent = `简历附件 ${counts.attach} 份 · 仅留会话 ${counts.chat} 份 · 将移除 ${counts.remove} 份`;
  }
  function showMaterials(s, publishing = false) {
    if (!s || s.cardOnly) return;
    const reading = AI.running.has(s.id) ? readingStatus.get(s.id) || '正在读取材料…' : '';
    openPanel(UI.materialPanel(s, publishing, reading));
    syncMaterialCount(get('material-form'));
  }
  function refreshMaterials(id) {
    const form = get('material-form');
    if (form?.dataset.session !== id || !panel.open) return;
    const choices = new Map([...form.querySelectorAll('[data-picked]')].map(el => [el.dataset.source, el.value]));
    showMaterials(F.sessions.get(id), form.hasAttribute('data-publish'));
    const next = get('material-form');
    if (!next) return;
    for (const select of next.querySelectorAll('[name="material-destination"]')) {
      if (!choices.has(select.dataset.source) || select.hasAttribute('data-locked')) continue;
      select.value = choices.get(select.dataset.source);
      select.dataset.picked = '';
    }
    syncMaterialCount(next);
  }
  async function readRemaining(id, requested, connection, turnIndex) {
    const pending = new Set(requested);
    let reviewReason = '';
    while (pending.size) {
      const s = F.sessions.get(id);
      if (!s || s.cardOnly) return;
      const batch = AI.reviewBatch(s, [...pending]);
      if (!batch.length) break;
      readingStatus.set(id, `正在判读材料 · 本批 ${batch.length} 份`);
      refreshMaterials(id);
      const result = await AI.analyze(s, turnIndex ?? s.messages.length, connection, batch);
      reviewReason ||= result.reviewReason || '';
      const stored = F.sessions.get(id);
      if (!stored || stored.cardOnly) return;
      const next = F.copy(stored);
      AI.applyReviews(next, result);
      if (turnIndex !== undefined) AI.applySuggestions(next, result, next.messages[turnIndex]);
      if (result.fileReviews.length || result.imagesRead?.length || (turnIndex !== undefined && result.updates?.length)) await F.save(next);
      batch.forEach(sourceId => pending.delete(sourceId));
    }
    return reviewReason;
  }
  async function reviewExisting(s) {
    if (!s || AI.running.has(s.id)) return;
    AI.running.set(s.id, -1);
    refreshMaterials(s.id);
    syncComposer();
    try {
      const connection = await AI.connectionForSend();
      if (connection.mode === 'local') throw new Error('请先在设置中连接 AI，再回来判读材料。');
      const locked = F.protectedSources(s);
      await readRemaining(s.id, s.sources.filter(src => !src.review && !locked.has(src.id)).map(src => src.id), connection);
    } catch (reason) {
      notify(reason.message || '判读中断，已完成的建议已保存。');
    } finally {
      AI.running.delete(s.id);
      readingStatus.delete(s.id);
      refreshMaterials(s.id);
      syncComposer();
    }
  }
  async function submitMaterials(form) {
    const s = F.sessions.get(form.dataset.session);
    if (!s || s.cardOnly || AI.running.has(s.id) || s.revision !== Number(form.dataset.revision))
      throw new Error('材料已更新，请重新打开核对。');
    const selects = [...form.querySelectorAll('[name="material-destination"]')];
    const choices = new Map(selects.map(el => [el.dataset.source, el.value]));
    const publishing = form.hasAttribute('data-publish');
    const button = form.querySelector('[type="submit"]');
    const submitLabel = button.textContent;
    const enabled = [...form.querySelectorAll('select:enabled, button:enabled')];
    form.querySelector('.form-error').textContent = '';
    enabled.forEach(el => { el.disabled = true; });
    button.textContent = '正在保存…';
    try {
      await F.applyRetention(s, choices, publishing);
    } finally {
      enabled.forEach(el => { el.disabled = false; });
      button.textContent = submitLabel;
    }
    const saved = F.sessions.get(s.id);
    const remaining = new Set(saved.sources.map(src => src.id));
    const removed = s.sources.filter(src => !remaining.has(src.id));
    if (publishing) return showPublished(s.id, removed.length ? `已收进简历，已移除 ${removed.length} 份材料副本` : undefined);
    render();
    openPanel(UI.materialResult(saved, removed));
  }
  async function organizeTurn(s, index, connection) {
    if (AI.running.has(s.id) || !s.messages[index]?.ai) return;
    AI.running.set(s.id, index);
    refreshAIThread(s.id);
    let result, error;
    try {
      result = await AI.analyze(s, index, connection);
    } catch (reason) {
      error = reason.message || '整理未完成，请重试。';
    }
    try {
      const stored = F.sessions.get(s.id);
      if (!stored || stored.cardOnly) return;
      const next = F.copy(stored);
      if (result) {
        AI.applySuggestions(next, result, next.messages[index]);
        AI.applyReviews(next, result);
      }
      next.messages[index].ai = result
        ? {
            status: 'finishing',
            mode: connection.mode,
            reply: result.reply,
            notes: result.notes,
            clips: result.clips,
          }
        : { status: 'error', mode: connection.mode, error };
      await F.save(next);
      sidebar.innerHTML = UI.rail(state);
      renderResults();
      if (result) {
        const chosen = result.capture;
        const profile = F.profile();
        if (chosen && profile.name === chosen.person.name && profile.school === chosen.person.school) {
          const word = await FolioEvidence.readWord(await F.getBlob(chosen.sourceId), next.sources.find(src => src.id === chosen.sourceId).name);
          const item = word.images.find(i => i.number === chosen.image);
          if (item) {
            const clip = await F.saveClip(s.id, chosen.sourceId, await word.image(item), chosen.name, {image: item.number, part: item.path, rect: null});
            await readAfterCapture(next, clip);
          }
        }
        const attempted = new Set(result.attempted);
        const batchIds = next.messages[index].ids || [];
        const scope = !batchIds.length && next.messages[index].workflowMode === 'auto' ? next.sources.map(src => src.id) : batchIds;
        const remaining = scope.filter(id => !attempted.has(id));
        const batchReason = await readRemaining(s.id, remaining, connection, index);
        const latest = F.sessions.get(s.id);
        if (!latest || latest.cardOnly) return;
        if (latest.messages[index].workflowMode === 'auto') {
          const ownerChanged = result.person && (F.profile().name !== result.person.name || F.profile().school !== result.person.school);
          await F.finishAutomatic(latest, index, ownerChanged ? '个人信息已变更，请核对材料归属。' : result.reviewReason || batchReason);
        } else {
          const done = F.copy(latest);
          done.messages[index].ai.status = 'done';
          await F.save(done);
        }
        if (state.page === 'resume' || state.page === 'timeline') render();
      }
    } catch (reason) {
      const message = reason.message || '整理结果未能保存，请重试。';
      const failed = F.copy(F.sessions.get(s.id));
      if (failed?.messages?.[index]?.ai && !failed.messages[index].workflow) {
        failed.messages[index].ai = { ...failed.messages[index].ai, status: 'error', error: message };
        await F.save(failed).catch(() => {});
      }
      notify(message);
    } finally {
      AI.running.delete(s.id);
      readingStatus.delete(s.id);
      refreshAIThread(s.id);
      refreshMaterials(s.id);
    }
  }
  async function retryAI(s, index) {
    if (!s?.messages[index]?.ai || s.messages[index].ai.status === 'done')
      return;
    const connection = await AI.connectionForSend();
    if (connection.mode === 'local') {
      if (state.id === s.id) go('settings');
      return;
    }
    organizeTurn(s, index, connection);
  }
  async function organizeExisting(s, openSettings = true) {
    if (!s || AI.running.has(s.id)) return;
    const connection = await AI.connectionForSend();
    if (state.id !== s.id || current()?.revision !== s.revision) return;
    if (connection.mode === 'local') {
      if (openSettings) {
        deferredAuto = {id: s.id, revision: s.revision};
        go('settings');
        notify('连接 AI 后返回会话，拾页会继续整理已有材料。');
      } else notify('仍在使用本地整理。连接 AI 后可继续处理原件。');
      return;
    }
    const next = F.copy(s);
    await F.addTurn(next, [], '自动整理', false, connection.mode, 'auto');
    const saved = await F.save(next);
    organizeTurn(saved, saved.messages.length - 1, connection);
  }
  async function useNote(index) {
    const s = F.copy(current()),
      m = s.messages[index];
    if (!m?.text || F.autoCommand(m.text) || !['note', 'turn'].includes(m.type)) return;
    s.draft.contribution = m.text;
    delete s.draft.refs.contribution;
    s.dirty = true;
    await F.save(s);
    render();
    notify('已写入草稿的个人贡献');
  }
  async function confirmRecord(record) {
    if (!record || !record.dirty) return;
    const s = F.copy(record);
    if (AI.running.has(s.id)) {
      notify('材料正在整理，完成后即可收录');
      return;
    }
    if (!s.draft.title.trim()) {
      openPanel(UI.editor(s));
      return;
    }
    const locked = F.protectedSources(s);
    if (s.sources.some(src => F.materialReview(s, src, locked).kind === 'discard')) {
      showMaterials(s, true);
      return;
    }
    F.publishDraft(s);
    await F.save(s);
    showPublished(s.id);
  }
  function showPublished(id, message = '已收进简历，卡片和时间线已同步') {
    state.query = '';
    state.category = '全部';
    state.year = '';
    highlightId = id;
    if (panel.open) panel.close();
    go(state.page === 'timeline' ? 'timeline' : 'resume');
    notify(message);
  }
  async function saveEdit(form) {
    const data = new FormData(form);
    const parent = F.sessions.get(form.dataset.parent);
    const existing = F.sessions.get(form.dataset.session);
    if (parent && existing) {
      openPanel(existing.cardOnly ? UI.detail(existing) : UI.draft(existing), 'side-panel');
      return;
    }
    const source = parent?.sources.find((src) => src.id === form.dataset.source);
    const s = source ? F.draftFromSource(parent, source) : existing && F.copy(existing);
    if (!s) return;
    if (existing && existing.revision !== Number(form.dataset.revision))
      throw new Error('这段经历已有更新，请重新打开编辑。');
    const card = form.hasAttribute('data-card');
    const r = card ? s.published.record : s.draft;
    const val = (key) => String(data.get(key) || '').trim();
    if (!val('title')) {
      form.querySelector('.form-error').textContent = '请填写经历名称。';
      return;
    }
    if (val('start') && val('end') && val('end') < val('start')) {
      form.querySelector('.form-error').textContent =
        '结束月份应晚于或等于开始月份。';
      return;
    }
    const revised = {
      ...r,
      refs: { ...r.refs },
      title: val('title'),
      category: val('category'),
      role: val('role'),
      start: val('start'),
      end: val('end'),
      awarded: val('awarded'),
      result: val('result'),
      contribution: val('contribution'),
      tags: F.cleanTags(val('tags')),
    };
    let changed = Boolean(source);
    for (const key of Object.keys(UI.fieldNames)) {
      if (JSON.stringify(revised[key]) !== JSON.stringify(r[key] ?? '')) {
        delete revised.refs[key];
        changed = true;
      }
    }
    const checked = new Set(data.getAll('resume-source'));
    const selected = s.sources.filter((src) => checked.has(src.id)).map((src) => src.id);
    if (card) {
      if (changed || JSON.stringify(selected) !== JSON.stringify(s.published.sourceIds)) {
        if (!s.cardOnly) {
          if (r.title !== revised.title) s.conversationName = F.conversationTitle(s);
          for (const key of Object.keys(UI.fieldNames)) {
            if (JSON.stringify(s.draft[key] ?? '') === JSON.stringify(r[key] ?? '') &&
                JSON.stringify(revised[key]) !== JSON.stringify(r[key] ?? '')) {
              s.draft[key] = revised[key];
              delete s.draft.refs[key];
            }
          }
          if (JSON.stringify(F.resumeSources(s)) === JSON.stringify(s.published.sourceIds)) {
            if (!s.evidenceFirst && selected.length === s.sources.length) delete s.resumeSources;
            else s.resumeSources = selected;
          }
        }
        revised.refs = Object.fromEntries(Object.entries(revised.refs).filter(([, id]) => checked.has(id)));
        s.published = { record: revised, sourceIds: selected };
        await F.save(s);
      }
      render();
      openPanel(UI.detail(F.sessions.get(s.id)), 'side-panel');
      notify('简历卡片已保存');
      return;
    }
    if (JSON.stringify(F.resumeSources(s)) !== JSON.stringify(selected)) {
      if (!s.evidenceFirst && selected.length === s.sources.length) delete s.resumeSources;
      else s.resumeSources = selected;
      changed = true;
    }
    if (changed) {
      s.draft = revised;
      s.dirty = true;
      await F.save(s);
    }
    render();
    openPanel(UI.draft(F.sessions.get(s.id)), 'side-panel');
    notify(source ? '已创建独立草稿，可以核对并加入简历' : changed ? '草稿已保存' : '草稿已核对');
  }
  function updateSourceCount(form) {
    const boxes = form.querySelectorAll('[name="resume-source"]');
    const count = form.querySelector('[data-source-count]');
    if (count) count.textContent = form.querySelectorAll('[name="resume-source"]:checked').length + ' / ' + boxes.length;
  }
  function clearSource() {
    releaseClip?.();
    releaseClip = null;
    if (sourceURL) {
      URL.revokeObjectURL(sourceURL);
      sourceURL = null;
    }
  }
  const fileIconName = (name) =>
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(name) ? 'image' : 'file';
  async function showSource(s, id, imageNumber, startCrop = false, suggestion) {
    const src = s?.sources.find((x) => x.id === id);
    if (!src) return;
    const request = ++sourceRequest;
    clearSource();
    sourceDialog.innerHTML = `<div class="panel-head"><div class="source-heading">${icon(fileIconName(src.name))}<h2 id="source-title">${esc(src.name)}</h2></div><button class="icon-btn" data-act="close-source" aria-label="关闭材料">${icon('close')}</button></div><div class="source-content" aria-live="polite">正在打开原件…</div>`;
    if (!sourceDialog.open) sourceDialog.showModal();
    try {
      let blob = null,
        url = src.url || null,
        txt = src.text;
      if (!url) {
        blob =
          txt !== undefined
            ? new Blob([txt], { type: 'text/plain;charset=utf-8' })
            : await F.getBlob(src.id);
        if (!blob) throw new Error('当前工作区中没有找到原件。');
      }
      if (request !== sourceRequest || !sourceDialog.open) return;
      if (!url) {
        sourceURL = URL.createObjectURL(blob);
        url = sourceURL;
      }
      let body = '', word = null;
      const picture = /\.(png|jpe?g|webp|gif|bmp)$/i.test(src.name);
      if (src.origin) body += `<p class="excerpt">取自 ${esc(src.origin.name)}${src.origin.image ? ' · 图 ' + src.origin.image : ''}</p>`;
      if (src.excerpt)
        body += `<p class="excerpt"><strong>材料摘录</strong><br>${esc(src.excerpt)}</p>`;
      if (/\.pdf$/i.test(src.name))
        body += `<iframe title="${esc(src.name)} PDF 预览" src="${esc(url)}#toolbar=1"></iframe>`;
      else if (/\.docx$/i.test(src.name) && blob) {
        try {
          word = await FolioEvidence.readWord(blob, src.name);
          const person = F.profile();
          for (const image of word.images) image.match = F.identityMatch(src.pictureReadings?.[image.number], person);
          body += `<p class="soft-copy">已读取 Word 正文和 ${word.images.length} 张可预览图片${word.omitted ? '，另有 ' + word.omitted + ' 张不支持预览' : ''}。</p>
            <details class="word-text" ${word.images.length ? '' : 'open'}><summary>查看正文</summary><pre>${esc(word.body.slice(0, 30000))}${word.body.length > 30000 ? '\n（仅预览前 3 万字）' : ''}</pre></details>`;
        } catch (error) {body += `<p class="soft-copy">无法预览此 Word 文件。${esc(error.message)}</p>`;}
      } else if (picture && !startCrop)
        body += `<img alt="${esc(src.name)} 的原件" src="${esc(url)}">`;
      else if (picture && startCrop) body += '';
      else if (
        txt !== undefined ||
        /\.(txt|md|csv|log|json)$/i.test(src.name)
      ) {
        txt = txt ?? (await blob.slice(0, 96000).text());
        body += `<pre>${esc(txt)}${blob?.size > 96000 ? '\n\n（预览仅显示开头部分）' : ''}</pre>`;
      } else
        body +=
          '<p class="soft-copy">原文件已保留。下载后可用对应的应用打开。</p>';
      if (request !== sourceRequest || !sourceDialog.open) return;
      const clip = word?.images.length || (picture && blob && startCrop);
      if (picture && !startCrop) body += `<div class="picture-check">${UI.imageReading(src)}<button type="button" class="quiet-button" data-act="read-picture" data-session="${esc(s.id)}" data-source="${esc(src.id)}">${icon('eye',15)}${src.pictureReadings?.[0] ? '重新识别图片' : '识别这张图'}</button><p class="form-error" role="status"></p></div>`;
      if (clip) body += '<section class="clip-editor" aria-label="提取和裁剪证明"></section>';
      else if (picture && blob) body += `<button type="button" class="soft-button" data-act="crop" data-session="${esc(s.id)}" data-source="${esc(src.id)}">裁剪图片</button>`;
      const related = F.draftFromSource(s, src).id;
      const split = s.id === related ? '' : `<button type="button" class="soft-button" data-act="split-source" data-session="${esc(s.id)}" data-source="${esc(src.id)}">${icon('layers', 15)}${F.sessions.has(related) ? '查看关联经历' : '用此材料另建经历'}</button>`;
      body += `<div class="source-footer"><span>本机原件${blob ? ' · ' + UI.bytes(blob.size) : ''}</span>${split}<a class="soft-button" href="${esc(url)}" download="${esc(src.name)}">${icon('download', 16)}下载原件</a></div>`;
      sourceDialog.querySelector('.source-content').innerHTML = body;
      if (clip) releaseClip = FolioEvidence.mount(sourceDialog.querySelector('.clip-editor'), {
        doc: word, blob, name: src.name, first: imageNumber, suggestion,
        save: async (output, title, region) => {
          const saved = await F.saveClip(s.id, src.id, output, title, region);
          if (sourceDialog.open && request === sourceRequest) sourceDialog.close();
          render();
          if (panel.open) {
            const latest = F.sessions.get(s.id);
            if (get('material-form')) refreshMaterials(latest.id);
            else if (panel.className === 'side-panel') openPanel(latest.cardOnly || !latest.dirty ? UI.detail(latest) : UI.draft(latest), 'side-panel');
          }
          notify('已保存证明附件');
          readAfterCapture(s, saved);
        },
      });
    } catch (err) {
      if (request === sourceRequest && sourceDialog.open)
        sourceDialog.querySelector('.source-content').textContent =
          err.message || '原件打开失败。';
    }
  }
  function resumeSheet() {
    const list = preview.rows.filter((s) => preview.selected.has(s.id));
    const catOrder = Object.keys(F.categories);
    const section = (cat) => {
      const rows = list.filter((s) => s.published.record.category === cat);
      if (!rows.length) return '';
      return `<section><h2>${esc(cat)}</h2>${rows
        .map((s) => {
          const r = s.published.record;
          return `<article><h3>${esc(r.title)}</h3><div class="meta">${esc(F.period(r))}${r.role ? ' · ' + esc(r.role) : ''}</div>${r.result ? `<p><strong>${esc(r.result)}</strong></p>` : ''}${r.contribution ? `<p>${esc(r.contribution)}</p>` : ''}</article>`;
        })
        .join('')}</section>`;
    };
    return `<div class="resume-sheet"><h1>${esc(preview.name || '我的经历简历')}</h1>${preview.focus ? `<p class="profile-sub">${esc(preview.focus)}</p>` : ''}${list.length ? catOrder.map(section).join('') : '<p class="meta">请选择要放入简历的经历。</p>'}</div>`;
  }
  function syncPreview() {
    const paper = get('preview-paper');
    if (!paper) return;
    paper.innerHTML = resumeSheet();
    get('print-count').textContent = `已选 ${preview.selected.size} 段经历`;
    get('print-btn').disabled = !preview.selected.size;
  }
  function showPreview() {
    const rows = UI.rows(state);
    preview = { ...preview, rows, selected: new Set(rows.map((s) => s.id)) };
    const choices = rows
      .map(
        (s) =>
          `<label class="preview-choice"><input type="checkbox" value="${esc(s.id)}" name="resume-entry" checked><span><strong>${esc(s.published.record.title)}</strong><small>${esc(s.published.record.category)} · ${esc(F.period(s.published.record))}</small></span></label>`,
      )
      .join('');
    openPanel(
      `<div class="panel-head"><span>${icon('book', 16)}经历简历</span><button class="icon-btn" data-act="close-panel" aria-label="关闭简历预览">${icon('close')}</button></div><div class="preview-body"><h2 id="panel-title">简历预览</h2><p class="preview-intro">从当前筛选结果中勾选经历，组合这次要用的简历。</p>
      <div class="edit-grid"><label class="edit-field"><span>姓名（选填）</span><input id="print-name" value="${esc(preview.name)}" placeholder="你的姓名"></label><label class="edit-field"><span>使用方向（选填）</span><input id="print-focus" value="${esc(preview.focus)}" placeholder="例如：交互设计实习"></label></div>
      <fieldset class="preview-fieldset" aria-label="选入简历的经历">${choices || '<p class="soft-copy">当前筛选结果为空。</p>'}</fieldset>
      <div id="preview-paper" class="paper-preview"></div><div class="modal-actions"><small id="print-count"></small><button id="print-btn" class="primary" data-act="print">${icon('print', 16)}打印 / 存为 PDF</button></div></div>`,
      'preview-panel',
    );
    syncPreview();
  }
  function renderResults() {
    const out = get('library-results');
    if (out) out.innerHTML = UI.results(state);
  }
  function toggleNav() {
    if (narrowScreen.matches) {
      mobileSidebarOpen = !mobileSidebarOpen;
    } else {
      desktopSidebarOpen = !desktopSidebarOpen;
      try {
        localStorage.setItem(
          sidebarPreferenceKey,
          desktopSidebarOpen ? 'open' : 'closed',
        );
      } catch {
        // The choice still applies for this visit if browser storage is unavailable.
      }
    }
    updateNavLayout();
  }
  function manageConversation(s, deleting) {
    if (!s || s.cardOnly) return;
    sidebar.querySelector(':popover-open')?.hidePopover();
    closeMobileNav();
    const name = esc(F.conversationTitle(s));
    const heading = deleting ? '删除会话' : '重命名会话';
    const description = s.published
      ? '会话消息和未收录的草稿将被删除。已收录的卡片及其附件会保存在经历简历中。'
      : '这段会话还没有已收录的卡片。删除后会移除会话消息和草稿。';
    openPanel(`<form class="edit-form" id="manage-chat" data-session="${esc(s.id)}" data-revision="${s.revision}" data-mode="${deleting ? 'delete' : 'rename'}">
      <h2 id="panel-title">${heading}</h2>${deleting
        ? `<p>删除「${name}」？</p><p class="body-text">${description}</p>`
        : `<label class="edit-field"><span>会话名称</span><input name="name" required maxlength="200" value="${name}"></label>`}
      <p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="soft-button" data-act="close-panel">取消</button>
      <button type="submit" class="primary ${deleting ? 'delete-chat-button' : ''}">${deleting ? '删除会话' : '保存名称'}</button></div></form>`);
    if (!deleting) {
      const input = panel.querySelector('input');
      input.focus();
      input.select();
    }
  }
  async function submitManageChat(form) {
    const s = F.sessions.get(form.dataset.session);
    if (!s || s.cardOnly || s.revision !== Number(form.dataset.revision))
      throw new Error('会话已有更新，请重新打开。');
    if (form.dataset.mode === 'delete') {
      await F.removeConversation(s);
      composerMemory.delete(s.id);
      panel.close();
      if (state.id === s.id) go(s.published ? 'resume' : 'work');
      else render();
      notify(s.published ? '已删除会话，简历卡片已保留' : '会话已删除');
    } else {
      const name = form.elements.name.value.trim();
      if (!name) throw new Error('请填写会话名称。');
      await F.save({ ...s, conversationName: name });
      panel.close();
      render();
      notify('会话已重命名');
    }
  }
  function handleClick(event) {
    const menu = document.querySelector('.attachment-menu[open]');
    if (menu && !menu.contains(event.target)) menu.open = false;
    const el = event.target.closest('[data-act]');
    if (!el) {
      if (
        event.target === get('nav-scrim') ||
        event.target.closest('#sidebar a')
      )
        closeMobileNav();
      return;
    }
    if (el.disabled) return;
    const action = el.dataset.act;
    const s = F.sessions.get(el.dataset.session) || current();
    switch (action) {
      case 'export-workspace':
        mutate(async () => {
          const status = get('transfer-status');
          status.textContent = '正在打包会话和附件…';
          try { status.textContent = '已生成迁移包，包含 ' + await FolioTransfer.exportWorkspace() + ' 段经历。'; }
          catch (error) { status.textContent = error.message; }
        });
        break;
      case 'import-workspace':
        get('transfer-file').click();
        break;
      case 'read-picture': {
        const token = sourceRequest;
        el.disabled = true;
        el.textContent = '正在识别图片…';
        readSavedPicture(s.id, el.dataset.source, true).then(() => {
          if (sourceDialog.open && token === sourceRequest) showSource(F.sessions.get(s.id), el.dataset.source);
        }).catch(error => {
          el.disabled = false;
          el.textContent = '重试识图';
          const msg = el.parentElement?.querySelector('.form-error');
          if (msg) msg.textContent = error.message;
        });
        break;
      }
      case 'profile': {
        const p = F.profile();
        openPanel(`<form class="edit-form" id="profile-form"><h2 id="panel-title">个人信息</h2>
          <p class="soft-copy">用证书上的署名核对你的材料。学校可帮助区分同名者。</p>
          <label class="edit-field"><span>姓名</span><input name="name" autocomplete="name" maxlength="80" value="${esc(p.name)}"></label>
          <label class="edit-field"><span>学校或单位（选填）</span><input name="school" autocomplete="organization" maxlength="120" value="${esc(p.school)}"></label>
          <p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="soft-button" data-act="close-panel">取消</button><button class="primary" type="submit">保存个人信息</button></div></form>`);
        break;
      }
      case 'materials':
        showMaterials(s);
        break;
      case 'read-materials':
        reviewExisting(s);
        break;
      case 'rename-session':
      case 'delete-session':
        manageConversation(s, action === 'delete-session');
        break;
      case 'edit-card':
        if (s?.published) openPanel(UI.editor(s, '', true));
        break;
      case 'new':
        event.preventDefault();
        closeMobileNav();
        go('work');
        break;
      case 'files':
      case 'folder':
        if (menu) menu.open = false;
        if (!busy)
          get(action === 'files' ? 'file-picker' : 'folder-picker').click();
        break;
      case 'unstage':
        unstage(Number(el.dataset.index));
        break;
      case 'draft':
        if (s) openPanel(UI.draft(s), 'side-panel');
        break;
      case 'answer':
      case 'cancel-answer':
        state.answering = action === 'answer';
        render();
        get('reply-note').focus();
        break;
      case 'use-note':
        mutate(() => useNote(Number(el.dataset.index)));
        break;
      case 'edit':
        if (s) openPanel(UI.editor(s));
        break;
      case 'confirm':
        mutate(() => confirmRecord(s));
        break;
      case 'split-source': {
        const src = s?.sources.find((item) => item.id === el.dataset.source);
        if (!src) break;
        const candidate = F.draftFromSource(s, src);
        const related = F.sessions.get(candidate.id);
        sourceDialog.close();
        if (related) openPanel(related.cardOnly ? UI.detail(related) : UI.draft(related), 'side-panel');
        else openPanel(UI.editor(candidate, s.id));
        break;
      }
      case 'pick-all':
      case 'pick-none':
        for (const box of el.form.querySelectorAll('[name="resume-source"]')) box.checked = action === 'pick-all';
        updateSourceCount(el.form);
        break;
      case 'detail':
        if (s?.published) openPanel(UI.detail(s), 'side-panel');
        break;
      case 'source':
      case 'crop': {
        const hint = s?.messages?.[Number(el.dataset.turn)]?.ai?.clips?.[Number(el.dataset.clip)];
        showSource(s, el.dataset.source, Number(el.dataset.image), action === 'crop', hint);
        break;
      }
      case 'close-panel':
        panel.close();
        break;
      case 'close-source':
        sourceDialog.close();
        break;
      case 'return-session':
        panel.close();
        break;
      case 'category':
        state.category = el.dataset.cat;
        render();
        break;
      case 'clear-filters':
        state.query = '';
        state.category = '全部';
        state.year = '';
        render();
        break;
      case 'jump-year':
        document
          .querySelector(`[data-year-group="${CSS.escape(el.dataset.year)}"]`)
          ?.scrollIntoView({ block: 'start' });
        break;
      case 'preview':
        showPreview();
        break;
      case 'print':
        get('paper-output').innerHTML = resumeSheet();
        window.print();
        break;
      case 'settings-back':
        if (state.settingsOrigin) history.back();
        else location.replace('#work');
        break;
      case 'retry-ai':
        retryAI(s, Number(el.dataset.index));
        break;
      case 'organize-existing':
        mutate(() => organizeExisting(s));
        break;
      case 'retry-workflow':
        mutate(async () => {
          await F.finishAutomatic(s, Number(el.dataset.index));
          refreshAIThread(s.id);
        });
        break;
      case 'about':
        closeMobileNav();
        openPanel(
          smallPanel(
            '关于拾页',
            `<p>拾页把一段经历的材料、补充和草稿放在一个会话里。收录后，卡片和时间线会同步更新。</p><p>原件保存在本机工作区。你可以在设置中连接 AI 或导出工作区迁移包。</p><button class="primary" data-act="close-panel">知道了</button>`,
          ),
        );
        break;
    }
  }
  async function dropEntries(items) {
    const getEntries = (entry) =>
      new Promise((resolve, reject) => entry.readEntries(resolve, reject));
    const combined = [];
    async function walk(entry, prefix) {
      if (entry.isFile) {
        const f = await new Promise((resolve, reject) =>
          entry.file(resolve, reject),
        );
        if (prefix)
          Object.defineProperty(f, 'webkitRelativePath', {
            value: prefix + f.name,
            configurable: true,
          });
        combined.push(f);
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        for (
          let children = await getEntries(reader);
          children.length;
          children = await getEntries(reader)
        ) {
          for (const child of children)
            await walk(child, prefix + entry.name + '/');
        }
      }
    }
    for (const entry of items) await walk(entry, '');
    return combined;
  }
  function canReceiveFiles() {
    return (
      Boolean(get('message-composer')) &&
      !get('main-content').inert &&
      !panel.open &&
      !sourceDialog.open &&
      !busy
    );
  }
  function syncWorkflowMode() {
    const mode = F.workflowMode();
    const picker = document.querySelector('[name="workflow-mode"]');
    if (picker) picker.value = mode;
    const help = document.querySelector('.composer-mode-help');
    if (help) {
      help.hidden = mode !== 'auto';
      help.textContent = UI.workflowHelp();
    }
    const tools = document.querySelector('.thread-tools');
    if (tools && current()) tools.innerHTML = UI.threadTools(current());
  }
  function bindEvents() {
    sidebar.addEventListener('beforetoggle', (event) => {
      const menu = event.target;
      if (!menu.matches('.session-menu') || event.newState !== 'open') return;
      const rect = menu.previousElementSibling.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(innerWidth - 154, rect.right - 146)) + 'px';
      menu.style.top = (rect.bottom + 94 <= innerHeight ? rect.bottom + 3 : rect.top - 88) + 'px';
    }, true);
    const closeChatMenu = () => sidebar.querySelector('.session-menu:popover-open')?.hidePopover();
    sidebar.addEventListener('scroll', closeChatMenu, true);
    window.addEventListener('resize', closeChatMenu);
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('storage', event => {
      if (event.key === F.workflowKey || event.key === null) syncWorkflowMode();
    });
    document.querySelector('.skip-link').addEventListener('click', (event) => {
      event.preventDefault();
      get('main-content').focus();
    });
    document.addEventListener('click', handleClick);
    for (const dlg of [panel, sourceDialog])
      dlg.addEventListener('click', (e) => {
        if (e.target !== dlg) return;
        const r = dlg.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dlg.close();
      });
    panel.addEventListener('close', () => {
      if (!panel.open) panel.replaceChildren();
    });
    sourceDialog.addEventListener('close', () => {
      if (!sourceDialog.open) {
        sourceRequest++;
        clearSource();
        sourceDialog.replaceChildren();
      }
    });
    document.addEventListener('input', (event) => {
      const el = event.target;
      if (el.id === 'home-note') {
        state.homeNote = el.value;
        syncComposer();
      }
      if (el.id === 'reply-note') {
        state.replyNote = el.value;
        syncComposer();
      }
      if (el.id === 'query') {
        state.query = el.value;
        renderResults();
      }
      if (el.id === 'print-name' || el.id === 'print-focus') {
        preview[el.id === 'print-name' ? 'name' : 'focus'] = el.value;
        syncPreview();
      }
    });
    document.addEventListener('change', (event) => {
      const el = event.target;
      if (el.id === 'transfer-file' && el.files?.length) {
        const file = el.files[0];
        el.value = '';
        mutate(async () => {
          const status = get('transfer-status');
          status.textContent = '正在校验迁移包并导入…';
          try {
            const count = await FolioTransfer.importWorkspace(file);
            render();
            status.textContent = '已导入 ' + count + ' 段经历和对应附件。';
          } catch (error) { status.textContent = error.message; }
        });
        return;
      }
      if (el.name === 'workflow-mode') {
        try {
          F.setWorkflowMode(el.value);
          syncWorkflowMode();
          notify(el.value === 'auto' ? '下次发送时将自动取舍材料并收录简历' : '下次发送时由你确认材料和简历');
        } catch { notify('整理方式未能保存，请重试。'); el.value = F.workflowMode(); }
      }
      if (el.name === 'resume-source') updateSourceCount(el.form);
      if (el.name === 'material-destination') {
        el.dataset.picked = '';
        syncMaterialCount(el.form);
      }
      if (el.id === 'file-picker' || el.id === 'folder-picker') {
        stageFiles([...el.files]);
        el.value = '';
      }
      if (el.id === 'year') {
        state.year = el.value;
        renderResults();
      }
      if (el.name === 'resume-entry') {
        if (el.checked) preview.selected.add(el.value);
        else preview.selected.delete(el.value);
        syncPreview();
      }
    });
    document.addEventListener('submit', (event) => {
      if (event.target.id === 'message-composer') {
        event.preventDefault();
        if (event.target.querySelector('[type="submit"]').disabled) return;
        mutate(state.page === 'work' ? create : reply);
      } else if (event.target.id === 'profile-form') {
        event.preventDefault();
        const data = new FormData(event.target);
        mutate(() => {
          F.saveProfile(data.get('name'), data.get('school'));
          panel.close();
          render();
          notify('个人信息已保存');
        });
      } else if (event.target.id === 'material-form') {
        event.preventDefault();
        if (busy) {
          event.target.querySelector('.form-error').textContent = '正在处理上一项操作，请稍后再保存。';
          return;
        }
        mutate(() => submitMaterials(event.target));
      } else if (event.target.id === 'manage-chat') {
        event.preventDefault();
        mutate(() => submitManageChat(event.target));
      } else if (event.target.id === 'edit-form') {
        event.preventDefault();
        mutate(() => saveEdit(event.target));
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mobileSidebarOpen) closeMobileNav();
      if (event.key === 'Escape') {
        const menu = document.querySelector('.attachment-menu[open]');
        if (menu) {
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        event.target.matches('#message-composer textarea')
      ) {
        event.preventDefault();
        if (!event.repeat) event.target.form.requestSubmit();
      }
    });
    document.addEventListener('paste', (event) => {
      if (!canReceiveFiles()) return;
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) {
        event.preventDefault();
        stageFiles(files);
      }
    });
    document.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!canReceiveFiles()) return;
      const area = document.querySelector('[data-drop-zone]');
      if (area) {
        area.classList.add('dragging');
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    document.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget)
        document.querySelector('.dragging')?.classList.remove('dragging');
    });
    document.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      document.querySelector('.dragging')?.classList.remove('dragging');
      if (!canReceiveFiles()) return;
      const target = location.hash;
      const entries = [...event.dataTransfer.items]
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);
      const direct = [...event.dataTransfer.files];
      try {
        const files = entries.some((e) => e.isDirectory)
          ? await dropEntries(entries)
          : direct;
        if (location.hash === target && canReceiveFiles()) stageFiles(files);
      } catch {
        notify('文件夹读取失败，请点加号后选择「添加文件夹」。');
      }
    });
  }
  async function start() {
    sidebarToggle.innerHTML = icon('panel', 22);
    try {
      desktopSidebarOpen =
        localStorage.getItem(sidebarPreferenceKey) !== 'closed';
    } catch {
      // Keep the default layout when the browser cannot load the preference.
    }
    sidebarToggle.addEventListener('click', toggleNav);
    narrowScreen.addEventListener('change', () => {
      mobileSidebarOpen = false;
      updateNavLayout();
    });
    updateNavLayout();
    await F.load();
    bindEvents();
    syncRoute();
    AI.connectionForSend().then(syncWorkflowMode);
    document.body.dataset.navReady = '';
  }
  start();
})();
