// store.js — single source of truth for the renderer.
//
// Model:
//  - The user registers one or more *library paths* (root folders). Each is scanned
//    for the project folders inside it. The project panel groups projects under their
//    library path with a collapsible toggle header.
//  - Each library path has its OWN schema. A project uses the schema of the library path it
//    belongs to. Schemas are sectioned: { version, sections:[{id,title,fields:[]}] }.
//  - Schemas are keyed by a STABLE id, not by the folder path: renaming or moving a library
//    folder used to orphan its schema silently, and schemas.json could never move between
//    machines. library.json carries each path's schemaId.

(function () {
  const listeners = new Set();

  const state = {
    // storageMode: 'infolder' | 'central' | 'custom'  — where notes and project.json live.
    // historyLocation: 'central' | 'inproject'        — where note snapshots live, independently.
    settings: { storageMode: 'infolder', folderName: 'ProjectNotes', customPath: '', historyLocation: 'central', theme: 'dark' },
    schemas: {},                               // { [schemaId]: schema }
    libraryPaths: [],                          // [{ path, collapsed, depth, schemaId }]
    groups: [],                                // [{ path, collapsed, projects:[{name,path,libraryPath,data,hasMetadata}] }]
    activeProjectPath: null,
    scanning: false,
  };

  function emit() { listeners.forEach((fn) => fn(state)); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function mode() { return state.settings.storageMode; }

  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 8); }
  function emptySchema() { return { version: 1, sections: [{ id: uid('sec_'), title: 'Details', fields: [] }] }; }

  // Normalise any schema (legacy flat or sectioned) into sectioned form.
  function normaliseSchema(schema) {
    if (!schema) return emptySchema();
    if (Array.isArray(schema.sections)) return schema;
    // legacy flat -> single section
    return { version: schema.version || 1, sections: [{ id: uid('sec_'), title: 'Details', fields: schema.fields || [] }] };
  }

  // ---- config persistence ----
  // A config file that fails to load must not be silently replaced by empty state — that turns
  // one bad file into permanent data loss on the next save. Read failures are reported and the
  // affected file is locked for writing until the user restarts.
  const loadFailed = new Set();
  async function readConfigSafe(filename, label) {
    try { return await window.api.readConfig(filename); }
    catch (err) {
      loadFailed.add(filename);
      window.Toast?.error(`Could not read ${label}: ${err.message || err}`);
      return null;
    }
  }

  async function loadConfig() {
    const settings = await readConfigSafe('settings.json', 'settings');
    if (settings) state.settings = { ...state.settings, ...settings };

    const lib = await readConfigSafe('library.json', 'library folders');
    if (lib?.paths) state.libraryPaths = lib.paths.map((p) => (typeof p === 'string' ? { path: p, collapsed: false } : p));

    const schemas = await readConfigSafe('schemas.json', 'schemas');
    let migrated = false;
    if (schemas?.byId) {
      for (const [id, sc] of Object.entries(schemas.byId)) state.schemas[id] = normaliseSchema(sc);
    } else if (schemas?.byPath) {
      // Legacy: schemas keyed by absolute path. Adopt them onto the matching library path's id.
      for (const [p, sc] of Object.entries(schemas.byPath)) {
        const lp = state.libraryPaths.find((x) => x.path === p);
        const id = lp ? (lp.schemaId ||= uid('sch_')) : uid('sch_');
        state.schemas[id] = normaliseSchema(sc);
      }
      migrated = true;
    } else if (!loadFailed.has('schemas.json')) {
      // Older still: one universal schema.json applied to every known path.
      const legacy = await readConfigSafe('schema.json', 'legacy schema');
      if (legacy) {
        for (const lp of state.libraryPaths) {
          lp.schemaId ||= uid('sch_');
          state.schemas[lp.schemaId] = normaliseSchema(legacy);
        }
        migrated = true;
      }
    }
    // Ensure every library path has an id and a schema object.
    for (const lp of state.libraryPaths) {
      if (!lp.schemaId) { lp.schemaId = uid('sch_'); migrated = true; }
      if (!state.schemas[lp.schemaId]) state.schemas[lp.schemaId] = emptySchema();
    }

    // Collect schemas nothing points at. The byPath migration above mints a fresh id for a schema
    // whose library path is no longer registered, and removeLibraryPath drops the path but not the
    // schema — so schemas.json grew a little every time either happened, invisibly.
    //
    // Only ever when schemas.json read cleanly: with a failed read, state.schemas is empty and
    // "unreferenced" would describe every schema the user has.
    if (!loadFailed.has('schemas.json') && !loadFailed.has('library.json')) {
      const live = new Set(state.libraryPaths.map((lp) => lp.schemaId));
      const orphans = Object.keys(state.schemas).filter((id) => !live.has(id));
      if (orphans.length) {
        for (const id of orphans) delete state.schemas[id];
        migrated = true;
        console.log(`[store] dropped ${orphans.length} schema(s) no library folder references`);
      }
    }

    if (migrated && !loadFailed.has('schemas.json')) { await saveLibrary(); await saveSchemas(); }
    emit();
  }

  // A failed config write used to be reported as success — the user saw "All changes saved"
  // and lost the work at next launch. Surface it instead.
  async function writeConfigChecked(filename, data, label) {
    if (loadFailed.has(filename)) {
      window.Toast?.error(`Not saving ${label} — it could not be read at startup. Restart the app to retry, so the existing file isn't overwritten.`);
      return false;
    }
    try { await window.api.writeConfig(filename, data); return true; }
    catch (err) {
      window.Toast?.error(`Could not save ${label}: ${err.message || err}`);
      window.setStatus?.(`Failed to save ${label}`);
      return false;
    }
  }

  async function saveSettings() { const ok = await writeConfigChecked('settings.json', state.settings, 'settings'); emit(); return ok; }
  async function saveLibrary() { return writeConfigChecked('library.json', { paths: state.libraryPaths }, 'library folders'); }
  async function saveSchemas() { return writeConfigChecked('schemas.json', { byId: state.schemas }, 'schema'); }

  // ---- per-path schema access ----
  // Callers still address schemas by library path; the id indirection is internal.
  function schemaIdFor(libraryPath) {
    const lp = state.libraryPaths.find((p) => p.path === libraryPath);
    if (!lp) return null;
    if (!lp.schemaId) lp.schemaId = uid('sch_');
    return lp.schemaId;
  }
  function schemaForPath(libraryPath) {
    const id = schemaIdFor(libraryPath);
    if (!id) return emptySchema();                 // unknown path (e.g. a removed folder)
    if (!state.schemas[id]) state.schemas[id] = emptySchema();
    return state.schemas[id];
  }
  function setSchemaForPath(libraryPath, schema) {
    const id = schemaIdFor(libraryPath);
    if (id) state.schemas[id] = schema;
  }
  function schemaForProject(project) { return schemaForPath(project.libraryPath); }

  // Save a path's schema, bump its version, and refresh any open boards for that path.
  async function saveSchemaForPath(libraryPath) {
    const sc = schemaForPath(libraryPath);
    sc.version = (sc.version || 0) + 1;
    await saveSchemas();
    emit();
    // auto-reload open project boards belonging to this path (item #4)
    if (window.ProjectBoard?.refreshForPath) window.ProjectBoard.refreshForPath(libraryPath);
  }

  // ---- library paths ----
  async function addLibraryPath(folderPath) {
    if (!folderPath || state.libraryPaths.some((p) => p.path === folderPath)) return;
    const schemaId = uid('sch_');
    state.libraryPaths.push({ path: folderPath, collapsed: false, depth: 1, schemaId });
    state.schemas[schemaId] = emptySchema();
    await saveLibrary(); await saveSchemas();
    await rescan();
  }

  // Point an existing library entry at a new folder, keeping its schema. This is what makes a
  // renamed or moved library folder recoverable instead of silently losing its fields.
  async function relinkLibraryPath(oldPath, newPath) {
    const lp = state.libraryPaths.find((p) => p.path === oldPath);
    if (!lp || !newPath || oldPath === newPath) return false;
    if (state.libraryPaths.some((p) => p.path === newPath)) return false;   // already registered
    lp.path = newPath;
    await saveLibrary();
    await rescan();
    return true;
  }
  async function setLibraryDepth(folderPath, depth) {
    const lp = state.libraryPaths.find((p) => p.path === folderPath);
    if (!lp) return;
    lp.depth = Math.max(1, Number(depth) || 1);
    await saveLibrary();
    await rescan();
  }
  async function removeLibraryPath(folderPath) {
    state.libraryPaths = state.libraryPaths.filter((p) => p.path !== folderPath);
    await saveLibrary();
    await rescan();
  }
  function toggleGroupCollapsed(folderPath) {
    const lp = state.libraryPaths.find((p) => p.path === folderPath);
    if (lp) lp.collapsed = !lp.collapsed;
    const g = state.groups.find((x) => x.path === folderPath);
    if (g && lp) g.collapsed = lp.collapsed;
    saveLibrary(); emit();
  }

  // ---- scanning ----
  // One IPC call per library folder (main batches scan + reconcile + read), and the folders
  // run in parallel. This used to be ~2 sequential IPC round-trips per project.
  async function rescan() {
    state.scanning = true; emit();
    try {
      const groups = await Promise.all(state.libraryPaths.map(async (lp) => {
        let found = [];
        try { found = await window.api.scanRootWithData(lp.path, lp.depth || 1); }
        catch (err) { window.Toast?.error(`Could not scan ${lp.path}: ${err.message || err}`); }
        const projects = found.map((f) => {
          const project = { name: f.name, path: f.path, libraryPath: lp.path, data: f.values, hasMetadata: !!f.hasMetadata };
          project.complete = computeComplete(project);
          return project;
        });
        return { path: lp.path, collapsed: !!lp.collapsed, projects };
      }));
      state.groups = groups;
    } finally {
      state.scanning = false;
      emit();
    }
    // Watch exactly the projects we just found, so external edits are noticed.
    window.api.watchProjects(allProjects().map((p) => p.path)).catch(() => {});
  }

  // A project's data changed on disk (another editor, a sync client). Re-read just that project
  // and refresh any open board — no full rescan.
  async function reloadProject(projectPath) {
    const project = getProject(projectPath);
    if (!project) return null;
    let rec;
    try { rec = await window.api.readProject(projectPath); }
    catch { return null; }
    project.data = rec ? rec.values : null;
    project.hasMetadata = !!rec;
    project.complete = computeComplete(project);
    emit();
    window.ProjectBoard?.refreshForPath?.(project.libraryPath);
    return project;
  }

  function allProjects() { return state.groups.flatMap((g) => g.projects); }
  function getProject(path) { return allProjects().find((p) => p.path === path) || null; }
  function projectCount() { return allProjects().length; }
  function setActive(path) { state.activeProjectPath = path; emit(); }

  async function saveProjectData(path, record) {
    const project = getProject(path);
    if (!project) return;
    const merged = { ...(project.data || {}), ...record };
    // Drop values whose field no longer exists in the schema. Merging forever meant a deleted
    // field's data lingered in project.json invisibly and there was no way to clear a key.
    const live = new Set(window.DataValidation.schemaFields(schemaForPath(project.libraryPath)).map((f) => f.key));
    if (live.size) for (const k of Object.keys(merged)) if (!live.has(k)) delete merged[k];
    let rec;
    try { rec = await window.api.writeProject(path, merged); }
    catch (err) { window.Toast?.error('Could not save project info: ' + (err.message || err)); throw err; }
    project.data = rec.values;
    project.hasMetadata = true;
    project.complete = computeComplete(project);
    emit();
    return rec.values;
  }

  // A project with data is "complete" when its schema validates (required fields filled, etc.).
  function computeComplete(project) {
    if (!project.data) return null; // not set up yet
    const schema = schemaForPath(project.libraryPath);
    return window.DataValidation.validateRecord(schema, project.data).valid;
  }

  window.Store = {
    state, subscribe, emit, mode, uid,
    loadConfig, saveSettings, saveSchemas,
    schemaForPath, setSchemaForPath, schemaForProject, saveSchemaForPath, emptySchema,
    addLibraryPath, removeLibraryPath, relinkLibraryPath, setLibraryDepth, toggleGroupCollapsed, rescan,
    allProjects, getProject, projectCount, setActive, saveProjectData, reloadProject,
  };
})();
