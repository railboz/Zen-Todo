<p align="center">
  <img src="logo-512.png" width="120" height="120" alt="Logo Zen Todo">
</p>

<h1 align="center">Zen Todo</h1>

<p align="center"><b>Vos tâches, chez vous.</b><br>
Extension de gestion de tâches pour Firefox — synchronisation optionnelle via <i>votre</i> Google Drive.</p>

<p align="center">
  <a href="https://addons.mozilla.org/firefox/addon/zen-todo/"><img alt="Installer sur Firefox" src="https://img.shields.io/badge/Firefox-Installer-FF7139?logo=firefoxbrowser&logoColor=white"></a>
  <a href="https://railboz.github.io/"><img alt="Site officiel" src="https://img.shields.io/badge/Site-officiel-6D5AE6"></a>
  <a href="https://railboz.github.io/privacy.html"><img alt="Politique de confidentialité" src="https://img.shields.io/badge/Confidentialit%C3%A9-Politique-5344C4"></a>
</p>

---

**Zen Todo** est une extension de navigateur simple et rapide pour organiser vos tâches : listes, projets,
sous-tâches, priorités, échéances et rappels. Son principe : **vos données restent chez vous** — pas de compte
à créer, pas de serveur, pas de traqueur. La synchronisation entre appareils est optionnelle et passe
directement par **votre propre Google Drive**.

## ✨ Fonctionnalités

- **Tâches, projets et sous-tâches** — avec progression automatique des projets
- **Priorités, dates, heures et rappels** — notifications à l'heure prévue
- **Recherche instantanée, filtres et tri** — retrouvez tout en quelques lettres
- **Réorganisation** par glisser-déposer (ou flèches ↑↓ sur mobile)
- **Thèmes sombre et clair** — suivent automatiquement le système
- **4 langues** : français, anglais, espagnol, allemand
- **Panneau latéral et raccourcis clavier** sur desktop
- **Sauvegarde et restauration** manuelles de toutes vos données
- **Compteur de tâches restantes** directement dans la barre d'outils

## 🔒 Confidentialité

- **Local d'abord** : vos tâches sont enregistrées dans votre navigateur, la synchronisation est désactivée par défaut.
- **Synchro Google optionnelle** : si vous l'activez, vos données vont dans un dossier privé (`appDataFolder`)
  de **votre** Drive — accessible uniquement par Zen Todo, illisible par l'auteur.
- **Aucun serveur, aucun suivi, aucune publicité, aucune mesure d'audience.**
- **Réseau minimal** : l'extension ne communique qu'avec `googleapis.com` et `oauth2.googleapis.com`.
- **Révocable à tout moment** depuis l'extension ou sur [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

📄 Politique complète : **[railboz.github.io/privacy.html](https://railboz.github.io/privacy.html)**

## 📦 Installation

### Firefox (recommandé)

➡️ **[Installer Zen Todo sur addons.mozilla.org](https://addons.mozilla.org/firefox/addon/zen-todo/)**

Fonctionne sur Firefox pour ordinateur **et** Firefox pour Android.

### Chrome / Opera

Une version Manifest V3 est en préparation (publication sur le Chrome Web Store à venir).

## 📱 Firefox pour Android

Zen Todo fonctionne sur téléphone et tablette :

- Interface plein écran adaptée au mobile
- Rappels par notification
- Connexion Google via un onglet de connexion (l'API desktop n'existe pas sur mobile)
- Réorganisation avec les flèches ↑↓ (le glisser-déposer HTML5 n'est pas disponible au tactile)
- Après expiration de session (~1 h), appuyez sur **« Se connecter avec Google »** pour rétablir la synchro

## 🔄 Synchronisation Google (optionnelle)

1. Ouvrez les options de l'extension → **« Se connecter avec Google »**
2. Vos tâches sont enregistrées dans un fichier caché de votre propre Drive (zone `appDataFolder`)
3. Elles se synchronisent automatiquement entre vos appareils ; en cas de modification simultanée,
   la version la plus récente est conservée
4. Déconnexion ou révocation à tout moment — sans impact sur vos données locales

## 🌍 Langues

Français · English · Español · Deutsch

## 📬 Contact

Une question, un bug, une suggestion ? **zentodoassist@gmail.com**

## 🗂️ Ce dépôt

Ce dépôt héberge le **site officiel** de Zen Todo (GitHub Pages) :
`index.html` (page d'accueil), `privacy.html` (politique de confidentialité) et le logo.
Le code de l'extension est distribué via [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/zen-todo/).

---

## English

**Zen Todo** is a lightweight task-list extension for Firefox (desktop and Android). Local-first: your data
stays in your browser, and optional cross-device sync stores everything in a private app-data folder of
**your own Google Drive** — no servers, no tracking, no account with us.

- Tasks, projects, sub-tasks, priorities, due dates and reminders
- Instant search, filters and sorting; drag & drop or arrow buttons
- Dark/light themes; French, English, Spanish, German
- Optional Google Drive sync (`appDataFolder` scope), revocable anytime

**Install:** [addons.mozilla.org/firefox/addon/zen-todo](https://addons.mozilla.org/firefox/addon/zen-todo/) ·
**Privacy:** [railboz.github.io/privacy.html](https://railboz.github.io/privacy.html) ·
**Contact:** zentodoassist@gmail.com

---

<p align="center">© 2026 Zen Todo</p>
