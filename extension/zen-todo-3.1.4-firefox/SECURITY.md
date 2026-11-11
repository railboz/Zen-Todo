# Sécurité et confidentialité — Zen Todo

## Données
- Tout est stocké **localement** dans le navigateur (`storage.local`). Sans synchronisation Google (désactivée par défaut), aucune donnée n'est envoyée sur Internet.
- Aucune collecte, aucun suivi, aucune statistique : l'auteur ne reçoit aucune donnée. Un compte Google n'est utilisé que si vous activez vous-même la synchronisation (voir plus bas).

## Permissions demandées (le strict minimum)
| Permission | Pourquoi |
|---|---|
| `storage` | enregistrer vos tâches, projets et réglages |
| `alarms` | déclencher les rappels et mettre à jour le badge à minuit |
| `notifications` | afficher les rappels et la confirmation du clic droit |
| `contextMenus` | menu « Ajouter à Zen Todo » sur un texte sélectionné |
| `identity` | ouvrir la fenêtre de connexion Google (synchronisation optionnelle uniquement) |
| `tabs` | sur Firefox Android : reconnaître l'URL de retour du flux de connexion Google, y compris si la page de fond a été déchargée. Aucune URL n'est enregistrée ni transmise. |

L'extension n'accède ni à l'historique ni aux téléchargements. Sur Firefox Android, l'écouteur d'onglets
ne sert qu'à reconnaître l'URL de retour OAuth ; il ignore toutes les autres navigations et ne journalise rien.
Aucun script injecté dans les pages : l'extension ne peut pas lire ce que vous consultez.

## Protections techniques
- **Politique de sécurité du contenu (CSP) stricte** : `default-src 'none'`, scripts uniquement de l'extension,
  `connect-src` limité à `www.googleapis.com` et `oauth2.googleapis.com` (synchronisation Google uniquement : aucune autre requête réseau possible),
  pas de styles ni de scripts en ligne, pas d'objets ni de cadres.
  Même si du code malveillant s'introduisait, il ne pourrait ni charger de contenu distant ni contacter un autre domaine que ceux de Google.
- **Aucun `innerHTML`** : le texte saisi est toujours inséré comme texte brut, jamais interprété comme du HTML.
- **Validation de toutes les données lues** (popup et fond) : types, longueurs, dates, heures, couleurs et identifiants
  sont contrôlés ; les champs inconnus sont supprimés. Un stockage modifié ou corrompu ne peut pas casser l'extension.
- **Nettoyage du texte** : caractères de contrôle et caractères d'inversion du sens de lecture retirés,
  longueurs bornées (titre 200, note 500, projet 80, sous-tâche 200).
- Aucune ressource de l'extension n'est exposée aux pages web (`web_accessible_resources` absent).
- Suppression de toutes les tâches et de tous les projets protégée par une confirmation en deux clics ; une sauvegarde locale est créée avant l'effacement et les suppressions individuelles sont annulables.

## Synchronisation Google (optionnelle)
- **Désactivée par défaut** : sans connexion Google, tout reste local et rien ne quitte l'appareil.
- Si vous l'activez, les données (tâches, projets, réglages) sont enregistrées dans un fichier caché de
  **votre propre Google Drive** (zone `appDataFolder`), accessible uniquement par Zen Todo après votre consentement.
  Aucun autre serveur, aucune base de données tierce.
- Connexion OAuth2 standard (portées `drive.appdata` et `userinfo.email`, écran de consentement Google).
  Le jeton est conservé uniquement dans le stockage local de l'extension ; révoquez-le via
  « Se déconnecter » ou sur https://myaccount.google.com/permissions .
- Une sauvegarde locale est créée avant un effacement total et chaque fois qu'une synchronisation modifie vos données locales ;
  elle est restaurable via Options → Données.
- Permission `identity` (elle ouvre le flux de connexion Google ; elle ne donne accès à aucun compte par elle-même)
  et accès réseau restreint aux domaines `googleapis.com` / `oauth2.googleapis.com` (CSP).

## Signaler un problème
Si vous trouvez une faille, ne la publiez pas : contactez directement l'auteur de l'extension.
