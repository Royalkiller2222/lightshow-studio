// Build workspace bottom panel: the patch sheet — every fixture, its type,
// mirror twin and (Pro) DMX universe / address / channel span. Click a row to
// select that fixture in the 3D view. Address clashes are flagged; fixtures
// are auto-patched to free addresses when added, so Simple mode hides DMX.

import { fixtureIcon, icon } from './icons.js';
import { esc } from './dom.js';

export class PatchSheet {
  /**
   * deps: patch, rig, shell, fixtureType(key),
   *       onSelect(fx), onRemove(fx), onCommit()
   */
  constructor(root, deps) {
    this.root = root;
    this.d = deps;
    this.selected = null;

    root.innerHTML = `
      <div class="ps-head">
        <span class="ph-title"><span class="pro">Patch</span><span class="simple-only">Fixtures</span></span>
        <span class="ph-sub" data-role="sum"></span>
        <span class="ps-warn pro" data-role="warn" hidden>${icon('warning', 'sm')}<span></span></span>
        <span class="tl-spacer"></span>
        <button type="button" class="btn ghost icon sm" data-act="hide" title="Hide the patch sheet" aria-label="Hide the patch sheet">${icon('panel-bottom', 'sm')}</button>
      </div>
      <div class="ps-scroll" data-role="scroll"></div>`;
    this.scroll = root.querySelector('[data-role="scroll"]');
    root.querySelector('[data-act="hide"]').addEventListener('click', () => deps.shell.togglePanel('bottom', false));

    this.scroll.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      const entry = deps.patch.entries[Number(tr.dataset.i)];
      if (!entry) return;
      if (e.target.closest('[data-act="remove"]')) { deps.onRemove(entry.fixture); return; }
      if (e.target.closest('input')) return; // editing an address
      deps.onSelect(entry.fixture);
    });
    this.scroll.addEventListener('change', (e) => {
      const el = e.target;
      const tr = el.closest('tr[data-i]');
      if (!tr || !el.dataset.field) return;
      deps.patch.repatch(Number(tr.dataset.i), { [el.dataset.field]: parseInt(el.value, 10) });
      deps.onCommit();
    });
    this.scroll.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });

    deps.patch.onChange(() => this.render());
    this.render();
  }

  setSelected(fx) {
    this.selected = fx;
    for (const tr of this.scroll.querySelectorAll('tr[data-i]')) {
      const e = this.d.patch.entries[Number(tr.dataset.i)];
      tr.classList.toggle('sel', !!e && (e.fixture === fx || (fx && e.fixture === fx.mirror)));
    }
  }

  render() {
    const { patch, rig, fixtureType } = this.d;
    const entries = patch.entries;
    const flags = patch.collisions();
    const channels = entries.reduce((n, e) => n + e.channelCount, 0);
    this.root.querySelector('[data-role="sum"]').textContent =
      `${entries.length} fixture${entries.length === 1 ? '' : 's'} · ${channels} channel${channels === 1 ? '' : 's'}`;
    const clashes = flags.filter(Boolean).length;
    const warn = this.root.querySelector('[data-role="warn"]');
    warn.hidden = clashes === 0;
    warn.lastElementChild.textContent = `${clashes} fixtures share DMX channels`;

    if (!entries.length) {
      this.scroll.innerHTML = '<div class="ps-empty">No fixtures yet — drag one from the library into the venue.</div>';
      return;
    }
    const rows = entries.map((e, i) => {
      const fx = e.fixture;
      const type = fixtureType(fx?.typeKey);
      const twin = fx?.mirror ? rig.labelOf(fx.mirror) : '';
      const sel = this.selected && (fx === this.selected || fx === this.selected.mirror);
      const dmx = e.channelCount === 0
        ? '<td class="pro muted" colspan="3">prop</td>'
        : `<td class="pro"><input type="number" min="1" value="${e.universe}" data-field="universe" aria-label="Universe" /></td>
           <td class="pro addr"><input type="number" min="1" max="512" value="${e.startAddress}" data-field="startAddress" aria-label="Start address" /></td>
           <td class="pro muted">${e.startAddress}–${e.startAddress + e.channelCount - 1} <span class="small">(${e.channelCount})</span></td>`;
      return `<tr data-i="${i}" class="${flags[i] ? 'clash' : ''}${sel ? ' sel' : ''}" title="${esc(e.profileName)}">
        <td><span class="nm">${fixtureIcon(fx?.typeKey, 'sm')}${esc(e.label)}</span></td>
        <td class="muted">${esc(type ? type.label : '—')}</td>
        ${dmx}
        <td class="muted">${twin ? `${icon('link', 'sm').replace('class="ico sm"', 'class="ico sm" style="display:inline-block;vertical-align:-2px;margin-right:4px"')}${esc(twin)}` : ''}</td>
        <td class="act"><button type="button" class="btn ghost icon sm" data-act="remove" title="Remove ${esc(e.label)}" aria-label="Remove ${esc(e.label)}">${icon('trash', 'sm')}</button></td>
      </tr>`;
    }).join('');
    this.scroll.innerHTML = `
      <table class="ps-table">
        <thead><tr><th>Name</th><th>Type</th><th class="pro">Universe</th><th class="pro">Address</th><th class="pro">Channels</th><th>Mirrored with</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
}
