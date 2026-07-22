# Smart Quiz Tutor

<div align="center">

![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0+-483699?style=flat-square&logo=obsidian)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square&logo=typescript)
![AI](https://img.shields.io/badge/AI-Ollama%20%7C%20OpenAI-brightgreen.svg?style=flat-square)
![License](https://img.shields.io/badge/License-ISC-blue.svg?style=flat-square)

**AI-powered quiz generation for Obsidian — read your Markdown knowledge base, call Ollama/OpenAI-compatible APIs to auto-generate quizzes with answer tracking, wrong answer book, and SM-2 spaced repetition.**

</div>

---

## Features

### 1. AI Quiz Generation
- Select Markdown files → AI extracts knowledge points → generates quizzes (5 question types) → auto-saves to vault
- Supports: **Single Choice, Multiple Choice, True/False, Fill-in-the-Blank, Essay**
- Batch select multiple files, group by knowledge tag or sort by time
- AI automatically extracts knowledge tags and integrates with Obsidian knowledge graph
- Compatible with **Ollama** (local models) and **OpenAI-compatible APIs** (GPT-4, DeepSeek, etc.)

### 2. Exam Recognition
- AI extracts quiz questions from any Markdown document
- Auto-detects original question types (essay, calculation, etc.) preserving format
- Retains original answers when available; AI generates answers for missing ones
- Batch process multiple files with results auto-saved

### 3. Answer Mode
- Select existing quizzes or generated questions and start answering immediately
- Instant scoring with correct/incorrect display and explanations
- Manually add wrong answers to the wrong answer book with custom tags and notes

### 4. Wrong Answer Book (SM-2 Spaced Repetition)
- Correct answer: interval extends (1d → 3d → 7d → 14d → 30d...)
- Wrong answer: interval resets to 1 day
- Auto-reminder for due reviews on Obsidian startup
- Group by knowledge point, source file, or date
- Wrong notes include `[[wikilinks]]` for Obsidian knowledge graph integration

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

### 1. Prerequisites
- Node.js >= 18
- Obsidian v1.4.0+

### 2. Install
```bash
git clone https://github.com/xxinjie21/question-generator.git
cd question-generator
npm install
npm run build
```

Copy these files to your vault's plugin directory:
```
your-vault/.obsidian/plugins/question-generator/
├── main.js
├── manifest.json
└── styles.css
```

### 3. Configure AI
Open **Settings → Smart Quiz Tutor**:
- **API Type**: Ollama (local) or OpenAI-compatible
- **API URL**: Default `http://127.0.0.1:11434` for Ollama
- **Model**: e.g., `qwen2:7b`, `gpt-4o`
- **API Key**: Required for OpenAI

### 4. Use
1. Click the 📚 icon in the left ribbon to open the sidebar
2. Click **Select Files** and choose Markdown files
3. Select question types and quantities, click **Generate**
4. Click **Start Answering** to take the quiz

---

## Commands

| Command | Description |
|---------|-------------|
| Open Smart Quiz Tutor sidebar | Open main interface |
| Generate questions from current document | Quiz from active file |
| View wrong answer book | Open wrong book |
| View generation history | View past quiz records |
| Rebuild knowledge index | Regenerate MOC notes |

### Hotkeys
| Hotkey | Function |
|--------|----------|
| `Ctrl+Q` | Quick quiz from current document |
| `Ctrl+W` | Open wrong answer book |

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
| Excluded Folders | Folders to exclude | `.obsidian, .trash, 模板, templates` |

---

## Tech Stack

| Technology | Description |
|------------|-------------|
| Obsidian API | Plugin platform |
| TypeScript | Development language |
| esbuild | Build tool |
| docx | Word document generation |
| SM-2 | Spaced repetition algorithm |

---

## License

[ISC License](LICENSE)
