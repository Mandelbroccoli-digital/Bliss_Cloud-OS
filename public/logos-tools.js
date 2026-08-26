/* Logos 🦀 — kernel tool registry.
   These are the hands: every entry maps a model-callable name onto a real
   subkernel capability (native Rust command or bus frame). Nothing here is
   simulated — if a call succeeds, the filesystem or a live panel changed. */

window.LOGOS_TOOLS = {

  list_dir: {
    desc: 'List a directory on the host filesystem.',
    args: { path: 'absolute directory path' },
    write: false,
    run: async (K, a) => {
      const e = await K.invoke('read_directory', { path: a.path });
      return e.map(x => `${x.is_dir ? 'DIR ' : '    '}${x.name}${x.is_dir ? '' : ' (' + x.size + 'b)'}`).join('\n')
             || '(empty)';
    }
  },

  read_file: {
    desc: 'Read a UTF-8 text file.',
    args: { path: 'absolute file path' },
    write: false,
    run: async (K, a) => {
      const t = await K.invoke('read_text_file', { path: a.path });
      return t.length > 12000 ? t.slice(0, 12000) + '\n…[truncated]' : t;
    }
  },

  write_file: {
    desc: 'Overwrite a text file with new contents.',
    args: { path: 'absolute file path', contents: 'full new text' },
    write: true,
    run: async (K, a) => {
      await K.invoke('write_text_file', { path: a.path, contents: a.contents ?? '' });
      window.subkernel.emit('Explorer', 'refresh', {});
      return `wrote ${(a.contents ?? '').length} chars to ${a.path}`;
    }
  },

  create_file: {
    desc: 'Create a new file inside a directory.',
    args: { parent: 'directory', name: 'filename', contents: 'initial text' },
    write: true,
    run: async (K, a) => {
      const p = await K.invoke('create_file', { parent: a.parent, name: a.name, contents: a.contents ?? '' });
      window.subkernel.emit('Explorer', 'refresh', {});
      return `created ${p}`;
    }
  },

  create_dir: {
    desc: 'Create a directory.',
    args: { parent: 'parent directory', name: 'folder name' },
    write: true,
    run: async (K, a) => {
      const p = await K.invoke('create_directory', { parent: a.parent, name: a.name });
      window.subkernel.emit('Explorer', 'refresh', {});
      return `created ${p}`;
    }
  },

  delete_path: {
    desc: 'Delete a file or directory (recursive).',
    args: { path: 'absolute path' },
    write: true,
    run: async (K, a) => {
      await K.invoke('delete_path', { path: a.path });
      window.subkernel.emit('Explorer', 'refresh', {});
      return `deleted ${a.path}`;
    }
  },

  shell: {
    desc: 'Execute a shell command on the host and capture stdout.',
    args: { cmd: 'command line' },
    write: true,
    run: async (K, a) => {
      const o = await K.invoke('execute_shell_command', { cmd: a.cmd });
      return (o || '(no output)').slice(0, 8000);
    }
  },

  python: {
    desc: 'Run a Python snippet and capture stdout.',
    args: { code: 'python source' },
    write: true,
    run: async (K, a) => {
      const r = await K.invoke('run_python', { payload: { code: a.code } });
      return `exit ${r.exit_code}\n${r.stdout || ''}${r.stderr ? '\nSTDERR:\n' + r.stderr : ''}`.slice(0, 8000);
    }
  },

  list_processes: {
    desc: 'List running host processes with PID and memory.',
    args: {},
    write: false,
    run: async (K) => {
      const p = await K.invoke('list_processes');
      return p.slice(0, 60).map(x => `${x.pid}\t${x.name}\t${x.mem_kb}KB`).join('\n');
    }
  },

  system_stats: {
    desc: 'Host telemetry: hostname, OS, memory, process count.',
    args: {},
    write: false,
    run: async (K) => JSON.stringify(await K.invoke('system_stats'), null, 2)
  },

  open_app: {
    desc: 'Open a panel inside the subkernel. Valid ids come from the app registry.',
    args: { app: 'app id', file: 'optional file to route to it' },
    write: false,
    run: async (K, a) => {
      if (!K.APPS[a.app]) return `unknown app "${a.app}". valid: ${Object.keys(K.APPS).join(', ')}`;
      K.openApp(a.app, a.file ? { file: a.file } : {});
      return `opened ${a.app}`;
    }
  },

  bus_emit: {
    desc: 'Send a frame on the subkernel bus to drive any panel directly.',
    args: { app: 'target surface', action: 'action name', payload: 'object' },
    write: false,
    run: async (K, a) => {
      window.subkernel.emit(a.app, a.action, a.payload || {});
      return `emitted ${a.app}:${a.action}`;
    }
  },

  diagram: {
    desc: 'Render a node graph in the Diagrammer. nodes:[{id,title,text,x,y}], edges:[{id,from,to}].',
    args: { nodes: 'array', edges: 'array' },
    write: false,
    run: async (K, a) => {
      K.openApp('mermaid');
      setTimeout(() => window.subkernel.emit('Diagrammer', 'load-graph',
        { nodes: a.nodes || [], edges: a.edges || [] }), 350);
      return `diagrammed ${(a.nodes || []).length} nodes`;
    }
  },

  map_floret: {
    desc: 'Map a directory tree visually in Floret.',
    args: { path: 'directory' },
    write: false,
    run: async (K, a) => {
      K.openApp('mindmap');
      setTimeout(() => window.subkernel.emit('Floret', 'map-path', { path: a.path }), 350);
      return `mapping ${a.path} in Floret`;
    }
  },

  notify: {
    desc: 'Show a status line in the shell taskbar.',
    args: { message: 'text' },
    write: false,
    run: async (K, a) => {
      window.subkernel.emit('System', 'notify', { message: a.message });
      try { if (window.parent && window.parent.setStatus) window.parent.setStatus(a.message); } catch (e) {}
      return 'notified';
    }
  }
};
