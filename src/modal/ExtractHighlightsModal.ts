import { App, Modal, normalizePath, Notice, TFile } from "obsidian";
import { sanitize } from "sanitize-filename-ts";
import SqlJs from "sql.js";
import { binary } from "src/binaries/sql-wasm";
import { HighlightService } from "src/database/Highlight";
import { Bookmark } from "src/database/interfaces";
import { Repository } from "src/database/repository";
import { KoboHighlightsPickerAndInboxerSettings } from "src/settings/Settings";
import { applyTemplateTransformations } from "src/template/template";
import { getTemplateContents } from "src/template/templateContents";

export class ExtractHighlightsModal extends Modal {
	goButtonEl!: HTMLButtonElement;
	inputFileEl!: HTMLInputElement;

	settings: KoboHighlightsPickerAndInboxerSettings;

	fileBuffer: ArrayBuffer | null | undefined;

	nrOfBooksExtracted: number;

	bookListContainerEl!: HTMLDivElement; // リスト表示用
  selectedBooks: Set<string> = new Set(); // チェックされた本のタイトルを保持

	private get intermediateFolder(): string {
		return this.settings?.intermediateFolder || "Kobo-Inboxes";
	}
	
	/*
	private get insightFolder(): string {
		return this.settings?.insightFolder || "Kobo-Insights";
	}
	*/
	

  // Marker line used in intermediate notes to record an extracted insight.
  private readonly INSIGHT_LINK_PREFIX = "insight::";

	constructor(app: App, settings: KoboHighlightsPickerAndInboxerSettings) {
		super(app);
		this.settings = settings;
		this.nrOfBooksExtracted = 0;
	}

	private async fetchHighlights() {
		if (!this.fileBuffer) {
			throw new Error("No sqlite DB file selected...");
		}

		const SQLEngine = await SqlJs({
			wasmBinary: binary.buffer,
		});

		const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer));

		const service: HighlightService = new HighlightService(
			new Repository(db),
		);

		const content = service.convertToMap(
			await service.getAllHighlight(this.settings.sortByChapterProgress),
		);

		const allBooksContent = new Map<string, Map<string, Bookmark[]>>();

		// Add all books with highlights
		for (const [bookTitle, chapters] of content) {
			allBooksContent.set(bookTitle, chapters);
		}

		if (this.settings.importAllBooks) {
			// Add books without highlights
			const allBooks = await service.getAllBooks();

			for (const [bookTitle, _] of allBooks) {
				if (!allBooksContent.has(bookTitle)) {
					allBooksContent.set(
						bookTitle,
						service.createEmptyContentMap(),
					);
				}
			}
		}

		this.nrOfBooksExtracted = allBooksContent.size;
		await this.writeBooks(service, allBooksContent);
	}

	private async writeBooks(
		service: HighlightService,
		content: Map<string, Map<string, Bookmark[]>>,
	) {
		const template = await getTemplateContents(
			this.app,
			this.settings.templatePath,
		);

		for (const [bookTitle, chapters] of content) {
			const sanitizedBookName = sanitize(bookTitle);
			const fileName = normalizePath(
				`${this.intermediateFolder}/${sanitizedBookName}.md`,
			);

			const details =
				await service.getBookDetailsFromBookTitle(bookTitle);

			await this.app.vault.adapter.write(
				fileName,
				applyTemplateTransformations(template, chapters, details),
			);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty(); // 初期化
	
		contentEl.createEl("h2", { text: "Kobo Book Selector" });
	
		// 1. ファイル選択エリア
		const fileInputContainer = contentEl.createDiv();
		this.inputFileEl = fileInputContainer.createEl("input", { type: "file" });
		this.inputFileEl.accept = ".sqlite";
	
		// 2. 本の一覧を表示するエリア（最初は空）
		this.bookListContainerEl = contentEl.createDiv({ cls: "kobo-book-list" });
		this.bookListContainerEl.createEl("p", { text: "Please select KoboReader.sqlite to see books." });
	
		// 3. 実行ボタンエリア（最初は非表示または無効）
		const buttonContainer = contentEl.createDiv({ cls: "kobo-button-container" });
		this.goButtonEl = buttonContainer.createEl("button", {
			text: "Next: Select Highlights",
			cls: "mod-cta" // Obsidian標準の目立つボタン色
		});
		this.goButtonEl.disabled = true;
	
		// ファイル読み込みイベント
		this.inputFileEl.addEventListener("change", (ev) => {
			const file = (ev.target as HTMLInputElement)?.files?.[0];
			if (!file) return;
	
			const reader = new FileReader();
			reader.onload = async () => {
				this.fileBuffer = reader.result as ArrayBuffer;
				// DBをスキャンしてリストを更新するメソッド（次で作る）を呼ぶ
				await this.refreshBookList();
			};
			reader.readAsArrayBuffer(file);
		});

		this.goButtonEl.addEventListener("click", async () => {
      if (this.selectedBooks.size === 0) return;
      
      const SQLEngine = await SqlJs({ wasmBinary: binary.buffer });
      const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer!));
      const service = new HighlightService(new Repository(db));

      new Notice("Syncing to intermediate notes...");

      for (const bookTitle of Array.from(this.selectedBooks)) {
        await this.syncToIntermediateNote(bookTitle, service, db);
      }

      db.close();
      this.close();
    });
	}

	// ★ 新しく追加：次のステップの画面を描画するメソッド
  private async renderHighlightSelector() {
    const { contentEl } = this;
    contentEl.empty(); // 前の画面（書籍選択）を消す

    contentEl.createEl("h2", { text: "Step 2: Select Highlights & Name Titles" });
    
    const scrollArea = contentEl.createDiv({ cls: "kobo-highlight-scroll-area" });
    scrollArea.style.maxHeight = "400px";
    scrollArea.style.overflowY = "auto";
    scrollArea.style.border = "1px solid var(--background-modifier-border)";
    scrollArea.style.padding = "10px";

    scrollArea.createEl("p", { text: "Loading highlights for selected books..." });

    // ここに選択した本のハイライトを抽出して並べるロジックを書いていきます
    // 次のステップでここを作り込みます
  }

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async refreshBookList() {
		if (!this.fileBuffer) return;

		this.bookListContainerEl.empty();
		this.bookListContainerEl.createEl("h3", { text: "Select Books to Import" });

		const SQLEngine = await SqlJs({ wasmBinary: binary.buffer });
		const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer));
		
		// --- 軽量化SQL: ハイライトが存在する本のタイトルだけを重複なく取得 ---
		const query = `
			SELECT DISTINCT content.Title 
			FROM content 
			JOIN bookmark ON content.ContentID = bookmark.VolumeID 
			WHERE content.ContentType = 6
			ORDER BY content.Title ASC
		`;
		
		const results = db.exec(query);
		
		if (results.length === 0 || !results[0].values) {
			this.bookListContainerEl.createEl("p", { text: "No books with highlights found." });
			db.close();
			return;
		}
		
		const bookTitles = results[0].values.map(v => v[0] as string);

		// --- 既存の中継ノート有無で振り分け ---
		const folderPath = this.intermediateFolder;
		const statusList = await Promise.all(
			bookTitles.map(async (bookTitle) => {
				const sanitizedBookName = sanitize(bookTitle);
				const fileName = normalizePath(`${folderPath}/${sanitizedBookName}.md`);
				const exists = await this.app.vault.adapter.exists(fileName);
				return { bookTitle, exists, fileName };
			})
		);

		const already = statusList.filter(x => x.exists).map(x => x.bookTitle);
		const newOnes = statusList.filter(x => !x.exists).map(x => x.bookTitle);

		// UI: 便利ボタン
		const actionRow = this.bookListContainerEl.createDiv({ cls: "kobo-book-actions" });
		actionRow.style.display = "flex";
		actionRow.style.gap = "8px";
		actionRow.style.margin = "10px 0";

		const selectNewBtn = actionRow.createEl("button", { text: "Select all NEW" });
		selectNewBtn.addEventListener("click", () => {
			this.selectedBooks = new Set(newOnes);
			this.goButtonEl.disabled = this.selectedBooks.size === 0;
			this.refreshBookList();
		});

		const clearBtn = actionRow.createEl("button", { text: "Clear selection" });
		clearBtn.addEventListener("click", () => {
			this.selectedBooks.clear();
			this.goButtonEl.disabled = true;
			this.refreshBookList();
		});

		const renderSection = (title: string, items: string[], badgeText: string) => {
			const section = this.bookListContainerEl.createDiv({ cls: "kobo-book-section" });
			section.createEl("h4", { text: `${title} (${items.length})` });

			items.forEach((bookTitle) => {
				const sanitizedBookName = sanitize(bookTitle);
				const fileName = normalizePath(`${folderPath}/${sanitizedBookName}.md`);
				const stats = this.readCachedStats(fileName);
				const badgeTextWithStats = stats
					? `${badgeText}  H:${stats.highlights_total}  I:${stats.insights_created}`
					: badgeText;

				const bookRow = section.createDiv({ cls: "kobo-book-row" });
				bookRow.style.display = "flex";
				bookRow.style.alignItems = "center";
				bookRow.style.margin = "5px 0";

				const checkbox = bookRow.createEl("input", { type: "checkbox" });
				checkbox.checked = this.selectedBooks.has(bookTitle);

				const label = bookRow.createEl("label", { text: bookTitle });
				label.style.marginLeft = "10px";
				label.style.flexGrow = "1";

				const badge = bookRow.createEl("span", { text: badgeTextWithStats });
				badge.style.fontSize = "0.75em";
				badge.style.opacity = "0.75";
				badge.style.marginLeft = "8px";

				checkbox.addEventListener("change", () => {
					if (checkbox.checked) {
						this.selectedBooks.add(bookTitle);
					} else {
						this.selectedBooks.delete(bookTitle);
					}
					this.goButtonEl.disabled = this.selectedBooks.size === 0;
				});
			});
		};

		renderSection("NEW (no intermediate note yet)", newOnes, "NEW");
		renderSection("ALREADY HAS intermediate note", already, "SYNCED");

		new Notice(`${bookTitles.length} books with highlights found. NEW:${newOnes.length} / SYNCED:${already.length}`);
		db.close(); // メモリ解放
	}

	/**
	 * Read cached stats from frontmatter if available.
	 * Returns null if the file doesn't exist or stats are missing/not yet cached.
	 */
	private readCachedStats(filePath: string): {
		highlights_total: number;
		insights_created: number;
	} | null {
		const f = this.app.vault.getAbstractFileByPath(filePath);
		if (!(f instanceof TFile)) return null;
		const cache = this.app.metadataCache.getFileCache(f);
		const fm: any = cache?.frontmatter;
		const ks: any = fm?.kobo_stats;
		if (!ks) return null;
		const h = Number(ks.highlights_total);
		const i = Number(ks.insights_created);
		if ([h, i].some((n) => Number.isNaN(n))) return null;
		return { highlights_total: h, insights_created: i };
	}

	/**
	 * Recompute stats from the note body and store them into frontmatter (cache).
	 * Source of truth is the body; frontmatter is only for fast listing.
	 */
	private async recomputeAndCacheStats(filePath: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(filePath);
		if (!(f instanceof TFile)) return;
		const text = await this.app.vault.read(f);
		const stats = this.computeIntermediateStats(text);
		await this.app.fileManager.processFrontMatter(f, (fm) => {
			const kobo = (fm.kobo_stats ??= {});
			kobo.highlights_total = stats.highlights_total;
			kobo.insights_created = stats.insights_created;
			kobo.updated_at = new Date().toISOString();
		});
	}

	private computeIntermediateStats(text: string): {
		highlights_total: number;
		insights_created: number;
	} {
		const highlights_total = (text.match(/^> \[!quote\]/gm) ?? []).length;
		const insights_created = (
			text.match(
				new RegExp(
					`^\\s*-\\s*${this.escapeForRegex(this.INSIGHT_LINK_PREFIX)}\\s*\\[\\[.+?\\]\\]`,
					"gm",
				),
			) ?? []
		).length;
		return { highlights_total, insights_created };
	}

	private escapeForRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// --- 中継ノートの生成または更新を行うメイン関数 ---
  private async syncToIntermediateNote(bookTitle: string, service: HighlightService, db: any) {
		const sanitizedBookName = sanitize(bookTitle);
		const folderPath = this.intermediateFolder;
		const fileName = normalizePath(`${folderPath}/${sanitizedBookName}.md`);
		
		if (!(await this.app.vault.adapter.exists(folderPath))) {
			await this.app.vault.createFolder(folderPath);
		}
	
		const highlightQuery = `
			SELECT b.BookmarkID, b.Text, b.Annotation
			FROM bookmark b
			INNER JOIN content c ON b.VolumeID = c.ContentID
			WHERE c.Title = '${bookTitle.replace(/'/g, "''")}'
			AND b.Text IS NOT NULL
		`;
		
		const res = db.exec(highlightQuery);
		if (!res || res.length === 0 || !res[0].values) {
			console.log(`No highlights found for ${bookTitle}`);
			return;
		}
	
		// 1. 既存ファイルの内容を取得。なければヘッダーのみ作成
		let existingContent = "";
		const fileExists = await this.app.vault.adapter.exists(fileName);
		if (fileExists) {
			existingContent = await this.app.vault.adapter.read(fileName);
		} else {
			existingContent = this.createNoteHeader(bookTitle);
		}
	
		// 2. 新規分だけを組み立てる
		let newHighlightsText = "";
		let addedCount = 0;
	
		for (const row of res[0].values) {
			const id = row[0] as string;
			const rawText = row[1] as string;
			// コールアウト形式に変換
			const calloutText = rawText.trim().split('\n').map(line => `> ${line}`).join('\n');
			const annotation = row[2] as string || "";
			const summary = rawText.replace(/\r?\n/g, '').slice(0, 30);
	
			if (!existingContent.includes(`id: ${id}`)) {
				let block = `\n---\n> [!quote]- ${summary}...\n> <!-- id: ${id} -->\n${calloutText}\n> \n\n`;
				
				// Kobo側でメモ（Annotation）があれば、考察欄の初期値として入れる
				if (annotation) {
					block += `📝: ${annotation}\n\n`;
				}
				
				// 知見ノート化のための入力行（メモ欄）
				block += `- [ ] memo:: \n`;
				
				newHighlightsText += block;
				addedCount++;
			}
		}
	
		// 3. 書き込み処理
		if (addedCount > 0) {
			// 既存の内容の末尾に、新しいハイライトを合体させる
			const updatedContent = existingContent.trimEnd() + "\n\n" + newHighlightsText.trim();
			await this.app.vault.adapter.write(fileName, updatedContent);
			await this.recomputeAndCacheStats(fileName);
			new Notice(`${bookTitle}: ${addedCount}件追加完了`);
		} else {
			// 初回作成時のみ、中身がなくてもヘッダーだけ書く
			if (!fileExists) {
				await this.app.vault.adapter.write(fileName, existingContent);
				await this.recomputeAndCacheStats(fileName);
				new Notice(`${bookTitle}: 中継ノートを作成しました（新着なし）`);
			} else {
				new Notice(`${bookTitle}: すべて同期済みです`);
			}
		}
	}

  // 中継ノートの冒頭部分（ボタンを含む）を作成
  private createNoteHeader(title: string): string {
		const now = new Date().toISOString();
		return `---
title: "${title}"
sync_date: ${now}
kobo_stats:
  highlights_total: 0
  insights_created: 0
  updated_at: ${now}
---

\`\`\`kobo-inboxer
\`\`\`

# ${title}
`;
}

/*
	private async renderHighlightSelector() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Step 2: Preview Highlights & Name Titles" });
    const description = contentEl.createEl("p", { text: "選んだハイライトが個別のノートとして保存されます。タイトルを入力してください。" });

    const scrollArea = contentEl.createDiv({ cls: "kobo-highlight-scroll-area" });
    scrollArea.style.maxHeight = "500px";
    scrollArea.style.overflowY = "auto";
    scrollArea.style.border = "1px solid var(--background-modifier-border)";
    scrollArea.style.padding = "15px";
    scrollArea.style.backgroundColor = "var(--background-secondary)";

    // DB再接続してハイライト詳細を取得
    const SQLEngine = await SqlJs({ wasmBinary: binary.buffer });
    const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer!));
    const service = new HighlightService(new Repository(db));

    // 選択された本のタイトルに紐づくハイライトを収集
    const highlightsToDisplay: { bookTitle: string, bookmark: Bookmark, titleInput: HTMLInputElement, checkbox: HTMLInputElement }[] = [];

    for (const bookTitle of Array.from(this.selectedBooks)) {
			// --- 修正箇所: 直接SQLを実行して、その本のハイライトを安全に取得 ---
			const highlightQuery = `
				SELECT 
					bookmark.Text as text, 
					bookmark.Annotation as annotation, 
					bookmark.ChapterProgress as chapterProgress
				FROM bookmark
				JOIN content ON bookmark.VolumeID = content.ContentID
				WHERE content.Title = '${bookTitle.replace(/'/g, "''")}'
				AND bookmark.Text IS NOT NULL
				ORDER BY bookmark.ChapterProgress ASC
			`;
			
			const res = db.exec(highlightQuery);
			const bookmarks: any[] = [];
			
			if (res.length > 0 && res[0].values) {
					res[0].values.forEach(row => {
							bookmarks.push({
									text: row[0],
									annotation: row[1],
									chapterProgress: row[2]
							});
					});
			}

			// --- UIの構築 ---
			const bookHeader = scrollArea.createEl("h3", { text: bookTitle });
			bookHeader.style.borderBottom = "1px solid var(--text-muted)";
			bookHeader.style.marginTop = "20px";

			bookmarks.forEach((bm) => {
					const card = scrollArea.createDiv({ cls: "kobo-highlight-card" });
					card.style.backgroundColor = "var(--background-primary)";
					card.style.margin = "10px 0";
					card.style.padding = "10px";
					card.style.borderRadius = "8px";
					card.style.border = "1px solid var(--background-modifier-border)";

					// 1. 上段エリア（チェックボックスとタイトル入力）
					const topRow = card.createDiv();
					topRow.style.display = "flex";
					topRow.style.justifyContent = "space-between";
					topRow.style.alignItems = "center";

					const checkbox = topRow.createEl("input", { type: "checkbox" });
					checkbox.checked = true;

					const titleInput = topRow.createEl("input", { type: "text" });
					titleInput.placeholder = "ノートのタイトルを入力 (空欄なら本文冒頭)";
					titleInput.style.flexGrow = "1";
					titleInput.style.margin = "0 10px";

					// 2. ハイライト本文のプレビュー（小文字の .text に修正）
					const quote = card.createEl("blockquote", { text: bm.text });
					quote.style.fontSize = "0.9em";
					quote.style.margin = "10px 0 0 0";
					quote.style.color = "var(--text-normal)";

					// 3. メモがあれば表示（小文字の .annotation に修正）
					if (bm.annotation) {
							const note = card.createEl("p", { text: `📝: ${bm.annotation}` });
							note.style.fontSize = "0.8em";
							note.style.color = "var(--text-accent)";
							note.style.marginTop = "5px";
					}

					highlightsToDisplay.push({ bookTitle, bookmark: bm, titleInput, checkbox });
			});
	}

    // --- 保存ボタン ---
    const bottomActionRow = contentEl.createDiv();
    bottomActionRow.style.marginTop = "20px";
    bottomActionRow.style.textAlign = "right";

    const saveButton = bottomActionRow.createEl("button", {
        text: "Save Selected to Inbox",
        cls: "mod-cta"
    });

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
        
        let count = 0;
        for (const item of highlightsToDisplay) {
            if (item.checkbox.checked) {
                await this.saveHighlightAsNote(item.bookTitle, item.bookmark, item.titleInput.value);
                count++;
            }
        }

        new Notice(`${count} 件のハイライトを保存しました！`);
        this.close();
    });

    db.close();
	}


	private async renderHighlightSelector() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Step 2: Preview Highlights & Name Titles" });
    const description = contentEl.createEl("p", { text: "選んだハイライトが個別のノートとして保存されます。タイトルを入力してください。" });

    const scrollArea = contentEl.createDiv({ cls: "kobo-highlight-scroll-area" });
    scrollArea.style.maxHeight = "500px";
    scrollArea.style.overflowY = "auto";
    scrollArea.style.border = "1px solid var(--background-modifier-border)";
    scrollArea.style.padding = "15px";
    scrollArea.style.backgroundColor = "var(--background-secondary)";

    // DB再接続してハイライト詳細を取得
    const SQLEngine = await SqlJs({ wasmBinary: binary.buffer });
    const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer!));
    const service = new HighlightService(new Repository(db));

    // 選択された本のタイトルに紐づくハイライトを収集
    const highlightsToDisplay: { bookTitle: string, bookmark: Bookmark, titleInput: HTMLInputElement, checkbox: HTMLInputElement }[] = [];

    for (const bookTitle of Array.from(this.selectedBooks)) {
			// --- 修正箇所: 直接SQLを実行して、その本のハイライトを安全に取得 ---
			const highlightQuery = `
				SELECT 
					bookmark.Text as text, 
					bookmark.Annotation as annotation, 
					bookmark.ChapterProgress as chapterProgress
				FROM bookmark
				JOIN content ON bookmark.VolumeID = content.ContentID
				WHERE content.Title = '${bookTitle.replace(/'/g, "''")}'
				AND bookmark.Text IS NOT NULL
				ORDER BY bookmark.ChapterProgress ASC
			`;
			
			const res = db.exec(highlightQuery);
			const bookmarks: any[] = [];
			
			if (res.length > 0 && res[0].values) {
					res[0].values.forEach(row => {
							bookmarks.push({
									text: row[0],
									annotation: row[1],
									chapterProgress: row[2]
							});
					});
			}

			// --- UIの構築 ---
			const bookHeader = scrollArea.createEl("h3", { text: bookTitle });
			bookHeader.style.borderBottom = "1px solid var(--text-muted)";
			bookHeader.style.marginTop = "20px";

			bookmarks.forEach((bm) => {
					const card = scrollArea.createDiv({ cls: "kobo-highlight-card" });
					card.style.backgroundColor = "var(--background-primary)";
					card.style.margin = "10px 0";
					card.style.padding = "10px";
					card.style.borderRadius = "8px";
					card.style.border = "1px solid var(--background-modifier-border)";

					// 1. 上段エリア（チェックボックスとタイトル入力）
					const topRow = card.createDiv();
					topRow.style.display = "flex";
					topRow.style.justifyContent = "space-between";
					topRow.style.alignItems = "center";

					const checkbox = topRow.createEl("input", { type: "checkbox" });
					checkbox.checked = true;

					const titleInput = topRow.createEl("input", { type: "text" });
					titleInput.placeholder = "ノートのタイトルを入力 (空欄なら本文冒頭)";
					titleInput.style.flexGrow = "1";
					titleInput.style.margin = "0 10px";

					// 2. ハイライト本文のプレビュー（小文字の .text に修正）
					const quote = card.createEl("blockquote", { text: bm.text });
					quote.style.fontSize = "0.9em";
					quote.style.margin = "10px 0 0 0";
					quote.style.color = "var(--text-normal)";

					// 3. メモがあれば表示（小文字の .annotation に修正）
					if (bm.annotation) {
							const note = card.createEl("p", { text: `📝: ${bm.annotation}` });
							note.style.fontSize = "0.8em";
							note.style.color = "var(--text-accent)";
							note.style.marginTop = "5px";
					}

					highlightsToDisplay.push({ bookTitle, bookmark: bm, titleInput, checkbox });
			});
	}

    // --- 保存ボタン ---
    const bottomActionRow = contentEl.createDiv();
    bottomActionRow.style.marginTop = "20px";
    bottomActionRow.style.textAlign = "right";

    const saveButton = bottomActionRow.createEl("button", {
        text: "Save Selected to Inbox",
        cls: "mod-cta"
    });

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
        
        let count = 0;
        for (const item of highlightsToDisplay) {
            if (item.checkbox.checked) {
                await this.saveHighlightAsNote(item.bookTitle, item.bookmark, item.titleInput.value);
                count++;
            }
        }

        new Notice(`${count} 件のハイライトを保存しました！`);
        this.close();
    });

    db.close();
	}
	*/

	private async saveHighlightAsNote(bookTitle: string, bookmark: Bookmark, customTitle: string) {
    // 1. ファイル名の決定
    // カスタムタイトルがあればそれを使用、なければ本文の最初の15文字
    let fileName = customTitle.trim() !== "" 
        ? customTitle.trim() 
        : bookmark.text.substring(0, 15).replace(/[\\/:*?"<>|]/g, "");
    
    // 重複を避けるためにタイムスタンプ等を付与しても良いですが、まずはシンプルに
    const fullPath = normalizePath(`${this.intermediateFolder}/${sanitize(fileName)}.md`);

    // 2. フロントマターと本文の組み立て（理想の構造）
    const fileContent = `---
title: "${customTitle || fileName}"
book: "[[${bookTitle}]]"
author: ""
date: ${new Date().toISOString().split('T')[0]}
tags: [kobo-highlight]
location: "${bookmark.chapterProgress}"
---

> [!quote]+ ${bookmark.text}
${bookmark.annotation ? `\n${bookmark.annotation}\n` : ""}
— *出典: ${bookTitle}*
`;

    // 3. 書き出し（既存ファイルがあれば上書き、またはNoticeを出す）
    try {
        await this.app.vault.adapter.write(fullPath, fileContent);
    } catch (e) {
        console.error("Failed to write file:", fullPath, e);
    }
	}
}



// ===== Kobo Stats Display Helpers (FINAL) =====
function readKoboStats(cache: any) {
  const ks = cache?.frontmatter?.kobo_stats;
  if (!ks) {
    return { highlights_total: 0, insights_created: 0 };
  }
  return {
    highlights_total: ks.highlights_total ?? 0,
    insights_created: ks.insights_created ?? 0,
  };
}
