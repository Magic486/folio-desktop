'use strict';
(function aiConnections() {
  const { esc } = window.FolioUI;
  const F = window.Folio;
  const running = new Map();
  let section = null;
  let settings = null;
  let desktop = false;
  let tab = 'chatgpt';
  let poll = null;
  let pendingChange = null;
  let operation = 0;
  let busy = false;
  let feedback = '';
  let serviceOrigin = '';

  async function findService(signal) {
    if (serviceOrigin) return serviceOrigin;
    if (location.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(location.hostname)) {
      throw new Error('请用「启动拾页」打开本机服务后再连接 AI。');
    }
    const origins = [location.origin];
    if (location.port === '52843') origins.push('http://' + location.hostname + ':52844');
    for (const origin of origins) {
      const probe = await fetch(origin + '/', { method: 'HEAD', cache: 'no-store', credentials: 'omit', signal });
      if (probe.ok && probe.headers.get('X-Folio-Service') === 'local') {
        serviceOrigin = origin;
        return origin;
      }
    }
    throw new Error('请用「启动拾页」打开本机服务后再连接 AI。');
  }

  async function request(path, data, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const origin = await findService(controller.signal);
      const response = await fetch(origin + '/api/' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          'X-Folio-Client': 'workspace',
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json')) {
        throw new Error('请用「启动拾页」打开本机服务后再连接 AI。');
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '请求未完成，请重试。');
      return result;
    } catch (error) {
      if (error.name === 'AbortError')
        throw new Error('等待连接超时，请稍后重试。');
      if (error instanceof TypeError) {
        serviceOrigin = '';
        throw new Error('无法连接本机服务，请重新打开「启动拾页」。');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function remember(value) {
    if ('desktop' in value) desktop = value.desktop;
    settings = value;
    try {
      localStorage.setItem('folio.ai.mode', value.mode);
    } catch {
      /* Optional offline status. */
    }
    return value;
  }

  async function connectionForSend() {
    try {
      return remember(await request('settings', undefined, 3500));
    } catch {
      if (settings) return settings;
      try {
        return { mode: localStorage.getItem('folio.ai.mode') || 'local' };
      } catch {
        return { mode: 'local' };
      }
    }
  }

  const modeName = (mode) =>
    ({ local: '仅本地整理', api: 'API 密钥', chatgpt: 'ChatGPT 订阅' })[mode] ||
    '仅本地整理';

  function updateMode() {
    const badge = section.querySelector('.connection-badge');
    badge.hidden = false;
    badge.classList.toggle('connected', settings.mode !== 'local');
    badge.querySelector('[data-connection-mode]').textContent = modeName(settings.mode);
    section.querySelector('[data-ai="local"]').hidden = settings.mode === 'local';
  }

  function renderSettings() {
    const s = settings;
    const selected = (v) => String(tab === v);
    const chat = tab === 'chatgpt';
    const active = s.mode === tab;
    const account = s.account;
    const apiForm = `<form id="api-connection-form" class="connection-form">
      <label class="edit-field"><span>API 密钥</span><input type="password" name="key" autocomplete="off" spellcheck="false" maxlength="4096" placeholder="${s.hasKey ? '已保存密钥，留空可继续使用' : '输入服务商提供的 API 密钥'}"></label>
      <label class="edit-field"><span>API 地址</span><input type="url" name="baseUrl" required spellcheck="false" value="${esc(s.baseUrl)}"></label>
      <label class="edit-field"><span>模型名称</span><input name="model" required maxlength="200" spellcheck="false" value="${esc(s.model)}"></label>
      <p class="connection-help">支持 OpenAI 和兼容 Chat Completions 的服务。验证会向所填地址发送一条简短的测试消息。</p>
      <div class="connection-actions"><button type="submit" class="primary">验证并使用</button>${s.apiReady ? '<button type="button" class="quiet-button" data-ai="forget-api">移除密钥</button>' : ''}</div>
    </form>`;
    const accountControls = s.loginUrl
      ? `<div class="connection-state">等待官方登录完成…</div><div class="connection-actions"><a href="${esc(s.loginUrl)}" target="_blank" rel="noopener noreferrer" class="primary">打开授权页面</a><button type="button" class="quiet-button" data-ai="cancel">取消登录</button></div>`
      : account
        ? `<div class="connection-state">已连接 · ${esc(account.plan)}</div><div class="connection-actions">${active ? '' : '<button class="primary" data-ai="use-account">使用此账号</button>'}<button class="quiet-button" data-ai="logout">断开账号</button></div>`
        : '<button type="button" class="primary" data-ai="login">登录 ChatGPT</button>';
    section.querySelector('.settings-section-body').innerHTML =
      `<h3 id="connection-options-label">连接方式</h3>
      <div class="connection-options" role="group" aria-labelledby="connection-options-label"><button type="button" data-ai="chatgpt" aria-pressed="${selected('chatgpt')}">ChatGPT 订阅</button><button type="button" data-ai="api" aria-pressed="${selected('api')}">API 密钥</button></div>
      ${chat ? `<p class="connection-description">在 OpenAI 官方页面登录，使用账号套餐可用的 Codex 额度。</p>${accountControls}` : apiForm}
      <p id="connection-feedback" role="status">${esc(feedback || (chat ? s.loginError : ''))}</p>
      <div class="connection-foot"><p>启用后，发送消息会将当前这段经历的描述和可读材料提交给所选服务。</p></div>`;
    updateMode();
    setBusy(busy);
  }

  function setBusy(value) {
    busy = value;
    section.querySelectorAll('button, input').forEach((el) => {
      el.disabled = value;
    });
  }

  function startPoll() {
    clearTimeout(poll);
    if (!section || !settings?.loginUrl) return;
    const version = operation;
    poll = setTimeout(async () => {
      if (version !== operation) return;
      try {
        const result = await request('settings');
        if (version !== operation) return;
        remember(result);
        if (!result.loginUrl) {
          feedback =
            result.loginError ||
            (result.mode === 'chatgpt' ? 'ChatGPT 已连接。' : '登录已结束。');
          if (tab === 'chatgpt') renderSettings();
          else {
            updateMode();
            section.querySelector('#connection-feedback').textContent = feedback;
          }
        }
        startPoll();
      } catch (error) {
        if (version !== operation) return;
        section.querySelector('#connection-feedback').textContent =
          error.message;
        startPoll();
      }
    }, 1800);
  }

  async function loadSettings() {
    const version = ++operation;
    busy = false;
    feedback = '';
    const body = section.querySelector('.settings-section-body');
    body.innerHTML = pendingChange
      ? '<p role="status">正在等待连接设置更新…</p>'
      : '<p role="status">正在读取连接设置…</p>';
    try {
      if (pendingChange) {
        const pendingError = await pendingChange.then(() => '', (error) => error.message);
        if (version !== operation) return;
        feedback = pendingError;
      }
      const result = await request('settings');
      if (version !== operation) return;
      remember(result);
      tab = result.loginUrl || result.mode !== 'api' ? 'chatgpt' : 'api';
      renderSettings();
      startPoll();
    } catch (error) {
      if (version === operation)
        body.innerHTML = `<p role="status">${esc(error.message)}</p><button class="soft-button" data-ai="refresh">重新连接</button>`;
    }
  }

  async function act(path, data, message, popup) {
    const version = ++operation;
    clearTimeout(poll);
    setBusy(true);
    const status = section.querySelector('#connection-feedback');
    status.textContent =
      path === 'api-key' ? '正在验证密钥和模型…' : '正在连接本机服务…';
    const change = request(path, data, path === 'api-key' ? 115000 : 40000);
    pendingChange = change;
    try {
      const result = await change;
      if (popup && !popup.closed) {
        if (result.loginUrl && version === operation)
          popup.location.replace(result.loginUrl);
        else popup.close();
      }
      if (version !== operation) return;
      remember(result);
      feedback = message;
      setBusy(false);
      renderSettings();
      startPoll();
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      if (version !== operation) return;
      setBusy(false);
      status.textContent = error.message;
      startPoll();
    } finally {
      if (pendingChange === change) pendingChange = null;
    }
  }

  function handleClick(event) {
    const action = event.target.closest('[data-ai]')?.dataset.ai;
    if (action === 'refresh') {
      loadSettings();
      return;
    }
    if (!action || busy) return;
    if (action === 'api' || action === 'chatgpt') {
      if (action !== tab) {
        tab = action;
        feedback = '';
        renderSettings();
        section.querySelector(`[data-ai="${tab}"]`)?.focus();
      }
    } else if (action === 'login') {
      const popup = desktop ? null : window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
      act('account/login', {}, '', popup);
    } else if (action === 'cancel') {
      act('account/cancel', {}, '已取消本次登录。');
    } else if (
      ['forget-api', 'use-account', 'logout', 'local'].includes(action)
    ) {
      const messages = {
        'forget-api': '已移除保存的密钥。',
        'use-account': '已使用 ChatGPT 订阅。',
        logout: '已断开拾页的账号连接。',
        local: '已切回本地整理。',
      };
      act('connection', { action }, messages[action]);
    }
  }
  function handleSubmit(event) {
    event.preventDefault();
    if (!busy && event.target.id === 'api-connection-form') {
      const data = Object.fromEntries(new FormData(event.target));
      act(
        'api-key',
        { ...data, revision: settings.revision },
        '验证成功，整理会话将使用这个模型。',
      );
    }
  }
  function mount(element) {
    section = element;
    section.addEventListener('click', handleClick);
    section.addEventListener('submit', handleSubmit);
    loadSettings();
  }
  function unmount() {
    if (!section) return;
    ++operation;
    clearTimeout(poll);
    section.removeEventListener('click', handleClick);
    section.removeEventListener('submit', handleSubmit);
    section = null;
  }

  function base64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () =>
        reject(new Error('材料读取失败，请重新选择文件。'));
      reader.readAsDataURL(file);
    });
  }

  const imageFile = name => /\.(png|jpe?g|webp|bmp|gif)$/i.test(name);
  async function readPictures(items, connection) {
    const readings = new Map();
    for (let start = 0; start < items.length; start += 4) {
      const group = items.slice(start, start + 4), files = [];
      for (const item of group) {
        const thumb = await FolioEvidence.thumbnail(await item.blob());
        files.push({id: item.id, name: '图片' + (files.length + 1) + '.jpg', data: await base64(thumb)});
      }
      const result = await request('organize', {
        task: 'readImages', mode: connection.mode, revision: connection.revision, files, draft: {}, history: [],
        message: connection.imageReading ? '逐图转录可见的署名、学校和奖项，保留原图编号。' :
          '逐图识别实际可见的证据。请把结果作为 JSON 数组写在 reply 字符串中。每项为 {"id":"对应材料的id","names":["图片上的获奖者或参赛者姓名"],"school":"获奖者学校","award":"奖项","text":"图中文字摘要","uncertain":false}。排除指导老师和颁奖人。署名不清、姓名和奖项对应多行时 uncertain 为 true。缺失字段用空字符串或空数组，不猜测。updates 留空。',
      }, 195000);
      let rows = result.readings;
      if (!Array.isArray(rows) && typeof result.reply === 'string') {
        try {rows = JSON.parse(result.reply.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));} catch { /* Report a readable recognition failure below. */ }
      }
      if (!Array.isArray(rows)) throw new Error('模型没有返回可核对的图像文字。请确认连接的模型支持图片，再重试。');
      for (const row of rows) {
        const source = files.find(f => f.id === row?.id);
        if (!source || !Array.isArray(row.names) || typeof row.text !== 'string' || typeof row.uncertain !== 'boolean' ||
          (result.notes || []).some(note => note.includes('《' + source.name + '》'))) continue;
        const clean = (value, n) => typeof value === 'string' ? value.trim().slice(0, n) : '';
        readings.set(row.id, {names: row.names.map(n => clean(n, 80)).filter(Boolean).slice(0, 60),
          school: clean(row.school, 120), award: clean(row.award, 180), text: clean(row.text, 700), uncertain: row.uncertain});
      }
    }
    return readings;
  }
  async function recognizeImage(src, connection) {
    if (connection.mode === 'local') throw new Error('请在设置中连接支持图片的 AI 模型，再识别这张图。');
    const results = await readPictures([{id: 'p1', blob: () => F.getBlob(src.id)}], connection);
    if (!results.has('p1')) throw new Error('图片未能识别，请打开原件核对或重试。');
    return results.get('p1');
  }
  function canRead(src) {
    return src.text !== undefined || (/\.docx$/i.test(src.name) && src.size <= FolioEvidence.wordLimit) || /\.(txt|md|csv|json|log)$/i.test(src.name) ||
      imageFile(src.name) || (src.size <= 6_000_000 && /\.(pdf|pptx)$/i.test(src.name));
  }
  function ordered(session, ids) {
    const byId = new Map(session.sources.map(src => [src.id, src]));
    const rank = src => !canRead(src) ? 3 : F.evidenceName(src.name) ? 0 : /作品|成果|论文|验收|签名|分工/.test(src.name) ? 1 : 2;
    return [...new Set(ids)].filter(id => byId.has(id)).sort((a, b) => rank(byId.get(a)) - rank(byId.get(b)));
  }
  function reviewBatch(session, ids) {
    const batch = [];
    let bytes = 0;
    const byId = new Map(session.sources.map(src => [src.id, src]));
    const protectedIds = F.protectedSources(session);
    for (const id of ordered(session, ids)) {
      const src = byId.get(id);
      if (src.review?.manual || !canRead(src)) continue;
      if (!src.review && F.materialReview(session, src, protectedIds).kind === 'discard') continue;
      const size = /\.(docx|txt|md|csv|json|log)$/i.test(src.name) || imageFile(src.name) ? 0 : src.size || 0;
      if (bytes + size > 11_000_000) continue;
      batch.push(id);
      bytes += size;
      if (batch.length === 6) break;
    }
    return batch;
  }
  async function analyze(session, index, connection, reviewIds) {
    const turn = reviewIds ? {text: '请逐份核对本批材料的归档价值，并补充其中有依据的经历信息。', ids: reviewIds, workflowMode: session.messages[index]?.workflowMode} : session.messages[index];
    const prior = session.messages.slice(0, index);
    const ids = reviewIds || [
      ...new Set([
        ...ordered(session, turn.ids || []),
        ...ordered(session, prior
          .slice()
          .reverse()
          .flatMap((m) => m.ids || [])),
      ]),
    ];
    const person = F.profile(), imagesRead = [], identity = [];
    const files = [], illustrations = [],
      notes = [];
    const bySourceId = new Map(session.sources.map(src => [src.id, src]));
    const photoMatches = new Map();
    if (person.name) {
      const activeIds = reviewIds || (turn.ids?.length ? turn.ids : ids.slice(0, 16));
      const photos = activeIds.map(id => bySourceId.get(id)).filter(src => src && imageFile(src.name));
      for (let start = 0; start < photos.length; start += 4) {
        const group = photos.slice(start, start + 4);
        const missing = group.filter(src => !src.pictureReadings?.[0]);
        let fresh = new Map();
        try {fresh = await readPictures(missing.map(src => ({id: src.id, blob: () => F.getBlob(src.id)})), connection);}
        catch (e) {notes.push('部分图片的署名未能核对。' + e.message);}
        for (const src of group) {
          const reading = src.pictureReadings?.[0] || fresh.get(src.id);
          if (reading && !src.pictureReadings?.[0]) imagesRead.push({id: src.id, number: 0, reading});
          const status = F.identityMatch(reading, person) || 'unknown';
          photoMatches.set(src.id, status);
          identity.push({sourceId: src.id, status, names: reading?.names, award: reading?.award});
        }
      }
      const rank = id => photoMatches.get(id) === 'match' ? 0 : photoMatches.get(id) === 'other' ? 2 : 1;
      ids.sort((a,b) => rank(a) - rank(b));
    }
    let bytes = 0;
    for (const id of ids.slice(0, 16)) {
      const source = session.sources.find((s) => s.id === id);
      if (!source) continue;
      const item = { id, name: source.name };
      files.push(item);
      if (source.text !== undefined) {
        item.text = source.text.slice(0, 10000);
        item.partial = source.text.length > item.text.length;
        continue;
      }
      if (
        !/\.(txt|md|csv|json|log|pdf|docx|pptx|png|jpe?g|webp|bmp|gif)$/i.test(
          source.name,
        ) ||
        files.length > 8
      ) {
        notes.push(`《${source.name}》本次仅提供了文件名。`);
        continue;
      }
      let blob = await F.getBlob(id);
      if (!blob && source.url && /^assets\/[\w.-]+$/.test(source.url)) {
        const response = await fetch(source.url);
        if (response.ok) blob = await response.blob();
      }
      if (!blob) {
        notes.push(`《${source.name}》的原件暂不可读。`);
        continue;
      }
      if (/\.docx$/i.test(source.name)) {
        try {
          const word = await FolioEvidence.readWord(blob, source.name);
          const candidates = word.images.filter(i => i.proof);
          if (!candidates.length && !word.financial) candidates.push(...word.images.filter(i => !/支付|发票|身份证|银行/.test(i.label)));
          if (person.name && candidates.length) {
            const scan = candidates;
            let scanError = false;
            // Read the signatures before revealing the profile to the model that summarizes the experience.
            for (let offset = 0; offset < scan.length; offset += 4) {
              const batch = scan.slice(offset, offset + 4);
              const missing = batch.filter(i => !source.pictureReadings?.[i.number]);
              let fresh = new Map();
              if (!scanError) {
                try { fresh = await readPictures(missing.map(i => ({id: 'p' + i.number, blob: () => word.image(i)})), connection); }
                catch (e) {scanError = true; notes.push('部分候选图未能识别。' + e.message);}
              }
              for (const i of batch) {
                const reading = source.pictureReadings?.[i.number] || fresh.get('p' + i.number);
                if (reading && !source.pictureReadings?.[i.number]) imagesRead.push({id, number: i.number, reading});
                i.match = F.identityMatch(reading, person) || 'unknown';
                if (reading) i.reading = reading;
                identity.push({sourceId: id, image: i.number, status: i.match, names: reading?.names, award: reading?.award});
              }
            }
            const rank = i => i.match === 'match' ? 0 : i.match === 'other' ? 2 : 1;
            candidates.sort((a,b) => rank(a) - rank(b));
            if (scan.length) {
              const matched = scan.filter(i => i.match === 'match');
              notes.push(matched.length ? `《${source.name}》中图 ${matched.map(i => i.number).join('、')} 的署名与${person.name}相符。${matched.length > 1 ? '请核对想收录的那张。' : ''}`
                : `《${source.name}》的 ${scan.length} 张候选图中，未能明确核对到${person.name}。`);
            }
          }
          const prefix = `正文含 ${word.images.length} 张可预览图片。${word.financial ? '已在本机筛出与经历有关的段落。' : ''}\n`;
          item.text = (prefix + word.aiText).slice(0, 10000);
          item.partial = !word.textComplete || (prefix.length + word.aiText.length > 10000) || !word.aiText.trim();
          let count = 0;
          for (const image of candidates.slice(0, 2)) {
            if (illustrations.length >= 4) break;
            try {
              const thumb = await FolioEvidence.thumbnail(await word.image(image));
              if (bytes + thumb.size > 11_000_000) break;
              const entry = {id: id + '/image/' + image.number, name: source.name + ' · 图 ' + image.number + '.jpg', data: await base64(thumb)};
              illustrations.push({entry, sourceId: id, image: image.number, proof: image.proof, match: image.match, reading: image.reading});
              bytes += thumb.size;
              count++;
            } catch { /* Other images and the text can still be read. */ }
          }
          if (word.images.length) notes.push(`《${source.name}》有 ${word.images.length} 张可预览图片，本轮提交了 ${count} 张供 AI 判读。打开原件可框选，也可回复“提取图 1”这样的指令保存整图。`);
        } catch (error) {notes.push(`《${source.name}》正文读取失败：${error.message}`);}
        continue;
      }
      if (/\.(txt|md|csv|log|json)$/i.test(source.name)) {
        const content = await blob.slice(0, 40000).text();
        item.text = content.slice(0, 10000);
        item.partial = blob.size > 40000 || content.length > 10000;
        continue;
      }
      if (imageFile(source.name) && (person.name || blob.size > 6_000_000)) {
        try {
          if (person.name && !photoMatches.has(id)) {
            const reading = source.pictureReadings?.[0] || await recognizeImage(source, connection);
            if (!source.pictureReadings?.[0]) imagesRead.push({id, number: 0, reading});
            identity.push({sourceId: id, status: F.identityMatch(reading, person), ...reading});
          }
        } catch (e) {
          identity.push({sourceId: id, status: 'unknown'});
          notes.push(`《${source.name}》署名未能核对。${e.message}`);
        }
        if (blob.size > 6_000_000 || bytes + blob.size > 11_000_000) blob = await FolioEvidence.thumbnail(blob);
        if (blob.type === 'image/jpeg' && !/\.jpe?g$/i.test(item.name)) item.name += '.jpg';
      }
      if (blob.size > 6_000_000 || bytes + blob.size > 11_000_000) {
        notes.push(`《${source.name}》超出本次读取大小，仅提供了文件名。`);
        continue;
      }
      bytes += blob.size;
      item.data = await base64(blob);
    }
    if (ids.length > 16) notes.push('草稿首轮参考了优先排序的前 16 份材料。');
    files.splice(16 - illustrations.length);
    const attached = new Set(files.map(file => file.id));
    const included = illustrations.filter(pic => attached.has(pic.sourceId));
    files.unshift(...included.map(pic => pic.entry));
    const history = prior
      .filter((m) => m.text || m.ai?.reply)
      .slice(-12)
      .map((m) => ({
        user: (m.text || '').slice(0, 2400),
        assistant: (m.ai?.reply || '').slice(0, 1800),
      }));
    const result = await request(
      'organize',
      {
        mode: connection.mode,
        revision: connection.revision,
        draft: {
          ...session.draft,
          workspaceStatus: {
            待澄清: session.workflowHold || '',
            ...(!connection.workflowReview && turn.workflowMode === 'auto' ? {
              收录判断: '在 reply 最后一行写【收录判断】可收录，或【收录判断】后接需要用户澄清的具体冲突。日期、标签等可选项缺失不影响收录。最终材料去向和卡片状态由应用呈现。',
            } : {}),
            ...(person.name ? {个人信息: person, 署名核对: identity.map(row => ({...row, text: undefined})),
              归属规则: '仅用获得者署名确实相符且单位无冲突的证据推断本人奖项。match 表示署名相符，other 是其他人，unknown 待核对。不得把同校、导师、不同队伍的奖项算给本人。存在歧义时问一个具体问题。'} : {}),
            current: session.published
              ? (session.dirty ? '已收录，有待确认更新' : '已收录')
              : '仅草稿，尚未收录进简历',
            actions: turn.workflowMode === 'auto'
              ? '本轮为全自动整理。应用将在全部材料分析完成后选择附件并收录或更新卡片。回复只说明已读内容和待核对事实，最终收录状态由应用展示。'
              : '本轮只补充草稿。应用会引导用户选择材料并核对简历。',
            取图工具: 'Word 的候选配图已单独提供，图号对应原件。请读图核对署名与奖项。用户可以在原件中保存整图或框选。不同队伍或奖次请分别列出，身份不明时请用户选队。不要声称附件已经保存。',
            ...(!connection.materialReview && files.length ? {
              材料核对: '请在 reply 自然回复末尾逐行列出实际读到的材料，格式为【保留 1】理由、【待核对 2】理由或【可舍弃 3】理由，数字为 materials 的顺序（从1起）。证书、公示、作品和个人贡献证明优先保留。只对明确无证据价值的空白模板或通用说明建议舍弃，不凭文件名判断。',
            } : {}),
          },
        },
        history,
        message: (turn.text || '').slice(0, 16000),
        files,
      },
      195000,
    );
    const readingNotes = result.notes || [];
    if (!connection.workflowReview && turn.workflowMode === 'auto' && typeof result.reviewReason !== 'string') {
      const verdict = result.reply.match(/(?:^|\n)\s*【收录判断】[：:\s]*([^\n]+)\s*$/);
      result.reviewReason = verdict ? (/^可收录[。.]?$/.test(verdict[1].trim()) ? '' : verdict[1].trim().slice(0, 240)) : '本轮未获得明确的收录判断，请核对草稿。';
      if (verdict) result.reply = result.reply.slice(0, verdict.index).trim() || '已整理本轮材料。';
    }
    result.imagesRead = imagesRead;
    result.person = person;
    const suggested = Array.isArray(result.clips) ? result.clips : [];
    const actualImages = included.filter(pic => !readingNotes.some(n => n.includes('《' + pic.entry.name + '》')));
    result.clips = actualImages.flatMap(pic => {
      const hint = suggested.find(h => h?.imageId === pic.entry.id);
      if (pic.match === 'other') return [];
      if (!hint && !pic.proof && !/裁剪|提取|截取|奖状|证书/.test(turn.text || '')) return [];
      const box = hint?.box;
      const valid = Array.isArray(box) && box.length === 4 && box.every(v => Number.isInteger(v) && v >= 0 && v <= 1000) && box[2] > box[0] && box[3] > box[1];
      return [{sourceId: pic.sourceId, image: pic.image, label: pic.reading ? [...pic.reading.names, pic.reading.award].filter(Boolean).join(' · ') : typeof hint?.label === 'string' ? hint.label.slice(0, 80) : '', box: valid ? box : null}];
    });
    const parentIds = new Map(included.map(pic => [pic.entry.id, pic.sourceId]));
    const matches = identity.filter(row => row.status === 'match');
    const differentAwards = new Set(matches.map(row => row.award).filter(Boolean)).size > 1;
    if (differentAwards || (identity.length && !matches.length))
      result.reviewReason ||= differentAwards ? '材料中有多个本人奖项，请核对本次要收录哪一个。' : '材料中的署名还不能确认属于本人，请核对后收录。';
    const personalFields = new Set(['result','awarded','role','contribution']);
    result.updates = (result.updates || []).filter(update => {
      if (!update || !identity.length) return true;
      if (!update.sourceId && typeof update.value === 'string' && update.value.trim() && (turn.text || '').includes(update.value.trim())) return true;
      if (differentAwards && personalFields.has(update.field)) return false;
      const pic = included.find(i => i.entry.id === update.sourceId);
      const rows = identity.filter(r => r.sourceId === (pic?.sourceId || update.sourceId) && (!pic || r.image === pic.image));
      if (!rows.length) return !personalFields.has(update.field) || Boolean(update.sourceId);
      if (rows.some(r => r.status !== 'match')) return false;
      return update.field !== 'result' || rows.some(r => r.award && typeof update.value === 'string' && update.value.includes(r.award));
    });
    for (const update of result.updates) if (update && parentIds.has(update.sourceId)) update.sourceId = parentIds.get(update.sourceId);
    const capture = !reviewIds && /^(?:请|帮我|请帮我)?(?:把我的(?:奖状|证书)(?:截出来|提取出来|截取出来)|(?:截取|提取|截图保存)我的(?:奖状|证书))[。！!\s]*$/.test((turn.text || '').trim());
    if (capture && person.name) {
      const documents = session.sources.filter(src => ids.includes(src.id) && (/\.docx$/i.test(src.name) || imageFile(src.name)));
      const chosen = matches.length === 1 && matches[0];
      if (chosen?.image && documents.every(src => identity.some(row => row.sourceId === src.id)) && identity.every(row => row.status !== 'unknown')) {
        result.capture = {sourceId: chosen.sourceId, image: chosen.image, name: [person.name, chosen.award || '证明'].join(' · '), person};
      } else notes.push('可以打开候选图片核对，再选择要保存的证明。');
    }
    let reviews = Array.isArray(result.fileReviews) ? result.fileReviews : [];
    if (!connection.materialReview && !Array.isArray(result.fileReviews)) {
      const kinds = { 保留: 'keep', 待核对: 'review', 可舍弃: 'discard' };
      result.reply = result.reply.replace(/^\s*[-*]?\s*【(保留|待核对|可舍弃)\s*(\d+)】[：:\s]*([^\n]+)$/gm, (_, kind, pos, reason) => {
        if (files[Number(pos) - 1]) reviews.push({ sourceId: files[Number(pos) - 1].id, kind: kinds[kind], reason });
        return '';
      }).trim() || '已核对本次材料，可以查看材料取舍。';
    }
    const byId = new Map(files.map(item => [item.id, item]));
    result.attempted = [...new Set([...files.filter(item => item.data || item.text !== undefined).map(item => item.id), ...photoMatches.keys()])];
    result.fileReviews = [];
    for (const entry of reviews) {
      const item = byId.get(entry?.sourceId);
      if (!item || !['keep', 'discard', 'review'].includes(entry.kind) || typeof entry.reason !== 'string' || !entry.reason.trim()) continue;
      let coverage = result.coverage?.[item.id];
      if (!result.coverage && !readingNotes.some(note => note.includes('《' + item.name + '》'))) {
        if (item.text?.trim()) coverage = item.partial ? 'partial' : 'read';
        else if (item.data) coverage = /\.(jpe?g|bmp)$/i.test(item.name) ? 'read' : 'partial';
      }
      if ((!item.data && !item.text?.trim()) || !['partial', 'read'].includes(coverage)) continue;
      const uncertain = entry.kind === 'discard' && (coverage !== 'read' || F.evidenceName(item.name));
      result.fileReviews.push({
        sourceId: item.id, kind: uncertain ? 'review' : entry.kind,
        reason: uncertain ? '材料可能包含证明信息，建议打开原件核对' : entry.reason.trim().slice(0, 180),
      });
    }
    result.notes = [...new Set([...notes, ...readingNotes])];
    return result;
  }

  function applyReviews(session, result) {
    const previous = F.resumeSources(session);
    const reviews = new Map(result.fileReviews.map(entry => [entry.sourceId, entry]));
    for (const src of session.sources) {
      for (const r of result.imagesRead || []) if (r.id === src.id) (src.pictureReadings ||= {})[r.number] = r.reading;
      if (src.review?.manual) continue;
      const review = reviews.get(src.id);
      if (review) src.review = { kind: review.kind, reason: review.reason };
    }
    if (JSON.stringify(previous) !== JSON.stringify(F.resumeSources(session))) session.dirty = true;
  }

  function applySuggestions(session, result, turn) {
    const draft = session.draft;
    const person = F.profile();
    if (result.person && (person.name !== result.person.name || person.school !== result.person.school)) return;
    const fields = new Set([
      'title',
      'category',
      'start',
      'end',
      'awarded',
      'role',
      'result',
      'contribution',
      'tags',
    ]);
    const updates = {};
    for (const item of result.updates || []) {
      if (!item || !fields.has(item.field) || typeof item.value !== 'string')
        continue;
      const key = item.field,
        value = item.value.trim().slice(0, key === 'contribution' ? 3500 : 350);
      const empty =
        key === 'category'
          ? draft.category === '其他'
          : key === 'tags'
            ? !draft.tags.length
            : key === 'title'
              ? !draft.title || draft.title === session.initialTitle
              : !draft[key];
      const automatic = turn?.workflowMode === 'auto';
      const readSource = item.sourceId && (result.coverage ? ['read', 'partial'].includes(result.coverage[item.sourceId]) : result.attempted?.includes(item.sourceId));
      const explicit = !item.sourceId && turn?.text?.includes(value);
      const replace = automatic && !result.reviewReason && (explicit || (readSource && draft.refs[key] && turn.ids.includes(item.sourceId)));
      if (
        (!empty && !replace) || (automatic && item.sourceId && !readSource) ||
        !value ||
        (item.sourceId && !session.sources.some((s) => s.id === item.sourceId))
      )
        continue;
      if (
        ['start', 'end', 'awarded'].includes(key) &&
        !/^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(value)
      )
        continue;
      if (key === 'category' && !Object.hasOwn(F.categories, value)) continue;
      updates[key] = {
        value: key === 'tags' ? F.cleanTags(value).slice(0, 12) : value,
        ref: item.sourceId,
      };
    }
    const start = updates.start?.value || draft.start,
      end = updates.end?.value || draft.end;
    if (start && end && end < start) {
      delete updates.start;
      delete updates.end;
    }
    for (const [key, item] of Object.entries(updates)) {
      draft[key] = item.value;
      if (item.ref) draft.refs[key] = item.ref;
      else delete draft.refs[key];
      if (key === 'title') delete session.initialTitle;
      session.dirty = true;
    }
  }
  window.FolioAI = {
    recognizeImage,
    mount,
    unmount,
    running,
    connectionForSend,
    analyze,
    reviewBatch,
    applyReviews,
    applySuggestions,
  };
})();
