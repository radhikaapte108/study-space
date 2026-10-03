require('dotenv').config();

const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const express = require('express');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const Assignment = require('./models/Assignment');
const User = require('./models/User');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/study_space';
const DATABASE_NAME = 'study_space';
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || (!isProduction ? randomBytes(48).toString('hex') : null);
const SESSION_COOKIE_NAME = 'study-space.sid';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ASSIGNMENT_STATUSES = ['Pending', 'Partially completed', 'Completed'];

if ((isProduction && !process.env.SESSION_SECRET) ||
    SESSION_SECRET.length < 32 ||
    SESSION_SECRET === 'replace-with-a-long-random-secret') {
  throw new Error('Set SESSION_SECRET to at least 32 random characters; it is required in production.');
}

function createApp({ sessionStore, userModel = User, assignmentModel = Assignment } = {}) {
  const app = express();
  const store = sessionStore || MongoStore.create({
    mongoUrl: MONGODB_URI,
    dbName: DATABASE_NAME,
    collectionName: 'sessions',
    ttl: Math.floor(SESSION_MAX_AGE / 1000)
  });

  if (isProduction) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use(session({
    name: SESSION_COOKIE_NAME,
    secret: SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE
    }
  }));
  app.use(express.static(path.join(__dirname, 'public')));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many sign-in attempts. Please try again in 15 minutes.' }
  });

  function makeCsrfToken(req) {
    if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
    return req.session.csrfToken;
  }

  app.get('/api/auth/session', async (req, res) => {
    try {
      let user = null;
      if (req.session.userId) {
        user = await userModel.findById(req.session.userId).select('name email');
        if (!user) {
          await regenerateSession(req);
          const csrfToken = makeCsrfToken(req);
          await saveSession(req);
          return res.json({ user: null, csrfToken });
        }
      }

      res.json({
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
        csrfToken: makeCsrfToken(req)
      });
    } catch (error) {
      console.error('Could not load the current session:', error.message);
      res.status(500).json({ message: 'Could not load your session.' });
    }
  });

  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const providedToken = req.get('X-CSRF-Token');
    const expectedToken = req.session.csrfToken;
    if (typeof providedToken !== 'string' || typeof expectedToken !== 'string') {
      return res.status(403).json({ message: 'Your session has expired. Refresh the page and try again.' });
    }

    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(expectedToken);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return res.status(403).json({ message: 'Your session has expired. Refresh the page and try again.' });
    }
    next();
  });

  function regenerateSession(req) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
  }

  function saveSession(req) {
    return new Promise((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
  }

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const { name, email, password } = req.body || {};
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
        return res.status(400).json({ message: 'Enter a name between 2 and 80 characters.' });
      }
      if (typeof email !== 'string' || email.trim().length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
      }
      if (typeof password !== 'string' || password.length < 10 ||
          Buffer.byteLength(password, 'utf8') > 72) {
        return res.status(400).json({ message: 'Use a password with at least 10 characters and no more than 72 bytes.' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await userModel.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash
      });

      await regenerateSession(req);
      req.session.userId = user.id;
      const csrfToken = makeCsrfToken(req);
      await saveSession(req);
      res.status(201).json({
        user: { id: user.id, name: user.name, email: user.email },
        csrfToken
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
      if (error.name === 'ValidationError') return res.status(400).json({ message: error.message });
      console.error('Could not register user:', error.message);
      res.status(500).json({ message: 'Could not create your account.' });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Enter your email and password.' });
      }
      const user = await userModel.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ message: 'Email or password is incorrect.' });
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      const csrfToken = makeCsrfToken(req);
      await saveSession(req);
      res.json({
        user: { id: user.id, name: user.name, email: user.email },
        csrfToken
      });
    } catch (error) {
      console.error('Could not sign in user:', error.message);
      res.status(500).json({ message: 'Could not sign in. Please try again.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax'
      });
      res.json({ message: 'Signed out successfully.' });
    } catch (error) {
      console.error('Could not sign out user:', error.message);
      res.status(500).json({ message: 'Could not sign out. Please try again.' });
    }
  });

  async function requireUser(req, res, next) {
    try {
      if (!req.session.userId) return res.status(401).json({ message: 'Please sign in to continue.' });
      const user = await userModel.findById(req.session.userId).select('name email');
      if (!user) return res.status(401).json({ message: 'Please sign in to continue.' });
      req.user = user;
      next();
    } catch (error) {
      console.error('Could not authenticate request:', error.message);
      res.status(500).json({ message: 'Could not verify your session.' });
    }
  }

  app.use('/api/assignments', requireUser);

  // Every assignment operation is scoped to the authenticated user's ID.
  app.get('/api/assignments', async (req, res) => {
    try {
      const filter = { owner: req.user._id };
      if (req.query.status && req.query.status !== 'All') {
        if (!ASSIGNMENT_STATUSES.includes(req.query.status)) {
          return res.status(400).json({ message: 'Status must be Pending, Partially completed, or Completed.' });
        }
        filter.status = req.query.status;
      }

      const assignments = await assignmentModel.find(filter).sort({ deadline: 1, createdAt: -1 });
      res.json(assignments);
    } catch (error) {
      console.error('Could not load assignments:', error.message);
      res.status(500).json({ message: 'Could not load assignments.' });
    }
  });

  app.post('/api/assignments', async (req, res) => {
    try {
      const { subject, title, description, deadline, priority, status } = req.body || {};
      const assignment = await assignmentModel.create({
        owner: req.user._id,
        subject,
        title,
        description,
        deadline,
        priority,
        status
      });
      res.status(201).json(assignment);
    } catch (error) {
      if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({ message: error.message });
      }
      console.error('Could not add assignment:', error.message);
      res.status(500).json({ message: 'Could not add assignment.' });
    }
  });

  app.get('/api/assignments/:id', async (req, res) => {
    try {
      const assignment = await assignmentModel.findOne({ _id: req.params.id, owner: req.user._id });
      if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
      res.json(assignment);
    } catch (error) {
      if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid assignment ID.' });
      console.error('Could not load assignment:', error.message);
      res.status(500).json({ message: 'Could not load assignment.' });
    }
  });

  app.put('/api/assignments/:id', async (req, res) => {
    try {
      const { subject, title, description, deadline, priority, status } = req.body || {};
      const assignment = await assignmentModel.findOneAndUpdate(
        { _id: req.params.id, owner: req.user._id },
        { subject, title, description, deadline, priority, status },
        { new: true, runValidators: true }
      );
      if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
      res.json(assignment);
    } catch (error) {
      if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({ message: error.message });
      }
      console.error('Could not update assignment:', error.message);
      res.status(500).json({ message: 'Could not update assignment.' });
    }
  });

  app.patch('/api/assignments/:id/status', async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!ASSIGNMENT_STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Status must be Pending, Partially completed, or Completed.' });
      }

      const assignment = await assignmentModel.findOneAndUpdate(
        { _id: req.params.id, owner: req.user._id },
        { status },
        { new: true, runValidators: true }
      );
      if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
      res.json(assignment);
    } catch (error) {
      if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid assignment ID.' });
      console.error('Could not change assignment status:', error.message);
      res.status(500).json({ message: 'Could not change assignment status.' });
    }
  });

  app.delete('/api/assignments/:id', async (req, res) => {
    try {
      const assignment = await assignmentModel.findOneAndDelete({
        _id: req.params.id,
        owner: req.user._id
      });
      if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
      res.json({ message: 'Assignment deleted successfully.' });
    } catch (error) {
      if (error.name === 'CastError') return res.status(400).json({ message: 'Invalid assignment ID.' });
      console.error('Could not delete assignment:', error.message);
      res.status(500).json({ message: 'Could not delete assignment.' });
    }
  });

  return app;
}

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, { dbName: DATABASE_NAME });
    console.log(`Connected to MongoDB database "${mongoose.connection.name}".`);
    createApp().listen(PORT, () => {
      console.log(`Study Space is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Could not start the server:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) startServer();

module.exports = { createApp, startServer };
