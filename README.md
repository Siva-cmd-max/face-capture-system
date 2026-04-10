#  FaceVault: Advanced Biometric Identity System
> A production-grade, zero-failure Face Capture and Identity Verification pipeline, built specifically for high-stakes environments like test and examination centers.
---
##  Project Overview
**FaceVault** is a full-stack biometric automation tool built to digitally onboard individuals, prevent duplicate identities, and perform instantaneous identity checks via live webcams. It operates by converting human faces into deep mathematical representations (embeddings) and cross-referencing them against an SQL database with extreme precision.
---
##  Core Technologies Stack
* **Frontend:** React, Vite, Tailwind CSS (Single Page Application architecture)
* **Backend:** Python, FastAPI, Uvicorn (Fully independent asynchronous server)
* **AI & Machine Learning:** DeepFace, ArcFace Model (generates exact 512-D vector embeddings)
* **Database:** SQL Server (stores candidate data and landmark coordinates)
---
##  How The AI Engine Actually Works
Instead of just comparing pixels, the backend uses **Deep Learning (ArcFace)** to understand a face across 512 different dimensions. 
1. **Detection:** When a photo or webcam frame is sent, the AI pinpoints the face and its exact geometric landmarks (left eye, right eye, nose, mouth edges).
2. **Translation:** It feeds this crop into a neural network, extracting a **512-Dimensional Array** (a unique "mathematical fingerprint" for that person).
3. **Comparison:** It uses cosine distance to compare this array against others. A threshold of `0.45` is strictly enforced to easily ignore varied lighting/glasses while absolutely blocking false-positives (lookalike twins).
---
##  The 3 Operational Modes Explained
The application is natively built around three primary logic tracks. Here is a breakdown of what each one does:
### 1️⃣ Mode 1: Bulk Registration (The Onboarding Phase)
> **Goal:** Securely induct authorized candidate faces into the database.
* **How It Works:** Administrators upload either a single photo or a bulk folder of images.
* **Smart Anti-Duplication:** 
  * The system performs a **Level 1 Check (MD5 Hash)**: Immediately rejects files if the exact same image file is uploaded twice.
  * The system performs a **Level 2 Check (Strict Embedding Similarity)**: Runs the ArcFace model at a `0.98` strict threshold. If you try to upload a slightly different cropped photo of the *same person*, the AI stops it, ensuring no individual is registered twice.
* **Saving:** Saves the data, facial arrays, and cropped photos securely into the SQL database.
### 2️⃣ Mode 2: Live Verification / 1-to-N Search (The Gatekeeper)
> **Goal:** Validate people standing in front of a live camera against the entire database.
* **How It Works:** A candidate stands at a physical checkpoint. The webcam captures a frame and sends it to the API endpoint (`/identify-registered`).
* **Deep Database Search:** The system converts that live frame into an embedding array and scans the *entire database* simultaneously to find a match.
* **Zero-Failure Logic:** It enforces a dual-scoring mechanism: the neural ArcFace match must be `>= 0.45` **AND** the physical combined facial geometry score must be `>= 72.5%`. If it matches, the screen flashes green and grants identity approval.
### 3️⃣ Mode 3: Strict Photo-vs-Photo Comparison (The 1-to-1 Spot Check)
> **Goal:** A standalone tool to manually compare two photos without using the database.
* **How It Works:** A user uploads a **Left Image** (e.g., an ID card photo) and a **Right Image** (e.g., a selfie).
* **Direct Calculation:** The system completely bypasses the database. It instantly calculates the exact mathematical distance between those two specific images.
* **Instant Result:** Outputs the raw cosine score, match percentages, bounding boxes, and confirms natively: **"Identity Verified: Same Person"** or **"Not Matched: Different Person"**.
---
##  Process of How to Run the Project Locally
Because the layout features a fully detached Backend and Frontend, you must run them sequentially in two separate terminal windows.
### Step 1: Starting the AI Backend (Python)
The backend loads the AI models into RAM and spins up the API endpoints.
1. Open a terminal and navigate to the backend folder:
   ```bash
   cd "PyBackend"
   ```
2. Activate your Virtual Environment (if you have one setup).
3. Install the required Python packages (only needed the first time):
   ```bash
   pip install -r requirements.txt
   ```
4. Start the FastAPI server using the dedicated batch file:
   ```bash
   start_backend.bat
   ```
   *(Wait until the console logs: `"✅ Model ready — all uploads will now be < 200 ms."`)*
### Step 2: Starting the User Interface (React)
This spins up the graphical interface that connects to your webcam and talks to the FastAPI server.
1. Open a **new, separate terminal** and navigate to the frontend folder:
   ```bash
   cd "Frontend"
   ```
2. Install the necessary Node dependencies (only needed the first time):
   ```bash
   npm install
   ```
3. Boot up the Vite developer server:
   ```bash
   npm run dev
   ```
4. **Open your browser:** The terminal will supply a local URL (e.g., `http://localhost:5173`). Click it to access the visual dashboard and start verifying faces!
