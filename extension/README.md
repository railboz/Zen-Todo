# Zen Todo — code source de l'extension

Version courante : **3.1.10** (correctif de synchronisation Google du 11/11/2026).

Ce dossier contient le code source de l'extension Zen Todo, en deux variantes :

- `zen-todo-3.1.4-firefox/` — Firefox (Manifest V3, `background.scripts`, `sidebar_action`) ;
- `zen-todo-3.1.3-chrome/` — Chrome/Opera (service worker MV3, `side_panel`).

Les deux dossiers partagent les mêmes fichiers (`sync.js`, `popup.js`, etc.) ; seul le manifeste
et le panneau latéral diffèrent. `make-zips.ps1` génère les archives de soumission AMO / Chrome Web Store.

## Installation pour tester

Firefox / Zen :

1. ouvrir `about:debugging#/runtime/this-firefox` ;
2. cliquer sur « Charger un module temporaire » ;
3. choisir `zen-todo-3.1.4-firefox/manifest.json`.

Chrome / Opera :

1. ouvrir `chrome://extensions` (ou `opera://extensions`) ;
2. activer le mode développeur ;
3. cliquer sur « Charger l'extension non empaquetée » et choisir `zen-todo-3.1.3-chrome/`.

## Synchronisation Google

La synchronisation est optionnelle et utilise la zone privée `appDataFolder` de **votre** Google Drive.
La configuration du projet Google (API Drive, client OAuth, URI de redirection) est décrite dans
[`zen-todo-3.1.4-firefox/SYNC.md`](zen-todo-3.1.4-firefox/SYNC.md).

Correctif du 11/11/2026 :

- `login_hint` sur le compte déjà autorisé, pour gérer plusieurs comptes Google ;
- message d'erreur renvoyé par Google conservé et affiché dans l'interface ;
- reconnexion interactive directe quand le jeton expire ;
- l'erreur reste visible jusqu'à la prochaine synchronisation réussie.

## Licence

MIT — voir [`LICENSE`](LICENSE).
