import { vi } from "vitest";

vi.mock("obsidian", () => {
	return {
		App: class {},
		Plugin: class {
			loadData() { return {}; }
			saveData() {}
			registerView() {}
			addRibbonIcon() { return document.createElement("div"); }
			registerEvent() {}
			addCommand() {}
			registerDomEvent() {}
			registerInterval() { return 0; }
		},
		TFile: class {
			basename = "";
			name = "";
			path = "";
			extension = "md";
			stat = { mtime: 0, ctime: 0, size: 0 };
			vault: any = null;
		},
		TFolder: class {
			name = "";
			path = "";
			children: any[] = [];
		},
		Notice: class {
			messageEl = document.createElement("div");
			constructor(msg: string) { this.messageEl.textContent = msg; }
		},
		ItemView: class {
			containerEl = document.createElement("div");
			constructor() {}
		},
		WorkspaceLeaf: class {},
		PluginSettingTab: class {
			containerEl = document.createElement("div");
			constructor(_app: any, _plugin: any) {}
			display() {}
		},
		Setting: class {
			settingEl = document.createElement("div");
			constructor(_containerEl: any) {}
			setName(_name: string) { return this; }
			setDesc(_desc: string) { return this; }
			setHeading() { return this; }
			addText(cb: any) { cb({ setValue: () => ({ setPlaceholder: () => ({ onChange: () => {} }) }), setPlaceholder: () => ({ onChange: () => {} }), onChange: () => {} }); return this; }
			addToggle(cb: any) { cb({ setValue: () => ({ onChange: () => {} }), onChange: () => {} }); return this; }
			addDropdown(cb: any) { cb({ addOption: () => ({ addOption: () => ({ setValue: () => ({ onChange: () => {} }) }) }), setValue: () => ({ onChange: () => {} }), onChange: () => {} }); return this; }
			addButton(cb: any) { cb({ setButtonText: () => ({ onClick: () => {} }) }); return this; }
		},
		requestUrl: vi.fn(),
	};
});

vi.mock("electron", () => {
	class MockBrowserWindow {
		constructor(_opts: any) {}
		loadURL(_url: string) { return Promise.resolve(); }
		webContents = {
			printToPDF: vi.fn().mockResolvedValue(Buffer.from("")),
		};
		close() {}
	}
	return {
		remote: {
			BrowserWindow: MockBrowserWindow,
			dialog: {
				showSaveDialog: vi.fn(),
			},
		},
	};
});
