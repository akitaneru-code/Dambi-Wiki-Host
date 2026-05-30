const express = require('express');
const { body, validationResult } = require('express-validator');

const utils = require('../utils');
const middleware = require('../utils/middleware');
const { UserTypes } = require('../utils/types');

const User = require('../schemas/user');
const Board = require('../schemas/board');
const BoardPost = require('../schemas/boardPost');
const BoardReply = require('../schemas/boardReply');

const app = express.Router();

const POSTS_PER_PAGE = 20;
const REPLIES_PER_PAGE = 50;

// 게시판 목록
app.get('/board', async (req, res) => {
    const boards = await Board.find().sort({ order: 1, name: 1 });
    return res.renderSkin('게시판', {
        contentName: 'board-list',
        contentHtml: await renderBoardList(boards, req)
    });
});

// 게시판 글 목록
app.get('/board/:slug', async (req, res) => {
    const board = await Board.findOne({ slug: req.params.slug });
    if (!board) return res.error('존재하지 않는 게시판입니다.', 404);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const total = await BoardPost.countDocuments({ board: req.params.slug, deleted: false });
    const posts = await BoardPost.find({ board: req.params.slug, deleted: false })
        .sort({ createdAt: -1 })
        .skip((page - 1) * POSTS_PER_PAGE)
        .limit(POSTS_PER_PAGE);

    const userUuids = [...new Set(posts.map(p => p.user))];
    const users = await User.find({ uuid: { $in: userUuids } });
    const userMap = Object.fromEntries(users.map(u => [u.uuid, u]));

    const postList = posts.map(p => ({
        uuid: p.uuid,
        title: p.title,
        views: p.views,
        replyCount: p.replyCount,
        createdAt: p.createdAt,
        user: userMap[p.user] ? {
            name: userMap[p.user].type === UserTypes.Account ? userMap[p.user].name : null,
            ip: userMap[p.user].type !== UserTypes.Account ? (req.permissions.includes('hideip') ? p.user : p.user.split('.').slice(0, 3).join('.') + '.*') : null
        } : { name: '(삭제된 사용자)', ip: null }
    }));

    const totalPages = Math.ceil(total / POSTS_PER_PAGE);

    return res.renderSkin(`${board.name} - 게시판`, {
        contentName: 'board-posts',
        contentHtml: renderPostList(board, postList, page, totalPages, req)
    });
});

// 게시글 작성 폼
app.get('/board/:slug/write', async (req, res) => {
    if (!req.user) return res.redirect('/member/login');
    const board = await Board.findOne({ slug: req.params.slug });
    if (!board) return res.error('존재하지 않는 게시판입니다.', 404);

    return res.renderSkin(`글쓰기 - ${board.name}`, {
        contentName: 'board-write',
        contentHtml: renderWriteForm(board, req)
    });
});

// 게시글 작성 처리
app.post('/board/:slug/write',
    body('title').trim().notEmpty().withMessage('제목을 입력해주세요.').isLength({ max: 255 }).withMessage('제목은 255자 이내여야 합니다.'),
    body('content').trim().notEmpty().withMessage('내용을 입력해주세요.').isLength({ max: 65536 }).withMessage('내용이 너무 깁니다.'),
    async (req, res) => {
        if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
        const board = await Board.findOne({ slug: req.params.slug });
        if (!board) return res.error('존재하지 않는 게시판입니다.', 404);

        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        const post = await BoardPost.create({
            board: req.params.slug,
            title: req.body.title.trim(),
            content: req.body.content.trim(),
            user: req.user.uuid
        });

        return res.redirect(`/board/${req.params.slug}/${post.uuid}`);
    }
);

// 게시글 보기
app.get('/board/:slug/:uuid', async (req, res) => {
    const board = await Board.findOne({ slug: req.params.slug });
    if (!board) return res.error('존재하지 않는 게시판입니다.', 404);

    const post = await BoardPost.findOne({ uuid: req.params.uuid, deleted: false });
    if (!post) return res.error('존재하지 않는 게시글입니다.', 404);

    await BoardPost.updateOne({ uuid: post.uuid }, { $inc: { views: 1 } });

    const postUser = await User.findOne({ uuid: post.user });
    const page = Math.max(1, parseInt(req.query.page) || 1);

    const totalReplies = await BoardReply.countDocuments({ post: post.uuid, deleted: false });
    const replies = await BoardReply.find({ post: post.uuid, deleted: false })
        .sort({ createdAt: 1 })
        .skip((page - 1) * REPLIES_PER_PAGE)
        .limit(REPLIES_PER_PAGE);

    const replyUserUuids = [...new Set(replies.map(r => r.user))];
    const replyUsers = await User.find({ uuid: { $in: replyUserUuids } });
    const replyUserMap = Object.fromEntries(replyUsers.map(u => [u.uuid, u]));

    const formatUser = (u, uuid) => u
        ? { name: u.type === UserTypes.Account ? u.name : null, ip: u.type !== UserTypes.Account ? (req.permissions.includes('hideip') ? uuid : uuid.split('.').slice(0, 3).join('.') + '.*') : null }
        : { name: '(삭제된 사용자)', ip: null };

    const replyList = replies.map(r => ({
        uuid: r.uuid,
        content: r.content,
        createdAt: r.createdAt,
        user: formatUser(replyUserMap[r.user], r.user),
        canDelete: req.user && (req.user.uuid === r.user || req.permissions.includes('admin'))
    }));

    const totalPages = Math.ceil(totalReplies / REPLIES_PER_PAGE);

    return res.renderSkin(`${post.title} - ${board.name}`, {
        contentName: 'board-view',
        contentHtml: renderPostView(board, post, postUser, replyList, page, totalPages, req)
    });
});

// 댓글 작성
app.post('/board/:slug/:uuid/reply',
    body('content').trim().notEmpty().withMessage('내용을 입력해주세요.').isLength({ max: 2000 }).withMessage('댓글은 2000자 이내여야 합니다.'),
    async (req, res) => {
        if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });

        const post = await BoardPost.findOne({ uuid: req.params.uuid, deleted: false });
        if (!post) return res.status(404).json({ error: '존재하지 않는 게시글입니다.' });

        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        await BoardReply.create({
            post: post.uuid,
            content: req.body.content.trim(),
            user: req.user.uuid
        });

        await BoardPost.updateOne({ uuid: post.uuid }, { $inc: { replyCount: 1 } });

        return res.redirect(`/board/${req.params.slug}/${post.uuid}`);
    }
);

// 게시글 삭제
app.post('/board/:slug/:uuid/delete', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const post = await BoardPost.findOne({ uuid: req.params.uuid });
    if (!post) return res.error('존재하지 않는 게시글입니다.', 404);
    if (post.user !== req.user.uuid && !req.permissions.includes('admin'))
        return res.status(403).json({ error: '권한이 없습니다.' });

    await BoardPost.updateOne({ uuid: post.uuid }, { deleted: true });
    return res.redirect(`/board/${req.params.slug}`);
});

// 댓글 삭제
app.post('/board/:slug/:uuid/reply/:replyUuid/delete', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const reply = await BoardReply.findOne({ uuid: req.params.replyUuid });
    if (!reply) return res.status(404).json({ error: '존재하지 않는 댓글입니다.' });
    if (reply.user !== req.user.uuid && !req.permissions.includes('admin'))
        return res.status(403).json({ error: '권한이 없습니다.' });

    await BoardReply.updateOne({ uuid: reply.uuid }, { deleted: true });
    await BoardPost.updateOne({ uuid: req.params.uuid }, { $inc: { replyCount: -1 } });

    return res.redirect(`/board/${req.params.slug}/${req.params.uuid}`);
});

// 어드민: 게시판 생성 (POST /admin/board/create)
app.post('/admin/board/create',
    middleware.permission('admin'),
    body('slug').trim().notEmpty().matches(/^[a-z0-9_-]+$/).withMessage('slug는 영문 소문자/숫자/-/_만 사용 가능합니다.'),
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        const exists = await Board.findOne({ slug: req.body.slug.trim() });
        if (exists) return res.status(400).json({ error: '이미 존재하는 slug입니다.' });

        await Board.create({
            slug: req.body.slug.trim(),
            name: req.body.name.trim(),
            description: (req.body.description || '').trim(),
            order: parseInt(req.body.order) || 0
        });
        return res.redirect('/admin/board');
    }
);

// 어드민: 게시판 목록
app.get('/admin/board', middleware.permission('admin'), async (req, res) => {
    const boards = await Board.find().sort({ order: 1, name: 1 });
    return res.renderSkin('게시판 관리', {
        contentName: 'admin-board',
        contentHtml: renderAdminBoard(boards)
    });
});

// ─── HTML 렌더 헬퍼 ─────────────────────────────────────────────────────────

function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('ko-KR') + ' ' + dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function renderUserName(u) {
    if (!u) return '(알 수 없음)';
    return u.name || u.ip || '(IP)';
}

async function renderBoardList(boards, req) {
    if (!boards.length) {
        return `<div style="padding:2rem;text-align:center;color:#666;">
            <p>아직 개설된 게시판이 없습니다.</p>
            ${req.permissions.includes('admin') ? `<p><a href="/admin/board">게시판 관리</a>에서 새 게시판을 만들어보세요.</p>` : ''}
        </div>`;
    }
    const rows = boards.map(b => `
        <div style="border:1px solid #e0e0e0;border-radius:8px;padding:1rem 1.5rem;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between;">
            <div>
                <a href="/board/${b.slug}" style="font-size:1.1rem;font-weight:600;text-decoration:none;color:inherit;">${escHtml(b.name)}</a>
                ${b.description ? `<p style="margin:.25rem 0 0;color:#666;font-size:.875rem;">${escHtml(b.description)}</p>` : ''}
            </div>
        </div>`).join('');
    return `<h2 style="margin-bottom:1rem;">게시판 목록</h2>${rows}`;
}

function renderPostList(board, posts, page, totalPages, req) {
    const rows = posts.length
        ? posts.map(p => `
            <tr>
                <td style="padding:.6rem 1rem;"><a href="/board/${board.slug}/${p.uuid}" style="text-decoration:none;color:inherit;font-weight:500;">${escHtml(p.title)}</a>${p.replyCount > 0 ? ` <span style="color:#e74c3c;font-size:.8rem;">[${p.replyCount}]</span>` : ''}</td>
                <td style="padding:.6rem 1rem;text-align:center;color:#555;font-size:.875rem;">${renderUserName(p.user)}</td>
                <td style="padding:.6rem 1rem;text-align:center;color:#888;font-size:.8rem;">${formatDate(p.createdAt)}</td>
                <td style="padding:.6rem 1rem;text-align:center;color:#888;font-size:.8rem;">${p.views}</td>
            </tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;padding:2rem;color:#666;">게시글이 없습니다.</td></tr>`;

    const pagination = buildPagination(`/board/${board.slug}`, page, totalPages);
    const writeBtn = req.user ? `<a href="/board/${board.slug}/write" style="display:inline-block;padding:.5rem 1.2rem;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;font-size:.9rem;">글쓰기</a>` : '';

    return `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
            <h2 style="margin:0;">${escHtml(board.name)}</h2>
            ${writeBtn}
        </div>
        ${board.description ? `<p style="margin:0 0 1rem;color:#666;">${escHtml(board.description)}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
            <thead style="background:#f8f9fa;">
                <tr>
                    <th style="padding:.7rem 1rem;text-align:left;font-weight:600;">제목</th>
                    <th style="padding:.7rem 1rem;text-align:center;font-weight:600;width:120px;">작성자</th>
                    <th style="padding:.7rem 1rem;text-align:center;font-weight:600;width:130px;">날짜</th>
                    <th style="padding:.7rem 1rem;text-align:center;font-weight:600;width:60px;">조회</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        ${pagination}`;
}

function renderWriteForm(board, req) {
    return `
        <h2 style="margin-bottom:1.2rem;">글쓰기 - ${escHtml(board.name)}</h2>
        <form method="post" action="/board/${board.slug}/write" style="display:flex;flex-direction:column;gap:.8rem;">
            <div>
                <label style="display:block;margin-bottom:.3rem;font-weight:500;">제목</label>
                <input name="title" maxlength="255" required
                    style="width:100%;padding:.6rem .8rem;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;box-sizing:border-box;">
            </div>
            <div>
                <label style="display:block;margin-bottom:.3rem;font-weight:500;">내용</label>
                <textarea name="content" rows="12" required
                    style="width:100%;padding:.6rem .8rem;border:1px solid #d1d5db;border-radius:6px;font-size:1rem;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
            </div>
            <div style="display:flex;gap:.6rem;">
                <button type="submit"
                    style="padding:.55rem 1.4rem;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;">등록</button>
                <a href="/board/${board.slug}"
                    style="padding:.55rem 1.2rem;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:1rem;">취소</a>
            </div>
        </form>`;
}

function renderPostView(board, post, postUser, replies, page, totalPages, req) {
    const canDelete = req.user && (req.user.uuid === post.user || req.permissions.includes('admin'));
    const authorName = postUser
        ? (postUser.type === UserTypes.Account ? postUser.name : (req.permissions.includes('hideip') ? post.user : post.user.split('.').slice(0, 3).join('.') + '.*'))
        : '(삭제된 사용자)';

    const replyRows = replies.map(r => `
        <div style="border-top:1px solid #f0f0f0;padding:.9rem 0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">
                <span style="font-weight:500;font-size:.9rem;">${escHtml(renderUserName(r.user))}</span>
                <div style="display:flex;align-items:center;gap:.8rem;">
                    <span style="color:#9ca3af;font-size:.8rem;">${formatDate(r.createdAt)}</span>
                    ${r.canDelete ? `<form method="post" action="/board/${board.slug}/${post.uuid}/reply/${r.uuid}/delete" style="display:inline;" onsubmit="return confirm('삭제하시겠습니까?')"><button type="submit" style="background:none;border:none;color:#ef4444;font-size:.8rem;cursor:pointer;padding:0;">삭제</button></form>` : ''}
                </div>
            </div>
            <p style="margin:0;white-space:pre-wrap;font-size:.95rem;">${escHtml(r.content)}</p>
        </div>`).join('');

    const replyForm = req.user ? `
        <form method="post" action="/board/${board.slug}/${post.uuid}/reply" style="margin-top:1rem;display:flex;flex-direction:column;gap:.6rem;">
            <textarea name="content" rows="4" placeholder="댓글을 입력하세요..." required maxlength="2000"
                style="width:100%;padding:.6rem .8rem;border:1px solid #d1d5db;border-radius:6px;font-size:.95rem;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
            <div><button type="submit" style="padding:.5rem 1.2rem;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:.9rem;cursor:pointer;">댓글 등록</button></div>
        </form>` : `<p style="margin-top:1rem;color:#666;font-size:.9rem;"><a href="/member/login">로그인</a> 후 댓글을 작성할 수 있습니다.</p>`;

    const pagination = buildPagination(`/board/${board.slug}/${post.uuid}`, page, totalPages);

    return `
        <div style="margin-bottom:.5rem;">
            <a href="/board/${board.slug}" style="color:#6b7280;text-decoration:none;font-size:.9rem;">← ${escHtml(board.name)}</a>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;">
            <h1 style="margin:0 0 .6rem;font-size:1.4rem;">${escHtml(post.title)}</h1>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding-bottom:.8rem;border-bottom:1px solid #f0f0f0;">
                <span style="font-size:.875rem;color:#6b7280;">
                    <strong>${escHtml(authorName)}</strong> &middot; ${formatDate(post.createdAt)} &middot; 조회 ${post.views}
                </span>
                ${canDelete ? `<form method="post" action="/board/${board.slug}/${post.uuid}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button type="submit" style="background:none;border:none;color:#ef4444;font-size:.875rem;cursor:pointer;padding:0;">삭제</button></form>` : ''}
            </div>
            <div style="white-space:pre-wrap;line-height:1.7;font-size:1rem;">${escHtml(post.content)}</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:1.5rem;">
            <h3 style="margin:0 0 .5rem;font-size:1rem;">댓글 ${post.replyCount}개</h3>
            ${replyRows || '<p style="color:#9ca3af;font-size:.9rem;padding:.5rem 0;">아직 댓글이 없습니다.</p>'}
            ${pagination}
            ${replyForm}
        </div>`;
}

function renderAdminBoard(boards) {
    const rows = boards.map(b => `
        <tr>
            <td style="padding:.6rem 1rem;">${escHtml(b.slug)}</td>
            <td style="padding:.6rem 1rem;"><a href="/board/${b.slug}">${escHtml(b.name)}</a></td>
            <td style="padding:.6rem 1rem;">${escHtml(b.description)}</td>
        </tr>`).join('');

    return `
        <h2>게시판 관리</h2>
        <form method="post" action="/admin/board/create" style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1.5rem;padding:1rem;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
            <input name="slug" placeholder="slug (영문, 예: general)" required pattern="[a-z0-9_-]+" style="padding:.5rem .8rem;border:1px solid #d1d5db;border-radius:6px;flex:1;min-width:120px;">
            <input name="name" placeholder="게시판 이름" required style="padding:.5rem .8rem;border:1px solid #d1d5db;border-radius:6px;flex:1;min-width:120px;">
            <input name="description" placeholder="설명 (선택)" style="padding:.5rem .8rem;border:1px solid #d1d5db;border-radius:6px;flex:2;min-width:180px;">
            <input name="order" placeholder="순서" type="number" value="0" style="padding:.5rem .8rem;border:1px solid #d1d5db;border-radius:6px;width:70px;">
            <button type="submit" style="padding:.5rem 1.2rem;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;">생성</button>
        </form>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0e0;">
            <thead style="background:#f8f9fa;">
                <tr>
                    <th style="padding:.6rem 1rem;text-align:left;">Slug</th>
                    <th style="padding:.6rem 1rem;text-align:left;">이름</th>
                    <th style="padding:.6rem 1rem;text-align:left;">설명</th>
                </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="3" style="padding:1rem;text-align:center;color:#9ca3af;">게시판 없음</td></tr>'}</tbody>
        </table>`;
}

function buildPagination(base, page, totalPages) {
    if (totalPages <= 1) return '';
    const pages = [];
    for (let i = Math.max(1, page - 3); i <= Math.min(totalPages, page + 3); i++) {
        pages.push(`<a href="${base}?page=${i}" style="display:inline-block;padding:.3rem .7rem;margin:0 .1rem;border:1px solid ${i === page ? '#3b82f6' : '#d1d5db'};border-radius:4px;text-decoration:none;color:${i === page ? '#fff' : 'inherit'};background:${i === page ? '#3b82f6' : '#fff'};font-size:.875rem;">${i}</a>`);
    }
    return `<div style="display:flex;justify-content:center;gap:.2rem;margin-top:1rem;">${pages.join('')}</div>`;
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = app;
