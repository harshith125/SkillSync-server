# SkillSync

SkillSync is a comprehensive job searching platform designed to bridge the gap between candidates and recruiters. It features an automated matching engine that intelligently connects job seekers with opportunities based on skills and experience, facilitating the process with instant email notifications.

## 🚀 Features

*   **User Roles**: Separate portals for Candidates (Interviewees) and Recruiters (Companies).
*   **Smart Matching**: Automated algorithm matching job requirements with candidate skills.
*   **ATS Scoring**: AI-powered resume analysis and scoring using Google Gemini and Natural NLP.
*   **Real-time Notifications**: Email alerts for successful job matches via Nodemailer.
*   **Interactive UI**: Modern, responsive interface built with React, Framer Motion, and 3D elements using Three.js.
*   **Resume Parsing**: Support for parsing PDF and DOCX resumes.

## 🛠 Tech Stack

### Client
*   **React** (Vite)
*   **Vanilla CSS** (for styling)
*   **Framer Motion** (Animations)
*   **Three.js / React Three Fiber** (3D Elements)
*   **Axios** (API Requests)

### Server
*   **Node.js & Express.js**
*   **MongoDB** (Database)
*   **Mongoose** (ODM)
*   **JWT** (Authentication)
*   **Nodemailer** (Email Service)
*   **Google Generative AI** (ATS Scoring)

## 📦 Installation

Prerequisites: Node.js and MongoDB installed.

1.  **Clone the repository** (if applicable)
    ```bash
    # git clone <repository_url>
    cd skillsync
    ```

2.  **Install Dependencies**

    *   **Server**:
        ```bash
        cd server
        npm install
        ```

    *   **Client**:
        ```bash
        cd ../client
        npm install
        ```

3.  **Environment Setup**

    Create a `.env` file in the `server` directory with the following variables:
    ```env
    PORT=5000
    MONGO_URI=your_mongodb_connection_string
    JWT_SECRET=your_jwt_secret
    
    # Email Settings (Nodemailer)
    EMAIL_SERVICE=gmail
    EMAIL_USER=your_email_address
    EMAIL_PASS=your_email_app_password
    
    # AI Settings
    GEMINI_API_KEY=your_gemini_api_key
    ```
    *(Note: Verify the exact variable names in your server code)*

## 🏃‍♂️ Usage

1.  **Start the Backend Server**
    ```bash
    cd server
    npm run dev
    ```
    The server will start on `http://localhost:5000`.

2.  **Start the Frontend Client**
    ```bash
    cd client
    npm run dev
    ```
    The client will start on `http://localhost:5173` (or the port specified by Vite).

## 📄 License

This project is for educational purposes.
