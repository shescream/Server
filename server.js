const express = require("express");
const rateLimit = require("express-rate-limit");
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { sendAudio } = require("./sender.js");

// Generating a unique UUID
// const id = crypto.randomUUID();
// console.log(id);

// server init
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "example";
app.set("trust proxy", 1);

//conneting
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

//making uploads folder static
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".m4a")) {
        res.setHeader("Content-Type", "audio/m4a");
      }
    },
  }),
);

//Client
app.use((req, res, next) => {
  const ip = req.ip;
  req.clientIp = ip.replace("::ffff:", "");
  next();
});

mongoose
  .connect(
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/BoundingBoxers",
  )
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error", err));

//Schema
const dataSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  location: { latitude: Number, longitude: Number },

  //unified motion samples
  motionSamples: [
    [
      {
        t: { type: Number, required: true }, // timestamp in ms/seconds from client
        ax: Number,
        ay: Number,
        az: Number,
        gx: Number,
        gy: Number,
        gz: Number,
      },
    ],
  ],

  //  audio section untouched
  audioFiles: [
    {
      filename: String,
      storedName: String,
      mimeType: String,
      // path: String,
      size: Number,
      dangerIndex: Number,
      timestamp: { type: Date, default: Date.now },
    },
  ],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per window
  message: { message: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
const logsignSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(6).max(128).required(),
});
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  passwordHash: String,
});
const adminSchema = new mongoose.Schema({
  adminId: String,
  adminName: String,
  passwordHash: String,
});

//Indexing the data entries
dataSchema.index({ userId: 1 });

const User = mongoose.model("User", userSchema);
const Admin = mongoose.model("Admin", adminSchema);
const Data = mongoose.model("Data", dataSchema);

app.get("/ping", (req, res) => {
  res.status(200).json({ message: "pong" });
});

app.post("/adminlogin", authLimiter, async (req, res) => {
  const { error } = logsignSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  const { username, password } = req.body;

  try {
    const admin = await Admin.findOne({ username });

    if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ adminId: admin.adminId }, JWT_SECRET, {
      expiresIn: "1d",
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/adminsignup", authLimiter, async (req, res) => {
  const { error } = logsignSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  const { adminName, password } = req.body;

  if (!adminName || !password)
    return res.status(400).json({ message: "adminName and password required" });

  if (await Admin.findOne({ adminName }))
    return res.status(409).json({ message: "adminName already taken" });

  const passwordHash = await bcrypt.hash(password, 8);
  const adminId = `admin${Date.now()}`;

  const newUser = new User({ adminId, adminName, passwordHash });
  await newUser.save();

  // const newTodo = new Todo({ userId: userId, tasks: {}, comptasks: {} });
  // await newTodo.save();

  const token = jwt.sign({ adminId: adminId }, JWT_SECRET, { expiresIn: "1d" });
  res.status(201).json({ token });
});

app.get("/adminwhoami", authenticateToken, async (req, res) => {
  const admin = await Admin.findOne({ id: req.adminId });
  if (!admin) return res.status(404).json({ message: "invalid token" });

  res.send({ adminId: admin.id, adminName: admin.adminName });
});

app.post("/login", authLimiter, async (req, res) => {
  const { error } = logsignSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.userId }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/signup", authLimiter, async (req, res) => {
  const { error } = logsignSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.details[0].message });
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ message: "Username and password required" });

  if (await User.findOne({ username }))
    return res.status(409).json({ message: "Username already taken" });

  const passwordHash = await bcrypt.hash(password, 8);
  const userId = `user${Date.now()}`;

  const newUser = new User({ userId, username, passwordHash });
  await newUser.save();

  // const newTodo = new Todo({ userId: userId, tasks: {}, comptasks: {} });
  // await newTodo.save();

  const token = jwt.sign({ userId: userId }, JWT_SECRET, { expiresIn: "7d" });
  res.status(201).json({ token });
});

app.get("/whoami", authenticateToken, async (req, res) => {
  const user = await User.findOne({ id: req.userId });
  if (!user) return res.status(404).json({ message: "invalid token" });

  res.send({ id: user.id, username: user.username });
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.sendStatus(403);
  }
}

/* uploads */
const uploadsDir = process.env.UPLOADS_DIR || "./uploads";
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

//To tell where to store
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) =>
    cb(null, crypto.randomUUID() + (path.extname(file.originalname) || ".mp4")),
});

//Acrually Stores
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

//health
app.get("/health", (req, res) => {
  res.json({
    status: "active",
    timestamp: new Date().toISOString(),
    clientIp: req.clientIp,
  });
});

/* panic */
app.post("/panic", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    const userId = req.userId;

    // const latitude = Number(req.body.latitude);
    // const longitude = Number(req.body.longitude);
    // parse incoming JSON
    const samples = JSON.parse(req.body.samples || "[]");

    let dangerIndex = 0;
    let audioEntry = null;

    if (req.file) {
      sendAudio(`./uploads/${req.file.filename}`)
        .then((res) => {
          console.log(res);
          dangerIndex = res.dangerIndex;
        })
        .catch((err) => console.log(err));
    }

    if (req.file) {
      // dangerIndex = await runDangerDetection('audio', req.file.path);

      audioEntry = {
        filename: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        // path: req.file.path,
        size: req.file.size,
        dangerIndex:dangerIndex,
      };
    }

    const pushOps = {};

    if (audioEntry) {
      pushOps.audioFiles = audioEntry;
    }

    if (samples.length) {
      pushOps.motionSamples = samples;
    }

    await Data.findOneAndUpdate(
      { userId },
      {
        userId,
        ...(Object.keys(pushOps).length && { $push: pushOps }),
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

    res.json({
      status: "panic_received",
      samplesCount: samples.length,
      audioReceived: !!req.file,
      dangerIndex: Number(dangerIndex.toFixed(2)),
    });

    // delete file in 10 min
    if (req.file) {
      setTimeout(() => {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }, 600000);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "panic failed" });
  }
});

/* data (self) */
app.get("/api/data", async (req, res) => {
  const data = await Data.findOne({ userId: req.userId });
  if (!data) return res.status(404).json({ error: "no data" });

  res.json({
    userId: data.userId,
    location: data.location,
    totalAccelerometer: data.accelerometer.length,
    totalGyroscope: data.gyroscope.length,
    totalAudio: data.audioFiles.length,
    latestDanger: data.audioFiles.at(-1)?.dangerIndex || 0,
    updatedAt: data.updatedAt,
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
