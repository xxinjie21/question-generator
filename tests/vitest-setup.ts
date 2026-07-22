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
