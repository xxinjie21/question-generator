<div align="center">

# Smart Quiz Tutor · 智学助手

**AI 驱动、间隔重复、全流程闭环的 Obsidian 智能刷题插件**

[![Obsidian](https://img.shields.io/badge/Obsidian-1.12.0+-483699?style=flat-square&logo=obsidian)](https://obsidian.md)
[![Build](https://img.shields.io/github/actions/workflow/status/xxinjie21/Smart-Quiz-Tutor/lint.yml?branch=master&style=flat-square&label=build)](https://github.com/xxinjie21/Smart-Quiz-Tutor/actions)
[![Release](https://img.shields.io/github/v/release/xxinjie21/Smart-Quiz-Tutor?style=flat-square&include_prereleases&label=release)](https://github.com/xxinjie21/Smart-Quiz-Tutor/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![AI](https://img.shields.io/badge/AI-Ollama%20%7C%20OpenAI-brightgreen.svg?style=flat-square)](https://ollama.com)

**[功能](#功能) • [快速开始](#快速开始) • [命令](#命令) • [配置](#配置) • [界面](#界面) • [许可](#许可)**

</div>

---

## 功能

### 🧠 AI 试题生成
- 基于 Markdown 笔记原文，AI 自动出题（5 种题型：单选 / 多选 / 判断 / 填空 / 简答）
- 支持 **Ollama**（本地）、**OpenAI 兼容接口**（DeepSeek、Claude 等）
- AI 自动提取知识点标签并写入 `[[双向链接]]`，融入 Obsidian 图谱
- 支持多文件批量选择、按知识点分组或按时间排序

### 📄 整卷识别
- 从完整试卷 / 题集中 AI 提取全部题目，保留原有格式
- 支持大文件分块处理（每块 15000 字符，重叠 2000 字符），避免截断
- 原试卷有答案则保留，缺答案由 AI 自动补全

### ✍️ 答题模式
- 直接选择题目文件或刚刚生成的结果，一键开始答题
- 即时批改，展示正确答案与解析
- 客观题自动计分，主观题可手动标记正误并记入错题本

### 📘 错题本（SM-2 间隔重复）
- 答对 → 间隔递增，答错 → 重置为 1 天
- 三种预设方案：**慢速 / 标准 / 快速**，覆盖考研各阶段节奏
- 错题记录含 `[[知识点标签]]`，自动同步到知识点文件夹，图谱可见
- 插件启动时自动提醒到期复习

### 📓 学习笔记
- 从任意 Markdown 文件创建学习笔记，AI 自动生成摘要与知识点
- 笔记同样纳入间隔重复复习体系
- 支持搜索、筛选、导出

### 📊 复习看板
- 统一展示所有到期复习项（错题 + 题目 + 笔记），按优先级排序
- 每行可一键标记「已完成」，自动推进到下一复习周期
- 按源文件 / 知识点 / 时间多种排序

### 📈 学习热力图
- GitHub 风格年度贡献图，直观展示学习活跃度
- 基于文件修改时间统计，颜色按活动频次分级（1-2 / 3-5 / 6-9 / 10+）

### 🔗 知识点图谱
- 每个模块独立的知识点文件夹（题目知识点 / 笔记知识点 / 错题知识点）
- 自动生成知识点 MOC 索引笔记
- 所有题目和错题末尾写入 `[[知识点]]` 双向链接，完美融入 Obsidian 图谱

### 📤 专业导出
- 支持导出 **Markdown**、**Word (.docx)**、**PDF**
- 可导出无答案版用于自测

---

## 快速开始

### 前提
- Obsidian v1.4.0+
- AI 服务（Ollama 本地或 OpenAI 兼容 API）

### 手动安装
```bash
git clone https://github.com/xxinjie21/Smart-Quiz-Tutor.git
cd Smart-Quiz-Tutor
npm install
npm run build
```

复制到你的 vault：
```
your-vault/.obsidian/plugins/Smart-Quiz-Tutor/
├── main.js
├── manifest.json
└── styles.css
```

### 配置 AI
打开 **设置 → 第三方插件 → Smart Quiz Tutor**：

| 设置项 | 说明 |
|--------|------|
| 接口类型 | Ollama 或 OpenAI 兼容 |
| 接口地址 | 默认 `http://127.0.0.1:11434` |
| 模型名称 | 如 `qwen2:7b`、`gpt-4o`、`deepseek-chat` |
| API Key | OpenAI / DeepSeek 需要 |

### 第一次出题
1. 点击左侧 Ribbon 栏的 📚 图标打开侧边栏
2. 在「出题」Tab 中选择 Markdown 源文件
3. 选择题目类型和数量，点击「生成」
4. 生成完成后点击「开始答题」
5. 答题结束标记正误，错题自动记入错题本，进入间隔复习流程

---

## 命令

| 命令 | 说明 |
|------|------|
| 打开智学助手 | 打开主界面侧边栏 |
| 从当前文档出题 | 快速基于当前活动文件出题 |
| 打开错题本 | 查看错题列表 |
| 查看生成历史 | 查看历史出题记录 |
| 重建知识点索引 | 重新生成 MOC 笔记 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Q` | 从当前文档快速出题 |
| `Ctrl+W` | 打开错题本 |

可在 **设置 → 快捷键** 中自定义。

---

## 配置

### 核心设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 接口类型 | Ollama 或 OpenAI | `Ollama` |
| 接口地址 | API 服务地址 | `http://127.0.0.1:11434` |
| 模型名称 | AI 模型 | `qwen2:7b` |
| Temperature | 随机性 (0-2) | `0.1` |
| 根文件夹 | 所有模块文件夹的父目录 | `智学助手` |
| 题目文件夹 | 生成题目的保存路径 | `智学助手/题目` |
| 错题文件夹 | 错题保存路径 | `智学助手/错题` |
| 笔记文件夹 | 学习笔记保存路径 | `智学助手/笔记` |
| 排除文件夹 | 不参与出题的文件夹 | `.obsidian, .trash, 模板` |

### 复习间隔预设

| 模块 | 慢速 | 标准 | 快速 |
|------|------|------|------|
| 错题 | `2,5,10,20,40,60` | `1,2,4,7,15,30` | `1,1,3,5,10,20` |
| 题目 | `10,20,40,80,120` | `7,15,30,60,90` | `4,8,18,40,60` |
| 笔记 | `3,8,20,45,80` | `2,6,14,35,70` | `1,1,2,3,5` |

---

## 界面

6 个功能 Tab：

| Tab | 功能 |
|-----|------|
| 🏠 首页 | 统计概览（4 卡片）+ 学习热力图 + 待复习 + 快捷操作 + 实用工具 |
| 📝 题目 | 出题设置、题目文件管理、文件选择器 |
| 📓 笔记 | 从文件创建学习笔记、笔记文件管理 |
| ❌ 错题 | 错题列表、详情、复习、导出、重生成 |
| 📊 复习 | 统一看板展示所有到期项，支持筛选 / 排序 / 一键完成 |
| ⚙ 设置 | 所有配置项 |

---

## 技术栈

| 技术 | 用途 |
|------|------|
| [Obsidian API](https://docs.obsidian.md) | 插件平台 |
| [TypeScript](https://www.typescriptlang.org) | 开发语言 |
| [esbuild](https://esbuild.github.io) | 构建工具 |
| [docx](https://docx.js.org) | Word 文档生成 |
| SM-2 | 间隔重复算法 |

---

## 支持

如果这个插件对你的学习有帮助，欢迎在 GitHub 上给一个 ⭐！

---

## 许可

[ISC License](LICENSE)
