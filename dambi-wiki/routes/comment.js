const express = require('express');
const { body, validationResult } = require('express-validator');

const utils = require('../utils');
const middleware = require('../utils/middleware');
const { UserTypes } = require('../utils/types');

const User = require('../schemas/user');
const Document = require('../schemas/document');
const DocumentComment = require('../schemas/documentComment');
const ACL = require('../class/acl');
const { ACLTypes } = require('../utils/types');

const app = express.Router();

const COMMENTS_PER_PAGE = 30;

// 문서 댓글 목록 조회
app.get('/comment{/*document}', middleware.parseDocumentName, async (req, res) => {
    const { namespace, title } = req.document;

    const dbDocument = await Document.findOne({ namespace, title });
    if (!dbDocument) return res.json({ comments: [], total: 0 });

    const acl = await ACL.get({ document: dbDocument }, req.document);
    const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
    if (!readable) return res.status(403).json({ error: '읽기 권한이 없습니다.' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const total = await DocumentComment.countDocuments({ document: dbDocument.uuid, deleted: false });
    const comments = await DocumentComment.find({ document: dbDocument.uuid, deleted: false })
        .sort({ createdAt: 1 })
        .skip((page - 1) * COMMENTS_PER_PAGE)
        .limit(COMMENTS_PER_PAGE);

    const userUuids = [...new Set(comments.map(c => c.user))];
    const users = await User.find({ uuid: { $in: userUuids } });
    const userMap = Object.fromEntries(users.map(u => [u.uuid, u]));

    const result = comments.map(c => {
        const u = userMap[c.user];
        const canDelete = req.user && (req.user.uuid === c.user || req.permissions.includes('admin'));
        return {
            uuid: c.uuid,
            content: c.content,
            createdAt: c.createdAt,
            canDelete,
            user: u
                ? { name: u.type === UserTypes.Account ? u.name : null, ip: u.type !== UserTypes.Account ? (req.permissions.includes('hideip') ? c.user : c.user.split('.').slice(0, 3).join('.') + '.*') : null }
                : { name: '(삭제된 사용자)', ip: null }
        };
    });

    return res.json({ comments: result, total, page, totalPages: Math.ceil(total / COMMENTS_PER_PAGE) });
});

// 댓글 작성
app.post('/comment{/*document}',
    middleware.parseDocumentName,
    body('content').trim().notEmpty().withMessage('내용을 입력해주세요.').isLength({ max: 2000 }).withMessage('댓글은 2000자 이내여야 합니다.'),
    async (req, res) => {
        if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });

        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

        const { namespace, title } = req.document;
        let dbDocument = await Document.findOne({ namespace, title });

        if (!dbDocument) {
            dbDocument = new Document({ namespace, title });
            await dbDocument.save();
        }

        const acl = await ACL.get({ document: dbDocument }, req.document);
        const { result: readable } = await acl.check(ACLTypes.Read, req.aclData);
        if (!readable) return res.status(403).json({ error: '권한이 없습니다.' });

        const comment = await DocumentComment.create({
            document: dbDocument.uuid,
            user: req.user.uuid,
            content: req.body.content.trim()
        });

        const u = req.user;
        return res.json({
            uuid: comment.uuid,
            content: comment.content,
            createdAt: comment.createdAt,
            canDelete: true,
            user: {
                name: u.type === UserTypes.Account ? u.name : null,
                ip: u.type !== UserTypes.Account ? (req.permissions.includes('hideip') ? u.uuid : u.uuid.split('.').slice(0, 3).join('.') + '.*') : null
            }
        });
    }
);

// 댓글 삭제
app.delete('/comment/:uuid', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const comment = await DocumentComment.findOne({ uuid: req.params.uuid });
    if (!comment) return res.status(404).json({ error: '존재하지 않는 댓글입니다.' });

    if (comment.user !== req.user.uuid && !req.permissions.includes('admin'))
        return res.status(403).json({ error: '권한이 없습니다.' });

    await DocumentComment.updateOne({ uuid: comment.uuid }, { deleted: true });
    return res.json({ ok: true });
});

module.exports = app;
