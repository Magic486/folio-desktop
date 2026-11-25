'use strict';
(function viewModule() {
  'use strict';
  const F = window.Folio;
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );
  const icons = {
    settings:
      '<path d="m9.3 3 .6-1h4.2l.6 2.2 1.7 1 2.2-.6 2.1 3.6-1.6 1.6v2l1.6 1.6-2.1 3.6-2.2-.6-1.7 1-.6 2.2H9.9l-.6-2.2-1.7-1-2.2.6-2.1-3.6 1.6-1.6v-2L3.3 8.2l2.1-3.6 2.2.6 1.7-1Z" transform="translate(0 1)"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    layers: '<path d="m3 8 9-5 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    stack:
      '<rect x="5" y="3" width="13" height="16" rx="2"/><path d="M9 7h5M9 11h6M9 15h3M20 7v12a3 3 0 0 1-3 3H9"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    timeline:
      '<path d="M6 2v3m0 5v4m0 5v3M12 7h8M12 16.5h6"/><circle cx="6" cy="7.5" r="2.5"/><circle cx="6" cy="16.5" r="2.5"/>',
    book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>',
    bubble:
      '<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 12h6"/>',
    clip: '<path d="m8 13 6.5-6.5a2.5 2.5 0 0 1 3.5 3.5l-8 8a4.3 4.3 0 0 1-6-6l9-9a3.8 3.8 0 0 1 5.5 0" transform="translate(1 1)"/>',
    folder:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h18"/>',
    award:
      '<circle cx="12" cy="8.5" r="5.5"/><path d="m8 13-2 8 6-3 6 3-2-8"/>',
    flag: '<path d="M5 21V4m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/>',
    heart:
      '<path d="M20.5 5.6a5.2 5.2 0 0 0-7.4 0L12 6.8l-1.1-1.2a5.2 5.2 0 0 0-7.4 7.4L12 21l8.5-8a5.2 5.2 0 0 0 0-7.4Z"/>',
    case: '<rect x="2.5" y="7" width="19" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c6 4 12 4 18 0M12 12v4"/>',
    file: '<path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h6"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    send: '<path d="M12 20V4m-6.5 6.5L12 4l6.5 6.5"/>',
    back: '<path d="M20 12H4m7-7-7 7 7 7"/>',
    chev: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    screen:
      '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    edit: '<path d="m4 15 11-11a2.5 2.5 0 0 1 3.5 3.5L7.5 18.5 3 20zM13 6l4 4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    leaf: '<path d="M20 3C11 2 3 5 4 13c1 8 12 9 15 0 1-3 0-6 1-10ZM4 21l11-13"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 14v6h18v-6"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    print:
      '<rect x="6" y="2" width="12" height="5" rx="1"/><path d="M6 17H3V8h18v9h-3M6 14h12v8H6ZM17 11h1"/>',
    lab: '<path d="M9 3h6m-5 0v6l-6 10a1.5 1.5 0 0 0 1.5 2h13a1.5 1.5 0 0 0 1.5-2L14 9V3M7 15h10"/>',
    link: '<path d="m10 14 4-4m-5 1-3 3a3.5 3.5 0 0 0 5 5l3-3m1-3 3-3a3.5 3.5 0 0 0-5-5l-3 3"/>',
    spark:
      '<path d="m12 2 2.1 6.9L21 11l-6.9 2.1L12 20l-2.1-6.9L3 11l6.9-2.1zM20 1v4m-2-2h4"/>',
    panel:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    person:
      '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.5 3.3-7 7.5-7s7.5 2.5 7.5 7"/>',
    tag: '<path d="M2.5 3h8l11 11-7.5 7.5L2.5 10V3Z"/><circle cx="7" cy="7" r="1"/>',
  };
  const icon = (name, size = 18) =>
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
  const tagInfo = (cat) => F.categories[cat] || F.categories['其他'];
  const catPill = (cat) =>
    `<span class="cat-pill ${tagInfo(cat).color}">${icon(tagInfo(cat).icon, 14)}${esc(cat)}</span>`;
  const status = (s) =>
    s.dirty ? (s.published ? '有待确认的更新' : '待确认') : '已收进简历';
  const bytes = (n) =>
    n < 1024
      ? `${n || 0} B`
      : n < 1048576
        ? `${Math.ceil(n / 1024)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  const fileFormat = (name) => {
    const m = name.match(/\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toUpperCase() : 'FILE';
  };
  const fileTone = (name) =>
    /\.pdf$/i.test(name)
      ? 'coral'
      : /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name)
        ? 'sage'
        : /\.(docx?|txt|md)$/i.test(name)
          ? 'sky'
          : 'honey';
  function tile(name, small = false) {
    return `<span class="file-tile ${fileTone(name)} ${small ? 'small' : ''}" aria-hidden="true"><i></i><b>${esc(fileFormat(name))}</b></span>`;
  }
  const sessionLink = (id) => `#session/${encodeURIComponent(id)}`;
  function recent() {
    return [...F.sessions.values()].filter((s) => !s.cardOnly).sort((a, b) =>
      b.updated.localeCompare(a.updated),
    );
  }
  const wordmark =
    '<a class="folio-wordmark" href="#work" aria-label="拾页，回到新会话"><img src="assets/folio.svg" alt="">拾页 <em>Folio</em></a>';
  function rail(state) {
    const chats = recent();
    const work = state.page === 'work' || state.page === 'session';
    const library = state.page === 'resume' || state.page === 'timeline';
    return `<div class="brand">${wordmark}</div>
      <a class="new-session" href="#work" data-act="new">${icon('plus', 19)}新建经历会话</a>
      <nav class="main-nav" aria-label="主要页面">
        <a href="#work" class="${work ? 'on' : ''}" ${work ? 'aria-current="page"' : ''}>${icon('bubble')}整理台</a>
        <a href="#resume" class="${library ? 'on' : ''}" ${library ? 'aria-current="page"' : ''}>${icon('book')}经历简历</a>
      </nav>
      <div class="rail-rule"></div><div class="rail-section-label"><span>历史会话</span><span>${chats.length}</span></div>
      <nav class="session-nav" aria-label="经历会话">${chats
        .map(
          (s) =>
            `<div class="session-item${state.id === s.id ? ' selected' : ''}">
              <a href="${sessionLink(s.id)}" title="${esc(F.conversationTitle(s))}"><span class="session-dot ${tagInfo(s.draft.category).color}"></span><span>${esc(F.conversationTitle(s))}</span></a>
              <button class="session-more" popovertarget="menu-${esc(s.id)}" aria-label="管理会话 ${esc(F.conversationTitle(s))}" title="管理会话">⋯</button>
              <div class="session-menu" id="menu-${esc(s.id)}" popover="auto">
                <button data-act="rename-session" data-session="${esc(s.id)}">${icon('edit', 15)}重命名</button>
                <button data-act="delete-session" data-session="${esc(s.id)}">${icon('close', 15)}删除会话</button>
              </div></div>`,
        )
        .join('')}</nav>
      <div class="rail-secondary"><button data-act="about">${icon('book', 15)}关于拾页</button></div>
      <div class="rail-foot"><a class="rail-settings" href="#settings" ${state.page === 'settings' ? 'aria-current="page"' : ''}>${icon('settings', 19)}设置</a></div>`;
  }
  function topbar(state) {
    const {name} = F.profile();
    const personal = `<button type="button" class="profile-button" data-act="profile" aria-label="个人信息" aria-haspopup="dialog" title="个人信息">${icon('person', 17)}<span>${esc(name || '个人信息')}</span></button>`;
    if (state.page === 'settings') {
      const from = state.settingsOrigin;
      const returnLabel = from.startsWith('#session/')
        ? '返回会话'
        : ({ '#resume': '返回简历', '#timeline': '返回时间线' })[from] || '返回整理台';
      return `<div class="breadcrumb"><span>个人工作区</span>${icon('chev', 13)}<h1>设置</h1></div>
        <div class="top-actions"><button type="button" class="settings-back" data-act="settings-back">${icon('back', 15)}${returnLabel}</button>${personal}</div>`;
    }
    if (state.page === 'work' || state.page === 'session') {
      const inThread = state.page === 'session';
      return `${wordmark}
        <nav class="agent-nav" aria-label="工作区">
          ${inThread ? `<a href="#work" data-act="new" aria-label="新会话" title="新会话">${icon('plus', 17)}<span>新会话</span></a>` : ''}
          ${personal}
        </nav>`;
    }
    return `<h1 class="sr-only">经历简历</h1>
      <div class="top-actions">
      <button type="button" class="soft-button" data-act="preview" aria-haspopup="dialog">${icon('eye', 16)}简历预览</button>${personal}</div>`;
  }
  function imageReading(src) {
    const r = src.pictureReadings?.[0];
    if (!r) return '';
    const label = {match: '获奖人署名与本人相符', other: '署名为其他人', unknown: '本人归属待核对'}[F.identityMatch(r)];
    return `<div class="image-reading"><strong>${esc(label || '图片识别结果')}</strong><p>${esc([r.names.join('、'), r.school, r.award].filter(Boolean).join(' · '))}</p>${r.text ? '<p>' + esc(r.text) + '</p>' : ''}</div>`;
  }
  function workflowPicker() {
    const auto = F.workflowMode() === 'auto';
    return `<select class="workflow-picker" aria-label="整理方式" name="workflow-mode" title="选择下次发送材料时的整理方式"><option value="manual" ${auto ? '' : 'selected'}>手动确认</option><option value="auto" ${auto ? 'selected' : ''}>全自动整理</option></select>`;
  }
  function settingsPage() {
    return `<div class="settings-page">
      <section class="settings-section" aria-labelledby="workflow-title"><header class="settings-section-heading"><h2 id="workflow-title">整理方式</h2></header>
        <div class="settings-section-body workflow-settings">${workflowPicker()}
        <p><strong>手动确认</strong>先选择材料去向，再核对草稿并收录。</p>
        <p><strong>全自动整理</strong>发送后自动选择附件、移除无用副本，并创建或更新简历卡片。归属不清或信息冲突时留在草稿。</p></div></section>
      <section class="settings-section" id="ai-settings" aria-labelledby="ai-settings-title">
        <header class="settings-section-heading">
          <h2 id="ai-settings-title">AI 连接</h2>
          <p class="connection-badge" hidden><span class="sr-only">当前整理方式</span><span data-connection-mode></span></p>
          <button type="button" class="inline-action" data-ai="local" hidden>切回本地整理</button>
        </header>
        <div class="settings-section-body"></div>
      </section>
      <section class="settings-section" aria-labelledby="transfer-title"><header class="settings-section-heading"><h2 id="transfer-title">工作区迁移</h2></header>
        <div class="settings-section-body"><p class="soft-copy">迁移包包含会话、简历卡片、附件和个人资料，可导入空工作区。AI 连接需在新设备单独设置。</p>
        <div class="connection-actions"><button type="button" class="soft-button" data-act="export-workspace">导出迁移包</button>
        <button type="button" class="soft-button" data-act="import-workspace">导入迁移包</button><input id="transfer-file" type="file" accept=".zip" hidden></div>
        <p class="soft-copy" id="transfer-status" role="status"></p></div></section>
    </div>`;
  }
  function staged(files) {
    if (!files.length) return '';
    return `<div class="staged"><div class="staged-label">${icon('clip', 14)}待提交材料 · ${files.length} 份</div><div class="staged-list">${files.map((f, i) => `<span class="staged-chip" title="${esc(f.webkitRelativePath || f.name)}">${tile(f.name, true)}<span>${esc(f.name)}</span><button type="button" data-act="unstage" data-index="${i}" aria-label="移除 ${esc(f.name)}">${icon('close', 13)}</button></span>`).join('')}</div></div>`;
  }
  function composer(state) {
    const home = state.page === 'work';
    const files = home ? state.homeFiles : state.replyFiles;
    const value = home ? state.homeNote : state.replyNote;
    const answering = !home && state.answering;
    const inputId = home ? 'home-note' : 'reply-note';
    const placeholder = home
      ? '说说这次经历，或把材料拖进来…'
      : answering
        ? '我负责了…，最后完成了…'
        : '继续补充这段经历，或拖入材料…';
    return `<form class="agent-composer" id="message-composer" data-drop-zone aria-label="${home ? '开始一段经历' : '回复会话'}">
      <div id="${home ? 'home-staged' : 'reply-staged'}" aria-live="polite">${staged(files)}</div>
      ${answering ? `<div class="reply-target"><span>写入个人贡献</span><button type="button" data-act="cancel-answer" aria-label="切换为普通消息">${icon('close', 13)}</button></div>` : ''}
      <label class="sr-only" for="${inputId}">${home ? '新会话消息' : '回复消息'}</label>
      <textarea id="${inputId}" rows="1" enterkeyhint="send" aria-describedby="send-help" placeholder="${placeholder}">${esc(value)}</textarea>
      <span class="sr-only" id="send-help">回车发送，Shift 加回车换行。也可以只发送附件。</span>
      <div class="composer-bar">
        <details class="attachment-menu">
          <summary aria-label="添加材料" title="添加材料">${icon('plus', 21)}</summary>
          <div class="attachment-options">
            <button type="button" data-act="files">${icon('clip', 17)}添加文件</button>
            <button type="button" data-act="folder">${icon('folder', 17)}添加文件夹</button>
          </div>
        </details>
        ${workflowPicker()}
        <button type="submit" class="composer-send" id="${home ? 'create-btn' : 'reply-btn'}" aria-label="发送" title="发送（Enter）" ${files.length || value.trim() ? '' : 'disabled'}>${icon('send', 20)}</button>
      </div>
      <p class="composer-mode-help" ${F.workflowMode() === 'auto' ? '' : 'hidden'}>${workflowHelp()}</p>
      <div class="drop-hint" aria-hidden="true">${icon('clip', 19)}松开以添加材料</div>
    </form>`;
  }
  function home(state) {
    return `<section class="chat-start" aria-label="新会话"><h1 class="sr-only">新会话</h1>${composer(state)}</section>`;
  }
  const sourceButton = (s, src) =>
    `<button class="source-chip" data-act="source" data-session="${esc(s.id)}" data-source="${esc(src.id)}">${tile(src.name, true)}<span>${esc(src.name)}</span>${icon('eye', 13)}</button>`;
  function sourceRows(s, ids = s.sources.map((x) => x.id)) {
    const rows = ids
      .map((id) => s.sources.find((src) => src.id === id))
      .filter(Boolean);
    return rows.length
      ? `<div class="source-rows">${rows.map((src, i) => `<button data-act="source" data-session="${esc(s.id)}" data-source="${esc(src.id)}">${tile(src.name)}<span><strong>${esc(src.name)}</strong><small>材料 ${String(i + 1).padStart(2, '0')} · ${src.size ? bytes(src.size) : esc(fileFormat(src.name))}</small></span>${icon('eye', 17)}</button>`).join('')}</div>`
      : '<p class="soft-copy">暂无简历附件。</p>';
  }
  const ref = (s, r, key) => {
    const id = r.refs?.[key];
    const source = id && s.sources.find((src) => src.id === id);
    if (!source) return '';
    const ids = r === s.published?.record ? s.published.sourceIds : F.resumeSources(s);
    const number = ids.indexOf(id) + 1;
    return `<button class="ref" data-act="source" data-session="${esc(s.id)}" data-source="${esc(id)}" title="查看依据：${esc(source.name)}" aria-label="查看依据 ${number || ''} ${esc(source.name)}">${icon('link', 10)}${number || '原件'}</button>`;
  };
  function fields(s, r) {
    const field = (title, content) =>
      `<div><dt>${title}</dt><dd>${content}</dd></div>`;
    const activity = (r.start || r.end || !r.awarded)
      ? field('活动时间', esc(F.period(r)) + ref(s, r, r.start ? 'start' : 'end')) : '';
    const award = r.awarded ? field('颁证月份', esc(F.fmt(r.awarded)) + ref(s, r, 'awarded')) : '';
    return `<dl class="fact-list">${activity}${award}${field('我的角色', esc(r.role || '待补充') + ref(s, r, 'role'))}${field('成果 / 奖项', esc(r.result || '待补充') + ref(s, r, 'result'))}</dl>`;
  }
  const fieldNames = {
    title: '名称',
    category: '分类',
    start: '开始月份',
    end: '结束月份',
    awarded: '颁证月份',
    role: '角色',
    result: '成果',
    contribution: '个人贡献',
    tags: '标签',
  };
  function userTurn(s, text, ids, index) {
    const sources = ids
      .map((id) => s.sources.find((src) => src.id === id))
      .filter(Boolean);
    const chips = sources.length
      ? `<div class="source-chips">${sources.map((src) => sourceButton(s, src)).join('')}</div>`
      : '';
    const noteAction = !text || F.autoCommand(text)
      ? ''
      : s.draft.contribution === text
        ? '<span class="note-stored">已写入个人贡献</span>'
        : `<button class="inline-action" data-act="use-note" data-index="${index}">用作个人贡献</button>`;
    return `<div class="user-turn" aria-label="你的消息">
      <div class="user-bubble">${text ? `<p>${esc(text)}</p>` : ''}${chips}${s.messages[index].removed ? `<small>已清理 ${s.messages[index].removed} 份材料</small>` : ''}</div>${noteAction}
    </div>`;
  }
  function assistantTurn(content, ask) {
    return `<div class="agent-turn" aria-label="拾页的回复">
      <div class="agent-name"><img src="assets/folio.svg" alt="">拾页</div>
      <p>${content}</p>
      ${ask ? `<div class="followup"><strong>你具体完成了哪一部分？</strong><div class="followup-actions"><button class="inline-action" data-act="answer">填写我的贡献</button></div></div>` : ''}
    </div>`;
  }
  function workflowHelp() {
    return window.FolioAI.currentMode === 'local'
      ? '当前仅使用本地规则。读取图片、PDF 和 Word 的内容需要在设置中连接 AI。'
      : '发送后自动选择附件，并收录或更新简历。';
  }
  function workflowReceipt(m, s, latest) {
    const w = m.workflow;
    const localDraft = !m.ai && w.status === 'draft' && s.sources.length > 0;
    const labels = { created: '已自动创建简历卡片', updated: '已自动更新简历卡片', current: '已核对，简历卡片已是最新', draft: '简历草稿待核对' };
    return `<div class="workflow-receipt"><strong>${icon(w.status === 'draft' ? 'edit' : 'check', 15)}${w.needsAI ? '等待 AI 读取附件' : labels[w.status]}</strong>
      <p>${w.status === 'draft' ? '草稿附件' : '简历附件'} ${w.attached} 份 · 仅留会话 ${w.chat} 份 · 本次移除 ${w.removed.length} 份</p>
      ${w.removed.length ? `<details><summary>查看已移除的副本</summary><ul>${w.removed.map(name => `<li>${esc(name)}</li>`).join('')}</ul></details>` : ''}
      ${w.reason ? `<p>${esc(w.reason)}</p>` : ''}
      ${latest && localDraft ? '<p><button class="soft-button" data-act="organize-existing">用 AI 整理已有材料</button></p>' : ''}
      ${latest ? `<p>${s.sources.length ? '<button class="inline-action" data-act="materials">查看材料取舍</button>' : ''}<button class="inline-action" data-act="${s.dirty ? 'draft' : 'detail'}">${s.dirty ? '核对简历草稿' : '查看已收录版本'}</button></p>` : ''}</div>`;
  }
  function messages(s) {
    const turns = [];
    const last = s.messages.findLast(m => m.type === 'turn');
    const firstNew = s.messages.findIndex((m) => m.type === 'turn');
    const legacyCount = firstNew < 0 ? s.messages.length : firstNew;
    const ask = !s.draft.contribution && s.sources.length > 0;
    const conflict = (fields) =>
      `${esc(fields.map((key) => fieldNames[key] || key).join('、'))} 有不同写法，请结合原件核对。`;
    s.messages.forEach((m, i) => {
      if (m.type === 'turn') {
        turns.push(userTurn(s, m.text, m.ids, i));
        if (m.ai) {
          const pending = window.FolioAI.running.get(s.id) === i;
          if (m.ai.status === 'done') {
            const notes = (m.ai.notes || [])
              .map((n) => `<small class="ai-reading-note">${esc(n)}</small>`)
              .join('');
            const clips = (m.ai.clips || []).map((c, k) => s.sources.some(src => src.id === c.sourceId)
              ? `<button class="inline-action" data-act="crop" data-turn="${i}" data-clip="${k}" data-image="${c.image}" data-source="${esc(c.sourceId)}">提取图 ${c.image}${c.label ? ' · ' + esc(c.label) : ''}</button>` : '').join(' ');
            turns.push(assistantTurn(esc(m.ai.reply) + notes + (clips ? '<span class="clip-links">' + clips + '</span>' : ''), false));
            if (m.workflow) turns.push(workflowReceipt(m, s, m === last));
          } else if (pending) {
            turns.push(assistantTurn(m.ai.status === 'finishing' ? '正在完成材料取舍和简历整理…' : '正在整理这段经历…', false));
          } else {
            const message = m.ai.error || '上次整理中断，消息和材料已保存。';
            turns.push(
              assistantTurn(
                `${esc(message)} <button class="inline-action" data-act="retry-ai" data-index="${i}">重新整理</button>`,
                false,
              ),
            );
          }
          return;
        }
        const reply = m.workflowMode === 'auto'
          ? '本轮由本地规则整理。'
          : m.contribution
          ? '已把你的补充写入经历草稿的「个人贡献」。'
          : m.ids.length
            ? `已将这 ${m.ids.length} 份材料收进当前会话。点文件名可以查看原件。`
            : m.removed ? '这批材料已完成取舍。' : '已记下这段描述。你可以继续发这次经历的材料。';
        turns.push(
          assistantTurn(
            reply + (m.conflicts?.length ? ' ' + conflict(m.conflicts) : ''),
            ask && m.workflowMode !== 'auto' && i === s.messages.length - 1,
          ),
        );
        if (m.workflow) turns.push(workflowReceipt(m, s, m === last));
        else if (m.workflowMode === 'auto' && i === s.messages.length - 1)
          turns.push('<div class="system-note">自动整理尚未完成。<button class="inline-action" data-act="retry-workflow" data-index="' + i + '">继续自动整理</button></div>');
      } else if (m.type === 'files' || m.type === 'note') {
        turns.push(userTurn(s, m.text || '', m.ids || [], i));
        const picture = m.ids?.length === 1 && s.sources.find(src => src.id === m.ids[0]);
        const clip = picture?.origin;
        if (clip) {
          turns.push(assistantTurn(`已从《${esc(clip.name)}》${clip.image ? '的图 ' + clip.image : ''}${clip.rect ? '裁剪选区' : '提取整图'}，并保存为证明附件。`, false));
          if (picture.pictureReadings?.[0]) turns.push(imageReading(picture));
        }
      } else if (m.type === 'conflict') {
        turns.push(
          `<div class="system-note">${icon('flag', 15)}${conflict(m.fields)}</div>`,
        );
      } else if (m.type === 'reviewed') {
        turns.push(
          `<div class="system-note">${icon('check', 15)}已将确认的版本收进简历。</div>`,
        );
      }
      if (i + 1 === legacyCount) {
        const summary = '这段经历的材料和草稿已就绪，可以在这里继续补充。';
        turns.push(
          assistantTurn(summary, ask && i === s.messages.length - 1),
        );
      }
    });
    if (!window.FolioAI.running.has(s.id) && (!last?.ai || last.ai.status === 'done') && !last?.workflow && last?.workflowMode !== 'auto') {
      const attachments = F.resumeSources(s).length;
      const locked = F.protectedSources(s);
      const discard = s.sources.filter(src => F.materialReview(s, src, locked).kind === 'discard').length;
      const material = s.sources.length ? `当前${s.dirty ? '草稿' : '卡片'}有 ${s.dirty ? attachments : s.published.sourceIds.length} 份附件${discard ? '，另有 ' + discard + ' 份材料建议移除' : ''}。点<button class="inline-action" data-act="materials">材料取舍</button>调整每份文件的去向。` : '';
      const version = s.dirty
        ? `打开<button class="inline-action" data-act="draft">核对简历草稿</button>，确认后${s.published ? '更新已收录的卡片' : '加入经历简历'}。`
        : '打开<button class="inline-action" data-act="detail">查看已收录版本</button>，核对当前简历里的内容和附件。';
      turns.push(`<div class="workflow-guide"><strong>${icon('stack',15)}${s.dirty ? '接下来，核对这段经历' : '这段经历已收录'}</strong><p>${material}${version}</p></div>`);
    }
    return turns.join('');
  }
  function threadTools(s) {
    const count = s.sources.length;
    const automatic = F.workflowMode() === 'auto';
    const action = s.published ? 'detail' : 'draft';
    const title = s.published ? '查看已收录版本' : '核对简历草稿';
    const materialsHint = automatic ? '由 Agent 自动取舍' : count ? count + ' 份材料 · 选择简历附件' : '发送文件后可选附件';
    const versionHint = automatic ? '由 Agent 自动收录或更新' : s.published ? (s.dirty ? '有待核对的草稿更新' : '查看卡片内容和附件') : '确认后生成简历卡片';
    return `<button class="workflow-tool" data-act="materials" aria-label="材料取舍" aria-describedby="materials-hint" ${automatic || !count ? 'disabled' : ''}>${icon('folder',20)}<span><strong>材料取舍</strong><small id="materials-hint">${materialsHint}</small></span>${icon('chev',14)}</button>
      <button class="workflow-tool version-tool" data-act="${action}" aria-label="${title}" aria-describedby="version-hint" ${automatic ? 'disabled' : ''}>${icon('book',20)}<span><strong>${title}</strong><small id="version-hint">${versionHint}</small></span>${icon('chev',14)}</button>`;
  }
  function sessionPage(state, s) {
    return `<section class="chat-thread" aria-label="经历会话">
      <header class="thread-head"><div><h1>${esc(F.conversationTitle(s))}</h1></div>
        <nav class="thread-tools" aria-label="材料和简历">${threadTools(s)}</nav></header>
      <div class="conversation-turns" role="log" aria-label="会话消息" aria-live="polite">${messages(s)}</div>
      ${composer(state)}
    </section>`;
  }
  function materialPanel(s, publishing, reading) {
    const locked = F.protectedSources(s, false);
    const attachments = new Set(F.resumeSources(s));
    const groups = { keep: [], review: [], discard: [] };
    for (const src of s.sources) {
      const review = F.materialReview(s, src, locked);
      groups[review.kind].push({ src, review });
    }
    const labels = { keep: '证明与附件', review: '其他材料', discard: '建议移除' };
    const section = (kind) => groups[kind].length ? `<details class="material-group" ${kind === 'discard' || s.sources.length <= 8 ? 'open' : ''}>
      <summary>${labels[kind]} <small>${groups[kind].length}</small></summary>
      ${groups[kind].map(({src, review}) => {
        const suggestRemoval = kind === 'discard' && !s.resumeSources?.includes(src.id);
        const choice = suggestRemoval ? 'remove' : attachments.has(src.id) ? 'attach' : 'chat';
        return `<div class="material-row">
          <label for="destination-${esc(src.id)}"><strong>${esc(src.name)}</strong><small>${esc(review.reason)}</small>${src.path && src.path !== src.name ? `<small>${esc(src.path)}</small>` : ''}</label>
          <select id="destination-${esc(src.id)}" name="material-destination" data-source="${esc(src.id)}" ${review.locked ? 'data-locked' : ''} ${review.locked || reading ? 'disabled' : ''}>
            <option value="attach" ${choice === 'attach' ? 'selected' : ''}>简历附件</option>
            <option value="chat" ${choice === 'chat' ? 'selected' : ''}>仅留会话</option>
            <option value="remove" ${choice === 'remove' ? 'selected' : ''}>移除副本</option></select>
          <button type="button" class="icon-btn" data-act="source" data-session="${esc(s.id)}" data-source="${esc(src.id)}" aria-label="预览${esc(src.name)}">${icon('eye',16)}</button></div>`;
      }).join('')}</details>` : '';
    return `<form id="material-form" class="edit-form" data-session="${esc(s.id)}" data-revision="${s.revision}" ${publishing ? 'data-publish' : ''}>
      <h2 id="panel-title">材料取舍</h2><p class="soft-copy">给每份材料选一个去向。简历附件随草稿收录。移除副本只清理本次会话，电脑上的原文件仍会保留。</p>
      ${reading ? `<p class="material-reading" role="status">${esc(reading)}</p>` :
        window.FolioAI.reviewBatch(s, s.sources.filter(src => !src.review && !locked.has(src.id)).map(src => src.id)).length
        ? '<button class="quiet-button material-read" type="button" data-act="read-materials">用 AI 判读剩余材料</button>' : ''}
      <div class="material-list">${Object.keys(groups).map(section).join('')}</div>
      <p class="material-count" id="material-count" role="status"></p><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="soft-button" data-act="close-panel">取消</button><button type="submit" class="primary" aria-describedby="material-count" ${reading ? 'disabled' : ''}>${publishing ? '保存并收录' : '保存选择'}</button></div></form>`;
  }
  function materialResult(s, removed) {
    const ids = new Set(F.resumeSources(s));
    const groups = [['简历附件', s.sources.filter(src => ids.has(src.id))],
      ['仅留会话', s.sources.filter(src => !ids.has(src.id))], ['已移除副本', removed]];
    return `<div class="edit-form"><h2 id="panel-title">材料选择已保存</h2><div class="material-list">${groups.map(([label, files]) =>
      `<details class="material-group" ${files.length && files.length <= 8 ? 'open' : ''}><summary>${label} <small>${files.length} 份</small></summary>${files.length ? `<ul class="material-result-files">${files.map(src => `<li>${esc(src.name)}</li>`).join('')}</ul>` : ''}</details>`).join('')}</div>
      <div class="modal-actions"><button type="button" class="soft-button" data-act="close-panel">完成</button>
      <button type="button" class="primary" data-act="${s.dirty ? 'draft' : 'detail'}" data-session="${esc(s.id)}">${s.dirty ? '核对简历草稿' : '查看已收录版本'}</button></div></div>`;
  }
  function draft(s) {
    const r = s.draft;
    const ids = F.resumeSources(s);
    return `<div class="panel-head"><span>${icon('stack', 16)}经历草稿</span><button class="icon-btn" data-act="close-panel" aria-label="关闭草稿">${icon('close')}</button></div>
      <div class="detail-body"><div class="title-meta">${catPill(r.category)}<span class="status ${s.dirty ? 'pending' : ''}">${esc(status(s))}</span></div>
        <h2 id="panel-title">${esc(r.title)}</h2>${fields(s, r)}
        <h3>个人贡献 ${ref(s, r, 'contribution')}</h3><p class="body-text">${esc(r.contribution || '等待补充')}</p>
        ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="draft-actions"><button class="primary full" data-act="${s.dirty ? 'confirm' : 'detail'}" data-session="${esc(s.id)}">${icon(s.dirty ? 'check' : 'book', 16)}${s.dirty ? (s.published ? '确认并更新简历' : '确认并加入简历') : '查看简历卡片'}</button>
        <button class="quiet-button full" data-act="edit" data-session="${esc(s.id)}">${icon('edit', 14)}编辑草稿</button></div>
        <div class="detail-sources"><h3>简历附件 <small>${ids.length}</small></h3>${sourceRows(s, ids)}</div>
      </div>`;
  }
  function matchesFilters(state, r) {
    if (state.category !== '全部' && r.category !== state.category) return false;
    const year = F.recordMonth(r).slice(0, 4) || '待补充';
    if (state.year && state.year !== year) return false;
    const query = state.query.trim().toLocaleLowerCase();
    return !query || [r.title, r.role, r.result, r.contribution, r.category, ...r.tags]
      .join(' ').toLocaleLowerCase().includes(query);
  }
  function rows(state) {
    return [...F.sessions.values()]
      .filter((s) => s.published && matchesFilters(state, s.published.record))
      .sort((a, b) => F.dateSort(a.published.record, b.published.record));
  }
  function cover(r) {
    const c = tagInfo(r.category);
    return `<div class="cover ${c.color}" aria-hidden="true"><div class="cover-pattern"></div><div class="cover-art"><i></i><i></i><i></i><i></i></div><span class="cover-symbol">${icon(c.icon, 27)}</span></div>`;
  }
  function archiveCard(s) {
    const r = s.published.record;
    return `<button class="archive-card" data-act="detail" data-session="${esc(s.id)}" aria-label="查看详情：${esc(r.title)}">
      ${cover(r)}<span class="card-content"><span class="card-top"><span class="category-text ${tagInfo(r.category).color}">${esc(r.category)}</span></span>
      <strong class="card-title">${esc(r.title)}</strong><span class="card-dates">${icon('cal', 14)}${esc(F.period(r))}</span><span class="card-result">${esc(r.result || r.contribution || r.role || '查看经历详情')}</span>
      <span class="card-foot"><span>${r.role ? esc(r.role) : '角色待补充'}</span><span>${icon('clip', 13)}${s.published.sourceIds.length}</span></span></span></button>`;
  }
  function timeline(list) {
    const groups = new Map();
    for (const s of list) {
      const r = s.published.record,
        year = F.recordMonth(r).slice(0, 4) || '时间待补充';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(s);
    }
    return `<div class="timeline-layout"><nav class="year-nav" aria-label="时间线年份">${[...groups.keys()].map((y) => `<button data-act="jump-year" data-year="${esc(y)}">${esc(y)}</button>`).join('')}</nav><div class="timeline-groups">
      ${[...groups]
        .map(
          ([
            year,
            items,
          ]) => `<section class="year-group" data-year-group="${esc(year)}"><div class="year-heading"><h3>${esc(year)}</h3><span>${items.length} 段经历</span></div>
        ${items
          .map((s) => {
            const r = s.published.record,
              month = F.recordMonth(r).slice(5);
            return `<div class="time-row"><span class="month">${month ? esc(month) + ' 月' : '待补'}</span><span class="time-track"><i class="${tagInfo(r.category).color}"></i></span><button class="time-card" data-act="detail" data-session="${esc(s.id)}"><span class="time-meta">${catPill(r.category)}</span><strong>${esc(r.title)}</strong><span class="time-summary">${esc(r.result || r.contribution || r.role || '查看详情')}</span><small>${esc(F.period(r))}${r.role ? ' · ' + esc(r.role) : ''}</small></button></div>`;
          })
          .join('')}</section>`,
        )
        .join('')}</div></div>`;
  }
  function results(state) {
    const list = rows(state);
    const pending = recent().filter((s) =>
      s.dirty && matchesFilters(state, s.draft));
    const queue = pending.length ? `<section class="review-queue" aria-label="待确认草稿">
      <h2>待确认草稿 <small>${pending.length}</small></h2>${pending.map((s) =>
        `<button data-act="draft" data-session="${esc(s.id)}"><span>${esc(s.draft.title)} </span><small>${s.published ? '核对更新' : '核对并收录'} ${icon('chev', 13)}</small></button>`).join('')}</section>` : '';
    const label = queue + `<div class="results-head"><span>已收录 <b>${list.length}</b> 段经历</span><small>${state.page === 'timeline' ? '最近的经历在前' : '已确认版本'}</small></div>`;
    if (!list.length)
      return pending.length ? label : (
        label +
        `<div class="empty">${icon('folder', 28)}<h3>这里还没有匹配的经历</h3><p>可以调整筛选，或从整理会话确认一段新经历。</p><button class="soft-button" data-act="clear-filters">清除筛选</button></div>`
      );
    return (
      label +
      (state.page === 'timeline'
        ? timeline(list)
        : `<div class="archive-grid">${list.map(archiveCard).join('')}</div>`)
    );
  }
  function library(state) {
    const records = [];
    for (const s of F.sessions.values()) {
      if (s.published) records.push(s.published.record);
      if (s.dirty) records.push(s.draft);
    }
    const years = [
      ...new Set(
        records.map((r) => F.recordMonth(r).slice(0, 4) || '待补充'),
      ),
    ].sort((a, b) => b.localeCompare(a));
    const categories = Object.keys(F.categories).filter(
      (c) =>
        records.some((r) => r.category === c) ||
        state.category === c,
    );
    return `<div class="page library-page">
      <div class="library-tools"><div class="mode-switch" aria-label="展示方式"><a href="#resume" class="${state.page === 'resume' ? 'active' : ''}" ${state.page === 'resume' ? 'aria-current="page"' : ''}>${icon('grid', 15)}卡片</a><a href="#timeline" class="${state.page === 'timeline' ? 'active' : ''}" ${state.page === 'timeline' ? 'aria-current="page"' : ''}>${icon('timeline', 16)}时间线</a></div>
        <div class="filter-inputs"><label class="search-box">${icon('search', 15)}<input id="query" type="search" placeholder="搜索经历、角色或标签" aria-label="搜索经历、角色或标签" value="${esc(state.query)}"></label><label class="year-select"><select id="year" aria-label="按经历年份筛选"><option value="">所有年份</option>${years.map((y) => `<option ${state.year === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>${icon('down', 12)}</label></div></div>
      <div class="filter-line"><div class="filter-chips">${['全部', ...categories].map((c) => `<button data-act="category" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${esc(c)}</button>`).join('')}</div>
      </div>
      <div id="library-results">${results(state)}</div></div>`;
  }
  function detail(s) {
    const r = s.published.record;
    return `<div class="modal-handle"></div><div class="panel-head"><span>${icon('book', 16)}经历详情</span><button class="icon-btn" data-act="close-panel" aria-label="关闭详情">${icon('close')}</button></div>
      ${cover(r)}<div class="detail-body"><div class="title-meta">${catPill(r.category)}</div><h2 id="panel-title">${esc(r.title)}</h2>${fields(s, r)}
      <h3>个人贡献 ${ref(s, r, 'contribution')}</h3><p class="body-text">${esc(r.contribution || '暂未填写')}</p>
      ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="card-actions">${!s.cardOnly && s.dirty ? `<button class="primary" data-act="draft" data-session="${esc(s.id)}">核对草稿更新</button>` : ''}<button class="${s.dirty ? 'quiet-button' : 'primary'}" data-act="edit-card" data-session="${esc(s.id)}">${icon('edit', 15)}编辑卡片</button>
      ${s.cardOnly ? '' : `<a class="quiet-button" href="${sessionLink(s.id)}" data-act="return-session">${icon('bubble', 16)}回到会话补充</a>`}</div>
      <div class="detail-sources"><h3>原始材料 <small>${s.published.sourceIds.length}</small></h3>${sourceRows(s, s.published.sourceIds)}</div></div>`;
  }
  function attachmentPicker(s, ids) {
    if (!s.sources.length) return '';
    const selected = new Set(ids);
    const checkboxes = s.sources.map((src) => `<label>
      <input type="checkbox" name="resume-source" value="${esc(src.id)}" ${selected.has(src.id) ? 'checked' : ''}>
      <span>${esc(src.path || src.name)}</span></label>`).join('');
    return `<details class="attachment-picker"><summary>简历附件 <small data-source-count>${selected.size} / ${s.sources.length}</small></summary>
      <div class="pick-actions"><button type="button" class="inline-action" data-act="pick-all">全选</button><button type="button" class="inline-action" data-act="pick-none">清空选择</button></div>
      <div class="pick-list">${checkboxes}</div></details>`;
  }
  function editor(s, parentId = '', card = false) {
    const r = card ? s.published.record : s.draft;
    const heading = card ? '编辑简历卡片' : parentId ? '从材料另建经历' : '编辑经历草稿';
    const input = (key, label, value, type = 'text') =>
      `<label class="edit-field"><span>${label}</span><input type="${type}" name="${key}" value="${esc(value)}" ${key === 'title' ? 'required maxlength="200"' : ''}></label>`;
    return `<div class="panel-head"><span>${icon('edit', 17)}${card ? '经历简历' : '整理会话'}</span><button class="icon-btn" data-act="close-panel" aria-label="关闭编辑">${icon('close')}</button></div><form id="edit-form" class="edit-form" data-session="${esc(s.id)}" data-revision="${s.revision}" ${card ? 'data-card' : ''} ${parentId ? `data-parent="${esc(parentId)}" data-source="${esc(s.sources[0].id)}"` : ''}><h2 id="panel-title">${heading}</h2>
      ${input('title', '经历名称', r.title)}<div class="edit-grid"><label class="edit-field"><span>主分类</span><select name="category">${Object.keys(
        F.categories,
      )
        .map(
          (c) => `<option ${r.category === c ? 'selected' : ''}>${c}</option>`,
        )
        .join('')}</select></label>${input('role', '我的角色', r.role)}
      ${input('start', '开始月份', r.start, 'month')}${input('end', '结束月份', r.end, 'month')}</div>
      ${input('awarded', '颁证月份（选填）', r.awarded, 'month')}
      ${input('result', '成果 / 奖项', r.result)}<label class="edit-field"><span>个人贡献</span><textarea rows="3" name="contribution">${esc(r.contribution)}</textarea></label>
      ${input('tags', '技能标签（用顿号或逗号隔开）', r.tags.join('、'))}${attachmentPicker(s, card ? s.published.sourceIds : F.resumeSources(s))}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="soft-button" data-act="close-panel">取消</button><button type="submit" class="primary">${card ? '保存卡片' : parentId ? '创建独立草稿' : '保存草稿'}</button></div></form>`;
  }
  window.FolioUI = {
    workflowHelp,
    imageReading,
    esc,
    icon,
    tile,
    catPill,
    sourceRows,
    sessionLink,
    rail,
    topbar,
    settingsPage,
    home,
    messages,
    sessionPage,
    threadTools,
    materialPanel,
    materialResult,
    draft,
    detail,
    library,
    results,
    rows,
    editor,
    staged,
    fieldNames,
    bytes,
  };
})();
