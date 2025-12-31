# Kobo Highlights Picker & Inboxer

An Obsidian plugin to import Kobo highlights **selectively**, organize them into **intermediate inbox notes**, and gradually turn them into **insight notes** at your own pace.

This plugin is built for people who want to *think with their highlights*, not simply dump them into Obsidian.

---

## 💡 Workflow At a Glance

This plugin turns the typical bulk-import process into a deliberate, multi-stage workflow. Instead of creating hundreds of notes at once, you get a reviewable inbox that respects your attention, time, and cognitive load.

---

## ⚙️ How It Works: A Step-by-Step Guide

#### 1. Sync Highlights from Kobo
- The plugin reads your `KoboReader.sqlite` file.
- It identifies all books with highlights and lets you choose which ones to import.
- Previously imported books are clearly marked, so you only sync what's new.

#### 2. Review in Intermediate Notes
- For each book, a single **Intermediate Note** is created in an "inbox" folder (e.g., `Kobo-Inboxes/`).
- New highlights are safely appended to the end of the note—no duplicates.
- Each highlight is a structured block, ready for your thoughts:
  ```md
  > Highlight text...
  - [ ] memo:: 
  ```

#### 3. Add Memos (Your Thoughts)
- An empty `memo::` is an unprocessed thought. It's a placeholder for you to reflect on the highlight.
- When you have an idea, fill in the memo:
  ```md
  > Highlight text...
  - [ ] memo:: This is my thought! It connects to another idea.
  ```
- If you're not ready, just leave it empty.

#### 4. Create Insight Notes
- Run the "Create Insight Note" command.
- The plugin scans your intermediate notes for **non-empty memos**.
- Each filled memo is converted into a new **Insight Note** in your "insights" folder (e.g., `Kobo-Insights/`).

#### 5. Automatic Linking
- After an insight note is created, the original intermediate note is updated automatically.
- The `memo::` line is replaced with a link to your new, permanent note:
  ```md
  > Highlight text...
  insight:: [[This is my thought!]]
  ```
- This creates a powerful link between the original source and your own knowledge.

---

## ✨ Features

- **Selective Import**: You choose which books to sync.
- **Incremental & Safe**: Only new highlights are added. Your existing notes are safe.
- **Inbox-style Workflow**: Intermediate notes act as a dedicated space for thinking.
- **Memo-driven Note Creation**: You decide when a thought is ready to become a permanent note. No note spam.
- **Automatic Progress Tracking**: The plugin keeps track of total highlights and created insights, caching stats in the frontmatter for performance.
- **Configurable**: Set your own folder paths for inboxes and insights.
- **Philosophy-first Design**: Your knowledge is created only when *you* decide it's ready.

---

## 📁 Example Folder Structure

```text
Kobo-Inboxes/
  ├─ Thinking, Fast and Slow.md
  └─ The Structure of Scientific Revolutions.md

Kobo-Insights/
  ├─ System 1 vs System 2.md
  └─ Paradigm Shifts.md
```

---

## 🙏 Acknowledgements

This project was originally inspired by [obsidian-kobo-highlights-import](https://github.com/OGKevin/obsidian-kobo-highlights-import) by **OGKevin**.

The original project provided a solid foundation for importing Kobo highlights. This plugin started as a cloned codebase and has since been **heavily redesigned and extended** with a different workflow, data model, and philosophy focused on incremental thinking and deliberate note creation.

---

## 📜 License

MIT License
