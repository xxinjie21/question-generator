<div align="center">

# Smart Question Tutor

**AI-powered, spaced-repetition study plugin for Obsidian**

[![Obsidian](https://img.shields.io/badge/Obsidian-1.12.0+-483699?style=flat-square&logo=obsidian)](https://obsidian.md)
[![Release](https://img.shields.io/github/v/release/xxinjie21/Smart-Quiz-Tutor?style=flat-square&include_prereleases&label=release)](https://github.com/xxinjie21/Smart-Quiz-Tutor/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![AI](https://img.shields.io/badge/AI-Ollama%20%7C%20OpenAI-brightgreen.svg?style=flat-square)](https://ollama.com)

[Features](#features) &bull; [Installation](#installation) &bull; [Quick Start](#quick-start) &bull; [Settings](#settings) &bull; [License](#license)

</div>

---

## Features

### AI Question Generation
- Auto-generate quizzes from any Markdown notes using AI (5 question types: single choice, multiple choice, true/false, fill-in-the-blank, short answer)
- Supports **Ollama** (local), **OpenAI-compatible APIs** (DeepSeek, Claude, etc.)
- AI auto-extracts knowledge tags and writes `[[wikilinks]]` for Obsidian graph view
- Multi-file batch selection, sort by topic or date

### Full Exam Recognition
- Extract all questions from a complete exam paper or question bank via AI, preserving original formatting
- Large file chunking (15,000 chars per chunk, 2,000 overlap) to avoid truncation
- Retains existing answers; AI fills in missing ones

### Answering Mode
- Select any question file or a just-generated result to start answering instantly
- Real-time grading with correct answers and explanations
- Objective questions auto-scored; subjective questions manually markable as correct/wrong

### Wrong Answer Book (SM-2 Spaced Repetition)
- Correct → interval increases; Wrong → resets to 1 day
- Three presets: **Slow / Standard / Fast**, covering every stage of exam preparation
- Wrong answers include `[[knowledge tags]]`, synced to knowledge folders, visible in graph view
- Automatic review reminders on plugin startup

### Study Notes
- Create study notes from any Markdown file with AI-generated summaries and knowledge points
- Notes are also part of the spaced repetition review system
- Search, filter, and export supported

### Review Dashboard
- Unified view of all due review items (wrong answers + questions + notes), sorted by priority
- One-click "Done" button per item to advance to the next review cycle
- Sort by source file, knowledge tag, or date

### Learning Heatmap
- GitHub-style annual contribution graph showing learning activity
- Color intensity scales by activity count (1-2 / 3-5 / 6-9 / 10+)

### Knowledge Graph
- Separate knowledge folders per module (questions / notes / wrong answers)
- Auto-generated MOC (Map of Content) index notes
- `[[wikilinks]]` at the end of every question and wrong answer for seamless Obsidian graph integration

### Export
- Export to **Markdown**, **Word (.docx)**, or **PDF**
- Answer-free version available for self-testing

---

## Installation

### From Obsidian Community Plugins
1. Open **Settings** → **Community plugins** → **Browse**
2. Search for **Smart Question Tutor**
3. Click **Install**, then **Enable**

### Manual Installation
```bash
git clone https://github.com/xxinjie21/Smart-Quiz-Tutor.git
cd Smart-Quiz-Tutor
npm install
npm run build
```

Copy these files into your vault:
```
your-vault/.obsidian/plugins/smart-quiz-tutor/
├── main.js
├── manifest.json
└── styles.css
```

Then enable the plugin in **Settings** → **Community plugins**.

---

## Quick Start

1. **Configure AI** — Go to **Settings** → **Smart Question Tutor**, set your AI provider (Ollama or OpenAI-compatible) and model
2. **Generate questions** — Open the sidebar via the ribbon icon, select a Markdown source file in the **Questions** tab, choose question types and count, click **Generate**
3. **Start answering** — Click **Start Answering** after generation completes
4. **Review mistakes** — Wrong answers are automatically saved to the Wrong Answer Book with spaced repetition scheduling
5. **Track progress** — Check the **Review** tab for due items, or view the heatmap on the Home tab

---

## Commands

| Command | Description |
|---------|-------------|
| Open Smart Question Tutor | Open the main sidebar |
| Generate from current file | Quick quiz generation from the active document |
| Open Wrong Answer Book | View wrong answer list |
| Rebuild knowledge index | Regenerate MOC notes |

### Hotkeys

| Hotkey | Action |
|--------|--------|
| `Ctrl+Q` | Generate quiz from current file |
| `Ctrl+W` | Open wrong answer book |

Customizable in **Settings** → **Hotkeys**.

---

## Settings

### Core

| Setting | Description | Default |
|---------|-------------|---------|
| API Type | Ollama or OpenAI | `Ollama` |
| API URL | AI service endpoint | `http://127.0.0.1:11434` |
| Model | AI model name | `qwen2:7b` |
| Temperature | Randomness (0-2) | `0.1` |
| Root folder | Parent directory for all modules | `Smart Question Tutor` |
| Questions folder | Where generated questions are saved | `Smart Question Tutor/Questions` |
| Wrong answers folder | Wrong answer storage path | `Smart Question Tutor/Wrong` |
| Notes folder | Study notes storage path | `Smart Question Tutor/Notes` |
| Exclude folders | Folders excluded from question generation | `.obsidian, .trash, Templates` |

### Review Interval Presets

| Module | Slow | Standard | Fast |
|--------|------|----------|------|
| Wrong answers | `2,5,10,20,40,60` | `1,2,4,7,15,30` | `1,1,3,5,10,20` |
| Questions | `10,20,40,80,120` | `7,15,30,60,90` | `4,8,18,40,60` |
| Notes | `3,8,20,45,80` | `2,6,14,35,70` | `1,1,2,3,5` |

---

## Interface

The sidebar has 6 tabs:

| Tab | Description |
|-----|-------------|
| Home | Stats overview (4 cards) + learning heatmap + due reviews + quick actions |
| Questions | Question generation settings, file management, file picker |
| Notes | Create study notes from files, note file management |
| Wrong | Wrong answer list, details, review, export, regeneration |
| Review | Unified dashboard of all due items with filter / sort / one-click completion |
| Settings | All configuration options |

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Obsidian API](https://docs.obsidian.md) | Plugin platform |
| [TypeScript](https://www.typescriptlang.org) | Development |
| [esbuild](https://esbuild.github.io) | Bundler |
| [docx](https://docx.js.org) | Word document generation |
| SM-2 | Spaced repetition algorithm |

---

## Support

If this plugin helps your studies, consider giving it a star on GitHub!

For issues and feature requests, please [open an issue](https://github.com/xxinjie21/Smart-Quiz-Tutor/issues).

---

## License

[ISC License](LICENSE)
