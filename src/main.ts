import { addIcon, Notice, normalizePath, Plugin, TFile } from "obsidian";
import { ExtractHighlightsModal } from "./modal/ExtractHighlightsModal";
import {
  DEFAULT_SETTINGS,
  KoboHighlightsPickerAndInboxerSettings,
  KoboHighlightsPickerAndInboxerSettingsTab,
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
  settings!: KoboHighlightsPickerAndInboxerSettings;
  // Marker used in intermediate notes to record an extracted insight.
  // We count only these lines to compute "insights_created".
  private readonly INSIGHT_LINK_PREFIX = "insight::";

	async onload() {
    addIcon("inbox", INBOX_ICON_PATH);
    await this.loadSettings();

		// const INTERMEDIATE_FOLDER = this.settings.intermediateFolder;
		// Insight notes created from checked memos are stored here.
		// const INSIGHT_FOLDER = this.settings.insightFolder;

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

    this.addSettingTab(new KoboHighlightsPickerAndInboxerSettingsTab(this.app, this));
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
        // 1) create an insight note
        const createdPath = await this.createNewInsightNote(
          target.title,
          result.quoteContent,
          file.basename,
          result.bookmarkId,
        );

        newLines[target.index] = `- [ ] memo:: `;

        // 3) add a dedicated marker line that we can reliably count later
        //    (don't count generic [[links]]; only this prefix is considered)
        if (createdPath) {
          const linkTarget = createdPath.replace(/\.md$/i, "");
          newLines.splice(target.index + 1, 0, `- ${this.INSIGHT_LINK_PREFIX} [[${linkTarget}]]`);
        }
        
        createdCount++;
      }
    }

    await this.app.vault.modify(file, newLines.join("\n"));
    await this.updateIntermediateNoteStats(file);
    new Notice(createdCount + " 件の知見ノートを作成しました");
  }

  /**
   * Recompute and store stats for an intermediate note.
   * Source of truth is the note body; frontmatter is just a cache for fast UI.
   */
  private async updateIntermediateNoteStats(file: TFile): Promise<void> {
    try {
      const text = await this.app.vault.read(file);
      const stats = this.computeIntermediateStats(text);
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        // keep existing title/sync_date
        const kobo = (fm.kobo_stats ??= {});
        kobo.highlights_total = stats.highlights_total;
        kobo.insights_created = stats.insights_created;
        kobo.updated_at = new Date().toISOString();
      });
    } catch (e) {
      // Stats are a convenience; do not break extraction if something goes wrong.
      console.warn("Failed to update kobo_stats:", e);
    }
  }

  private computeIntermediateStats(text: string): {
    highlights_total: number;
    insights_created: number;
  } {
    const highlights_total = (text.match(/^> \[!quote\]/gm) ?? []).length;

    // Only count lines that start with our dedicated marker.
    const insights_created = (text.match(new RegExp(`^\\s*-\\s*${this.escapeForRegex(this.INSIGHT_LINK_PREFIX)}\\s*\\[\\[.+?\\]\\]`, "gm")) ?? []).length;

    return { highlights_total, insights_created };
  }

  private escapeForRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  async createNewInsightNote(title: string, quote: string, bookTitle: string, bookmarkId?: string): Promise<string | null> {
		const normalizedTitle = (title ?? "")
    .replace(/^\s*memo::\s*/i, "")  // strip "memo::" if it appears at the start
    .trim();

		// ② 空なら「作らない」
		if (!normalizedTitle) {
			return null;
		}

    const folder = this.settings.insightFolder;
    const safe = sanitizeFileName(normalizedTitle);
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
title: "${normalizedTitle.replace(/"/g, '\\"')}"
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
      return path;
    } catch (e) {
      new Notice(`エラー: 同名のファイルが既に存在する可能性があります (${title})`);
      return path; // still return path so the link can be added (user might already have it)
    }
  }
}



// ===== Kobo Stats Helpers (FINAL) =====
export function computeKoboStatsFromBody(body: string) {
  const highlights_total =
    (body.match(/^> \[!quote\]/gm) || []).length;



  const insights_created =
    (body.match(/^\s*-\s*insight::\s*\[\[.+?\]\]/gm) || []).length;

  return { highlights_total, insights_created };
}

// Replace memo:: with insight:: inside a highlight block
export function replaceMemoWithInsight(
  blockText: string,
  insightLink: string
): string {
  const withoutMemo = blockText.replace(
    /^\s*-\s*\[[ xX]\]\s*memo::.*$/gm,
    ""
  );

  return withoutMemo.trimEnd() + `\n\n- insight:: [[${insightLink}]]\n`;
}
