import { addIcon, Notice, normalizePath, Plugin, TFile } from "obsidian";
import { ExtractHighlightsModal } from "./modal/ExtractHighlightsModal";
import {
  DEFAULT_SETTINGS,
  KoboHighlightsImporterSettings,
  KoboHighlightsImporterSettingsTab,
} from "./settings/Settings";

const INBOX_ICON_PATH = `
<svg viewBox="0 0 24 24">
  <path
    d="M12 4v9"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
  />
  <path
    d="M8 9l4 4 4-4"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linejoin="round"
  />
  <path
    d="M5 18h14"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
  />
</svg>
`;


// ファイル名に使えない文字を潰す（Obsidian/OS両対応のためシンプルに）
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export default class KoboHighlightsImporter extends Plugin {
  settings!: KoboHighlightsImporterSettings;

	async onload() {
    addIcon("inbox", INBOX_ICON_PATH);
    await this.loadSettings();

    // 1. リボンアイコン（最初に登録）
    const iconEl = this.addRibbonIcon("inbox", "Kobo Highlight Picker", () => {
      new ExtractHighlightsModal(this.app, this.settings).open();
    });
    iconEl.addClass("kobo-highlight-picker-inboxer-icon");

    // 2. インポートコマンド
    this.addCommand({
      id: "import-from-kobo-sqlite",
      name: "Import from Kobo",
      callback: () => new ExtractHighlightsModal(this.app, this.settings).open(),
    });

    // 3. 抽出コマンド（エラーの出にくいシンプルな callback 形式に変更）
    this.addCommand({
      id: "extract-highlights",
      name: "Extract checked highlights to Inbox",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          await this.extractHighlightsToNotes(activeFile);
        } else {
          new Notice("アクティブなMarkdownファイルが見つかりません");
        }
      },
    });

    // 4. コードブロックプロセッサ
    this.registerMarkdownCodeBlockProcessor("kobo-inboxer", (source, el, ctx) => {
      const btn = el.createEl("button", { 
        text: "⚡️ 知見ノート化を実行",
        cls: "kobo-inbox-btn" 
      });
    
      btn.addEventListener("click", async () => {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (file instanceof TFile) {
          await this.extractHighlightsToNotes(file);
        }
      });
    });

    this.addSettingTab(new KoboHighlightsImporterSettingsTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

	async extractHighlightsToNotes(file: TFile) {
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const newLines = [...lines];

    const targets: { index: number; title: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // チェックボックス [x] が含まれているか確認
      if (line.includes("- [x]")) {
        // チェックボックスより右側のテキストをすべて取得
        let insightTitle = line.replace(/^\s*-\s*\[x\]\s*/, "").trim();
        
        // もし先頭に "_" が残っていたら、それとその後のスペースを掃除する
        insightTitle = insightTitle.replace(/^_\s*/, "").trim();

        // 何かしら文字が書かれていれば採用（"_" だけの場合は無視される）
        if (insightTitle.length > 0) {
          targets.push({ index: i, title: insightTitle });
        }
      }
    }

    if (targets.length === 0) {
      new Notice("抽出対象（チェック済みでタイトルあり）が見つかりません。");
      return;
    }

    let createdCount = 0;
    for (let j = targets.length - 1; j >= 0; j--) {
      const target = targets[j];
      const result = this.collectQuoteBlockUpwards(lines, target.index);

      if (result.quoteContent.trim().length > 0) {
        await this.createNewInsightNote(target.title, result.quoteContent, file.basename, result.bookmarkId);
        
        newLines[target.index] = "- [[" + target.title + "]]";
        newLines.splice(target.index + 1, 0, "- [ ] ");
        
        createdCount++;
      }
    }

    await this.app.vault.modify(file, newLines.join("\n"));
    new Notice(createdCount + " 件の知見ノートを作成しました");
  }

  private collectQuoteBlockUpwards(lines: string[], fromIndex: number) {
    let quoteLines: string[] = [];
    let started = false;
    let bId = "";

    // 記号を安全に定義
    const htmlOpen = "<" + "!" + "--"; 

    for (let k = fromIndex - 1; k >= 0; k--) {
      const line = lines[k];

      if (line.includes("id:")) {
        const idMatch = line.match(/id:\s*([A-Za-z0-9_-]+)/);
        if (idMatch) bId = idMatch[1];
      }

      if (line.startsWith(">")) {
        started = true;
        // コールアウトタグやIDタグを除外
        if (!line.includes("[!quote]") && !line.includes(htmlOpen)) {
          quoteLines.unshift(line.replace(/^>\s?/, ""));
        }
        continue;
      }
      
      if (started) break;
    }

    return { 
      quoteContent: quoteLines.join("\n"), 
      bookmarkId: bId 
    };
  }

  // ✅ bookmarkId をメタに入れたいなら使う（不要なら引数ごと消してOK）
  async createNewInsightNote(title: string, quote: string, bookTitle: string, bookmarkId?: string) {
    const folder = "Inbox";
    const safe = sanitizeFileName(title);
    const path = normalizePath(`${folder}/${safe}.md`);

    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }

    const created = new Date().toISOString().split("T")[0];
    const metaBookmark = bookmarkId ? `bookmark: "${bookmarkId}"\n` : "";

    const quoteBody = quote
      .trim()
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");

    const fileContent = `---
title: "${title.replace(/"/g, '\\"')}"
book: "[[${bookTitle}]]"
${metaBookmark}created: ${created}
---

> [!quote] ${title}
${quoteBody}
>
> <cite>— *${bookTitle}*</cite>
`;

    try {
      await this.app.vault.create(path, fileContent);
    } catch (e) {
      new Notice(`エラー: 同名のファイルが既に存在する可能性があります (${title})`);
    }
  }
}
