const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
        index: true,
        default: crypto.randomUUID
    },
    board: {
        type: String,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        maxLength: 255
    },
    content: {
        type: String,
        required: true
    },
    user: {
        type: String,
        required: true,
        index: true
    },
    views: {
        type: Number,
        required: true,
        default: 0
    },
    replyCount: {
        type: Number,
        required: true,
        default: 0
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    deleted: {
        type: Boolean,
        required: true,
        default: false
    }
});

module.exports = mongoose.model('BoardPost', newSchema);
