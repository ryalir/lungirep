const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json()); 

const uri = process.env.MONGO_URI; 
// FIX: Added maxPoolSize and keepAlive to prevent random dropouts
const client = new MongoClient(uri, {
    maxPoolSize: 10,
    socketTimeoutMS: 45000,
    keepAlive: true
});

let db;

async function connectDB() {
    try {
        await client.connect();
        // CHANGED: Your real database name is "lungi"
        db = client.db("lungi"); 
        console.log("Connected to MongoDB!");
    } catch (e) {
        console.error("Database connection error:", e);
    }
}
connectDB();

// 1. PULL COURSE DATA
app.get('/get-courses', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ error: "Database not connected yet. Please try again in a moment." });
        }
        // CHANGED: Your real collection name is "lungi collection1"
        const collection = db.collection("lungi collection1");
        const data = await collection.find({}).toArray();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. PUSH COURSE DATA
app.post('/save-course', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ error: "Database not connected yet. Please try again in a moment." });
        }
        // CHANGED: Your real collection name is "lungi collection1"
        const collection = db.collection("lungi collection1");
        
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
