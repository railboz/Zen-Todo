# Synchronisation Google Drive — guide d'installation (v3.1.5)

La synchronisation enregistre vos tâches et projets dans un fichier caché de **votre** Google Drive
(zone `appDataFolder`, visible uniquement par Zen Todo). Aucun serveur tiers, aucune base de données :
les données restent chez Google, dans votre compte.

## 1. Créer le projet Google (~5 min)
1. Ouvrez https://console.cloud.google.com/ et créez un projet (ex. « Zen Todo »).
2. Menu **API et services → Bibliothèque** : recherchez et activez **Google Drive API**.
3. Menu **Écran de consentement OAuth** : type **Externe**, renseignez le nom de l'application et votre e-mail.
   - Ajoutez les portées (scopes) : `https://www.googleapis.com/auth/drive.appdata` et `https://www.googleapis.com/auth/userinfo.email`.
   - En mode « Test », ajoutez votre adresse dans **Utilisateurs test**.
   - Si vous publiez l'application sans validation Google, un écran « Application non validée »
     s'affiche à la première connexion : cliquez **Continuer vers l'application** (normal pour un usage personnel).

## 2. Créer le client OAuth
1. Menu **Clients** (ou « Identifiants ») → **Créer des identifiants → ID client OAuth** → type **Application Web**.
2. Dans **URI de redirection autorisés**, collez l'URL de redirection de l'extension :
   - elle est affichée dans la console de débogage de l'extension (background), ou
   - elle a ce format : `https://<sha1-de-l-id>.extensions.allizom.org/` — Firefox ne transmet jamais
     l'ID en clair, mais son empreinte SHA-1. Pour l'ID `zen-todo@example.local` :
     `https://89b8af435932f8262889f84ce3398d91f1a1a169.extensions.allizom.org/`.
3. Copiez le **Client ID** (format `xxxx.apps.googleusercontent.com`).

Astuce : pour connaître l'URL exacte, ouvrez `about:debugging` → votre extension → « Inspect » du background,
puis tapez `browser.identity.getRedirectURL()` dans la console.

### Chrome & Opera (dossier séparé `zen-todo-3.1.3-chrome`)
- L'extension existe en **deux dossiers indépendants** : `zen-todo-3.1.4-firefox` (manifeste Firefox)
  et `zen-todo-3.1.3-chrome` (manifeste Chrome/Opera : service worker, `side_panel`, pas de clés Firefox).
- Installation : `chrome://extensions` ou `opera://extensions` → Mode développeur →
  « Charger l'extension non empaquetée » → dossier `zen-todo-3.1.3-chrome`.
- Ajoutez **aussi** l'URI de redirection de Chrome dans le même client OAuth : ouvrez la console du
  service worker (chrome://extensions → Zen Todo → « Inspect : service worker ») et tapez
  `chrome.identity.getRedirectURL()` → format `https://<id>.chromiumapp.org/`.
- Pour une extension chargée « non empaquetée », cet identifiant dérive du chemin du dossier :
  il reste stable tant que le dossier n'est pas déplacé. Une fois publiée sur le Chrome Web Store,
  il devient fixe pour tous les utilisateurs.
- Après une modification du code (faite dans le dossier Firefox), lancez `sync-code.ps1`
  (script de développement, non inclus dans le paquet publié) depuis le dossier Firefox : il copie les fichiers partagés dans le dossier Chrome.
  Cliquez ensuite « Actualiser » dans chrome://extensions.

> **Note développement** : pour une installation *temporaire* (about:debugging), Firefox régénère l'UUID à chaque
> rechargement → l'URI de redirection change. En développement, mettez simplement à jour l'URI dans la console
> Google quand il change. Sur une version **signée AMO** (ID fixe `zen-todo@example.local`), l'URL est stable :
> vous n'avez à l'enregistrer qu'une seule fois, elle vaut pour tous les utilisateurs.

## 3. Configurer l'extension
1. Ouvrez `sync.js` et collez le Client ID dans la constante `GOOGLE_CLIENT_ID` (ligne 6).
2. Rechargez l'extension : `about:debugging` → Zen Todo → **Recharger**.
3. Zen Todo → **Options → Compte Google → Se connecter avec Google**.

## Fonctionnement
- Synchronisation ~2,5 s après chaque modification (même popup fermé), à l'ouverture du panneau,
  toutes les 15 min en arrière-plan, et via le bouton « Synchroniser ».
- Une même modification déclenche deux planifications (popup + arrière-plan) : le second cycle, s'il démarre
  moins de 2 s après un cycle réussi, est ignoré (aucun effet visible, deux fois moins d'appels réseau).
- Le fichier Drive est retrouvé une seule fois : son identifiant est mémorisé (lié au compte Google) et
  revalidé automatiquement (nouvelle recherche si le fichier répond 404/403, cache effacé à la déconnexion).
- Fusion par élément : chaque tâche/projet porte son horodatage, le plus récent gagne ;
  une suppression l'emporte si elle est plus récente que la dernière modification (pierres tombales gardées 90 jours).
- Les réglages (langue, thème, tri, priorité par défaut…) sont synchronisés en bloc : le plus récent gagne.
- L'ordre manuel de la liste reste propre à chaque appareil.
- **Filet de sécurité** : l'état local est copié dans une sauvegarde avant un effacement total et chaque fois qu'une synchronisation
  modifie vos données locales (par ex. à la première connexion) ; Options → Données → « Restaurer la sauvegarde précédente »
  permet de revenir en arrière (confirmation en 2 clics).
- **Session Google expirée** : si le jeton ne peut pas être renouvelé en silence, un message l'indique ; « Se déconnecter » puis « Se connecter avec Google » rétablit la synchronisation.
- **Se déconnecter** n'efface rien : les données restent sur l'appareil et dans le Drive.
  Pour tout supprimer du Drive : effacez les tâches (bouton « Supprimer toutes les tâches ») puis synchronisez.
- Pour révoquer l'accès : https://myaccount.google.com/permissions
- Outils de diagnostic (console de l'arrière-plan via about:debugging → Inspecter) :
  `Sync.debug()` (état local/distant, sans afficher vos textes) et `Sync.probe()` (test d'écriture Drive).
  Ils sont **désactivés dans les versions publiées** (constante `DEBUG = false` en tête de `sync.js`) et ne
  font rien ; pour un débogage local, passez `DEBUG` à `true` dans votre copie du dossier source.

## Passer la synchronisation en « production » (plus un test)
1. console.cloud.google.com → projet Zen Todo → **Google Auth Platform** → onglet **Audience**.
2. Section « Statut de publication » : Application de test → bouton **Publier l'application** → confirmer.
   Les portées utilisées (`drive.appdata`, `userinfo.email`) sont **non sensibles** : aucun écran
   d'avertissement, aucune limite d'utilisateurs, aucune validation Google requise, aucun coût.
3. (Recommandé) Onglet **Image de marque** : complétez nom, logo et URL de politique de confidentialité,
   puis « Publier l'image de marque » — l'écran de consentement affichera « Zen Todo » et son logo
   (vérification automatique, 2 à 3 jours ouvrés).
4. Identifiant d'extension : **`zen-todo@example.local`** — c'est l'ID de la fiche AMO existante ;
   AMO refuse tout autre ID lors d'une mise à jour. L'URI de redirection OAuth correspondante est le
   **SHA-1 de cet ID** (Firefox ne renvoie jamais l'ID en clair) :
   `https://89b8af435932f8262889f84ce3398d91f1a1a169.extensions.allizom.org/`
   Ces deux valeurs sont codées dans `manifest.json` et `sync.js` — ne plus les modifier.

## Firefox Android (téléphone / tablette)
- L'extension fonctionne sur Firefox Android (manifeste : `gecko_android`) ; la connexion Google y passe
  par un **onglet** au lieu de la fenêtre popup de `identity.launchWebAuthFlow`, absente de cette plateforme
  (API « desktop only » côté Mozilla). L'onglet est **forcé au premier plan** (v3.1.7) : Android le créait
  parfois en arrière-plan, donnant l'impression que le bouton ne faisait rien.
  L'URL de retour est identique, aucune configuration Google supplémentaire.
- Différence d'usage : la renégociation silencieuse du jeton est impossible. Quand la session expire (~1 h),
  un message « Session Google expirée » s'affiche ; appuyer sur « Se connecter avec Google » (ou
  « Synchroniser maintenant », qui rouvre l'onglet de connexion) suffit à rétablir la synchro.
- L'autorisation d'hôte `https://*.extensions.allizom.org/*` sert uniquement à lire l'URL de retour OAuth
  dans l'onglet ; la permission `tabs` n'est pas demandée. Note de soumission AMO suggérée : « L'autorisation
  d'hôte https://*.extensions.allizom.org/* sert à détecter l'URL de retour du flux OAuth Google lors de la
  connexion sur Firefox Android, où l'API identity n'est pas disponible. »
- Chrome/Opera mobile : sans objet — ces navigateurs ne supportent pas les extensions.

## Site web officiel + validation branding Google (v3.1.6)
- Dossier ..\site-web\ : index.html (accueil FR/EN), privacy.html (confidentialite FR/EN),
  logo-512/256/120.png (lune + coche, generes par make-logo.ps1), README.md (procedure complete).
- Raison : la validation branding Google exige une page d'accueil publique sur un domaine verifiable
  via Search Console. La fiche AMO ne convient pas (addons.mozilla.org appartient a Mozilla,
  verification impossible) ; erreurs constatees : page de connexion, nom non trouve, contenu insuffisant.
- Procedure : GitHub Pages https://railboz.github.io/ (depot renomme en railboz.github.io) ;
  propriete Search Console en "Prefixe d'URL" sur https://railboz.github.io/ ;
  Branding : accueil + confidentialite a la racine, domaine railboz.github.io + logo 120 px ; attendre 24 h ;
  relancer "Verifier le branding" ; ensuite Audience -> Publier l'application en production.
- Rappel : scopes drive.appdata + userinfo.email = NON sensibles -> la validation branding n'est PAS
  requise pour publier en production ni pour que la synchro fonctionne ; elle ajoute seulement le nom
  et le logo sur l'ecran de consentement (sans validation, seul le domaine y figure).