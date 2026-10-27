SMART ATTENDANCE — BACKEND PACKAGE

WHAT'S INCLUDED
- public/college.html: College/Staff portal connected to API
- public/admin.html: Private owner panel connected to API
- server.js: Express backend + persistent JSON database

RUN LOCALLY
1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run: npm install
4. Set secure environment variables before first run:
   OWNER_EMAIL=your-owner-email
   OWNER_PASSWORD=use-a-strong-unique-password
   (PowerShell: $env:OWNER_EMAIL='...'; $env:OWNER_PASSWORD='...')
5. Run: npm start
6. Open http://localhost:3000/admin.html and http://localhost:3000/college.html

INITIAL DEMO ACCOUNTS (CHANGE THESE BEFORE REAL USE)
Owner: owner@smartattend.com / Owner@123
College: rkcollege / RK@12345 (other seeded accounts are in data.json after first run)
Staff: staff@demo.com / Staff123

IMPORTANT LIMITATIONS / SECURITY
- This is a starter backend, not a fully audited production system. Use HTTPS and strong secrets.
- JSON file storage is suitable for a small demo only; use PostgreSQL/SQL Server for production.
- Create a backup before deployment. Owner's college password reset/creation workflow should be completed before public launch.
- Publishing requires a hosting account and environment variables; this package does not itself upload to the internet.
