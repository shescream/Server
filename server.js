const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();


/* uuid */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/* app */
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/m4a');
    }
  }
}));


/* client ip */
app.use((req, res, next) => {
  const ip =
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    req.connection.remoteAddress ||
    req.ip;
  req.clientIp = ip.replace('::ffff:', '');
  next();
});

/* mongodb */
mongoose.connect(
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/BoundingBoxers')
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error", err));

/* schema */
const dataSchema = new mongoose.Schema({
  ipAddress: { type: String, required: true },
  sessionId: String,

  location: { latitude: Number, longitude: Number },

  //unified motion samples
  motionSamples:[[{
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
    path: String,
    size: Number,
    dangerIndex: Number,
    timestamp: { type: Date, default: Date.now }
  }],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});


//Indexing the data entries
dataSchema.index({ ipAddress: 1 });

const Data = mongoose.model('Data', dataSchema);

/* uploads */
const uploadsDir = process.env.UPLOADS_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// let audioCounter = 0;

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

/* ml */
const { runDangerDetection } = require('./mlController');

/* health */
app.get('/health', (req, res) => {
  res.json({
    status: 'active',
    timestamp: new Date().toISOString(),
    clientIp: req.clientIp
  });
});

/* panic */
app.post('/panic', upload.single('audio'), async (req, res) => {
  try {
    const ipAddress = req.clientIp;

    // const latitude = Number(req.body.latitude);
    // const longitude = Number(req.body.longitude);
    // parse incoming JSON
    const samples = [JSON.parse(req.body.samples || '[]')];


    let dangerIndex = 0;
    let audioEntry = null;

    if (req.file) {
      dangerIndex = await runDangerDetection('audio', req.file.path);

      audioEntry = {
        filename: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        path: req.file.path,
        size: req.file.size,
        dangerIndex
      };
    }

    await Data.findOneAndUpdate(
      { ipAddress },
      {
        ipAddress,
        sessionId: uuidv4(),
        // location: { latitude, longitude },
        ...(audioEntry && { $push: { audioFiles: audioEntry } }),
        ...(samples.length && { $push: { motionSamples: samples } }),
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    res.json({
      status: 'panic_received',
      samplesCount: samples.length,
      audioReceived: !!req.file,
      dangerIndex: Number(dangerIndex.toFixed(2))
    });

    //This delets the audio file after 10 mins

    // if (req.file) {
    //   setTimeout(() => {
    //     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    //   }, 600000);
    // }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'panic failed' });
  }
});

/* data (self) */
app.get('/api/data', async (req, res) => {
  const data = await Data.findOne({ ipAddress: req.clientIp });
  if (!data) return res.status(404).json({ error: 'no data' });

  res.json({
    ipAddress: data.ipAddress,
    sessionId: data.sessionId,
    location: data.location,
    totalAccelerometer: data.accelerometer.length,
    totalGyroscope: data.gyroscope.length,
    totalAudio: data.audioFiles.length,
    latestDanger: data.audioFiles.at(-1)?.dangerIndex || 0,
    updatedAt: data.updatedAt
  });
});

/* stream audio */
app.get("/audio/:filename", async (req, res) => {
  try {
    const file = await gfs.files.findOne({ filename: req.params.filename });

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    //set correct content type
    res.set("Content-Type", file.contentType);

    const readStream = gfs.createReadStream(file.filename);
    readStream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



/* start */
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
