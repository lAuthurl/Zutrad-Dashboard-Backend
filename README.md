# Zutrad Backend

Zutrad Backend is the Node.js/Express API for managing clients, maintenance logs, reports, store items, supply entries, and calendar events for the Zutrad platform.

## Features

- Authentication and role-based access control
- Client and machine management
- Maintenance logging and completion tracking
- Report submission, approval, rejection, and deletion
- Store and supply management with file attachments
- Calendar event management
- MongoDB persistence with Mongoose

## Tech Stack

- Node.js
- Express.js
- MongoDB with Mongoose
- JSON Web Tokens (JWT)
- Multer for file uploads
- CORS and dotenv support

## Prerequisites

- Node.js 18+
- MongoDB instance
- npm

## Environment Variables

Create a .env file in the project root with values such as:

```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/zutrad
JWT_SECRET=your_secret_key
```

## Installation

```bash
npm install
```

## Running the Server

Start the backend in development mode:

```bash
npm run dev
```

Or run it directly:

```bash
npm start
```

## Project Structure

```text
config/         Database connection setup
middleware/     Auth middleware and access control
models/         Mongoose schemas
routes/         API route handlers
seed.js         Seed data for development
server.js       Application entry point
```

## Main API Areas

- Auth: login, signup, profile, settings, and user management
- Clients: create, update, delete, and manage client machines
- Maintenance: create and complete maintenance logs
- Reports: submit and moderate reports
- Store: manage stock items
- Supply: create supply entries and upload files
- Calendar: manage calendar events

## Notes

- File uploads are stored under the uploads directory.
- Some routes require authentication and/or admin/superadmin privileges.
- The API uses JSON responses and supports multipart uploads for file-based features.
