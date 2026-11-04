/* Mesa de Corte v1.6 — ações de prévia e exportação no final da página */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const exportButton = document.getElementById('exportTop');
  const previewBox = document.getElementById('previewBox');
  if (!app || !exportButton || !previewBox || document.getElementById('bottomEditorActions')) return;

  // Mover o botão ORIGINAL preserva o onclick, o estado disabled e a exportação.
  const section = document.createElement('section');
  section.id = 'bottomEditorActions';
  section.className = 'bottom-editor-actions pane';
  section.setAttribute('aria-label', 'Prévia e exportação da edição');

  const help = document.createElement('p');
  help.className = 'bottom-actions-help';
  help.textContent = 'Confira o vídeo antes de exportar.';

  const actions = document.createElement('div');
  actions.className = 'bottom-actions-row';

  const previewButton = document.createElement('button');
  previewButton.id = 'previewBottom';
  previewButton.type = 'button';
  previewButton.className = 'bottom-preview-button';
  previewButton.textContent = '▶ Prévia';
  previewButton.setAttribute('aria-label', 'Assistir à prévia completa da edição antes de exportar');

  exportButton.classList.add('bottom-export-button');
  exportButton.textContent = '↥ Exportar';
  exportButton.setAttribute('aria-label', 'Exportar o vídeo editado');

  actions.append(previewButton, exportButton);
  section.append(help, actions);
  // A última seção visível do editor fica depois das fontes, do monitor e da timeline.
  app.appendChild(section);

  const refresh = () => { previewButton.disabled = exportButton.disabled; };
  refresh();
  // As regras originais continuam controlando quando é possível pré-visualizar e exportar.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(refresh);
    observer.observe(exportButton, { attributes: true, attributeFilter: ['disabled'] });
  }

  previewButton.addEventListener('click', () => {
    if (exportButton.disabled || !ready.every(Boolean) || duration < 0.25) {
      toast('Selecione os dois vídeos para assistir à prévia.');
      return;
    }
    if (exporting) {
      toast('Conclua ou cancele a exportação antes de reproduzir.');
      return;
    }
    // Executar play() no mesmo toque para respeitar a política do Safari do iPhone.
    seekTo(0);
    previewBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    void play();
  });
})();
