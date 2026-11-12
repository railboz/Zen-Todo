# Zen Todo

Site public (GitHub Pages) et code source de l'extension de gestion de tâches Zen Todo pour Firefox.

Version 3.1.11 · [addons.mozilla.org/firefox/addon/zen-todo](https://addons.mozilla.org/firefox/addon/zen-todo/) · licence MIT (`extension/LICENSE`)

## Ce que contient ce dépôt

| Chemin | Rôle |
|---|---|
| `index.html`, `privacy.html` | Site servi par GitHub Pages sur https://railboz.github.io/ : accueil FR/EN, politique de confidentialité |
| `logo-120.png`, `logo-256.png`, `logo-512.png`, `make-logo.ps1` | Logos du site et script qui les génère |
| `googlec98a307503694ac0.html` | Fichier de vérification Google Search Console |
| `extension/` | Source de l'extension : deux variantes autonomes, `make-zips.ps1`, un `SECURITY.md` et un `SYNC.md` par variante |
| `tools/tests/` | Harnais de tests statiques et unitaires (Node 20+, zéro dépendance) |

Le site ne contient pas l'extension : les versions installables sont distribuées via addons.mozilla.org.
Aucune fiche Chrome Web Store n'est référencée dans ce dépôt.

## Installer l'extension

| Cible | Procédure |
|---|---|
| Firefox bureau et Android | Version signée : https://addons.mozilla.org/firefox/addon/zen-todo/ |
| Développement Firefox | `about:debugging#/runtime/this-firefox` → « Charger un module temporaire » → `extension/zen-todo-3.1.4-firefox/manifest.json` |
| Développement Chrome / Opera | `chrome://extensions` (ou `opera://extensions`) → mode développeur → « Charger l'extension non empaquetée » → `extension/zen-todo-3.1.3-chrome/` |

Versions minimales déclarées : Firefox 140.0 sur bureau, Firefox pour Android 142.0, Chrome 116.

Un module chargé temporairement n'est pas signé : Firefox régénère l'identifiant de l'extension à chaque
rechargement, donc l'URI de redirection OAuth change en développement (procédure dans `SYNC.md`).

## Confidentialité & permissions

- Tâches, projets et réglages dans `storage.local` uniquement. `storage.sync` n'est jamais utilisé.
- Synchronisation optionnelle, désactivée par défaut : un fichier `zen-todo.json` dans la zone `appDataFolder`
  du Drive de l'utilisateur (portées `drive.appdata` et `userinfo.email`).
- Aucune mesure d'audience, aucun service tiers, aucun code distant.
- Permissions : `storage`, `alarms`, `notifications`, `contextMenus`, `identity`, plus `sidePanel` côté Chrome.
  Hôtes : `https://www.googleapis.com/*` et `https://oauth2.googleapis.com/*` ; côté Firefox uniquement
  `https://*.extensions.allizom.org/*`, pour observer l'URL de retour OAuth sur Firefox pour Android.
- Pas de `tabs`, pas de content script, pas de `web_accessible_resources`, pas de `externally_connectable`.
- CSP stricte, identique dans les deux variantes : `default-src 'none'`, `script-src 'self'`, `connect-src`
  limité aux deux points d'entrée Google.

Détail : [privacy.html](privacy.html) et [`extension/zen-todo-3.1.4-firefox/SECURITY.md`](extension/zen-todo-3.1.4-firefox/SECURITY.md).

## Développer

```
extension/
  zen-todo-3.1.4-firefox/   variante Firefox (nom de dossier historique, version réelle 3.1.11)
  zen-todo-3.1.3-chrome/    variante Chrome/Opera (service worker, side_panel)
  make-zips.ps1             paquetage des deux zips
  LICENSE                   MIT
tools/tests/                run.mjs, checks/, unit/, lib/
```

Pas de build, pas de npm, pas de dépendance : les dossiers de variantes sont chargés tels quels.

Onze fichiers JS/HTML/CSS sont identiques octet pour octet entre les deux variantes (liste dans
`tools/tests/lib/paths.mjs`) ; seul `manifest.json` diffère, et `sidepanel.html` n'existe que côté Chrome.
Toute modification d'un fichier partagé doit être reportée dans les deux dossiers.

Tests :

```sh
node tools/tests/run.mjs
```

91 contrôles, aucune dépendance, pas de navigateur, pas de réseau. Le harnais vérifie la syntaxe JS,
l'absence de puits XSS, le contrat manifeste/CSP (permissions, hôtes exacts, `connect-src` confronté aux
appels réellement émis), la dérive Firefox/Chrome, et teste `util.js`, `i18n.js` et `datepicker.js` dans une
`vm` avec une fausse API `chrome`. Il n'y a pas de CI (`.github/` absent) : la suite est lancée localement.

**ADR — duplication des variantes.** Un build step, ou un manifeste paramétré, aurait supprimé la
duplication mais ajoutait une chaîne d'outils à maintenir et un risque de paquet qui ne correspond plus au
code relu. Décision : deux dossiers autonomes, l'écart étant surveillé par le test de dérive. Conséquence :
une correction se fait deux fois, et le test échoue dès qu'un fichier partagé diverge.

Le texte de licence est dans `extension/LICENSE` ; il n'y a pas de `LICENSE` à la racine.

## Publier une version

1. Incrémenter `version` dans `extension/zen-todo-3.1.4-firefox/manifest.json` **et**
   `extension/zen-todo-3.1.3-chrome/manifest.json` (les deux valeurs restent identiques).
2. `node tools/tests/run.mjs` doit être vert.
3. Depuis `extension/` : `powershell -ExecutionPolicy Bypass -File .\make-zips.ps1 -Version "<version>"`.
   Produit `zen-todo-<version>-firefox.zip` et `zen-todo-<version>-chrome.zip`, 15 fichiers chacun,
   `manifest.json` à la racine du zip.
4. `npx web-ext lint extension/zen-todo-3.1.4-firefox` doit rapporter 0 erreur, 0 avertissement, 0 notice.
5. Soumettre le zip Firefox sur AMO (canal *listed*, fiche `zen-todo`).

Contraintes AMO : un numéro de version déjà soumis ne peut pas être réutilisé, donc reconstruire un paquet
impose d'incrémenter la version. L'identifiant d'extension `zen-todo@example.local` est figé (AMO refuse un
autre identifiant en mise à jour) et détermine l'URI de redirection OAuth.

Exclusions de paquetage (`make-zips.ps1`) : le zip Firefox exclut `sync-code.ps1` et `SYNC.md` ; le zip
Chrome exclut `sync-code.ps1` et tous les `.md`, donc `SECURITY.md` et `SYNC.md`.

## Limites connues

- Firefox ne redemande pas une permission d'hôte ajoutée lors d'une mise à jour (bug Mozilla 1893232) :
  après la mise à jour qui introduit `https://*.extensions.allizom.org/*`, la connexion Google sur Firefox
  pour Android peut nécessiter une réinstallation ou un octroi manuel depuis le panneau des extensions.
- Le flux OAuth par onglet de Firefox pour Android est le chemin le moins testé. La renégociation
  silencieuse du jeton y est impossible : après expiration (environ une heure), la reconnexion est manuelle.
- Les deux dossiers de variantes sont dupliqués par conception, faute de build step ; c'est un coût de
  maintenance assumé.

## Licence

MIT — © 2026 Railboz. Texte complet : [`extension/LICENSE`](extension/LICENSE).
