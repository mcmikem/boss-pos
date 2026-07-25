# IMAC POS - Deployment Guide

## Quick Deploy to Render (Free Permanent URL)

### Step 1: Create a GitHub Repo
1. Go to https://github.com/new
2. Name it `boss-pos` (or any name)
3. Make it **Public** (free tier requires public repo on Render)
4. Don't initialize with README

### Step 2: Push Code to GitHub
Run these commands from your project folder:

```bash
cd /Users/me/Downloads/boss-pos
git init
git add .
git commit -m "IMAC POS - initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/boss-pos.git
git push -u origin main
```

### Step 3: Deploy on Render
1. Go to https://render.com and sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo
4. Settings:
   - **Name:** `imac-pos`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node server.js`
5. Click **"Create Web Service"**
6. Wait 2-3 minutes for first deploy
7. Your permanent URL will be: `https://imac-pos.onrender.com`

### Step 4: Install as PWA on Phones
1. Open `https://imac-pos.onrender.com` on your phone
2. **iPhone:** Tap Share icon → "Add to Home Screen"
3. **Android:** Tap 3-dot menu → "Install App" or "Add to Home Screen"
4. The app icon will appear on your home screen!

### Important Notes
- Render free tier spins down after 15 min of inactivity (first load takes ~30s)
- Data persists in SQLite until the service restarts
- For always-on + persistent data, upgrade to Render paid plan ($7/month)
- Every device shares the same data from the server database
