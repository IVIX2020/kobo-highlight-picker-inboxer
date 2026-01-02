import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import KoboHighlightPickerAndInboxer from "src/main";
import { FolderSuggest } from "./suggestors/FolderSuggest";

export interface KoboHighlightPickerAndInboxerSettings {
  intermediateFolder: string;
  insightFolder: string;
  sortByChapterProgress: boolean;
}

export const DEFAULT_SETTINGS: KoboHighlightPickerAndInboxerSettings = {
  intermediateFolder: "kobo-inboxes",
  insightFolder: "kobo-insights",
  sortByChapterProgress: false,
};

export class KoboHighlightPickerAndInboxerSettingsTab extends PluginSettingTab {
  constructor(public app: App, private plugin: KoboHighlightPickerAndInboxer) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl).setName(this.plugin.manifest.name).setHeading();

    this.addIntermediateFolder();
    this.addInsightFolder();
    this.addSortByChapterProgress();
  }

  private addIntermediateFolder(): void {
    new Setting(this.containerEl)
      .setName("Intermediate notes folder")
      .setDesc("Where to save intermediate (inbox) notes. Example: kobo-inboxes or reading/inbox.")
      .addSearch((cb) => {
        new FolderSuggest(this.app, cb.inputEl);

        cb.setPlaceholder("Example: kobo-inboxes")
          .setValue(this.plugin.settings.intermediateFolder)
          .onChange((newFolder) => {
            void this.saveIntermediateFolder(newFolder).catch(console.error);
          });
      });
  }

  private async saveIntermediateFolder(newFolder: string): Promise<void> {
    const v = normalizePath((newFolder ?? "").trim());
    this.plugin.settings.intermediateFolder = v || "kobo-inboxes";
    await this.plugin.saveSettings();
  }

  private addInsightFolder(): void {
    new Setting(this.containerEl)
      .setName("Insight notes folder")
      .setDesc("Where to save generated insight notes. Example: kobo-insights or zettelkasten/insights.")
      .addSearch((cb) => {
        new FolderSuggest(this.app, cb.inputEl);

        cb.setPlaceholder("Example: kobo-insights")
          .setValue(this.plugin.settings.insightFolder)
          .onChange((newFolder) => {
            void this.saveInsightFolder(newFolder).catch(console.error);
          });
      });
  }

  private async saveInsightFolder(newFolder: string): Promise<void> {
    const v = normalizePath((newFolder ?? "").trim());
    this.plugin.settings.insightFolder = v || "Kobo-Insights";
    await this.plugin.saveSettings();
  }

  private addSortByChapterProgress(): void {
    new Setting(this.containerEl)
      .setName("Sort by chapter progress")
      .setDesc(
        "Turn on to sort highlights by chapter progress. If turned off, highlights are sorted by creation date and time."
      )
      .addToggle((cb) => {
        cb.setValue(this.plugin.settings.sortByChapterProgress).onChange((toggle) => {
          void this.saveSortByChapterProgress(toggle).catch(console.error);
        });
      });
  }

  private async saveSortByChapterProgress(toggle: boolean): Promise<void> {
    this.plugin.settings.sortByChapterProgress = toggle;
    await this.plugin.saveSettings();
  }
}
