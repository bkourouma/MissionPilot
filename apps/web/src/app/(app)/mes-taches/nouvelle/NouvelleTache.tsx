"use client";

import { useRouter } from "next/navigation";
import type { OptionSelect } from "../../../../components/ui/Select";
import { SAISIE_TACHE_VIDE } from "../../../../lib/taches-collaboration";
import { FormulaireTache } from "../FormulaireTache";

/** Création d'une tâche ; « Annuler » revient à l'écran d'origine. */
export function NouvelleTache({
  personnes,
  entites,
  entite,
  entiteImposee,
  retour,
}: {
  personnes: OptionSelect[];
  entites: OptionSelect[];
  /** Valeur « type:identifiant » de l'élément imposé, ou "". */
  entite: string;
  entiteImposee?: string;
  retour: string;
}) {
  const router = useRouter();
  return (
    <FormulaireTache
      initial={{ ...SAISIE_TACHE_VIDE, entite }}
      personnes={personnes}
      entites={entites}
      entiteImposee={entiteImposee}
      onAnnuler={() => router.push(retour)}
    />
  );
}
