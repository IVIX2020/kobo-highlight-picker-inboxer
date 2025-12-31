# Kobo Highlights Picker & Inboxer

An Obsidian plugin to import Kobo highlights **selectively**, organize them into **intermediate inbox notes**, and gradually turn them into **insight notes** at your own pace.

This plugin is built for people who want to *think with their highlights*, not simply dump them into Obsidian.

---

## Overview

Most highlight importers focus on **bulk extraction**.
This plugin focuses on **deliberate thinking**.

Instead of immediately turning every highlight into a permanent note, highlights are first collected into **intermediate notes**, where you can annotate, reflect, and decide what is worth turning into knowledge.

---

## Features

### 📚 Selective Import from Kobo

* Import highlights from `KoboReader.sqlite`
* Choose **which books** to import
* Clearly see which books:

  * already have intermediate notes
  * have not been imported yet

---

### 🗂 Intermediate Notes (Inbox-style)

* One intermediate note per book
* Highlights are appended incrementally (no duplication)
* Each highlight is stored as a structured block with a unique ID
* Designed as a *thinking workspace*, not a final archive

---

### 📝 Memo-driven Workflow

Each new highlight includes a memo placeholder:

```md
- [ ] memo::
```

* This represents an *unprocessed thought*
* Empty memos are ignored
* A highlight with no memo is simply “not ready yet”

---

### 💡 Insight Notes (Created on Demand)

* When a memo contains text, it can be turned into an **insight note**
* After creation:

  * The `memo::` line is removed
  * An `insight:: [[Note]]` link is added to the intermediate note
* Empty memos never generate notes

This prevents accidental note spam and keeps insight notes intentional.

---

### 📊 Automatic Progress Tracking

Statistics are derived from the **note body itself** (source of truth):

* Total highlights
* Remaining memos
* Created insight notes

For performance, stats are cached in frontmatter:

```yaml
kobo_stats:
  highlights_total: 42
  insights_created: 17
```

---

### ⚙️ Configurable Folders

From Settings, you can configure:

* Intermediate notes folder
* Insight notes folder
* Template for imported notes
* Whether to import all books or only books with highlights
* Optional saved path to `KoboReader.sqlite` (to avoid reselecting each time)

---

### 🧠 Philosophy-first Design

* Notes are not created automatically
* Nothing is forced
* Knowledge is created only when *you* decide it is ready

---

## Typical Workflow

1. **Select `KoboReader.sqlite`**

   * Can be configured once in Settings
   * Automatically reused later

2. **Choose Books**

   * See which books are already imported
   * Select only what you want

3. **Sync to Intermediate Notes**

   * One note per book
   * New highlights are appended safely

4. **Add Memos**

   * Write thoughts next to highlights
   * Leave memos empty if you are not ready

5. **Create Insight Notes**

   * Only non-empty memos generate notes
   * Insight links are tracked automatically

---

## Folder Structure Example

```text
Kobo-Inboxes/
  ├─ Thinking, Fast and Slow.md
  ├─ The Structure of Scientific Revolutions.md

Kobo-Insights/
  ├─ System 1 vs System 2.md
  ├─ Paradigm Shifts.md
```

---

## Why Intermediate Notes?

This plugin intentionally separates:

* **Collection** (highlights)
* **Thinking** (memos)
* **Knowledge** (insight notes)

Instead of creating hundreds of notes at once, you get a **reviewable inbox** that respects attention, time, and cognitive load.

---

## Acknowledgements

This project was originally inspired by
[obsidian-kobo-highlights-import](https://github.com/OGKevin/obsidian-kobo-highlights-import)
by **OGKevin**.

The original project provided a solid foundation for importing Kobo highlights into Obsidian.
This plugin started as a cloned codebase and has since been **heavily redesigned and extended** with a different workflow, data model, and philosophy focused on incremental thinking and deliberate note creation.

---

## Status

* Actively developed
* Breaking changes may occur
* Feedback and ideas are welcome

---

## License

MIT License
