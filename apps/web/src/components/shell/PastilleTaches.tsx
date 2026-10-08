"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  libellePastilleTaches,
  pastilleTaches,
  tachesOuvertes,
  type PageTaches,
} from "../../lib/taches-collaboration";

/** Événement émis après un changement de tâche (création, statut) pour relire la pastille. */
export const EVENEMENT_TACHES = "mp:taches";

/*
 * Compteur partagé entre les instances (navigation latérale, menu du téléphone) : une seule
 * requête par changement de page. La liste de l'API est triée « ouvertes d'abord » : les dix
 * premières suffisent pour afficher 1 à 9 ou « 9+ ».
 */
let valeur: number | null = null;
let enCours: Promise<void> | null = null;
const abonnes = new Set<(n: number | null) => void>();

function relire(): Promise<void> {
  if (enCours) return enCours;
  enCours = api
    .get<PageTaches>("/api/taches-collaboration?vue=assignees&limite=10", {
      redirigerSi401: false,
      delaiMs: 10_000,
    })
    .then((r) => {
      valeur = tachesOuvertes(r.elements);
      for (const a of abonnes) a(valeur);
    })
    .catch(() => {
      // Hors connexion : on garde le dernier compteur connu.
    })
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

/** Pastille « tâches ouvertes » de l'entrée « Mes tâches » ; rien quand il n'y en a pas. */
export function PastilleTaches() {
  const chemin = usePathname();
  const [n, setN] = useState<number | null>(valeur);

  useEffect(() => {
    abonnes.add(setN);
    return () => {
      abonnes.delete(setN);
    };
  }, []);

  useEffect(() => {
    void relire();
  }, [chemin]);

  useEffect(() => {
    const surEvenement = () => void relire();
    window.addEventListener(EVENEMENT_TACHES, surEvenement);
    window.addEventListener("online", surEvenement);
    return () => {
      window.removeEventListener(EVENEMENT_TACHES, surEvenement);
      window.removeEventListener("online", surEvenement);
    };
  }, []);

  const texte = pastilleTaches(n);
  if (!texte) return null;
  return (
    <span className="mp-nav__pastille">
      <span aria-hidden="true">{texte}</span>
      <span className="mp-visuellement-cache">{`, ${libellePastilleTaches(n)}`}</span>
    </span>
  );
}
