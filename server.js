const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://skill-sync-gold.vercel.app',
  'https://skill-sync-gold.vercel.app/'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Basic Route
app.get('/', (req, res) => {
  res.send('SkillSync API is running');
});

// Define Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/ats', require('./routes/ats'));

// Database Connection
if (process.env.MONGO_URI) {
  console.log('Attempting to connect to MongoDB...');
  mongoose.connect(process.env.MONGO_URI, {
    // Force IPv4 if needed? No, just timeouts for now
    connectTimeoutMS: 30000, // 30 seconds
  })
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => {
      console.error('MongoDB connection error:', err.message);
      console.error('1. Check your internet connection.');
      console.error('2. Check if your IP address is whitelisted in MongoDB Atlas (Network Access).');
      console.error('3. Verify your username and password in .env');
    });
} else {
  console.log('MONGO_URI not found in environment variables. Database not connected.');
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
