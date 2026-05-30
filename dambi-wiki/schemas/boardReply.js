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
    post: {
        type: String,
        required: true,
        index: true
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
    createdAt: {
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

module.exports = mongoose.model('BoardReply', newSchema);
