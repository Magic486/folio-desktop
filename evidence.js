'use strict';
window.FolioEvidence = (() => {
  const wordLimit = 80_000_000;
  const proof = /奖状|获奖|证书|荣誉|参赛证明|志愿服务证明|项目成果|作品展示|certificate/i;
  const expense = /发票|车票|报销|行程|支付|账单|流水|付款|收款|交通费|住宿|银行|身份证|学号|学\/工号|invoice|receipt/i;
  const types = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  const descendants = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const textOf = node => descendants(node, 't').map(t => t.textContent).join('').trim();

  async function part(zip, path, limit) {
    const entry = zip.file(path);
    if (!entry) throw new Error('文档缺少所需的内容。');
    const chunks = [];
    return new Promise((resolve, reject) => {
      let size = 0;
      const stream = entry.internalStream('uint8array');
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > limit) {
          stream.pause();
          reject(new Error('这部分内容过大，无法在浏览器中展开。'));
        } else chunks.push(chunk);
      }).on('error', reject).on('end', () => resolve(new Blob(chunks))).resume();
    });
  }
  async function xml(zip, path) {
    const doc = new DOMParser().parseFromString(await (await part(zip, path, 6_000_000)).text(), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Word 文档的内部格式有误。');
    return doc;
  }
  async function readWord(file, filename) {
    if (file.size > wordLimit) throw new Error('Word 文件超过 80 MB，请拆分后再读取。');
    const zip = await JSZip.loadAsync(file);
    const root = await xml(zip, 'word/document.xml');
    const related = new Map();
    if (zip.file('word/_rels/document.xml.rels')) {
      const rels = await xml(zip, 'word/_rels/document.xml.rels');
      for (const r of descendants(rels, 'Relationship')) {
        if (!r.getAttribute('Type')?.endsWith('/image') || r.getAttribute('TargetMode') === 'External') continue;
        const target = r.getAttribute('Target')?.replace(/^\/word\//, '') || '';
        if (/^media\/[^/\\]+$/i.test(target)) related.set(r.getAttribute('Id'), 'word/' + target);
      }
    }
    const paragraphs = [], images = [], seen = new Set();
    let section = '', omitted = 0;
    for (const p of descendants(root, 'p')) {
      const text = textOf(p);
      if (text) {
        paragraphs.push(text);
        section = text.slice(0, 120);
      }
      for (const node of [...descendants(p, 'blip'), ...descendants(p, 'imagedata')]) {
        const id = Array.from(node.attributes).find(a => ['embed', 'id'].includes(a.localName))?.value;
        const path = related.get(id);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const type = types[path.split('.').pop().toLowerCase()];
        if (!type || !zip.file(path)) { omitted++; continue; }
        images.push({ path, type, number: images.length + 1, label: section, proof: proof.test(section) && !expense.test(section) });
      }
    }
    const financial = expense.test(filename) || paragraphs.some(t => /报销事由|报销材料清单|支付明细/.test(t));
    const body = paragraphs.join('\n');
    const aiText = financial ? paragraphs.filter(t => !expense.test(t) && /参[加赛]|获奖|奖项|队员|队伍|赛事|二等奖|三等奖|一等奖|指导老师|比赛证明/.test(t)).join('\n') : body;
    const textComplete = !financial && !images.length && !omitted && !Object.keys(zip.files).some(p =>
      /^word\/(?:media\/|embeddings\/|charts\/|header|footer|footnotes|endnotes|diagrams\/)/.test(p));
    return { body, aiText, financial, textComplete, images, omitted, async image(item) {
      const raw = await part(zip, item.path, 30_000_000);
      return raw.slice(0, raw.size, item.type);
    }};
  }

  function toBlob(canvas, type) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片保存失败。')), type, 0.9));
  }
  async function thumbnail(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await toBlob(canvas, 'image/jpeg');
    } finally { bitmap.close(); }
  }

  // Keep crop coordinates in original image pixels as the preview resizes.
  function mount(container, { doc, blob, name, first, suggestion, save }) {
    const { esc } = window.FolioUI;
    const images = doc ? doc.images : [{ number: 1 }];
    let sequence = 0, url, original, rect, drag, disposed = false;
    const picker = images.map(i => `<option value="${i.number}">图 ${i.number}${i.match === 'match' ? ' · 本人署名' : i.match === 'other' ? ' · 其他署名' : i.proof ? ' · 证明材料' : ''}</option>`).join('');
    container.innerHTML = `<div class="clip-controls">${doc ? `<label>文档图片 <select aria-label="选择文档图片">${picker}</select></label>` : ''}
      <button type="button" class="quiet-button" data-whole>使用整图</button></div>
      <p class="clip-caption"></p><div class="clip-frame"><img alt="拖动框选要保留的区域" draggable="false"><span class="clip-outline" hidden></span></div>
      <p class="clip-status" role="status"></p><label class="edit-field"><span>证明材料名称</span><input class="clip-name" maxlength="150"></label>
      <button type="button" class="primary" data-save>保存为证明附件</button>`;
    const get = q => container.querySelector(q), img = get('img'), frame = get('.clip-frame'), outline = get('.clip-outline');
    const status = get('.clip-status'), select = get('select'), button = get('[data-save]'), field = get('.clip-name');
    function draw() {
      outline.hidden = !rect;
      if (rect) Object.assign(outline.style, {left: rect.x / img.naturalWidth * 100 + '%', top: rect.y / img.naturalHeight * 100 + '%',
        width: rect.w / img.naturalWidth * 100 + '%', height: rect.h / img.naturalHeight * 100 + '%'});
      status.textContent = rect ? `已框选 ${rect.w} × ${rect.h} 像素` : '当前保留整图，也可以在图上拖动框选。';
    }
    async function selectImage() {
      const ticket = ++sequence, item = images[(Number(select?.value) || 1) - 1];
      original = null; rect = null; drag = null; outline.hidden = true; button.disabled = true;
      status.textContent = '正在读取原图…';
      get('.clip-caption').textContent = item.label || '';
      field.value = name.replace(/\.[^.]+$/, '') + (doc ? ' · 图 ' + item.number : ' · 裁剪');
      try {
        const file = doc ? await doc.image(item) : blob;
        if (disposed || ticket !== sequence) return;
        if (url) URL.revokeObjectURL(url);
        img.src = url = URL.createObjectURL(file);
        await img.decode();
        if (disposed || ticket !== sequence) return;
        if (item.number === first && suggestion) {
          if (suggestion.label) field.value = suggestion.label;
          const b = suggestion.box;
          if (b && b.join() !== '0,0,1000,1000') {
            const [x,y,right,bottom] = b.map((v,i) => Math.round(v * (i % 2 ? img.naturalHeight : img.naturalWidth) / 1000));
            if (right > x && bottom > y) rect = {x,y,w:right-x,h:bottom-y};
          }
        }
        original = file; button.disabled = false; draw();
      } catch { if (!disposed && ticket === sequence) status.textContent = '此图无法预览，请选择其他图片或下载原件。'; }
    }
    function point(e) {
      const r = img.getBoundingClientRect();
      return [Math.round(Math.min(1, Math.max(0, (e.clientX-r.left)/r.width)) * img.naturalWidth),
        Math.round(Math.min(1, Math.max(0, (e.clientY-r.top)/r.height)) * img.naturalHeight)];
    }
    frame.onpointerdown = e => {
      if (!original || e.button !== 0) return;
      drag = point(e); frame.setPointerCapture(e.pointerId);
    };
    function move(e) {
      if (!drag) return;
      const [x,y] = point(e), w = Math.abs(x-drag[0]), h = Math.abs(y-drag[1]);
      if (w > 1 && h > 1) {rect = {x: Math.min(x,drag[0]), y: Math.min(y,drag[1]), w,h}; draw();}
    }
    frame.onpointermove = move;
    frame.onpointerup = e => {move(e); drag = null;};
    frame.onpointercancel = () => {drag = null;};
    get('[data-whole]').onclick = () => {rect = null; draw();};
    button.onclick = async () => {
      if (!original || button.disabled) return;
      const title = field.value.trim();
      if (!title) {field.focus(); status.textContent = '请填写证明材料名称。'; return;}
      button.disabled = true;
      if (select) select.disabled = true;
      const item = images[(Number(select?.value) || 1) - 1];
      const region = rect && {...rect};
      try {
        let output = original;
        if (region) {
          if (region.w * region.h > 40_000_000) throw new Error('选区过大，请缩小后保存。');
          const canvas = document.createElement('canvas');
          canvas.width = region.w; canvas.height = region.h;
          canvas.getContext('2d').drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
          output = await toBlob(canvas, 'image/png');
        }
        await save(output, title, {image: doc ? item.number : null, part: item.path, rect: region});
      } catch (e) {status.textContent = e.message || '保存失败，请重试。';}
      finally {if (!disposed) {button.disabled = false; if (select) select.disabled = false;}}
    };
    if (select) {select.value = String(images.some(i => i.number === first) ? first : (images.find(i => i.match === 'match') || images.find(i => i.proof) || images[0]).number); select.onchange = selectImage;}
    void selectImage();
    return () => {disposed = true; if (url) URL.revokeObjectURL(url);};
  }
  return {wordLimit, readWord, thumbnail, mount};
})();
