// Renders the live patch table into the sidebar and re-renders on any patch
// change. Universe and start address are editable inline (committed on blur /
// Enter), each row can be removed, and new fixtures can be added from the
// type list. Re-patching drives the live fixture and re-validates collisions,
// which are flagged in red - the first authoring guard-rail in the app.
//
// The panel never touches the scene or hub directly; it calls back through
// onAdd / onRemove so spawning and teardown stay in app.js.

export class PatchPanel {
  constructor(patch, root, { fixtureTypes = [], onAdd, onRemove, onDragStart, onDragEnd } = {}) {
    this.patch = patch;
    this.root = root;
    this.fixtureTypes = fixtureTypes;
    this.onAdd = onAdd;
    this.onRemove = onRemove;
    this.onDragStart = onDragStart;
    this.onDragEnd = onDragEnd;
    this.mirror = true; // "Mirror placement" toggle; persists across re-renders

    // Commit address/universe edits and the mirror toggle.
    this.root.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.dataset && el.dataset.role === 'mirror') {
        this.mirror = el.checked;
        return;
      }
      if (el.tagName !== 'INPUT' || !el.dataset.field) return;
      this.patch.repatch(Number(el.dataset.index), { [el.dataset.field]: parseInt(el.value, 10) });
    });

    // Add / remove buttons.
    this.root.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'remove') {
        this.onRemove?.(Number(btn.dataset.index));
      } else if (btn.dataset.action === 'add') {
        const sel = this.root.querySelector('select[data-role="add-type"]');
        if (sel) this.onAdd?.(sel.value);
      }
    });

    // Drag the "drag to place" handle into the viewport (carries the selected type).
    this.root.addEventListener('dragstart', (ev) => {
      const el = ev.target;
      if (!el.classList || !el.classList.contains('patch-drag')) return;
      const sel = this.root.querySelector('select[data-role="add-type"]');
      const key = sel ? sel.value : '';
      ev.dataTransfer.setData('text/plain', key);
      ev.dataTransfer.effectAllowed = 'copy';
      this.onDragStart?.(key);
    });
    this.root.addEventListener('dragend', () => this.onDragEnd?.());

    patch.onChange(() => this.render());
    this.render();
  }

  render() {
    const { entries } = this.patch;
    const flags = this.patch.collisions();

    const rows = entries
      .map((e, i) => {
        const cls = flags[i] ? ' class="patch-collision"' : '';
        const remove = `<td><button type="button" class="patch-remove" data-action="remove" data-index="${i}" title="Remove fixture">✕</button></td>`;
        // Props (0 channels) have no patch address.
        if (e.channelCount === 0) {
          return `<tr title="${escapeAttr(e.profileName)}">
            <td>${escapeHtml(e.label)}</td>
            <td class="patch-prop" colspan="3">prop</td>
            ${remove}
          </tr>`;
        }
        const end = e.startAddress + e.channelCount - 1;
        return `<tr${cls} title="${escapeAttr(e.profileName)}">
          <td>${escapeHtml(e.label)}</td>
          <td><input type="number" min="1" value="${e.universe}" data-index="${i}" data-field="universe" /></td>
          <td><input type="number" min="1" max="512" value="${e.startAddress}" data-index="${i}" data-field="startAddress" /></td>
          <td title="channels ${e.startAddress}–${end}">${e.channelCount}</td>
          ${remove}
        </tr>`;
      })
      .join('');

    const table = entries.length
      ? `<table class="patch-table">
          <thead><tr><th>Fixture</th><th>Uni</th><th>Addr</th><th>Ch</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<p class="hint">No fixtures patched.</p>';

    const warn = flags.some(Boolean)
      ? '<p class="patch-warn">⚠ Address collision — fixtures share channels.</p>'
      : '';

    const options = this.fixtureTypes
      .map((t) => `<option value="${escapeAttr(t.key)}">${escapeHtml(t.label)}</option>`)
      .join('');
    const adder = this.fixtureTypes.length
      ? `<div class="patch-add">
          <select data-role="add-type">${options}</select>
          <button type="button" data-action="add">Add</button>
        </div>
        <div class="patch-place">
          <span class="patch-drag" draggable="true" title="Drag into the venue to place">⠿ drag to place</span>
          <label class="patch-mirror"><input type="checkbox" data-role="mirror" ${this.mirror ? 'checked' : ''} /> Mirror</label>
        </div>`
      : '';

    this.root.innerHTML = `${table}${warn}${adder}`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
