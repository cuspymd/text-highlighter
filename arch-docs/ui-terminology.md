# UI Terminology

One name per thing the user sees, in every locale, the settings page, the
onboarding page, the popup and the guide (`docs/guide/`). Mixed names made the
same bar read as several different features - "control UI", "controls",
"palette", "color list", "highlight palette" - and named a setting after
something it does not control.

Code identifiers and storage keys keep their old names (`selectionControlsVisible`,
`showControlsOnSelection`, `.text-highlighter-controls`, the guide anchor
`#add-control-ui`). Renaming them would break stored settings, sync and external
links; only the words shown to users follow this table.

## Terms

| Thing | ko | en | ja | zh | es | pt | ru |
|---|---|---|---|---|---|---|---|
| Pen icon shown next to selected text | 선택 아이콘 | selection icon | 選択アイコン | 选择图标 | icono de selección | ícone de seleção | значок маркера |
| Bar of color buttons (both kinds below) | 색상 팔레트 (repeated: 팔레트) | color palette (palette) | カラーパレット (パレット) | 调色板 | paleta de colores (paleta) | paleta de cores (paleta) | палитра |
| Browser menu on right-click | 우클릭 메뉴 | right-click menu | 右クリックメニュー | 右键菜单 | menú contextual | menu de contexto | контекстное меню |
| Extension button in the browser toolbar | 툴바 아이콘 | toolbar icon | ツールバーアイコン | 工具栏图标 | icono de la barra de herramientas | ícone da barra de ferramentas | значок на панели инструментов |

ru uses "значок маркера" rather than a literal "selection icon": in Russian
"выделение" means both selection and highlight, so a literal term is ambiguous.
es, pt and ru use their language's ordinary name for the right-click menu.

## The two palettes

The palette opened from the selection icon and the one opened by clicking a
highlight are the same component; the second adds a delete (trash) button. They
share the one name. Where the difference matters, say how it was opened instead
of inventing a second name:

- "the palette opened by clicking a highlight has a trash button"
- not "the highlight palette" / "the controls" / "the color list"

## Do not use

- control UI, controls, controller, control panel (for either palette)
- color list, highlight palette (for the palette)
- highlighter icon, highlight icon (for the selection icon)
- context menu in ko/en/ja/zh (use the right-click menu term)

## The setting

"Show Selection Icon on Text Selection" (`showControlsOnSelection`) turns only
the selection icon off. Clicking a highlight still opens its palette, and mobile
has no such switch - the icon is always shown there. Copy describing the setting
must not imply it hides the palette.
