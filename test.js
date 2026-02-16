const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();
const crypto = require('crypto');
const {sendAudio} = require('./sender.js')

// Generating a unique UUID
// const id = crypto.randomUUID();
// console.log(id);

// server init
const app = express();
const PORT = process.env.PORT || 5000;

//conneting
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

//making uploads folder static
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m4a')) {
            res.setHeader('Content-Type', 'audio/m4a');
        }
    }
}));

//Client
app.use((req, res, next) => {
    const ip = req.ip;
    req.clientIp = ip.replace('::ffff:', '');
    next();
});

mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/BoundingBoxers')
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.log("MongoDB error", err));

//Schema
const dataSchema = new mongoose.Schema({
    ipAddress: { type: String, required: true },
    sessionId: String,

    location: { latitude: Number, longitude: Number },

    //unified motion samples
    motionSamples: [[{
        t: { type: Number, required: true },   // timestamp in ms/seconds from client
        ax: Number,
        ay: Number,
        az: Number,
        gx: Number,
        gy: Number,
        gz: Number
    }]],

    //  audio section untouched
    audioFiles: [{
        filename: String,
        storedName: String,
        mimeType: String,
        // path: String,
        size: Number,
        dangerIndex: Number,
        timestamp: { type: Date, default: Date.now }
    }],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});


//Indexing the data entries
dataSchema.index({ ipAddress: 1 });

//mongoose model
const Data = mongoose.model('Data', dataSchema);

//uploads
const uploadsDir = process.env.UPLOADS_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

//To tell where to store
const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) =>
        cb(null, crypto.randomUUID() + (path.extname(file.originalname) || '.mp4'))
});

//Acrually Stores
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

//health
app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        timestamp: new Date().toISOString(),
        clientIp: req.clientIp
    });
});

//panic
app.post('/panic', upload.single('audio'), async (req, res) => {
    try {
        const ipAddress = req.clientIp;

        // const latitude = Number(req.body.latitude);
        // const longitude = Number(req.body.longitude);
        // parse incoming JSON
        const samples = JSON.parse(req.body.samples || '[]');


        let dangerIndex = 0;
        let audioEntry = null;

        if (req.file) {
            // dangerIndex = await runDangerDetection('audio', req.file.path);

            audioEntry = {
                filename: req.file.originalname,
                storedName: req.file.filename,
                mimeType: req.file.mimetype,
                // path: req.file.path,
                size: req.file.size,
                dangerIndex
            };
        }

        await Data.findOneAndUpdate(
            { ipAddress },
            {
                $set: {
                    ipAddress,
                    sessionId: crypto.randomUUID(),
                    updatedAt: new Date()
                },

                $setOnInsert: { createdAt: new Date() },

                $push: {
                    ...(audioEntry && { audioFiles: audioEntry }),
                    ...(samples.length && { motionSamples: samples })
                }
            },
            { upsert: true }
        );


        res.json({
            status: 'panic_received',
            samplesCount: samples.length,
            audioReceived: !!req.file,
            dangerIndex: Number(dangerIndex.toFixed(2))
        });

        sendAudio(`./uploads/${req.file.filename}`)
        .then((res) => {
            console.log(res);
        })
        .catch((err)=>console.log(err));

        // delete file in 10 min
        if (req.file) {
          setTimeout(() => {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          }, 600000);
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'panic failed' });
    }
});

/* start */
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
