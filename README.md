<div align="center">

# Smart Quiz Tutor

**AI-powered quiz generator for Obsidian** — Turn your notes into quizzes with one click.

[![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0+-483699?style=flat-square&logo=obsidian)](https://obsidian.md)
[![Build](https://img.shields.io/github/actions/workflow/status/xxinjie21/question-generator/lint.yml?branch=master&style=flat-square&label=build)](https://github.com/xxinjie21/question-generator/actions)
[![Release](https://img.shields.io/github/v/release/xxinjie21/question-generator?style=flat-square&include_prereleases&label=release)](https://github.com/xxinjie21/question-generator/releases)
[![Stars](https://img.shields.io/github/stars/xxinjie21/question-generator?style=flat-square&logo=github)](https://github.com/xxinjie21/question-generator/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![AI](https://img.shields.io/badge/AI-Ollama%20%7C%20OpenAI-brightgreen.svg?style=flat-square)](https://ollama.com)
[![License](https://img.shields.io/badge/License-ISC-blue.svg?style=flat-square)](LICENSE)

> **中文用户**：[查看中文说明](README.zh.md) | **English**: Read below

**[Features](#features) • [Quick Start](#quick-start) • [Commands](#commands) • [Configuration](#configuration) • [Contributing](#contributing) • [License](#license)**

</div>

---

## Demo

<!-- Replace these placeholders with actual screenshots/GIFs -->
<table>
  <tr>
    <td align="center"><strong>AI Quiz Generation</strong><br><img src="https://via.placeholder.com/400x250/483699/ffffff?text=Screenshot+Coming+Soon" alt="Quiz Generation" width="400"></td>
    <td align="center"><strong>Answer Mode</strong><br><img src="https://via.placeholder.com/400x250/2E7D32/ffffff?text=Screenshot+Coming+Soon" alt="Answer Mode" width="400"></td>
  </tr>
  <tr>
    <td align="center"><strong>Wrong Answer Book</strong><br><img src="https://via.placeholder.com/400x250/1565C0/ffffff?text=Screenshot+Coming+Soon" alt="Wrong Book" width="400"></td>
    <td align="center"><strong>Export to Word/PDF</strong><br><img src="https://via.placeholder.com/400x250/6A1B9A/ffffff?text=Screenshot+Coming+Soon" alt="Export" width="400"></td>
  </tr>
</table>

---

## Features

### 1. AI Quiz Generation
- Select Markdown files → AI extracts knowledge → generates quizzes (5 question types) → auto-saves to vault
- Supports: **Single Choice, Multiple Choice, True/False, Fill-in-the-Blank, Essay**
- Batch select multiple files, group by knowledge tag or sort by time
- AI automatically extracts knowledge tags and integrates with Obsidian graph
- Compatible with **Ollama** (local), **OpenAI**, **DeepSeek**, **Claude**, and any OpenAI-compatible API

### 2. Exam Recognition
- AI extracts quiz questions from any Markdown document
- Auto-detects original question types preserving format
- Retains original answers when available; AI generates answers for missing ones
- Batch process multiple files with results auto-saved

### 3. Answer Mode
- Select existing quizzes or generated questions and start answering immediately
- Instant scoring with correct/incorrect display and explanations
- Manually add wrong answers to the wrong answer book

### 4. Wrong Answer Book (SM-2 Spaced Repetition)
- **Correct**: interval extends (1d → 3d → 7d → 14d → 30d...)
- **Wrong**: interval resets to 1 day
- Auto-reminder for due reviews on Obsidian startup
- Group by knowledge point, source file, or date
- Wrong notes include `[[wikilinks]]` for Obsidian knowledge graph

### 5. Learning Analytics
- Statistics: total questions, accuracy rate, mastery rate
- Identify **weak knowledge points** with specific wrong questions
- Study trend charts (recent accuracy changes)
- Auto-creates knowledge point MOC index notes

### 6. Professional Export
- **Graduate exam answer format** formatting
- Export to **Word (.docx)**, **PDF**, and **Markdown**
- Technical terms highlighted with red wavy underline
- Answer-free version for self-testing

---

## Quick Start

### Prerequisites
- Node.js >= 18
- Obsidian v1.4.0+

### Install from Community Store
<!-- Once approved -->
<!-- 1. Open Obsidian **Settings → Community plugins** -->
<!-- 2. Search for "Smart Quiz Tutor" -->
<!-- 3. Install and enable -->

### Manual Install
```bash
git clone https://github.com/xxinjie21/question-generator.git
cd question-generator
npm install
npm run build
```

Copy to your vault:
```
your-vault/.obsidian/plugins/question-generator/
├── main.js
├── manifest.json
└── styles.css
```

### Configure AI
Open **Settings → Smart Quiz Tutor**:
| Setting | Description |
|---------|-------------|
| API Type | Ollama or OpenAI-compatible |
| API URL | Default `http://127.0.0.1:11434` |
| Model | e.g. `qwen2:7b`, `gpt-4o`, `deepseek-chat` |
| API Key | Required for OpenAI/DeepSeek |

### First Quiz
1. Click the 📚 icon in the left ribbon to open the sidebar
2. Click **Select Files** and choose Markdown files
3. Select question types and quantities, click **Generate**
4. Click **Start Answering** to take the quiz

---

## Commands

| Command | Description |
|---------|-------------|
| Open Smart Quiz Tutor sidebar | Open main interface |
| Generate from current document | Quick quiz from active file |
| View wrong answer book | Open wrong book |
| View generation history | View past quiz records |
| Rebuild knowledge index | Regenerate MOC notes |

### Hotkeys
| Hotkey | Function |
|--------|----------|
| `Ctrl+Q` | Quick quiz from current document |
| `Ctrl+W` | Open wrong answer book |

Customize in **Settings → Hotkeys**.

---

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| API Type | Ollama or OpenAI | `Ollama` |
| API URL | API service address | `http://127.0.0.1:11434` |
| Model | AI model name | `qwen2:7b` |
| Temperature | Randomness (0-1) | `0.1` |
| Question Folder | Save path for generated quizzes | `出题` |
| Wrong Book Folder | Save path for wrong notes | `错题本` |
| Excluded Folders | Folders to exclude | `.obsidian, .trash, 模板` |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

[![Open in GitHub Codespaces](https://img.shields.io/badge/Codespace-ready-24292f?style=flat-square&logo=github)](https://github.com/codespaces/new?hide_repo_select=true&ref=master&repo=xxinjie21/question-generator)

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Obsidian API](https://docs.obsidian.md) | Plugin platform |
| [TypeScript](https://www.typescriptlang.org) | Development language |
| [esbuild](https://esbuild.github.io) | Build tool |
| [docx](https://docx.js.org) | Word document generation |
| SM-2 | Spaced repetition algorithm |

---

## Support

If this plugin helps your learning, consider giving it a ⭐ on GitHub!

[![Star History](https://api.star-history.com/svg?repos=xxinjie21/question-generator&type=Date)](https://star-history.com/#xxinjie21/question-generator&Date)

---

## License

[ISC License](LICENSE)
