# Study Space

Study Space is a private assignment planner for students. Each student creates an account and can only access their own assignments. The application uses HTML, CSS, and browser JavaScript, Node.js and Express, and MongoDB through Mongoose.

## Requirements

- Node.js and npm
- MongoDB Community Server running locally, or a MongoDB Atlas cluster

## Install and run

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` if you are setting up a fresh installation.
3. Set `MONGODB_URI` to your local MongoDB URL or Atlas connection string.
4. Set `SESSION_SECRET` to a unique random value. Generate one with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Start MongoDB, then run `npm run dev` or `npm start`.
6. Open `http://localhost:3000`, create an account, and add assignments.

The app always selects the `study_space` database from `MONGODB_URI`, even if the URI already names a different database. This keeps Study Space accounts, assignments, and sessions separate from the original Student Assignment Manager database without requiring changes to existing `.env` credentials. In local development only, the server generates a temporary session secret if `SESSION_SECRET` is not set; sessions will be invalidated when the server restarts. Production requires an explicitly configured secret. Never commit `.env` or share its contents.

## Accounts and privacy

- Registration requires a name, a valid email, and a password of at least 10 characters.
- Passwords are stored as bcrypt hashes, never as plain text.
- Login state is held in a server-side session stored in the Study Space MongoDB database. The session cookie is HTTP-only and uses `SameSite=Lax`; production cookies are secure and require HTTPS.
- Mutating API requests require a session-bound CSRF token.
- Every assignment stores its owner's MongoDB user ID. The API scopes reads, updates, status changes, and deletes to the signed-in owner's ID. The server ignores any owner ID submitted by the browser.
- Authentication attempts are rate-limited.

Existing assignment records created before accounts were added do not have an owner and are intentionally not shown to any account. They are not automatically assigned to the first user to sign in. Back up the database before deciding whether to remove or manually migrate those legacy records.

## Assignment features

- Create, edit, delete, and update assignment progress.
- Track subject, title, optional details, due date, and priority.
- Includes Pending, Partially completed, and Completed statuses.
- Filter by status and search your own assignments.
- View total, pending, completed, and due-soon counts.

## API routes

| Method | Route | Operation |
| --- | --- | --- |
| GET | `/api/auth/session` | Get the current user and a session CSRF token |
| POST | `/api/auth/register` | Create an account and sign in |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/assignments` | List the current user's assignments; optional status filter |
| GET | `/api/assignments/:id` | Read one of the current user's assignments |
| POST | `/api/assignments` | Create an assignment for the current user |
| PUT | `/api/assignments/:id` | Update one of the current user's assignments |
| PATCH | `/api/assignments/:id/status` | Change progress on the current user's assignment |
| DELETE | `/api/assignments/:id` | Delete one of the current user's assignments |

All assignment routes require authentication. All POST, PUT, PATCH, and DELETE requests require the `X-CSRF-Token` returned by `/api/auth/session` or an authentication response.

## Deployment

Deploy the Node.js app to a host that supports a persistent Express process and HTTPS. Configure `MONGODB_URI`, a strong unique `SESSION_SECRET`, `NODE_ENV=production`, and (if needed) `PORT` as host environment variables. Use a MongoDB Atlas database with network access restricted to the deployment host. The app uses the `study_space` database within the configured MongoDB cluster. Do not put secrets in frontend code or commit them. MongoDB-backed sessions allow application instances to share login sessions; all instances must use the same session secret and database.
