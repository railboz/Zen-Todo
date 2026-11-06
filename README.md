# Site web Zen Todo (GitHub Pages)

Site d'accueil officiel de Zen Todo, requis pour la validation « branding » de la Google Auth Platform.
Contenu : `index.html` (page d'accueil, FR + EN), `privacy.html` (politique de confidentialité, FR + EN),
`logo-512.png` / `logo-256.png` / `logo-120.png` (logo lune + coche — générer avec `make-logo.ps1`).

## Pourquoi ce site ?

Google exige que la page d'accueil déclarée dans le Branding soit :
- **publique** (sans connexion),
- sur un **domaine dont vous pouvez prouver la propriété** (Search Console),
- qui présente clairement le nom, le logo, la fonction de l'app et un lien vers la politique de confidentialité.

La fiche AMO (`addons.mozilla.org`) ne peut jamais satisfaire ces critères : le domaine appartient à Mozilla.

## Étapes de mise en ligne (~20 minutes)

### 1. Dépôt GitHub

1. Créez un compte gratuit sur [github.com](https://github.com) (si besoin) — notez votre nom d'utilisateur `<pseudo>`.
2. Créez un nouveau dépôt **public** nommé exactement : `<pseudo>.github.io`
3. Chargez-y **`index.html`** et **`privacy.html`** (bouton « Add file → Upload files », puis « Commit »).

Le site est alors servi à : `https://<pseudo>.github.io/` (GitHub Pages est automatique pour ce nom de dépôt ;
vérifiez dans **Settings → Pages** que la source est « Deploy from a branch → main → /root »).

### 2. Vérification Search Console

1. Ouvrez [Google Search Console](https://search.google.com/search-console) avec le compte Google du projet Cloud (`logan.bozier24@gmail.com`).
2. « Ajouter une propriété » → type **Préfixe d'URL** → `https://<pseudo>.github.io/`
3. Méthode de validation : **Fichier HTML** → téléchargez le fichier `googleXXXXXXX.html` proposé → ajoutez-le au dépôt GitHub (à la racine).
4. Cliquez « Vérifier ». Gardez le fichier dans le dépôt (ne le supprimez jamais).

### 3. Google Auth Platform → Branding

| Champ | Valeur |
|---|---|
| Page d'accueil | `https://<pseudo>.github.io/` |
| Règles de confidentialité | `https://<pseudo>.github.io/privacy.html` |
| Conditions d'utilisation | (vide, optionnel) |
| Domaines autorisés | `<pseudo>.github.io` (+ `allizom.org`, `chromiumapp.org` déjà présents) |
| Logo | remplacer la coche générique par **`logo-120.png`** (ou `logo-512.png`) |
| E-mail d'assistance | `zentodoassist@gmail.com` (après l'avoir ajouté en propriétaire du projet, voir SYNC.md) |

⚠️ Le lien vers la confidentialité présent **sur la page d'accueil** doit être exactement la même URL que celle
déclarée ci-dessus — c'est déjà le cas (`privacy.html` relatif → `https://<pseudo>.github.io/privacy.html`).

### 4. Validation

1. Attendez **24 h** après la vérification Search Console (Google l'exige explicitement).
2. Branding → « Vérifier le branding » → vérifiez le récapitulatif → Envoyer.
3. Une fois validé : **Audience → Publier l'application → Production**.

## Notes

- La page d'accueil doit toujours contenir : nom « Zen Todo », logo, description de la fonction, lien privacy, contact public. Ne pas la remplacer par une page de connexion.
- Toute modification du branding pendant une validation en cours est bloquée : cliquer « Annuler » sur la validation pour pouvoir éditer.
- `make-logo.ps1` régénère les PNG du logo (System.Drawing, aucune dépendance).
- Le logo est volontairement distinctif (lune + coche) : Google refuse les logos « génériques » qui n'identifient pas la marque.
