# Pulse Grid — kit de publication

## Contenu du dossier

| Dossier | À quoi ça sert |
|---|---|
| `site/` | **Le site prêt à mettre en ligne** (code minifié : 96 Ko compressés au total). C'est ce dossier que tu envoies sur l'hébergeur. |
| `source/` | Tes fichiers de travail (non minifiés) + les fichiers de publication. Tu modifies ici, puis tu régénères `site/`. |
| `build/` | `npm install && npm run build` régénère `site/` depuis `source/`. |
| `store/` | Icône 512, visuel 1024×500, 7 captures 1080×2160 prises dans le vrai jeu, textes de la fiche, réponses aux formulaires. |
| `sql/supabase_hardening.sql` | Durcissement du classement (plafond de score, anti-abus, suppression). **À lancer avant la mise en ligne.** |

> Je n'avais pas reçu ton `manifest.webmanifest`, ton `sw.js` ni tes icônes (ton `index.html` y fait référence) : j'ai donc créé les miens avec **les mêmes noms**. Si tu as déjà les tiens, compare avant d'écraser.

## À remplacer avant de publier (sinon la politique est invalide)

Déjà rempli : e-mail de contact (lerougearnaud31@gmail.com), date (10 octobre 2026), éditeur (« Arnaud, développeur indépendant » — mets ton nom complet si tu préfères).
**Reste à faire :**
- `source/privacy.html` : la **région de ton projet Supabase** (cherche `[RÉGION` et `[SUPABASE REGION]`, une fois en français et une fois en anglais). Où la trouver : Supabase › Project Settings › General › région.
- `source/.well-known/assetlinks.json` : nom du package et empreinte SHA-256 (voir « Android » ci-dessous).
- `store/fiche-play-store.md` : l'adresse de ton site (`[TON-SITE]`).

## Étapes, dans l'ordre

1. **Supabase** : `sql/supabase_hardening.sql` (déjà exécuté de ton côté ; relance-le seulement si tu changes le plafond de score).
2. **Textes à compléter** (liste ci-dessus), puis `cd build && npm install && npm run build`.
3. **Héberger `site/` en HTTPS** : Cloudflare Pages ou Netlify (glisser-déposer du dossier) — ils appliquent automatiquement `_headers` (sécurité + cache). GitHub Pages ne lit pas `_headers`.
4. **Vérifier en ligne** : ouvre l'URL sur ton téléphone, installe, coupe le réseau, relance : le jeu doit démarrer.
5. **Android (Play Store)** : le plus simple est un TWA : <https://www.pwabuilder.com> (colle l'URL → Android → Télécharger) ou `bubblewrap init --manifest=https://TON-SITE/manifest.webmanifest`. Le package signé te donne l'empreinte SHA-256 à mettre dans `assetlinks.json`, puis rebuild + redéploie (sinon une barre d'adresse reste visible).
6. **Play Console** : crée l'app, remplis la fiche avec `store/fiche-play-store.md`, les formulaires avec `store/formulaires-play-console.md`, importe icône, visuel et captures. Vérifie dans la console les exigences actuelles pour un nouveau compte (frais d'inscription, vérification d'identité, **test fermé avec un nombre minimum de testeurs pendant une durée minimale avant la production**).

## À chaque mise à jour

1. Modifie `source/`. 2. **Augmente `VERSION` dans `source/sw.js`** (sinon les joueurs gardent l'ancienne version en cache). 3. `npm run build`. 4. Redéploie `site/`. Les joueurs reçoivent la mise à jour au lancement suivant.

## Ce qui a été testé (navigateur de test, sur le site minifié)

Politique de sécurité (CSP) sans violation · aucun appel vers un autre domaine que ton Supabase · service worker actif, ancien cache nettoyé · **jeu, partie et page de confidentialité hors ligne** · classement indisponible hors ligne sans erreur technique · filtre de pseudos · suppression des données en ligne (succès, refus du serveur, hors ligne) · manifeste et icônes · 29 vérifications, 29 réussies. **Pas testé** : un vrai téléphone (A05s), l'installation Android, ton vrai Supabase.

---

## Verdict

**Plutôt bien — prêt pour une version de test, pas encore pour le grand public.** Le jeu est solide (hors ligne, sans pub ni traceur, pas d'argent réel : la conformité est simple). Il reste 3 points avant d'ouvrir à tout le monde.

**Points forts**
- Base technique saine : hors ligne complet, bouton retour Android géré, pause automatique, erreurs isolées sans plantage.
- Léger : 96 Ko compressés ; ouverture d'un onglet de boutique 100–190 ms même avec un processeur ralenti 6 fois.
- Contenu riche : 2 modes, progression, missions, 36 cosmétiques + 12 thèmes, packs, coffres, classement.
- Probabilités des coffres affichées (utile si tu ajoutes un jour de l'argent réel).

**À régler avant la mise en ligne** (le point 2 est réglé)
1. **Classement et triche.** Avec une clé publique, n'importe qui peut envoyer un faux score. Le SQL fourni limite les dégâts (plafond, une mise à jour toutes les 3 s) mais ne les supprime pas. Acceptable pour une v1 surveillée ; pour un classement sérieux, prochaine étape = connexion anonyme Supabase (chaque joueur ne peut alors modifier que sa propre ligne). Le bouton « Supprimer mes données en ligne » et la politique de confidentialité exigent aussi la règle de suppression du SQL.
2. ~~**Pseudo obligatoire au premier lancement.**~~ **Réglé** : la fenêtre propose maintenant « Jouer sans classement ». Rien n'est envoyé en ligne dans ce cas, la fenêtre ne revient plus, et le pseudo peut être choisi plus tard depuis Classement (le record local part alors tout seul). La fenêtre contient aussi le lien vers la confidentialité et la consigne « n'utilise pas ton vrai nom ».
3. **Modération.** Les pseudos sont publics : filtre automatique de base ajouté (insultes courantes, noms imitant l'équipe), mais imparfait. La politique indique une adresse pour signaler ; il te faudra regarder la table de temps en temps.
4. **Test sur vrais appareils.** Essaie sur au moins 2 téléphones Android (dont le A05s) : installation, mode avion, retour, rotation, reprise après appel.

**À améliorer plus tard (non bloquant)**
- Beaucoup de petits textes en 8–9 px : difficiles à lire pour certains joueurs.
- Pas de statistiques de plantage : tu seras aveugle après le lancement (la Play Console donnera les plantages Android de base).
- iOS : seulement via « Ajouter à l'écran d'accueil » ; l'App Store demanderait Capacitor et un compte payant.
- Un seul gros fichier JS : ça marche, mais plus dur à maintenir.
- `index.html` : `og:image` est un chemin relatif ; pour un bel aperçu de lien sur les réseaux, mets l'URL complète de ton site.

**Corrigé au passage** : le titre de la fenêtre de pause disait « Kits de bonus » (copier-coller) ; il dit maintenant « Respire un instant ».
