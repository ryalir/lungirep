// Load local environment variables if running locally
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const { Readable } = require('stream');
// Import Firebase Admin SDK
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to process traditional JSON requests
app.use(express.json());

// Initialize Firebase Admin securely using Render Environment Variable
try {
  const firebaseJson = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(firebaseJson)
  });
  console.log("Firebase Admin SDK Initialized Successfully.");
} catch (fbError) {
  console.error("Firebase Initialization Error. Check your Environment Variable:", fbError.message);
}

// 1. Connect to MongoDB using your updated Render Env Variable (Targeting 'lungi' DB)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected to lungi database'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 2. Course Schema mapping to your exact collection
const CourseSchema = new mongoose.Schema({
  courseCode: { type: String, required: true },
  courseName: { type: String, required: true },
  year: String,
  semester: String,
  regulation: String,
  category: String, 
  fileUrl: String, 
  uploadedBy: String,
  createOn: { type: Date, default: Date.now } 
}, { 
  collection: 'lungi collection1' 
});

const CourseModel = mongoose.model('Course', CourseSchema);


// 🌟 NEW SCHEMA ADDED: Tracks the history of sent push notifications
const NotificationHistorySchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  topic: { type: String, default: 'courses' },
  sentAt: { type: Date, default: Date.now }
}, {
  // Explicitly forces Mongoose to save inside a new collection called 'notification collection'
  collection: 'notification collection'
});

const NotificationHistoryModel = mongoose.model('NotificationHistory', NotificationHistorySchema);


// 3. Configure Multer to process files in memory safely
const upload = multer({ storage: multer.memoryStorage() });

// 4. Initialize Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });


// 5. Save Course with File Upload Endpoint
app.post('/save-course', upload.single('file'), async (req, res) => {
  try {
    console.log("=== NEW UPLOAD REQUEST ===");
    const { courseCode, courseName, year, semester, regulation, category, uploadedBy } = req.body;

    if (!courseCode || !courseName) {
      return res.status(400).json({ error: 'courseCode and courseName are required.' });
    }

    let finalFileUrl = "";

    if (req.file) {
      const fileStream = Readable.from(req.file.buffer);
      const driveResponse = await drive.files.create({
        requestBody: {
          name: req.file.originalname,
          parents: [process.env.GOOGLE_FOLDER_ID]
        },
        media: { mimeType: req.file.mimetype, body: fileStream },
        fields: 'id, webViewLink'
      });

      const fileId = driveResponse.data.id;
      finalFileUrl = driveResponse.data.webViewLink;

      try {
        await drive.permissions.create({
          fileId: fileId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (permError) {
        console.warn("Could not alter file permissions automatically:", permError.message);
      }
    }

    // Save metadata completely inline with your document structure
    const newCourse = new CourseModel({
      courseCode,
      courseName,
      year,
      semester,
      regulation,
      category, 
      fileUrl: finalFileUrl, 
      uploadedBy: uploadedBy || 'Anonymous'
    });

    await newCourse.save();

    // Broadcast a Push Notification and log it to MongoDB
    try {
      const notifTitle = '🆕 New Course Added!';
      const notifBody = `${courseCode}: ${courseName} has been uploaded by ${uploadedBy || 'Anonymous'}.`;

      const message = {
        notification: {
          title: notifTitle,
          body: notifBody
        },
        android: {
          notification: {
            channelId: 'eduhub_notifications' // Targets your exact Android channel string
          }
        },
        topic: 'courses' 
      };

      // A. Send across the live Firebase network
      const response = await admin.messaging().send(message);
      console.log('Push Notification Broadcasted Successfully:', response);

      // B. 🌟 NEW LOGIC: Save a copy of this sent alert into MongoDB Atlas permanently
      const historicLog = new NotificationHistoryModel({
        title: notifTitle,
        body: notifBody,
        topic: 'courses'
      });
      await historicLog.save();
      console.log('Notification saved to MongoDB history collection.');

    } catch (pushError) {
      console.error('Failed to process notification sequence:', pushError.message);
    }

    res.status(201).json({ 
      message: req.file ? 'Course and file saved successfully!' : 'Course details saved, but NO file was received.', 
      course: newCourse 
    });

  } catch (error) {
    console.error('CRITICAL ERROR during save-course execution:', error);
    res.status(500).json({ error: 'Server failed to save course structure.', details: error.message });
  }
});


// 6. Get Courses Endpoint
app.get('/get-courses', async (req, res) => {
  try {
    const courses = await CourseModel.find().sort({ createOn: -1 });
    res.status(200).json(courses);
  } catch (error) {
    console.error('Get Courses Error:', error);
    res.status(500).json({ error: 'Failed to retrieve courses.' });
  }
});


// 🌟 NEW ENDPOINT ADDED: Allows Android app to pull the saved notification history logs
app.get('/get-notifications', async (req, res) => {
  try {
    // Fetches history rows from 'notification collection' sorted with newest alerts first
    const alertsLogs = await NotificationHistoryModel.find().sort({ sentAt: -1 });
    res.status(200).json(alertsLogs);
  } catch (error) {
    console.error('Get Notifications History Error:', error);
    res.status(500).json({ error: 'Failed to retrieve notification historical logs.' });
  }
});


// 7. DETAILED DELETE ENDPOINT
app.delete('/delete-course/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ error: 'Invalid course ID format.' });
    }

    const course = await CourseModel.findById(courseId);
    if (!course) {
        return res.status(404).json({ error: 'Course record not found in MongoDB.' });
    }

    const url = course.fileUrl;
    if (url && url.includes("/d/")) {
        try {
            const fileId = url.split("/d/").split("/");
            await drive.files.delete({ fileId: fileId });
        } catch (driveError) {
            console.error("⚠️ Google Drive deletion warning:", driveError.message);
        }
    }

    await CourseModel.findByIdAndDelete(courseId);
    res.status(200).json({ message: 'Course and corresponding cloud file deleted successfully!' });

  } catch (error) {
    console.error('CRITICAL ERROR during delete-course execution:', error);
    res.status(500).json({ error: 'Server failed to process file deletion.', details: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server is active.');
});

app.listen(port, () => console.log(`Server running on port ${port}`));
