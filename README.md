# Auto Apply

**Your job hunt, minus the copy-paste.**

You have a spreadsheet of 200+ jobs. Every application asks the same twenty questions: name, email, "are you authorized to work in the US?", "how did you hear about us?", over and over. Auto Apply asks you those questions **once**, keeps your resume fresh, figures out which jobs are still open, and lines them up in the order worth applying.

Everything runs on your own computer. Your answers live in a local database, and the AI model runs locally too, so nothing about you is sent to an AI company.

> **Status:** the setup, job list and posting checks work today. Automatic form filling is the next piece being built.

---

## What it does

| | |
|---|---|
| 📝 **Asks once, reuses forever** | About 50 common application questions, answered once and saved. |
| 📄 **Always the latest resume** | Link a Google Doc; a fresh PDF is pulled before every run. Edit the doc and you're done. |
| 🆕 **Finds new jobs by itself** | Searches the job boards of every company on your list and adds matching openings; no spreadsheet needed. |
| 🔗 **Watches career pages** | Save pages that list many jobs; the app tells you when new postings appear. |
| 🔎 **Knows what's still open** | Checks each posting against Greenhouse, Ashby, Lever and Workday, so you don't apply to ghosts. |
| 🎯 **Puts the best bets first** | Ranks every job from *Apply first* to *Long shot* based on resume fit and difficulty. |
| 🧠 **Private AI** | Uses a local model (Ollama, LM Studio or MLX) to understand form questions. |
| 🛑 **Never guesses** | If a form asks something you haven't answered, it stops and asks you. |

---

## Quick start (about 10 minutes)

**You need:** a Mac or PC with [Node.js 20+](https://nodejs.org), and about 20 GB free for the AI model.

**1. Install and start the app**

```bash
cd autoapply
npm install
npm start
```

Open **http://localhost:4310**. (`npm start` must be run from inside the `autoapply` folder.)

**2. Install a local AI model** (one time)

```bash
brew install ollama            # or download it from ollama.com
brew services start ollama     # keeps it running in the background
ollama pull qwen3.8:27b        # an 18 GB download; any 12–30B model works
```

Machines with less than 32 GB of memory should pick a smaller model, such as an 8B one.

**3. Follow the checklist on the Home screen.** When all four steps are green, you're ready.

---

## A tour of the app

### 🏠 Home: your checklist
Four steps, each with one button:

1. **Answer the setup questions**
2. **Resume:** synced from your Google Doc
3. **Local model:** connected and answering
4. **Check which jobs are still open**

Below the checklist you'll see your jobs by priority, and how each one will get applied.

### ✍️ Setup questions
Fill in the fields marked **Needed**; everything else is optional. Answers save as you type, so there's no Save button to forget.

- **From your resume** means the field was filled in for you. Double-check it.
- **Default** means a safe starting answer, such as "Decline to answer" on voluntary demographic questions. Change it if you like.
- Anything you write under **Written answers** is reused word for word.

### 📋 Jobs
Your whole list, in the order the app will work through it.

- **Filter** by priority, by how a job gets applied, or search for a company.
- **Change a priority** with the dropdown on the left of any row. Your choice sticks.
- **Click a row** to see why it got its priority, the salary, whether the posting is open, and any answers already drafted for it.
- Switch between **To apply**, **Applied** (newest first, with the date) and **Removed** at the top of the list.
- **I applied to this myself** moves a job to Applied so the app never applies to it twice.
- **Remove from my list** moves a job you don't want to Removed. Re-importing the sheet won't bring it back; open it there and press **Put back on my list** to restore it.

### 🧹 Clean up
On the **To apply** view, press **Clean up…** and type words that don't fit what you're looking for, such as `sales, nurse, mechanical`. The app shows every job those words would remove *before* anything happens, then removes them in one click. It matches whole words in job titles (and company names, if you tick the box), and can also sweep out postings that have closed. Applied jobs are never touched, and everything removed can be restored. Your words are remembered for next time.

### 🆕 Finding new jobs
At the top of the Jobs tab, press **Find new jobs**. The app reads the public job boards (Greenhouse, Ashby and Lever) of every company already on your list and adds openings that match your filters. They show up with a green **New** tag, and the **Found by the app** chip lists only those.

- Titles that say *new grad*, *junior*, *entry-level* or *Engineer I* land at **Good chance**; the rest land at **Stretch**, so you can check the requirements.
- Change what counts as a match under **Settings → Finding new jobs**: title words, words to skip, locations and how recent a posting must be.
- Tightened a filter? The next search clears earlier finds that no longer match, unless you already touched them (changed the priority, applied or removed).
- Want a company that isn't on your list? Paste its job board link under **Watch another company**.

### 🔗 Links
Some of the best leads are pages that list lots of jobs at once, like a staffing agency's job board or a company careers page, and change every week. Paste one under **Follow a careers page**.

- The first check saves everything on the page as your starting point. After that, each check shows only **what's new since you last looked**, so you're not re-reading the same list.
- The **Links** tab gets a green badge when a followed page has new postings. Pages re-check themselves when you open the tab (if they haven't been checked in six hours), or press **Check all**.
- Like a new posting? **Add to my jobs** puts it on your Jobs list. When you're done reading, press **Mark as seen**.
- **Rename or add a note** to remember who to contact or what to look for.

Pages that load their jobs with JavaScript can't be read this way; the app will say so, and you can still keep them here as a bookmark.

### ⚙️ Settings
- **Resume:** paste your Google Docs link. The doc must be shared as *Anyone with the link can view*.
- **Local model:** pick Ollama, LM Studio or MLX, choose a model, then **Test connection**.
- **Finding new jobs:** the filters for **Find new jobs**, plus extra companies to watch.
- **Job sheet:** re-import after your job list changes. Your progress, priorities and removals are kept.

---

## How a job gets applied

| Label | What happens |
|---|---|
| **Automatic** | Ashby, Greenhouse and Lever forms. The app fills and submits them on its own, but only when every answer is one you confirmed. |
| **Review first** | Other company sites. The app fills the form, then waits for your one-click approval. |
| **Needs your login** | Workday. You sign in once and the app fills the pages. |
| **You apply, app helps** | LinkedIn, Indeed and similar sites don't allow bots, so the app opens them with your answers ready to paste. |
| **Email draft** | The app writes the email and attaches your resume; you press send. |

The app never solves CAPTCHAs, never invents experience, and never answers legal questions (work authorization, sponsorship, export control) with anything except what you entered.

---

## Priorities, explained

| Priority | Meaning |
|---|---|
| 1 · Apply first | Strong fit and a realistic chance |
| 2 · Good chance | Good fit, or a strong fit for a harder role |
| 3 · Stretch | Partial fit or a tough role |
| 4 · Long shot | A requirement isn't confirmed yet, or the role is very hard to land |

Nothing is skipped automatically; long shots simply go last.

---

## FAQ

**`npm start` says "Could not read package.json".**
You're in the wrong folder. `cd` into `autoapply` first, or run `npm --prefix path/to/autoapply start`.

**It says "Auto Apply is already running".**
It's already open. Go to http://localhost:4310.

**Local model says "Nothing is answering".**
Start Ollama (`brew services start ollama`), then press **Test again** on Home.

**Resume sync fails.**
Check that the Google Doc is shared as *Anyone with the link can view*.

**Where is my data?**
In `autoapply/data/` on your computer. It's excluded from git, so it never gets pushed.

---

## Under the hood

TypeScript · React · Vite · Hono · SQLite (better-sqlite3) · any OpenAI-compatible local model server.

```
server/   API, job import, priority scoring, posting checks, resume sync, model client
src/      the dashboard (React)
shared/   types used by both
data/     your local database and resume copies (not committed)
```

Jobs are imported from a `jobs.json` file. Point `KIT_DIR` at the folder that contains it if yours lives somewhere else.
