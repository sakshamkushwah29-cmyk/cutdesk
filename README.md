# Cutdesk

Cutdesk is a review bench for video, audio, stills, and documents. New uploads are stored on the machine running the app, in `STORAGE_DIR` (default `./storage`). PostgreSQL, run by Docker, stores projects, versions, comments, and share links. It does not store the video bytes.

This version plays the original file through an authenticated range proxy. It does not transcode, burn in a watermark, or apply DRM. The watermark on a share link is an on-screen overlay.

## What you can do

- Sign in with Google and open a bench. Invite people who already have a Cutdesk account.
- Create projects and folders.
- Upload a file in 256 KB chunks onto this server, then stack a new version on the same asset. A review link plays that file back.
- Play the file, step one frame at a time (24 fps display step), and leave timecoded comments with pen or box marks.
- Set workflow status to Needs Review, In Progress, or Approved.
- Send a review link. Guests can view, comment, and download without an account.

## Run it

Port 3000 is often already taken, so the dev server uses **3010**.

1. Start Docker Desktop, then start Postgres:

```bash
docker compose up -d
```

2. Copy the env file if you do not already have `.env`:

```bash
cp .env.example .env
```

Set `APP_SECRET` to a long random string. The checked-in example is a placeholder. A local `.env` is already created in this workspace with a generated secret and empty Google credentials.

3. Create the tables and start the app:

```bash
npm install
npx prisma db push
npm run dev
```

Open http://localhost:3010.

## Sign in with Google

Member sign-in and sign-up go through Clerk at `/sign-in` and `/sign-up`. Google is the social login. A new Google account gets a bench named after that person. Review links keep working with the share cookie and do not require Clerk.

The Clerk keys belong only in `.env`, which is gitignored. Pull them with:

```bash
npx clerk env pull
```

Development uses Clerk’s shared Google credentials, so localhost does not need your own Google client id. A public domain does. That Google client is separate from the optional Drive connection below.

Uploads work without Google Drive. A finished upload is marked ready and can be played from `/api/media/:versionId` and from a review link.

Each bench stores 2 GB, 2 projects, and 2 members. The other ceiling is free space on this machine. There is no paid plan. Docker and Docker Hub do not add a disk. Point `STORAGE_DIR` at another volume if you have one.

## Connect Google Drive

Google Drive is optional. It only plays and deletes files that were uploaded to Drive before server storage. New uploads are not sent to Drive, and connecting an account does not add space.

1. In Google Cloud Console, create a project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. While the app is in testing, add your Google account as a test user.
3. Create an OAuth client of type **Web application**.
4. Add this authorized redirect URI:

```text
http://localhost:3010/api/google/callback
```

5. Paste the client id and secret into `.env`:

```text
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3010/api/google/callback
NEXT_PUBLIC_APP_URL=http://localhost:3010
```

6. Restart `npm run dev`. In the app, open Settings and choose Connect Google Drive.

Cutdesk requests `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`, with offline access. That scope only covers files this app creates. A connected account can still play and delete files that were uploaded to Drive earlier. Files are not made public. Refresh tokens are encrypted with `APP_SECRET`.

If Google does not return a refresh token, remove Cutdesk’s access at https://myaccount.google.com/permissions and connect again.

Storage limits use decimal units (1 GB = 1,000,000,000 bytes). Uploads also stop when the machine runs out of disk.

## Not in this version

HLS or FFmpeg transcodes, mounted storage, camera ingest, a Premiere panel, speaker labels, SSO beyond Google sign-in, multiple workspaces, forensic watermarking, and DRM.
