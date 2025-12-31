import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import KoboHighlightsPickerAndInboxer from "src/main";
import { FileSuggestor } from "./suggestors/FileSuggestor";
import { FolderSuggestor } from "./suggestors/FolderSuggestor";

export interface KoboHighlightsPickerAndInboxerSettings {
  /**
   * NEW: 中継ノート（Kobo-Inboxes 的なもの）の保存先
   */
  intermediateFolder: string;

  /**
   * NEW: 知見ノート（Kobo-Insights 的なもの）の保存先
   */
  insightFolder: string;

  sortByChapterProgress: boolean;
}

export const DEFAULT_SETTINGS: KoboHighlightsPickerAndInboxerSettings = {

  // NEW defaults
  intermediateFolder: "Kobo-Inboxes",
  insightFolder: "Kobo-Insights",

  sortByChapterProgress: false,
};

export class KoboHighlightsPickerAndInboxerSettingsTab extends PluginSettingTab {
  constructor(
    public app: App,
    private plugin: KoboHighlightsPickerAndInboxer
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: this.plugin.manifest.name });

    this.add_intermediate_folder();
    this.add_insight_folder();

    // 既存
    this.add_template_path();
    this.add_sort_by_chapter_progress();
    this.add_import_all_books();

    // （任意）storageFolder は legacy なので UI から消す
    // もし残したいなら add_destination_folder() を復活させて storageFolder を編集可能にしてもOK
  }

  add_intermediate_folder(): void {
    new Setting(this.containerEl)
      .setName("Intermediate notes folder")
      .setDesc("Where to save intermediate (inbox) notes. Example: Kobo-Inboxes or Reading/Inbox")
      .addSearch((cb) => {
        new FolderSuggestor(this.app, cb.inputEl);
        cb.setPlaceholder("Example: Kobo-Inboxes")
          .setValue(this.plugin.settings.intermediateFolder)
          .onChange(async (newFolder) => {
            const v = normalizePath((newFolder ?? "").trim());
            this.plugin.settings.intermediateFolder = v || "Kobo-Inboxes";
            await this.plugin.saveSettings();
          });
      });
  }

  add_insight_folder(): void {
    new Setting(this.containerEl)
      .setName("Insight notes folder")
      .setDesc("Where to save generated insight notes. Example: Kobo-Insights or Zettelkasten/Insights")
      .addSearch((cb) => {
        new FolderSuggestor(this.app, cb.inputEl);
        cb.setPlaceholder("Example: Kobo-Insights")
          .setValue(this.plugin.settings.insightFolder)
          .onChange(async (newFolder) => {
            const v = normalizePath((newFolder ?? "").trim());
            this.plugin.settings.insightFolder = v || "Kobo-Insights";
            await this.plugin.saveSettings();
          });
      });
  }

  add_sort_by_chapter_progress(): void {
    const desc = document.createDocumentFragment();
    desc.append(
      "Turn on to sort highlights by chapter progess. If turned off, highlights are sorted by creation date and time."
    );

    new Setting(this.containerEl)
      .setName("Sort by chapter progress")
      .setDesc(desc)
      .addToggle((cb) => {
        cb.setValue(this.plugin.settings.sortByChapterProgress).onChange(async (toggle) => {
          this.plugin.settings.sortByChapterProgress = toggle;
          await this.plugin.saveSettings();
        });
      });
  }
}
