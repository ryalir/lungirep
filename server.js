// Load local environment variables if running locally
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { google } = require('googleapis');
const { Readable } = require('stream');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to process traditional JSON requests
app.use(express.json());

// 1. Connect to MongoDB using your updated Render Env Variable (Targeting 'lungi' DB)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected to lungi database'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 2. Exact Match Course Schema mapping to your exact collection
const CourseSchema = new mongoose.Schema({
  courseCode: { type: String, required: true },
  courseName: { type: String, required: true },
  year: String,
  semester: String,
  regulation: String,
  fileUrl: String, 
  uploadedBy: String,
  createOn: { type: Date, default: Date.now } 
}, { 
  // This explicitly forces Mongoose to use your exact collection name instead of auto-pluralising it
  collection: 'lungi collection1' 
});

const CourseModel = mongoose.model('Course', CourseSchema);

// 3. Configure Multer to process files in memory safely
const upload = multer({ storage: multer.memoryStorage() });

// 4. Initialize Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2Client });


// 5. Save Course with File Upload Endpoint (With Detailed Diagnostics)
app.post('/save-course', upload.single('file'), async (req, res) => {
  try {
    // 🔍 SERVER LOGS: Check your Render console for these outputs!
    console.log("=== NEW UPLOAD REQUEST ===");
    console.log("Received Body Fields:", req.body);
    console.log("Is File Attached?:", req.file ? "YES" : "NO");
    if (req.file) {
      console.log(`File Name: ${req.file.originalname}, MimeType: ${req.file.mimetype}, Size: ${req.file.size} bytes`);
    }

    const { courseCode, courseName, year, semester, regulation, uploadedBy } = req.body;

    if (!courseCode || !courseName) {
      return res.status(400).json({ error: 'courseCode and courseName are required.' });
    }

    let finalFileUrl = "";

    if (req.file) {
      const fileStream = Readable.from(req.file.buffer);
      
      // Upload the file binary chunk
      const driveResponse = await drive.files.create({
        requestBody: {
          name: req.file.originalname,
          parents: [process.env.GOOGLE_FOLDER_ID]
        },
        media: {
          mimeType: req.file.mimetype,
          body: fileStream
        },
        fields: 'id, webViewLink' // Added 'id' to change permissions next
      });

      const fileId = driveResponse.data.id;
      finalFileUrl = driveResponse.data.webViewLink;
      console.log("Google Drive Upload Successful. File ID:", fileId);

      // 🔐 CHANGE PERMISSIONS: This ensures anyone with your MongoDB link can open the file
      try {
        await drive.permissions.create({
          fileId: fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
        console.log("File visibility set to 'Anyone with link'.");
      } catch (permError) {
        console.warn("Could not alter file permissions automatically:", permError.message);
      }
    } else {
      console.warn("⚠️ Warning: Request skipped Google Drive because 'req.file' is undefined.");
    }

    // Save metadata completely inline with your document structure
    const newCourse = new CourseModel({
      courseCode,
      courseName,
      year,
      semester,
      regulation,
      fileUrl: finalFileUrl, // Will be an empty string if req.file is missing
      uploadedBy: uploadedBy || 'Anonymous'
    });

    await newCourse.save();
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
    // Fetches all entries sorted by the newest creation date from lungi collection1
    const courses = await CourseModel.find().sort({ createOn: -1 });
    res.status(200).json(courses);
  } catch (error) {
    console.error('Get Courses Error:', error);
    res.status(500).json({ error: 'Failed to retrieve courses.' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server is active.');
});

app.listen(port, () => console.log(`Server running on port ${port}`));
