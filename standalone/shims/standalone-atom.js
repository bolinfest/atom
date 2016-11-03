window.atom = require('../exports/atom');
// atom.initialize();

// We want to put some key items in to the global environment.
window.TextBuffer = atom.TextBuffer;
window.TextEditor = atom.TextEditor;
// window.EditorView = require('./editor-view');
// window.DisplayBuffer = require('./display-buffer');
// window.PaneView = require('./pane-view');

// Ideally, we would call:
//
//   atom.startEditorWindow();
//
// But startEditorWindow() assumes the entire workspace is present,
// so we call individual pieces of it in atom.html as a workaround.
