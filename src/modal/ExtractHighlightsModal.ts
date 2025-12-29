import { App, Modal, normalizePath, Notice } from "obsidian";
import { sanitize } from "sanitize-filename-ts";
import SqlJs from "sql.js";
import { binary } from "src/binaries/sql-wasm";
import { HighlightService } from "src/database/Highlight";
import { Bookmark } from "src/database/interfaces";
import { Repository } from "src/database/repository";
import { KoboHighlightsImporterSettings } from "src/settings/Settings";
import { applyTemplateTransformations } from "src/template/template";
import { getTemplateContents } from "src/template/templateContents";

export class ExtractHighlightsModal extends Modal {
	goButtonEl!: HTMLButtonElement;
	inputFileEl!: HTMLInputElement;

	settings: KoboHighlightsImporterSettings;

	fileBuffer: ArrayBuffer | null | undefined;

	nrOfBooksExtracted: number;

	bookListContainerEl!: HTMLDivElement; // リスト表示用
  selectedBooks: Set<string> = new Set(); // チェックされた本のタイトルを保持

	constructor(app: App, settings: KoboHighlightsImporterSettings) {
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
				`${this.settings.storageFolder}/${sanitizedBookName}.md`,
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

		this.goButtonEl.addEventListener("click", () => {
			// ここで次のステップ（チェックした本の中身を表示する）へ移行
			console.log("Selected Books:", Array.from(this.selectedBooks));
			// 次のUI：ハイライト選択モーダル または 表示の切り替え
			this.renderHighlightSelector(); 
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
			return;
		}
	
		const bookTitles = results[0].values.map(v => v[0] as string);
	
		// リスト表示
		bookTitles.forEach((bookTitle) => {
			const bookRow = this.bookListContainerEl.createDiv({ cls: "kobo-book-row" });
			bookRow.style.display = "flex";
			bookRow.style.alignItems = "center";
			bookRow.style.margin = "5px 0";
	
			const checkbox = bookRow.createEl("input", { type: "checkbox" });
			const label = bookRow.createEl("label", { text: bookTitle });
			label.style.marginLeft = "10px";
	
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedBooks.add(bookTitle);
				} else {
					this.selectedBooks.delete(bookTitle);
				}
				this.goButtonEl.disabled = this.selectedBooks.size === 0;
			});
		});
	
		new Notice(`${bookTitles.length} books with highlights found.`);
		db.close(); // メモリ解放
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
        // その本の全ハイライトを取得
        const bookmarks = await service.getHighlightsForBook(bookTitle); // 既存メソッド
        
        const bookHeader = scrollArea.createEl("h3", { text: bookTitle });
        bookHeader.style.borderBottom = "1px solid var(--text-muted)";

        bookmarks.forEach((bm) => {
            const card = scrollArea.createDiv({ cls: "kobo-highlight-card" });
            card.style.backgroundColor = "var(--background-primary)";
            card.style.margin = "10px 0";
            card.style.padding = "10px";
            card.style.borderRadius = "8px";
            card.style.border = "1px solid var(--background-modifier-border)";

            // 1. 取り込みチェックボックス
            const topRow = card.createDiv();
            topRow.style.display = "flex";
            topRow.style.justifyContent = "space-between";
            topRow.style.alignItems = "center";

            const checkbox = topRow.createEl("input", { type: "checkbox" });
            checkbox.checked = true; // デフォルトはON

            // 2. タイトル入力欄
            const titleInput = topRow.createEl("input", { type: "text" });
            titleInput.placeholder = "ノートのタイトルを入力 (空欄なら本文冒頭)";
            titleInput.style.flexGrow = "1";
            titleInput.style.margin = "0 10px";

            // 3. ハイライト本文のプレビュー（引用形式）
            const quote = card.createEl("blockquote", { text: bm.Text });
            quote.style.fontSize = "0.9em";
            quote.style.margin = "10px 0 0 0";
            quote.style.color = "var(--text-normal)";

            // メモがあれば表示
            if (bm.Annotation) {
                const note = card.createEl("p", { text: `📝: ${bm.Annotation}` });
                note.style.fontSize = "0.8em";
                note.style.color = "var(--text-accent)";
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
	
}
