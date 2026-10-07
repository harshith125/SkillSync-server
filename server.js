const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const dns = require('dns');
const { initJobExpiryCron } = require('./services/jobExpiryService');

dotenv.config(); // Reload environment variables

// Fallback DNS for Windows networks where MongoDB Atlas SRV lookups may fail
if (process.platform === 'win32' || process.env.ENABLE_CUSTOM_DNS === 'true') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (dnsErr) {
    // Continue if system DNS configuration cannot be changed
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

let lastDbError = null;

// Track mongoose connection events
mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
  lastDbError = null;
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
  lastDbError = err;
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Reconnection will be attempted.');
});

// Allowed Origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://skill-sync-gold.vercel.app',
  'https://www.myskillsync.me',
  'https://myskillsync.me',
  'https://www.myskillsync.me/',
  'https://myskillsync.me/'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.includes('vercel.app') ||
      process.env.NODE_ENV !== 'production'
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// Serve static uploaded files (PDF resumes, avatars)
app.use('/uploads', express.static(path.join(__dirname, '../client/public/uploads')));

// Health check endpoint
app.get('/', (req, res) => {
  res.send('SkillSync API is running');
});

// Detailed API health check & DB status
app.get('/api/health', (req, res) => {
  const readyStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const dbState = readyStates[mongoose.connection.readyState] || 'unknown';
  const isHealthy = mongoose.connection.readyState === 1;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    database: {
      status: dbState,
      readyState: mongoose.connection.readyState,
      hasMongoUri: !!process.env.MONGO_URI,
      lastError: lastDbError ? lastDbError.message : null
    },
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Database guard middleware for API endpoints to prevent 10s buffering timeouts
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/status') {
    return next();
  }

  if (mongoose.connection.readyState !== 1) {
    const readyStates = { 0: 'disconnected', 2: 'connecting', 3: 'disconnecting' };
    const currentState = readyStates[mongoose.connection.readyState] || 'disconnected';
    return res.status(503).json({
      msg: `Database is currently ${currentState}. Please check MongoDB Atlas Network Access (0.0.0.0/0) and MONGO_URI configuration.`,
      dbState: currentState,
      error: lastDbError ? lastDbError.message : 'Database not connected'
    });
  }
  next();
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/ats', require('./routes/ats'));
app.use('/api/google', require('./routes/google'));
app.use('/api/subscription', require('./routes/subscription'));

// Database Connection & Cron Startup
const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn('MONGO_URI not found in environment variables. Database not connected.');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    // Start background cron job for job expiry checks & automated leaderboards
    initJobExpiryCron();
  } catch (err) {
    lastDbError = err;
    console.error('MongoDB connection error:', err.message);
    console.log('Retrying MongoDB connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

connectDB();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
