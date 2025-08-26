const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const axios = require('axios');
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();



const saltRounds = 10;

const upload = multer({ dest: 'uploads/review_courses/' });
const app = express();

const PORT = process.env.PORT || 5002;

// ✅ PostgreSQL Connection
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: 5432,
});
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
console.log("GEMINI API Key:", process.env.GEMINI_API_KEY);

app.use(express.json());
app.use(cors());

// ✅ تعريف المجلدات الخاصة بالتحميلات
const uploadsDir = path.join(__dirname, "uploads");
const assignmentsDir = path.join(uploadsDir, "assignments");
const submissionsDir = path.join(uploadsDir, "submissions");
const reviewCoursesDir = path.join(uploadsDir, "review_courses");

// ✅ إنشاء مجلد `uploads` الرئيسي أولاً
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`📂 Created main uploads directory: ${uploadsDir}`);
}

// ✅ جعل مجلد `uploads` متاح للوصول العام
app.use("/uploads", express.static(uploadsDir));

// ✅ دالة لإنشاء المجلدات إذا لم تكن موجودة
const createDirectory = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📂 Created directory: ${dirPath}`);
    }
};

// ✅ إنشاء المجلدات
createDirectory(uploadsDir);
createDirectory(assignmentsDir);
createDirectory(submissionsDir);
createDirectory(reviewCoursesDir);

// ✅ التأكد من الاتصال بقاعدة البيانات
pool.connect()
    .then(() => console.log("✅ Connected to PostgreSQL"))
    .catch(err => console.error("❌ Database connection error:", err));

// ✅ Multer Configuration
const storage = (destination) => multer.diskStorage({
    destination,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const uploadAssignment = multer({ storage: storage(assignmentsDir) });
const uploadSubmission = multer({ storage: storage(submissionsDir) });
const uploadVideo = multer({ storage: storage(reviewCoursesDir) });

// ✅ API لرفع الواجبات
app.post("/api/assignments/upload", uploadAssignment.single("file"), async (req, res) => {
    const { title } = req.body;
    const filePath = req.file ? `/uploads/assignments/${req.file.filename}` : null;

    if (!filePath) {
        return res.status(400).json({ error: "File upload required" });
    }

    try {
        const result = await pool.query(
            "INSERT INTO assignments (title, file_url) VALUES ($1, $2) RETURNING *",
            [title, filePath]
        );
        res.json({ message: "Assignment uploaded successfully!", assignment: result.rows[0] });
    } catch (error) {
        console.error("❌ Error uploading assignment:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ API لجلب الواجبات
app.get("/api/assignments", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM assignments ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Error fetching assignments:", error);
        res.status(500).json({ error: "Server error" });
    }
});




app.delete("/api/assignments/delete/:id", async (req, res) => {
    const { id } = req.params;

    try {
        // أولًا نجيب مسار الملف من قاعدة البيانات
        const result = await pool.query("SELECT file_url FROM assignments WHERE id = $1", [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        const fileUrl = result.rows[0].file_url; // مثل: /uploads/assignments/filename.pdf
        const filePath = path.join(__dirname, "public", fileUrl); // مسار الملف الفعلي

        // نحذف من قاعدة البيانات
        await pool.query("DELETE FROM assignments WHERE id = $1", [id]);

        // نحذف الملف من المجلد
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error("❌ Failed to delete file from disk:", err);
                // مش لازم نرجع خطأ لو فشل حذف الملف من النظام، بس نعرض رسالة تنبيه فقط
            }
        });

        res.json({ message: "Assignment deleted successfully" });

    } catch (error) {
        console.error("❌ Error deleting assignment:", error);
        res.status(500).json({ error: "Server error" });
    }
});









app.post("/api/submissions", upload.single("file"), async (req, res) => {
    const { user_name, user_email } = req.body;
    const filePath = req.file ? `/uploads/submissions/${req.file.filename}${path.extname(req.file.originalname)}` : null;

    if (!filePath) {
        return res.status(400).json({ error: "File upload required" });
    }

    try {
        const result = await pool.query(
            "INSERT INTO submissions (user_name, user_email, file_url) VALUES ($1, $2, $3) RETURNING *",
            [user_name, user_email, filePath]
        );
        res.json({ message: "Submission uploaded successfully", submission: result.rows[0] });
    } catch (error) {
        console.error("❌ Error submitting assignment:", error);
        res.status(500).json({ error: "Server error" });
    }
});


// ✅ API لجلب الواجبات الطلابية
app.get("/api/submissions", async (req, res) => {
    try {
        const result = await pool.query("SELECT id, user_name, user_email, file_url FROM submissions ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Error fetching submissions:", error);
        res.status(500).json({ error: "Server error" });
    }
});


// ✅ API لرفع الفيديوهات
app.post("/api/review-courses/upload", uploadVideo.single("video"), async (req, res) => {
    const { title } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = `/uploads/review_courses/${req.file.filename}`;

    try {
        await pool.query("INSERT INTO review_courses (title, video_path) VALUES ($1, $2)", [title, filePath]);
        res.json({ message: "✅ Video uploaded successfully!" });
    } catch (error) {
        console.error("❌ Error uploading video:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ API لجلب الفيديوهات
app.get("/api/review-courses", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM review_courses ORDER BY id DESC");
        res.json(result.rows);
    } catch (error) {
        console.error("❌ Error fetching videos:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ API لحذف الفيديو
app.delete('/api/review-courses/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM review_courses WHERE id = $1 RETURNING video_path', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "❌ Video not found" });
        }

        const filePath = path.join(__dirname, result.rows[0].video_path.replace("/uploads", "uploads"));

        fs.promises.unlink(filePath)
            .then(() => console.log("✅ File deleted successfully"))
            .catch(err => console.error("⚠️ Error deleting file:", err));

        res.json({ message: "✅ Video deleted successfully!" });

    } catch (error) {
        console.error("❌ Error deleting video:", error);
        res.status(500).json({ error: "Server error" });
    }
});





app.post("/api/gemini-chat", async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage) {
            return res.status(400).json({ error: "الرسالة فارغة!" });
        }

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`
,
            {
                contents: [{ parts: [{ text: userMessage }] }]
            },
            { headers: { "Content-Type": "application/json" } }
        );
        

        console.log("Gemini API Response:", response.data);

        // ✅ استخراج الرد بطريقة صحيحة
        const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "لا يوجد رد متاح!";
        res.json({ reply });

    } catch (error) {
        console.error("❌ خطأ في الاتصال بـ Gemini API:", error.response?.data || error.message);
        res.status(500).json({ error: "حدث خطأ أثناء الاتصال بـ Gemini API" });
    }
});







app.post("/api/admin/evaluations", async (req, res) => {
    console.log("🔔 Hit POST /api/admin/evaluations – body:", req.body);
  
    const { student_name, student_email, subject, grade, level } = req.body;
  
    if (!student_name || !student_email || !subject || grade == null || !level) {
      console.log("❗ Missing fields", req.body);
      return res.status(400).json({ message: "جميع الحقول مطلوبة" });
    }
  
    try {
      const { rows } = await pool.query(
        `INSERT INTO student_evaluations
           (student_name, student_email, subject, grade, level)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [student_name.trim(), student_email.trim(), subject.trim(), grade, level]
      );
      console.log("✅ Inserted:", rows[0]);
      res.json({ message: "تم حفظ التقييم بنجاح ✅", evaluation: rows[0] });
    } catch (err) {
      console.error("❌ Error inserting evaluation:", err);
      res.status(500).json({ message: "حدث خطأ أثناء الحفظ." });
    }
  });
  














// GET /api/student/evaluations?student_name=...
app.get('/api/student/evaluations', async (req, res) => {
    const { student_email } = req.query;
    
    if (!student_email) {
      return res.status(400).json({ error: "student_email query parameter is required" });
    }
  
    try {
      const result = await pool.query(
        `SELECT subject, grade, level 
           FROM student_evaluations 
          WHERE student_email = $1`,
        [student_email.trim()]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Error fetching evaluations:", err);
      res.status(500).json({ error: "Error fetching evaluations." });
    }
  });
  










  









  app.post("/api/auth/register", async (req, res) => {
    console.log("📩 Request Body:", req.body);

    const { username, email, password, name } = req.body;

    if (!username || !email || !password || !name) {
        return res.status(400).json({ error: "Please fill in all fields" });
    }

    // تحديد الدور تلقائيًا حسب الإيميل
    let role = "student";
    if (email === "teacher@example.com") {
        role = "teacher";
    }

    try {
        const existingUser = await pool.query("SELECT * FROM users WHERE username = $1 OR email = $2", [username, email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "Username or Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            "INSERT INTO users (username, email, password, role, name) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [username, email, hashedPassword, role, name]
        );

        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, role: user.role }, "your_jwt_secret", { expiresIn: "1h" });

        res.json({ message: "User registered", token, user: { id: user.id, role: user.role } });
    } catch (error) {
        console.error("❌ Error in register route:", error);
        res.status(500).json({ error: "Server error" });
    }
});






const jwt = require("jsonwebtoken");
const secretKey = "your_secret_key"; // 🔐 غيّري دي بحاجة قوية وخزنيها في env

app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
    }

    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (result.rows.length === 0) {
            return res.status(400).json({ message: "User not found." });
        }

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: "Incorrect password." });
        }

        // تحقق إذا كان المستخدم هو المدرس
        if (email === "teacher@example.com" && user.role !== "teacher") {
            return res.status(400).json({ message: "Only the specified teacher email can login as teacher." });
        }

        // Success: return user data or token if needed
        res.status(200).json({
            message: "Login successful",
            userId: user.id,
            role: user.role,
            name: user.name,
            email: user.email // ✅ رجّع الإيميل هنا

        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error during login." });
    }
});

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});