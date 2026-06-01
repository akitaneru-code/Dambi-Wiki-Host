const express = require('express');
const parser = require('../utils/namumark/parser');
const toHtml = require('../utils/namumark/toHtml');
const utils = require('../utils');
const globalUtils = require('../utils/global');
const Document = require('../schemas/document');
const History = require('../schemas/history');
const DocumentTranslation = require('../schemas/documentTranslation');
const ACL = require('../class/acl');
const { ACLTypes } = require('../utils/types');

const app = express.Router();

const LANG_CODE_RE = /^[a-z]{2,5}$/;

const LANG_NAMES = {
    en: 'English', ja: '日本語', zh: '中文',
    fr: 'Français', de: 'Deutsch', es: 'Español',
    pt: 'Português', ru: 'Русский', ar: 'العربية',
    it: 'Italiano', nl: 'Nederlands', pl: 'Polski',
    tr: 'Türkçe', vi: 'Tiếng Việt', th: 'ภาษาไทย',
    id: 'Bahasa Indonesia', ko: '한국어', uk: 'Українська',
    sv: 'Svenska', da: 'Dansk', fi: 'Suomi',
    no: 'Norsk', cs: 'Čeština', sk: 'Slovenčina',
    ro: 'Română', hu: 'Magyar', ms: 'Bahasa Melayu',
    tl: 'Filipino', hi: 'हिन्दी', bn: 'বাংলা'
};

function getLangName(code) {
    return LANG_NAMES[code] || code.toUpperCase();
}

function parseLangFromPath(params) {
    const parts = params.document || [];
    const lang = parts[parts.length - 1];
    const docPath = parts.slice(0, -1).join('/');
    return { lang, docPath };
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GET /translate-edit{/*document} — 번역 편집 폼 (마지막 경로가 언어코드)
app.get('/translate-edit{/*document}', async (req, res) => {
    const { lang, docPath } = parseLangFromPath(req.params);
    if (!lang || !LANG_CODE_RE.test(lang))
        return res.error('잘못된 언어 코드입니다.', 400);
    if (!docPath)
        return res.error('문서명이 누락되었습니다.', 400);
    if (!req.user)
        return res.redirect(`/member/login?redirect=${encodeURIComponent(req.originalUrl)}`);

    const document = utils.parseDocumentName(docPath);
    const dbDocument = await Document.findOne({ namespace: document.namespace, title: document.title });
    if (!dbDocument)
        return res.error('원문 문서를 찾을 수 없습니다.', 404);

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
    if (!readable)
        return res.error('읽기 권한이 없습니다.', 403);

    const [rev, translation] = await Promise.all([
        History.findOne({ document: dbDocument.uuid }).sort({ rev: -1 }),
        DocumentTranslation.findOne({ document: dbDocument.uuid, lang })
    ]);

    let originalHtml = '<p style="color:#9ca3af;padding:1rem;">원문 내용이 없습니다.</p>';
    if (rev?.content) {
        const parseResult = parser(rev.content);
        const { html } = await toHtml(parseResult, { document, aclData: req.aclData, req, includeData: {} });
        originalHtml = html;
    }

    const docFullTitle = globalUtils.doc_fulltitle(document);
    const langName = getLangName(lang);
    const nonce = res.locals.cspNonce;
    const saveUrl = `/translate-edit/${globalUtils.encodeSpecialChars(docFullTitle)}/${lang}`;
    const viewUrl = `/w/${globalUtils.encodeSpecialChars(docFullTitle)}/${lang}`;
    const origUrl = globalUtils.doc_action_link(document, 'w');
    const previewUrl = `/preview/${globalUtils.encodeSpecialChars(docFullTitle)}`;

    const translationContent = esc(translation?.content || '');

    const contentHtml = `
<style>
.te-layout{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start;}
.te-panel{border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;}
.te-panel-head{padding:.5rem 1rem;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:.875rem;display:flex;justify-content:space-between;align-items:center;}
.te-panel-body{padding:1rem;max-height:72vh;overflow-y:auto;font-size:.9rem;}
.te-textarea{width:100%;box-sizing:border-box;padding:.75rem;border:none;resize:vertical;font-family:monospace;font-size:.875rem;line-height:1.6;outline:none;min-height:420px;}
.te-footer{padding:.65rem .75rem;background:#f9fafb;border-top:1px solid #e5e7eb;display:flex;gap:.5rem;align-items:center;}
.te-btn{padding:.4rem 1rem;border:1px solid #d1d5db;background:#fff;border-radius:6px;font-size:.85rem;cursor:pointer;}
.te-btn-primary{background:#3b82f6;color:#fff;border:none;font-weight:600;}
@media(max-width:900px){.te-layout{grid-template-columns:1fr;}}
</style>
<div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding:.75rem 1rem;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;">
    <div style="font-size:.95rem;">
      <strong>번역 편집</strong>:
      <a href="${esc(origUrl)}" style="color:#3b82f6;">${esc(docFullTitle)}</a>
      <span style="margin:0 .4rem;color:#9ca3af;">→</span>
      <strong>${esc(langName)}</strong> <span style="color:#9ca3af;">(${esc(lang)})</span>
    </div>
    <a href="${esc(viewUrl)}" style="color:#6b7280;font-size:.85rem;white-space:nowrap;">번역 보기 →</a>
  </div>

  <div class="te-layout">
    <div class="te-panel">
      <div class="te-panel-head">원문 <span style="font-weight:400;color:#6b7280;font-size:.8rem;">읽기 전용</span></div>
      <div class="te-panel-body wiki-article">${originalHtml}</div>
    </div>

    <div class="te-panel" style="display:flex;flex-direction:column;">
      <div class="te-panel-head">
        <span>번역 — ${esc(langName)}</span>
        <span id="te-status" style="font-size:.8rem;font-weight:400;color:#6b7280;"></span>
      </div>
      <textarea id="te-textarea" class="te-textarea"
        placeholder="나무마크 문법으로 번역된 내용을 입력하세요..."
      >${translationContent}</textarea>
      <div class="te-footer">
        <input id="te-log" type="text" placeholder="편집 요약 (선택)" maxlength="255"
          style="flex:1;padding:.4rem .7rem;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem;">
        <button id="te-preview-btn" class="te-btn">미리보기</button>
        <button id="te-save-btn" class="te-btn te-btn-primary">저장</button>
      </div>
    </div>
  </div>

  <div id="te-preview-wrap" style="display:none;margin-top:1.25rem;" class="te-panel">
    <div class="te-panel-head">미리보기</div>
    <div id="te-preview-body" class="te-panel-body wiki-article"></div>
  </div>
</div>

<script nonce="${nonce}">
(function(){
  var _save = ${JSON.stringify(saveUrl)};
  var _view = ${JSON.stringify(viewUrl)};
  var _prev = ${JSON.stringify(previewUrl)};

  function setStatus(msg, color) {
    var el = document.getElementById('te-status');
    if (el) { el.textContent = msg; el.style.color = color || '#6b7280'; }
  }

  window.addEventListener('load', function() {
    document.getElementById('te-preview-btn').addEventListener('click', function() {
      var content = document.getElementById('te-textarea').value;
      setStatus('로딩 중...', '#6b7280');
      fetch(_prev, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ content: content })
      }).then(function(r) { return r.json(); }).then(function(d) {
        var wrap = document.getElementById('te-preview-wrap');
        var body = document.getElementById('te-preview-body');
        body.innerHTML = d.contentHtml || '';
        wrap.style.display = 'block';
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setStatus('', '#6b7280');
      }).catch(function() { setStatus('미리보기 실패', '#ef4444'); });
    });

    document.getElementById('te-save-btn').addEventListener('click', function() {
      var content = document.getElementById('te-textarea').value;
      var log = document.getElementById('te-log').value;
      setStatus('저장 중...', '#6b7280');
      fetch(_save, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ content: content, log: log })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.error) { setStatus(d.error, '#ef4444'); return; }
        setStatus('저장 완료!', '#22c55e');
        setTimeout(function() { window.location.href = _view; }, 700);
      }).catch(function() { setStatus('저장 실패', '#ef4444'); });
    });
  });
}());
</script>`;

    res.renderSkin(`번역 편집: ${docFullTitle} (${langName})`, {
        viewName: 'translate_edit',
        document,
        contentHtml
    });
});

// GET /translate-redirect — 폼에서 언어 선택 후 편집 페이지로 리다이렉트
app.get('/translate-redirect', (req, res) => {
    const doc = (req.query.doc || '').trim();
    const lang = (req.query.lang || '').trim();
    if (!doc || !LANG_CODE_RE.test(lang))
        return res.error('잘못된 요청입니다.', 400);
    return res.redirect(`/translate-edit/${doc}/${encodeURIComponent(lang)}`);
});

// POST /translate-edit{/*document} — 번역 저장
app.post('/translate-edit{/*document}', async (req, res) => {
    const { lang, docPath } = parseLangFromPath(req.params);
    if (!lang || !LANG_CODE_RE.test(lang))
        return res.status(400).json({ error: '잘못된 언어 코드입니다.' });
    if (!docPath)
        return res.status(400).json({ error: '문서명이 누락되었습니다.' });
    if (!req.user)
        return res.status(401).json({ error: '로그인이 필요합니다.' });

    const content = req.body.content;
    if (typeof content !== 'string')
        return res.status(400).json({ error: '내용이 없습니다.' });
    if (content.length > 4000000)
        return res.status(400).json({ error: '내용이 너무 깁니다.' });

    const document = utils.parseDocumentName(docPath);
    const dbDocument = await Document.findOne({ namespace: document.namespace, title: document.title });
    if (!dbDocument)
        return res.status(404).json({ error: '원문 문서를 찾을 수 없습니다.' });

    const acl = await ACL.get({ document: dbDocument }, document);
    const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
    if (!readable)
        return res.status(403).json({ error: '권한이 없습니다.' });

    await DocumentTranslation.findOneAndUpdate(
        { document: dbDocument.uuid, lang },
        { content, updatedBy: req.user.uuid, updatedAt: new Date() },
        { new: true, upsert: true }
    );

    res.json({ ok: true });
});

module.exports = app;
