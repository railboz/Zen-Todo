# Zen Todo — carte du code de l'extension

Version 3.1.11. Extension WebExtension MV3 en JavaScript simple : pas de build, pas de npm, pas de
dépendance. Les deux variantes se chargent telles quelles.

## Deux dossiers, un même code

| Dossier | Cible | Spécificités |
|---|---|---|
| `zen-todo-3.1.4-firefox/` | Firefox bureau et Android | `background.scripts`, `sidebar_action`, `gecko_android` (le nom du dossier est historique) |
| `zen-todo-3.1.3-chrome/` | Chrome / Opera | service worker, `side_panel`, `sidepanel.html`, `minimum_chrome_version` |

Onze fichiers JS/HTML/CSS sont identiques octet pour octet (liste officielle : `SHARED_FILES` dans
`tools/tests/lib/paths.mjs`). Seul `manifest.json` diffère d'une variante à l'autre, et `sidepanel.html`
n'existe que côté Chrome. `SECURITY.md` et `SYNC.md` sont également dupliqués.

Règle : modifier un fichier partagé dans une variante oblige à reporter la modification dans l'autre.
Le test de dérive échoue sinon.

## Fichiers

| Fichier | Rôle |
|---|---|
| `manifest.json` | MV3 : permissions, hôtes, CSP, point d'entrée (`action`, `sidebar_action` ou `side_panel`, `background`) ; seul fichier volontairement différent entre les variantes |
| `background.js` | Page de fond / service worker : alarmes de rappel `r:<id>`, alarme `gsync` (périodique) et `midnight` (badge), badge, menu contextuel « Ajouter à Zen Todo », relais des messages `zt:*`, reprise du flux OAuth par onglet sur Android |
| `popup.html` | Markup du popup, réutilisé comme panneau latéral Firefox ; charge `theme-init.js` puis les trois CSS ; aucun handler inline |
| `popup.js` | État et rendu de l'interface : liste, projets, sous-tâches, filtres, tris, édition, réglages, envoi des messages au fond |
| `popup.css` | Mise en page et composants du popup / panneau |
| `theme.css` | Variables de thème sombre et clair : couleurs, aplats, contrastes |
| `theme-modern.css` | Surcouche visuelle : typographie, profondeur, surfaces |
| `theme-init.js` | Avant le premier rendu : pose `data-theme`, `data-textsize`, et les classes `android` / `is-sidebar` |
| `util.js` | Helpers partagés : `fireTime`, validation et sanitisation (`sanitizeTask`, `sanitizeProject`, `cleanText`, `RESERVED_IDS`), identifiants (`newId`, `stableId`), date locale |
| `i18n.js` | `api` (`browser`/`chrome`), dictionnaire `STRINGS` fr/en/es/de, `t()`, `setLang`, `applyStaticI18n`, ordre des dates selon la langue |
| `sync.js` | Tout Google : client OAuth (`GOOGLE_CLIENT_ID` déjà renseigné), `authUrl`/`getToken`, `userinfo`, fichier `zen-todo.json` en `appDataFolder`, fusion par `updatedAt` avec pierres tombales de 90 jours, sanitisation des données distantes, `Sync.debug()`/`Sync.probe()` inertes car `DEBUG = false` |
| `datepicker.js` | Sélecteurs de date et d'heure intégrés, `mk()` et `svgAsset()` : le texte passe par `textContent`, les SVG par une liste blanche de balises et d'attributs |
| `sidepanel.html` | Chrome uniquement : redirection meta vers `popup.html?view=sidebar` |

Autres fichiers du dossier :

| Fichier | Rôle |
|---|---|
| `SECURITY.md` | Modèle de sécurité, justification de chaque permission, limites connues |
| `SYNC.md` | Création du projet Google, client OAuth, URI de redirection, fonctionnement de la fusion |
| `sync-code.ps1` | Firefox seulement : copie les fichiers partagés vers le dossier Chrome (jamais dans un zip) |
| `make-zips.ps1` | Génère les deux zips de soumission |
| `LICENSE` | MIT, © 2026 Railboz |
| `icons/` | `icon-48.png`, `icon-96.png`, identiques dans les deux variantes |

## Où vit chaque préoccupation

| Sujet | Fichier |
|---|---|
| OAuth, jeton, Drive, fusion, sanitisation distante | `sync.js` |
| Alarmes, badge, notifications, menu contextuel, messages `runtime` | `background.js` |
| Rendu, état, réglages, projets et sous-tâches | `popup.js` (+ `popup.css`) |
| Helpers, validation, identifiants, heure de rappel | `util.js` |
| Chaînes et langues | `i18n.js` |
| Pickers date/heure, construction DOM, icônes SVG | `datepicker.js` |
| Thème appliqué avant le premier affichage | `theme-init.js` |
| Couleurs, typographie, surfaces | `theme.css`, `theme-modern.css`, `popup.css` |

Ordre de chargement des styles : `theme.css` (variables) → `popup.css` (composants) → `theme-modern.css`
(surcouche). L'attribut `data-theme` est posé par `theme-init.js` avant le premier rendu pour éviter le
clignotement.

## Tester

Depuis la racine du dépôt :

```sh
node tools/tests/run.mjs
```

91 contrôles, zéro dépendance, pas de navigateur. Le harnais lit les deux variantes sans jamais les
modifier : syntaxe, absence de puits XSS, contrat manifeste/CSP, dérive Firefox/Chrome, tests unitaires de
`util.js`, `i18n.js` et `datepicker.js` dans une `vm`. Aucune CI n'existe : la suite se lance localement.

## Paquetage

```sh
cd extension
powershell -ExecutionPolicy Bypass -File .\make-zips.ps1 -Version "3.1.11"
```

15 fichiers par zip, `manifest.json` à la racine. Le zip Firefox exclut `sync-code.ps1` et `SYNC.md` ; le
zip Chrome exclut `sync-code.ps1` et tous les `.md`. Ensuite
`npx web-ext lint extension/zen-todo-3.1.4-firefox` doit rapporter 0/0/0.

## Ne pas faire

- Pas de `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ni `new Function` :
  le texte utilisateur passe par `textContent`, le DOM par `mk()` / `svgAsset()`.
- Pas de handler inline (`onclick=`), pas d'URL `javascript:`.
- Pas de code distant, ni script ni style : la CSP l'interdit et le paquet doit rester autonome.
- Pas de `storage.sync` : uniquement `storage.local`, plus le Drive de l'utilisateur si la synchronisation
  est activée.
- Ne pas relâcher la sanitisation (`sanitizeTask`, `sanitizeProject`, `RESERVED_IDS`, listes blanches SVG),
  même pour une donnée « de confiance ».
- Ne pas éditer une seule variante : tout fichier partagé doit être modifié dans les deux, sinon
  `node tools/tests/run.mjs` échoue.
