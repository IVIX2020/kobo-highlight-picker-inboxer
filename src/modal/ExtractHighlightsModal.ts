import { App, Modal, normalizePath, Notice, TFile, Setting } from "obsidian";
import { sanitize } from "sanitize-filename-ts";
import SqlJs from "sql.js";
import { binary } from "src/binaries/sql-wasm";
import { HighlightService } from "src/database/Highlight";
import { Bookmark } from "src/database/interfaces";
import { Repository } from "src/database/repository";
import { KoboHighlightPickerAndInboxerSettings } from "src/settings/Settings";
import { applyTemplateTransformations } from "src/template/template";
import { getTemplateContents } from "src/template/templateContents";

export class ExtractHighlightsModal extends Modal {
	goButtonEl!: HTMLButtonElement;
	inputFileEl!: HTMLInputElement;

	settings: KoboHighlightPickerAndInboxerSettings;

	fileBuffer: ArrayBuffer | null | undefined;

	nrOfBooksExtracted: number;

	bookListContainerEl!: HTMLDivElement; // リスト表示用
  selectedBooks: Set<string> = new Set(); // チェックされた本のタイトルを保持

	private get intermediateFolder(): string {
		return this.settings?.intermediateFolder || "Kobo-Inboxes";
	}
  // Marker line used in intermediate notes to record an extracted insight.
  private readonly INSIGHT_LINK_PREFIX = "insight::";

	constructor(app: App, settings: KoboHighlightPickerAndInboxerSettings) {
		super(app);
		this.settings = settings;
		this.nrOfBooksExtracted = 0;
	}

	private async fetchHighlights() {
		if (!this.fileBuffer) {
			throw new Error("No SQlite database file selected.");
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
	
		new Setting(contentEl).setName("Kobo book selector").setHeading();
	
		// 1. ファイル選択エリア
		const fileInputContainer = contentEl.createDiv();
		this.inputFileEl = fileInputContainer.createEl("input", { type: "file" });
		this.inputFileEl.accept = ".sqlite";
	
		// 2. 本の一覧を表示するエリア（最初は空）
		this.bookListContainerEl = contentEl.createDiv({ cls: "kobo-book-list" });
		this.bookListContainerEl.createEl("p", { text: "Select KoboReader.sqlite to view your books." });
	
		// 3. 実行ボタンエリア（最初は非表示または無効）
		const buttonContainer = contentEl.createDiv({ cls: "kobo-button-container" });
		this.goButtonEl = buttonContainer.createEl("button", {
			text: "Next: select highlights",
			cls: "mod-cta" // Obsidian標準の目立つボタン色
		});
		this.goButtonEl.disabled = true;
	
		// ファイル読み込みイベント
		this.inputFileEl.addEventListener("change", (ev) => {
			const file = (ev.target as HTMLInputElement)?.files?.[0];
			if (!file) return;
	
			const reader = new FileReader();
			reader.onload = () => {
				this.fileBuffer = reader.result as ArrayBuffer;
				void this.refreshBookList().catch(console.error);
			};
			reader.readAsArrayBuffer(file);
		});

		this.goButtonEl.addEventListener("click", () => {
			void (async () => {
				if (this.selectedBooks.size === 0) return;
		
				const SQLEngine = await SqlJs({ wasmBinary: binary.buffer });
				const db = new SQLEngine.Database(new Uint8Array(this.fileBuffer!));
				const service = new HighlightService(new Repository(db));
		
				new Notice("Syncing intermediate notes...");
		
				for (const bookTitle of Array.from(this.selectedBooks)) {
					await this.syncToIntermediateNote(bookTitle, service, db);
				}
		
				db.close();
				this.close();
			})().catch(console.error);
		});		
	}

	private renderHighlightSelector() {
		const { contentEl } = this;
		contentEl.empty();
	
		new Setting(contentEl)
			.setName("Step 2: select highlights and name titles")
			.setHeading();
	
		const scrollArea = contentEl.createDiv({ cls: "kobo-highlight-scroll-area" });
		scrollArea.createEl("p", { text: "Loading highlights for selected books..." });
	}
	

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async refreshBookList() {
		if (!this.fileBuffer) return;

		this.bookListContainerEl.empty();
		new Setting(this.bookListContainerEl)
			.setName("Select books to import")
			.setHeading();


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

		const selectNewBtn = actionRow.createEl("button", { text: "Select all new" });
		selectNewBtn.addEventListener("click", () => {
			this.selectedBooks = new Set(newOnes);
			this.goButtonEl.disabled = this.selectedBooks.size === 0;
			void this.refreshBookList().catch(console.error);
		});

		const selectAllBtn = actionRow.createEl("button", { text: "Select all" });
		selectAllBtn.addEventListener("click", () => {
			this.selectedBooks = new Set(bookTitles);
			this.goButtonEl.disabled = this.selectedBooks.size === 0;
			void this.refreshBookList().catch(console.error);
		});

		const clearBtn = actionRow.createEl("button", { text: "Clear selection" });
		clearBtn.addEventListener("click", () => {
			this.selectedBooks.clear();
			this.goButtonEl.disabled = true;
			void this.refreshBookList().catch(console.error);
		});

		const renderSection = (title: string, items: string[], badgeText: string) => {
			const section = this.bookListContainerEl.createDiv({ cls: "kobo-book-section" });
			section.createDiv({
				cls: "kobo-section-title",
				text: `${title} (${items.length})`,
			});

			items.forEach((bookTitle) => {
				const sanitizedBookName = sanitize(bookTitle);
				const fileName = normalizePath(`${folderPath}/${sanitizedBookName}.md`);
				const stats = this.readCachedStats(fileName);
				const badgeTextWithStats = stats
					? `${badgeText}  H:${stats.highlights_total}  I:${stats.insights_created}`
					: badgeText;

				const bookRow = section.createDiv({ cls: "kobo-book-row" });

				const checkbox = bookRow.createEl("input", { type: "checkbox" });
				checkbox.checked = this.selectedBooks.has(bookTitle);

				const label = bookRow.createEl("label", { text: bookTitle, cls: "kobo-book-label" });

				const badge = bookRow.createEl("span", {
					text: badgeTextWithStats,
					cls: "kobo-book-badge",
				});

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

		renderSection("New (no intermediate note yet)", newOnes, "New");
		renderSection("Already has intermediate note", already, "Synced");

		new Notice(`${bookTitles.length} books with highlights found. new: ${newOnes.length} / synced: ${already.length}`);
		db.close(); 
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
		const fm = cache?.frontmatter as unknown;
		if (typeof fm !== "object" || fm === null || !("kobo_stats" in fm)) return null;
		
		const ks = (fm as { kobo_stats: unknown }).kobo_stats;
		if (typeof ks !== "object" || ks === null) return null;
		
		const h = Number((ks as Record<string, unknown>)["highlights_total"]);
		const i = Number((ks as Record<string, unknown>)["insights_created"]);
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
	private async syncToIntermediateNote(
		bookTitle: string,
		service: HighlightService,
		db: unknown
	) {
		// db: unknown → 使う直前で安全に扱う
		const sqlDb = db as { exec: (q: string) => unknown };
	
		const sanitizedBookName = sanitize(bookTitle);
		const folderPath = this.intermediateFolder;
		const fileName = normalizePath(`${folderPath}/${sanitizedBookName}.md`);
	
		if (!(await this.app.vault.adapter.exists(folderPath))) {
			await this.app.vault.createFolder(folderPath);
		}
	
		const escapedTitle = bookTitle.replace(/'/g, "''");
		const highlightQuery = `
			SELECT b.BookmarkID, b.Text, b.Annotation
			FROM bookmark b
			INNER JOIN content c ON b.VolumeID = c.ContentID
			WHERE c.Title = '${escapedTitle}'
				AND b.Text IS NOT NULL
		`;
	
		const execResult = sqlDb.exec(highlightQuery);
	
		// sql.js の exec 結果を最低限でガード（any禁止なので unknown → narrowing）
		const res = Array.isArray(execResult) ? execResult : null;
		const first = res?.[0] as unknown;
	
		const values =
			typeof first === "object" &&
			first !== null &&
			"values" in first &&
			Array.isArray((first as { values: unknown }).values)
				? (first as { values: unknown[] }).values
				: null;

	
		if (!values || values.length === 0) {
			console.debug(`No highlights found for ${bookTitle}`);
			return;
		}
	
		// 既存ファイル読み込み
		const fileExists = await this.app.vault.adapter.exists(fileName);
		const existingContent = fileExists
			? await this.app.vault.adapter.read(fileName)
			: this.createNoteHeader(bookTitle);
	
		let newHighlightsText = "";
		let addedCount = 0;
	
		for (const row of values) {
			if (!Array.isArray(row)) continue;
	
			const id = String(row[0] ?? "");
			const rawText = String(row[1] ?? "");
			const annotation = String(row[2] ?? "");
	
			const calloutText = rawText
				.trim()
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n");
	
			const summary = rawText.replace(/\r?\n/g, "").slice(0, 30);
	
			if (!existingContent.includes(`id: ${id}`)) {
				let block =
					`\n---\n` +
					`> [!quote]- ${summary}...\n` +
					`> <!-- id: ${id} -->\n` +
					`${calloutText}\n` +
					`> \n\n`;
	
				if (annotation) block += `📝: ${annotation}\n\n`;
				block += `- [ ] memo:: \n`;
	
				newHighlightsText += block;
				addedCount++;
			}
		}
	
		if (addedCount > 0) {
			const updatedContent =
				existingContent.trimEnd() + "\n\n" + newHighlightsText.trim();
			await this.app.vault.adapter.write(fileName, updatedContent);
			await this.recomputeAndCacheStats(fileName);
			new Notice(`${bookTitle}: ${addedCount}件追加完了`);
			return;
		}
	
		if (!fileExists) {
			await this.app.vault.adapter.write(fileName, existingContent);
			await this.recomputeAndCacheStats(fileName);
			new Notice(`${bookTitle}: 中継ノートを作成しました（新着なし）`);
		} else {
			new Notice(`${bookTitle}: すべて同期済みです`);
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
