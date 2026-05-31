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
    document: {
        type: String,
        required: true,
        index: true
    },
    lang: {
        type: String,
        required: true,
        index: true
    },
    content: {
        type: String,
        maxLength: 4000000
    },
    updatedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    updatedBy: {
        type: String
    }
});

newSchema.index({ document: 1, lang: 1 }, { unique: true });

newSchema.pre('save', function() {
    this.updatedAt = new Date();
});

module.exports = mongoose.model('DocumentTranslation', newSchema);
