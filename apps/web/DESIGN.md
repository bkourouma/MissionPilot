---
name: CabinetPilot
description: "Plan de vol : chaque mission est un vol, avec un cap prévu et un chemin réel ; la dérive se voit avant l'atterrissage."
colors:
  fond-lavande: "#f4f1fb"
  surface: "#ffffff"
  surface-2: "#ece7f7"
  bordure: "#ddd6f0"
  bordure-controle: "#6f6590"
  texte: "#1d1636"
  texte-doux: "#5a5278"
  primaire: "#5b2fc4"
  primaire-survol: "#4a22a6"
  primaire-pale: "#efeafa"
  sur-primaire: "#ffffff"
  or: "#e5a72f"
  or-survol: "#f0b848"
  sur-or: "#2b1468"
  nuit: "#2b1468"
  nuit-actif: "#3b1f8c"
  nuit-survol: "#34197a"
  sur-nuit: "#ffffff"
  sur-nuit-doux: "#cfc2f1"
  succes: "#1e6b3a"
  succes-fond: "#e6f4ea"
  attention: "#8a4b00"
  attention-fond: "#fff1db"
  danger: "#a4262c"
  danger-fond: "#fde8e8"
  neutre: "#4f4870"
  neutre-fond: "#efeaf7"
  info: "#4a22a6"
  info-fond: "#efeaf7"
  sombre-fond: "#130d26"
  sombre-surface: "#1b1336"
  sombre-surface-2: "#251b47"
  sombre-bordure: "#35295c"
  sombre-bordure-controle: "#8c80b4"
  sombre-texte: "#ece8f8"
  sombre-texte-doux: "#b6acd6"
  sombre-primaire: "#b9a2f5"
  sombre-primaire-survol: "#cdbcf8"
  sombre-sur-primaire: "#1a0f3d"
  sombre-primaire-pale: "#2a1f52"
typography:
  display:
    fontFamily: "Sora Variable, Figtree Variable, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Sora Variable, Figtree Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Sora Variable, Figtree Variable, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Sora Variable, Figtree Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "tnum"
  body:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  controle: "8px"
  carte: "12px"
  pastille: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.or}"
    textColor: "{colors.sur-or}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.or-survol}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.texte}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primaire}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.controle}"
    padding: "8px 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.texte}"
    rounded: "{rounded.controle}"
    padding: "8px 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.texte}"
    rounded: "{rounded.carte}"
    padding: "16px"
  badge-neutre:
    backgroundColor: "{colors.neutre-fond}"
    textColor: "{colors.neutre}"
    rounded: "{rounded.pastille}"
    padding: "2px 8px"
  rail:
    backgroundColor: "{colors.nuit}"
    textColor: "{colors.sur-nuit}"
    width: "248px"
  rail-lien-actif:
    backgroundColor: "{colors.nuit-actif}"
    textColor: "{colors.sur-nuit}"
    rounded: "{rounded.controle}"
  table-entete:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.texte-doux}"
---

# Design System: CabinetPilot

## Overview

**Creative North Star: "Le plan de vol"**

Chaque mission est un vol : un cap prévu, un chemin réel, un atterrissage estimé. L'interface est faite pour qu'une associée voie en une vue quelle mission dérive, l'ouvre, lise le cap (réalisé, budget, atterrissage) puis valide ou corrige, et pour qu'un consultant saisisse sa semaine sans chercher son chemin. Le système est un outil d'exploitation (mode Operate) : dense, calme, lisible en clair comme en sombre, cibles tactiles de 44 px, polices servies localement.

La structure est une colonne violet nuit pleine hauteur (le rail) face à une surface de travail lavande où reposent des cartes blanches plates à bordure d'un pixel. Le violet nuit porte la marque et l'orientation ; le violet vif porte les liens, la sélection et le focus ; l'or est rare et signale uniquement ce qui avance. Les surfaces sont plates : aucune ombre sur les cartes, la profondeur vient du ton et de la bordure. La trajectoire (prévu en tirets, réel en or, estimation en pointillé) est le langage unique du budget.

L'écart avec la convention est voulu : pas de barre latérale claire de vingt entrées plates, pas de rangée de cartes de chiffres identiques.

**Key Characteristics:**
- Rail violet nuit identique en clair et en sombre, navigation groupée par métier (Piloter, Produire, Conseil IA, Vendre, Facturer, Cabinet).
- Surfaces plates, bordure d'un pixel, aucune ombre au repos.
- Or réservé à trois usages ; violet vif pour tout le reste de l'interactif.
- Sora pour titres et chiffres, Figtree pour le texte.
- Un chiffre issu d'un moteur porte la marque « Calculé ».

## Colors

Palette violette à accent unique or, sur fond lavande ; chaque couleur a une version sombre qui garde les rôles.

### Primary
- **Violet vif** (#5b2fc4 ; sombre #b9a2f5) : liens, sélection de texte, focus, entrée active hors rail, pagination courante, ligne « prévu » de la trajectoire. Survol #4a22a6 (sombre #cdbcf8). Texte sur primaire : #ffffff (sombre #1a0f3d). Teinte pâle #efeafa (sombre #2a1f52) pour l'entrée active des menus clairs.

### Secondary
- **Or de cap** (#e5a72f ; survol #f0b848) : l'accent unique. Texte posé dessus : violet nuit #2b1468 (7,1:1). Identique en clair et en sombre.

### Tertiary
- **Violet nuit** (#2b1468) : rail, case du logo, barre haute du téléphone, panneau de marque de la connexion. Entrée active #3b1f8c, survol #34197a, texte #ffffff, texte doux #cfc2f1.

### Neutral
- **Lavande** (#f4f1fb ; sombre #130d26) : fond de la surface de travail.
- **Blanc carte** (#ffffff ; sombre #1b1336) : cartes, tableaux, champs.
- **Lavande profonde** (#ece7f7 ; sombre #251b47) : en-têtes de tableau, survols, éléments indisponibles.
- **Bordure** (#ddd6f0 ; sombre #35295c) : filets de cartes et de tableaux.
- **Bordure de contrôle** (#6f6590 ; sombre #8c80b4) : contour des champs et boutons secondaires (≥ 3:1).
- **Encre** (#1d1636 ; sombre #ece8f8) et **encre douce** (#5a5278 ; sombre #b6acd6) : texte et texte secondaire.
- **Statuts** (texte puis fond) : succès #1e6b3a / #e6f4ea, attention #8a4b00 / #fff1db, danger #a4262c / #fde8e8, neutre #4f4870 / #efeaf7, info #4a22a6 / #efeaf7. En sombre, textes #7fd19b, #f2b866, #f49a9e, #c4bbe2, #b9a2f5 sur fonds #12301f, #33240e, #3a1517, #2a2147, #2a1f52.

### Named Rules
**The Or Rule.** L'or sert l'action principale, la trajectoire réelle et le repère actif, et rien d'autre. Il n'est jamais une couleur de texte sur fond clair (1,9:1) : il apparaît en aplat sous un texte nuit, en trait, ou sur le rail nuit.

**The Calculé Rule.** Toute valeur issue d'un moteur de calcul testé porte la marque « Calculé » ; elle ne se confond jamais avec un brouillon IA ni avec un contenu validé.

**The Rail Nuit Rule.** Le rail violet nuit est le même en clair et en sombre, et ses entrées sont groupées par métier, jamais en liste plate.

## Typography

**Display Font:** Sora Variable (repli Figtree Variable, system-ui)
**Body Font:** Figtree Variable (repli system-ui, Segoe UI, Roboto)
**Label/Mono Font:** Figtree ; `code` en monospace système.

**Character:** Sora, géométrique et ouverte, donne aux titres et aux chiffres de tête un ton de cockpit ; Figtree, humaniste et neutre, porte le texte. Les deux sont servies localement (3G).

### Hierarchy
- **Display** (650, 1.875rem desktop / 1.5rem téléphone, 1.25) : titre de page (« Tableau de bord »).
- **Headline** (650, 1.5rem, 1.25) : titre de page sur téléphone, titre de connexion, chiffres de tête.
- **Title** (650 à 700, 1.25rem, 1.25) : titres de section et de carte ; 1rem pour les titres de carte en h3/h4.
- **Figure** (Sora 700, 1.5rem, chiffres tabulaires) : les quatre chiffres du cap de mission.
- **Body** (400, 1rem, 1.5) : texte courant ; 0.875rem pour la navigation du rail et l'aide.
- **Label** (700, 0.8125rem, 0.04em, capitales) : en-têtes de tableau uniquement.

### Named Rules
**The Chiffres Alignés Rule.** Tout nombre en tableau ou en valeur de tête est en chiffres tabulaires, aligné à droite.

## Layout

Grille à deux colonnes dès 960 px : rail fixe de 248 px (case du logo de 72 px de haut au-dessus, utilisateur en pied) et zone de contenu fluide à marge de 32 px, colonne de page plafonnée à 1200 px et centrée. Sous 960 px : barre haute violet nuit de 56 px (logo, cloche), contenu à marge de 16 px, barre basse de 64 px à cinq entrées, menu en tiroir. Échelle d'espacement de 4 px (4, 8, 12, 16, 24, 32, 48) ; espace vertical de page de 24 px. Les tableaux deviennent une fiche par ligne sous 640 px ; « Missions en vol » compose deux lignes (nom ; jours et écart) puis sa trajectoire. Connexion : panneau de marque violet nuit à 58 % et formulaire à 42 % dès 900 px, logo seul sur téléphone. Cible tactile minimale 44 px (34 px dans le rail au pointeur fin seulement).

## Elevation & Depth

Système plat, à couches tonales : fond lavande, cartes blanches, en-têtes de tableau lavande profonde, bordure d'un pixel. `--mp-ombre` vaut `none`. La seule ombre est celle du tiroir de menu du téléphone (`0 12px 32px rgb(29 22 54 / 0.2)`, sombre `rgb(0 0 0 / 0.55)`), parce qu'il flotte au-dessus de la page.

### Named Rules
**The Flat Rule.** Aucune ombre sur une carte, un tableau ou un champ. Le relief se dit par le ton et la bordure.

## Shapes

Coins doux et réguliers : 8 px pour contrôles, boutons, alertes et entrées du rail ; 12 px pour cartes et tableaux ; pastilles complètes (999 px) pour badges et marque « Calculé ». Bordures d'un pixel ; l'erreur d'un champ passe à 2 px en danger. Tracés de trajectoire à bouts arrondis, pointe de flèche triangulaire pleine.

## Components

### Buttons
- **Shape:** 8 px, minimum 44 × 44, graisse 600, transition de 150 ms.
- **Primary:** aplat or, texte violet nuit ; une par écran en règle ; survol or clair #f0b848.
- **Secondary:** blanc, contour de contrôle, survol lavande profonde.
- **Ghost:** transparent, texte violet vif, survol violet pâle.
- **Danger:** aplat danger, texte blanc, survol assombri de 8 %.
- **Disabled / busy:** opacité 0,65 / 0,85 ; indicateur circulaire.

### Cards / Containers
Blanche, bordure #ddd6f0, 12 px, padding 16 px, sans ombre. Les modules indisponibles passent en lavande profonde.

### Inputs / Fields
Hauteur 44 px, blanc, contour de contrôle d'un pixel, 8 px, texte 16 px minimum. Focus : contour de 3 px couleur focus, bordure violette. Erreur : bordure danger de 2 px, icône et message en danger gras.

### Navigation
Rail nuit : titres de groupe en 0.75rem capitales, entrées 0.875rem, survol #34197a, actif #3b1f8c avec repère or ; focus blanc. Téléphone : barre basse blanche à cinq entrées, entrée active signalée par un liseré or de 3 px sur le bord haut. Menus clairs : actif en violet pâle et texte violet.

### Badges et alertes
Pastille à contour courant, fond de statut, texte de statut ; icône toujours jointe pour ne pas dépendre de la couleur seule.

### Trajectoire (composant signature)
Dessin SVG d'une mission, sans axe de temps : cap prévu en tirets violets (2 px, 4 4) jusqu'au budget, repère vertical au budget, chemin réel en or (4 px, bouts ronds) avec pointe de flèche et point de départ, estimation en pointillé violet (rouge si l'atterrissage dépasse le budget). Le texte alternatif porte réalisés, budgétés et atterrissage. Le même tracé en grand habille le panneau de connexion et la fiche mission (cap et quatre chiffres).

### Marque « Calculé »
Pastille neutre à icône de facture et libellé « Calculé », placée dans l'en-tête de la section dont les chiffres viennent du moteur.

### Tableau
Entêtes lavande profonde en capitales, cellules à filet bas, survol de lien révélé (soulignement et violet) ; « Missions en vol » est classé par plus forte dérive et affiche un badge d'écart de cap.

## Do's and Don'ts

### Do:
- **Do** réserver l'or à l'action principale, à la trajectoire réelle et au repère actif.
- **Do** marquer « Calculé » toute valeur sortie d'un moteur.
- **Do** grouper la navigation du rail par métier sur le violet nuit #2b1468.
- **Do** dire l'état par texte et icône avec la couleur, pas par la couleur seule.
- **Do** garder les cartes plates : #ffffff, bordure #ddd6f0, 12 px.
- **Do** viser texte ≥ 4,5:1 et contours de contrôle ≥ 3:1 en clair et en sombre.
- **Do** garder focus visible (3 px) et cibles de 44 px.

### Don't:
- **Don't** utiliser l'or comme couleur de texte sur fond clair.
- **Don't** poser de bordure latérale épaisse (liseré de 3 px ou plus sur le côté d'une carte, d'une alerte ou d'une ligne) ; l'état se dit par fond, icône ou le repère inscrit du rail.
- **Don't** ajouter d'ombre aux cartes, tableaux ou champs.
- **Don't** aligner des cartes de chiffres identiques pour tenir lieu de tableau de bord, ni revenir à une barre latérale claire plate.
- **Don't** présenter un chiffre calculé, un brouillon IA et un contenu validé de la même façon.
- **Don't** servir des polices distantes ni un titre en police système.

## Dette du build non canonisée

- `.mp-page__code` (code d'erreur en capitales avec espacement de lettres) est une étiquette de type kicker : à ne pas reprendre sur de nouvelles surfaces.
- Le repère actif du rail est un trait or de 3 px collé au bord gauche (`::before`, coins droits arrondis) : à surveiller, c'est la limite de la règle sur les bordures latérales ; il n'est toléré que dans le rail.
- Le symbole de marque et la trajectoire de connexion (`Marque.tsx`, `VisuelMarque.tsx`) codent les hex #5b2fc4 et #e5a72f en dur au lieu des jetons.
