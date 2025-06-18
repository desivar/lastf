const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5001', // React app URL
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/pipeline-manager'
  }),
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pipeline-manager');

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// User Schema
const userSchema = new mongoose.Schema({
  githubId: { type: String, unique: true },
  username: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  avatar: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Pipeline Schema
const pipelineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  steps: [{ type: String }],
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Customer Schema
const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Job Schema
const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  pipelineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pipeline', required: true },
  currentStep: { type: String, required: true },
  status: { type: String, enum: ['active', 'completed', 'paused'], default: 'active' },
  dueDate: { type: Date },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Pipeline = mongoose.model('Pipeline', pipelineSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Job = mongoose.model('Job', jobSchema);

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Routes

// Simulate GitHub OAuth (for homework purposes)
app.post('/auth/github', async (req, res) => {
  try {
    // In a real app, you'd verify the GitHub token here
    const { username } = req.body;
    
    // For homework, we'll just accept "desivar" as valid
    if (username !== 'desivar') {
      return res.status(401).json({ error: 'Invalid username' });
    }

    let user = await User.findOne({ username });
    
    if (!user) {
      // Create new user
      user = new User({
        githubId: 'desivar-github-id',
        username: 'desivar',
        name: 'Desivar Developer',
        email: 'desivar@example.com',
        avatar: 'https://avatars.githubusercontent.com/u/desivar?v=4'
      });
      await user.save();

      // Create sample data for new user
      await createSampleData(user._id);
    }

    req.session.userId = user._id;
    res.json({ 
      success: true, 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        githubUsername: user.username
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ success: true });
  });
});

// Get current user
app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      githubUsername: user.username
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    const [activeJobs, totalCustomers, totalPipelines, jobsDueThisWeek] = await Promise.all([
      Job.countDocuments({ userId, status: 'active' }),
      Customer.countDocuments({ userId }),
      Pipeline.countDocuments({ userId }),
      Job.countDocuments({ 
        userId, 
        status: 'active',
        dueDate: { 
          $gte: new Date(), 
          $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
        }
      })
    ]);

    res.json({
      activeJobs,
      totalCustomers,
      totalPipelines,
      jobsDueThisWeek
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Jobs routes
app.get('/api/jobs', requireAuth, async (req, res) => {
  try {
    const jobs = await Job.find({ userId: req.session.userId })
      .populate('customerId', 'name')
      .populate('pipelineId', 'name')
      .sort({ createdAt: -1 });
    
    const formattedJobs = jobs.map(job => ({
      id: job._id,
      title: job.title,
      customer: job.customerId.name,
      pipeline: job.pipelineId.name,
      currentStep: job.currentStep,
      status: job.status,
      dueDate: job.dueDate ? job.dueDate.toISOString().split('T')[0] : null,
      progress: job.progress
    }));

    res.json(formattedJobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/api/jobs', requireAuth, async (req, res) => {
  try {
    const { title, customerId, pipelineId, currentStep, dueDate } = req.body;
    
    const job = new Job({
      title,
      customerId,
      pipelineId,
      currentStep,
      dueDate: dueDate ? new Date(dueDate) : null,
      userId: req.session.userId
    });

    await job.save();
    res.status(201).json({ success: true, jobId: job._id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Customers routes
app.get('/api/customers', requireAuth, async (req, res) => {
  try {
    const customers = await Customer.find({ userId: req.session.userId });
    
    const customersWithJobCounts = await Promise.all(
      customers.map(async (customer) => {
        const activeJobs = await Job.countDocuments({ 
          customerId: customer._id, 
          status: 'active' 
        });
        const totalJobs = await Job.countDocuments({ 
          customerId: customer._id 
        });
        
        return {
          id: customer._id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          activeJobs,
          totalJobs
        };
      })
    );

    res.json(customersWithJobCounts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

app.post('/api/customers', requireAuth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    
    const customer = new Customer({
      name,
      email,
      phone,
      userId: req.session.userId
    });

    await customer.save();
    res.status(201).json({ success: true, customerId: customer._id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Pipelines routes
app.get('/api/pipelines', requireAuth, async (req, res) => {
  try {
    const pipelines = await Pipeline.find({ userId: req.session.userId });
    
    const pipelinesWithJobCounts = await Promise.all(
      pipelines.map(async (pipeline) => {
        const jobCount = await Job.countDocuments({ 
          pipelineId: pipeline._id, 
          status: 'active' 
        });
        
        return {
          id: pipeline._id,
          name: pipeline.name,
          description: pipeline.description,
          steps: pipeline.steps,
          jobCount,
          createdAt: pipeline.createdAt.toISOString().split('T')[0]
        };
      })
    );

    res.json(pipelinesWithJobCounts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pipelines' });
  }
});

app.post('/api/pipelines', requireAuth, async (req, res) => {
  try {
    const { name, description, steps } = req.body;
    
    const pipeline = new Pipeline({
      name,
      description,
      steps,
      userId: req.session.userId
    });

    await pipeline.save();
    res.status(201).json({ success: true, pipelineId: pipeline._id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create pipeline' });
  }
});

// Helper function to create sample data
async function createSampleData(userId) {
  try {
    // Create sample pipelines
    const webPipeline = new Pipeline({
      name: "Web Development",
      description: "Standard web development workflow",
      steps: ["Initial Contact", "Requirements", "Design", "Development", "Testing", "Deployment"],
      userId
    });
    
    const mobilePipeline = new Pipeline({
      name: "Mobile App Development",
      description: "Mobile application development process", 
      steps: ["Discovery", "Wireframes", "UI/UX", "Development", "Beta Testing", "App Store"],
      userId
    });

    await Promise.all([webPipeline.save(), mobilePipeline.save()]);

    // Create sample customers
    const customer1 = new Customer({
      name: "ABC Corp",
      email: "contact@abccorp.com",
      phone: "+1-555-0123",
      userId
    });

    const customer2 = new Customer({
      name: "Tasty Bites",
      email: "info@tastybites.com",
      phone: "+1-555-0456", 
      userId
    });

    const customer3 = new Customer({
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "+1-555-0789",
      userId
    });

    await Promise.all([customer1.save(), customer2.save(), customer3.save()]);

    // Create sample jobs
    const jobs = [
      new Job({
        title: "E-commerce Website",
        customerId: customer1._id,
        pipelineId: webPipeline._id,
        currentStep: "Development",
        status: "active",
        dueDate: new Date('2025-07-01'),
        progress: 60,
        userId
      }),
      new Job({
        title: "Restaurant App", 
        customerId: customer2._id,
        pipelineId: mobilePipeline._id,
        currentStep: "UI/UX",
        status: "active",
        dueDate: new Date('2025-07-15'),
        progress: 30,
        userId
      }),
      new Job({
        title: "Portfolio Site",
        customerId: customer3._id,
        pipelineId: webPipeline._id,
        currentStep: "Testing",
        status: "active",
        dueDate: new Date('2025-06-20'),
        progress: 85,
        userId
      })
    ];

    await Promise.all(jobs.map(job => job.save()));
    console.log('Sample data created for user:', userId);
  } catch (error) {
    console.error('Error creating sample data:', error);
  }
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});