const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json()); 

const uri = process.env.MONGO_URI; 
const client = new MongoClient(uri);

let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("myAndroidApp"); 
        console.log("Connected to MongoDB!");
    } catch (e) {
        console.error("Database connection error:", e);
    }
}
connectDB();

// 1. PULL COURSE DATA (Android calls this to view courses)
app.get('/get-courses', async (req, res) => {
    try {
        // Fix: Check if db is ready. If not, try to connect or return an error.
        if (!db) {
            return res.status(500).json({ error: "Database not connected yet. Please try again in a moment." });
        }
        const collection = db.collection("items");
        const data = await collection.find({}).toArray();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. PUSH COURSE DATA (Android calls this to upload a course)
app.post('/save-course', async (req, res) => {
    try {
        // Fix: Check if db is ready.
        if (!db) {
            return res.status(500).json({ error: "Database not connected yet. Please try again in a moment." });
        }
        const collection = db.collection("items");
        
        const today = new Date();
        const midnightDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

        const newCourse = {
            courseCode: req.body.courseCode,
            courseName: req.body.courseName,
            year: req.body.year,
            semester: req.body.semester,
            regulation: req.body.regulation,
            fileUrl: req.body.fileUrl,
            createOn: midnightDate, 
            uploadedBy: req.body.uploadedBy
        };

        const result = await collection.insertOne(newCourse);
        res.status(201).json({ message: "Course saved successfully!", id: result.insertedId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
