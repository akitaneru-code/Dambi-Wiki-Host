const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;
const newSchema = new Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        maxLength: 100
    },
    description: {
        type: String,
        default: '',
        maxLength: 500
    },
    createdAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    order: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('Board', newSchema);
