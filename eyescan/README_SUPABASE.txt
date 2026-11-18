PS C:\Users\f23ari30.aror\Downloads\EyeScan_Supabase_Connected\eyescan> git remote -v
origin  https://github.com/MazharYounas/Medical_work.git (fetch)
origin  https://github.com/MazharYounas/Medical_work.git (push)
PS C:\Users\f23ari30.aror\Downloads\EyeScan_Supabase_Connected\eyescan> git fetch origin
remote: Repository not found.
fatal: repository 'https://github.com/MazharYounas/Medical_work.git/' not found
PS C:\Users\f23ari30.aror\Downloads\EyeScan_Supabase_Connected\eyescan> EyeScan — Supabase connected

Requirements: Node.js 18 or newer.

1. Extract this ZIP.
2. Open a terminal in the eyescan folder.
3. Run: node server.js
4. Open: http://localhost:3000

The app uses the dedicated Supabase project EyeScan (project ref: khywsjnfriabcveonglz).
Authentication: Supabase Auth (email/password).
Database: public.profiles and public.eye_images.
Image storage: private Storage bucket eye-images; each doctor's files are stored under their Auth user ID.

Security: browser/server use only the Supabase publishable key. Do NOT add a service_role or secret key to this app.

If sign-in reports "email not confirmed", follow the confirmation link sent to your email before signing in. If the email is missing, check spam or confirm the user under Supabase Auth > Users for testing. Supabase's built-in email sender has strict project limits; wait before retrying a rate-limited signup and avoid repeated attempts. For regular use, configure a custom SMTP provider under Authentication > SMTP Settings. Do not disable email confirmation in production. Configure Auth > URL Configuration for your deployed website URL when deploying publicly.

The old db.json and uploads files are retained in this ZIP as a backup only; the running app no longer reads or writes them. Existing local accounts/images are not automatically migrated.
