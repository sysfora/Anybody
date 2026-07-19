<div align="center">

<img src="assets/LogoFavicon.png" alt="App Logo" width="128" style="display: block; margin: 0 auto;" />

# Anybody

[![AGPL License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8.svg)](https://tailwindcss.com/)

**Anybody — The Open-Source AI App Builder**

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage-guide) • [Contributing](#-contributing) • [Support](#-support)

---

</div>

## 📖 Table of Contents

- [About](#-about)
- [Features](#-features)
- [Technology Stack](#-technology-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Running the Application](#-running-the-application)
- [Building for Production](#-building-for-production)
- [Usage Guide](#-usage-guide)
- [WebSocket Events](#-websocket-events)
- [Project Structure](#-project-structure)
- [Configuration](#-configuration)
- [Contributing](#-contributing)
- [Code of Conduct](#-code-of-conduct)
- [Support](#-support)
- [Roadmap](#-roadmap)
- [License](#-license)
- [Acknowledgments](#-acknowledgments)
- [About Sysfora](#-about-sysfora)

---

## 🌟 About

**Anybody** is an AI-powered app generator. Enter a prompt, attach optional files, and watch your application get built in real time.

### Why This Project?

- **Free and Open Source** — Licensed under AGPL-3.0
- **Real-time Generation** — WebSocket-driven status and code streaming as the app is built
- **File Attachments** — Upload up to 5 files (10MB each) for context and references
- **Project Control** — Start, cancel, and resume generation; auto-reconnect on disconnect
- **Code Preview** — Character-by-character file streaming with auto-scroll
- **Modern Stack** — Next.js 16, React 19, TypeScript, Tailwind CSS
- **Responsive** — Works on desktop and mobile
- **Actively Maintained** — Regular updates and community support

---

## ✨ Features

### 📡 Real-time Generation
- **Live WebSocket** — Status updates and code streaming as your app is built
- **Step-by-step Progress** — Numbered status tracking so you always know where things stand
- **Code Preview** — Character-by-character file streaming; see code as it’s written
- **Project Control** — Start, cancel, and resume project generation
- **Reconnection** — Automatic reconnection and progress resumption if the connection drops

### 🎯 Main App
- **Project Details** — Username, project name, and prompt
- **File Upload** — Up to 5 attachments, 10MB each
- **Status Display** — Real-time step and message updates
- **File Stream** — Live code preview with syntax-aware display
- **Error Handling** — Clear messages for build, upload, and runtime errors

### 🎨 General
- **Responsive Design** — Works on different screen sizes
- **TypeScript** — Full type safety across the application
- **Auto-scroll** — Code preview scrolls as content streams

---

## 🛠️ Technology Stack

### Frontend
- **[Next.js 16](https://nextjs.org/)** — React framework and app router
- **[React 19](https://reactjs.org/)** — UI library
- **[TypeScript 5](https://www.typescriptlang.org/)** — Type-safe JavaScript
- **[Tailwind CSS 4](https://tailwindcss.com/)** — Utility-first CSS
- **[Socket.IO Client](https://socket.io/)** — Real-time WebSocket communication
- **[Radix UI](https://www.radix-ui.com/)** — Accessible components
- **[Lucide React](https://lucide.dev/)** — Icons

### Backend / Services
- **Next.js API Routes** — Serverless API and server logic
- **Socket.IO** — WebSocket server for streaming and status

### Development Tools
- **npm** — Package manager
- **ESLint** — Linting
- **TypeScript** — Type checking

---

## 📋 Prerequisites

Before installing, ensure you have the following:

### Required Software

1. **Node.js** (v20 or higher) — [Download](https://nodejs.org/)
2. **npm** — Node package manager

### Backend

The frontend expects a backend server (e.g. for generation and WebSocket). Ensure it is running and that `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` in `.env.local` point to it.

---

## 📥 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Sysfora/Anybody.git
cd Anybody
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env.local` file in the project root:

```env
# Backend API
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_WS_URL=http://localhost:5000

# File upload
NEXT_PUBLIC_MAX_ATTACHMENTS=5
NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB=10
```

---

## 🚀 Running the Application

### Development Mode

Run the Next.js development server with hot-reload:

```bash
npm run dev
```

Then open **http://localhost:3000** in your browser.

> 💡 Ensure the backend server is running before starting the frontend.

### Production Mode (after build)

```bash
npm run build
npm run start
```

Then open **http://localhost:3000**.

---

## 📦 Building for Production

### Prerequisites

- Dependencies installed (`npm install`)
- `.env.local` (or production env) configured
- Backend server available for API and WebSocket

### Build

```bash
npm run build
```

Output is in the `.next` directory. Serve with:

```bash
npm run start
```

### Build Troubleshooting

**Build fails:**
```bash
rm -rf node_modules .next
npm install
npm run build
```

**Environment issues:** Ensure all `NEXT_PUBLIC_*` variables are set for the environment where you build.

---

## 📚 Usage Guide

### Getting Started

1. **Launch the App** — Run `npm run dev` and open http://localhost:3000.
2. **Project Details** — Enter username, project name, and your prompt.
3. **Attachments** *(optional)* — Upload up to 5 files, 10MB each.
4. **Start Generation** — Click **Start Generation** to begin.
5. **Monitor Progress** — Watch status updates and code stream in real time.
6. **Cancel** — Use **Cancel Project** if you need to stop.
7. **Resume** — If disconnected, use **Resume Connection** to reconnect.

### Main Flow

- **Message / Prompt** — Describe the app you want to generate.
- **Files** — Add reference files (e.g. specs, mockups) for context.
- **Status** — Step-by-step status shows current phase.
- **Code Preview** — Streamed file content with auto-scroll.

---

## 🔌 WebSocket Events

### Client → Server

| Event | Purpose |
|-------|--------|
| `start_generation` | Start project generation |
| `subscribe_to_project` | Subscribe to project updates |

### Server → Client

| Event | Purpose |
|-------|--------|
| `connected` | Connection confirmed |
| `generation_started` | Generation process started |
| `status_update` | Status update with step number |
| `file_start` | File streaming started |
| `file_content` | File content chunk |
| `file_end` | File streaming completed |
| `project_completed` | Project generation completed |
| `project_cancelled` | Project was cancelled |
| `project_error` | Error occurred |
| `build_error` | Build process error |
| `upload_error` | Upload process error |

---

## 📁 Project Structure

```
Anybody/
│
├── app/                          # Next.js app router
│   ├── page.tsx                  # Home / main page
│   ├── layout.tsx                # Root layout
│   ├── globals.css               # Global styles
│   ├── chat/                     # Chat / generation UI
│   │   ├── page.tsx
│   │   └── [projectId]/page.tsx
│   ├── projects/                 # Projects list
│   ├── login/                    # Auth
│   ├── register/
│   ├── settings/
│   ├── team/
│   ├── subscription/
│   ├── choose-plan/
│   ├── invite/
│   ├── verify-account/
│   └── api/                      # API routes
│       ├── credits/
│       ├── projects/
│       ├── stripe/
│       ├── subscription/
│       ├── team/
│       ├── user/
│       └── users/
│
├── components/                   # React components
│   ├── Home/                     # Landing (Navbar, Footer, etc.)
│   ├── Dashboard/                # Chat, projects, settings, team, etc.
│   └── ui/                       # UI primitives (button, card, dialog, etc.)
│
├── lib/                          # Utilities (socket, PocketBase, etc.)
│
├── hooks/                        # React hooks
├── context/                      # React context
│
├── server/                       # Server-side logic (if used)
│   ├── prompts/
│   ├── services/
│   ├── states/
│   └── utils/
│
├── public/                       # Static assets
├── assets/                       # App icon & branding
├── package.json
├── LICENSE                       # AGPL-3.0
└── README.md
```

---

## ⚙️ Configuration

### Frontend environment variables (`.env` or `.env.local`)

Create `.env` or `.env.local` in the **project root** (Next.js frontend).

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_POCKETBASE_URL` | PocketBase instance URL (e.g. `https://control.anybody.dev`) |
| `POCKETBASE_SUPERADMIN_EMAIL` | PocketBase superadmin email |
| `POCKETBASE_SUPERADMIN_PASSWORD` | PocketBase superadmin password |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (e.g. `pk_test_...` or `pk_live_...`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side only; e.g. `sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (e.g. `whsec_...`) |
| `NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID` | Stripe Price ID for monthly subscription |
| `NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID` | Stripe Price ID for yearly subscription |
| `NEXT_PUBLIC_APP_URL` | Public app URL (e.g. `https://anybody.dev`) |
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port (e.g. `587`) |
| `SMTP_SECURE` | Use TLS (`true`/`false`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password / app password |
| `SMTP_FROM_EMAIL` | From address for outgoing email |
| `SMTP_FROM_NAME` | From display name (e.g. `Anybody`) |
| `NEXT_PUBLIC_API_URL` | Backend API base URL (e.g. `https://app.anybody.dev` or `http://localhost:5000`) |
| `NEXT_PUBLIC_WS_URL` | WebSocket server URL (same as API in most setups) |
| `NEXT_PUBLIC_MAX_ATTACHMENTS` | Max number of file attachments (default: `5`) |
| `NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB` | Max file size per attachment in MB (default: `10`) |

#### Chat projects (PocketBase)

When signed in, the Next app creates a `projects` row (`POST /api/projects/create`) and navigates to `/chat/{projectName}` as soon as you send a message. The **Python Socket.IO server** (`npm run dev:ws`) runs generation **in the background**: disconnecting the browser does not cancel the job. It writes **partial HTML** and **chat rows** to PocketBase while streaming, then sets `projects.status` to `completed` (or `error` / `cancelled`). Configure the same PocketBase URL and superadmin credentials for `uvicorn` (see `server/README.md`; root `.env` is auto-loaded if `python-dotenv` is installed). `GET /api/projects/load` returns saved **HTML**, **messages**, and **status** so a refresh restores the thread and preview.

**Collection: `project_messages`** (create in PocketBase Admin → Collections)

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `project` | Relation | Yes | Single relation → collection **`projects`** |
| `role` | Select | Yes | Values: **`user`**, **`assistant`** |
| `content` | Text | Yes | Message body (assistant may be empty while streaming) |
| `thinking` | Text | No | Assistant “reasoning” text (optional) |
| `request_id` | Text | No | Correlates with Socket.IO `request_id` for a single generation turn |

Enable **list/view** rules as needed (the Next.js `load` route uses the superadmin API; the Python server also uses admin credentials to create/update rows). Optionally turn on **cascade delete** on the relation so deleting a `projects` record removes its messages (the app also deletes related `project_messages` before deleting a project in `DELETE /api/projects`).

---

### Backend environment variables (`server/.env`)

Create `.env` in the **`server/`** directory (Flask/generation backend).

#### Flask

| Variable | Description |
|----------|-------------|
| `FLASK_APP` | Flask application entry (e.g. `app.py`) |
| `FLASK_ENV` | Environment: `development` or `production` |
| `SECRET_KEY` | Flask secret key (use a strong random value in production) |

#### Repository / GitHub

| Variable | Description |
|----------|-------------|
| `REPO_URL` | Template repository URL (e.g. `https://github.com/sysfora/Anybody-Template.git`) |
| `REPO_BRANCH` | Branch to use (e.g. `main`) |
| `GITHUB_TOKEN` | GitHub personal access token (repo scope) |

#### Server

| Variable | Description |
|----------|-------------|
| `HOST` | Bind host (e.g. `0.0.0.0`) |
| `PORT` | Server port (e.g. `5000`) |

#### File upload

| Variable | Description |
|----------|-------------|
| `MAX_ATTACHMENTS` | Max number of attachments (e.g. `5`) |
| `MAX_ATTACHMENT_SIZE_MB` | Max file size per attachment in MB (e.g. `10`) |

#### State & output

| Variable | Description |
|----------|-------------|
| `STATE_DIR` | Directory for state files (e.g. `states`) |
| `OUTPUT_DIR` | Directory for build output (e.g. `output`) |

#### PocketBase

| Variable | Description |
|----------|-------------|
| `POCKETBASE_URL` | PocketBase instance URL |
| `POCKETBASE_ADMIN_EMAIL` | PocketBase admin email |
| `POCKETBASE_ADMIN_PASSWORD` | PocketBase admin password |

#### Anthropic / AI

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (e.g. `sk-ant-api03-...`) |
| `ANTHROPIC_MODEL` | Model name (e.g. `claude-haiku-4-5-20251001`) |
| `ANTHROPIC_MAX_ITERATIONS` | Max iterations for generation (e.g. `10`) |
| `BUILD_MAX_RETRIES` | Max retries for build steps (e.g. `3`) |

---

### Security notes

- **Do not commit** `.env` or `.env.local` or `server/.env` to version control.
- Use placeholders or a `.env.example` (without real secrets) for documentation.
- In production, use your platform’s secret management (e.g. env vars, vaults).

---

## 🤝 Contributing

We welcome contributions. Whether it's bug fixes, features, docs, or feedback, every bit helps.

### Ways to Contribute

1. **Report Bugs** — Open an issue with steps to reproduce and environment details.
2. **Suggest Features** — Share ideas for new features or improvements.
3. **Write Code** — Submit pull requests for bugs or features.
4. **Improve Documentation** — Help keep the README and docs clear and up to date.
5. **Share the Project** — Star the repo and tell others.

### Getting Started with Development

1. **Fork the Repository**
   ```bash
   git clone https://github.com/YOUR-USERNAME/Anybody.git
   cd Anybody
   ```

2. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature
   # or
   git checkout -b fix/bug-description
   ```

3. **Make Changes** — Follow existing style, use TypeScript, and test locally.

4. **Commit**
   ```bash
   git add .
   git commit -m "Add: brief description"
   ```
   Prefixes: `Add:` `Fix:` `Update:` `Docs:` `Style:` `Refactor:` `Test:` `Chore:`

5. **Push and Open a PR**
   ```bash
   git push origin feature/your-feature
   ```
   Then open a Pull Request with a clear description and any related issues.

### Code Style

- **Frontend** — Functional components, TypeScript, Tailwind CSS, React and Next.js best practices.
- **API / Server** — Consistent error handling and clear responses.

---

## 📜 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive behavior:** Respectful and inclusive communication, patience with newcomers, accepting constructive criticism, focusing on the community's best interest, empathy.

**Unacceptable behavior:** Harassment, trolling, derogatory comments, personal or political attacks, publishing others' private information, or any conduct inappropriate in a professional setting.

### Enforcement

Reports of unacceptable behavior will be reviewed and addressed by the maintainers. Maintainers may remove, edit, or reject comments, commits, code, and other contributions that violate this Code of Conduct.

---

## 💬 Support

### GitHub Issues

For bugs, feature requests, or technical questions:

🐛 **Open an Issue** (on the repository where this project is hosted)

When reporting a bug, please include:
- OS and version
- Node and npm versions
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or error messages if helpful

### Community

- ⭐ **Star the repo** to show your support.

### FAQ

**Q: Is this free to use?**  
A: Yes. It's open-source under the AGPL-3.0 license.

**Q: Can I use it commercially?**  
A: Yes, subject to AGPL-3.0. If you distribute or run a modified version over a network, you must make the source available under AGPL-3.0.

**Q: Do I need a backend?**  
A: The frontend expects a backend for generation and WebSocket. Run or deploy the backend according to the project setup.

**Q: How do I report a security issue?**  
A: Open a GitHub issue or contact the maintainers directly.

---

## 🗺️ Roadmap

### Possible Future Improvements

- [ ] **Export / Download** — Export generated project as archive
- [ ] **Templates** — Predefined app templates and starters
- [ ] **i18n** — Multiple languages for the UI
- [ ] **Accessibility** — Enhanced keyboard and screen reader support

### Version History

**v1.0** (Current)
- Real-time generation with WebSocket
- File upload and code streaming
- Project start, cancel, resume, and reconnection
- Next.js 16, React 19, TypeScript, Tailwind CSS

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

### What This Means

✅ **You CAN:**
- Use the software for any purpose
- Study, modify, and distribute it
- Use it commercially (under the license terms)

⚠️ **You MUST:**
- Disclose source when distributing
- Include the license and copyright notice
- State changes made
- License modifications under AGPL-3.0
- If you run a modified version over a network, provide source access to users

❌ **You CANNOT:**
- Hold the authors liable for damages
- Use the authors' names for endorsement without permission

**Full License Text:** See the [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

Thanks to the open-source projects and communities that make this possible:

### Core Technologies
- **[Next.js](https://nextjs.org/)** — React framework
- **[React](https://reactjs.org/)** — UI library
- **[TypeScript](https://www.typescriptlang.org/)** — Type safety
- **[Tailwind CSS](https://tailwindcss.com/)** — Styling

### Libraries & Tools
- **[Socket.IO](https://socket.io/)** — Real-time communication
- **[Radix UI](https://www.radix-ui.com/)** — Accessible components
- **[Lucide React](https://lucide.dev/)** — Icons

---

## 🏢 About Sysfora

<div align="center">

<img src="assets/SysforaLogo.png" alt="Sysfora Logo" width="200" style="border-radius: 999px; display: block; margin: 0 auto;" />

**[Sysfora](https://sysfora.com)** builds high-quality, open-source software for the betterment of the world.

</div>

### Our Mission

We are on a mission to build powerful AI systems that think, learn, and evolve like humans do, with nuance, memory, and imagination.

### Get in Touch

- 🌐 **Web**: [sysfora.com](https://sysfora.com)

### Support Sysfora

- ⭐ Star our repositories
- 🐛 Report bugs and suggest features
- 🤝 Contribute code or documentation
- 📣 Share the project with others

---

<div align="center">

## 💖 Thank You!

Thanks for using **Anybody**.

**Built with ❤️ by [Sysfora](https://sysfora.com)**

© 2026 Sysfora. Licensed under AGPL-3.0.

---

⭐ **If you find this project useful, please consider giving it a star on GitHub!** ⭐

[⬆ Back to Top](#anybody)

</div>
