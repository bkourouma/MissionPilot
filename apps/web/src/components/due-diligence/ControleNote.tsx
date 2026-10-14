import Link from "next/link";
import {
  hrefEcranDossier,
  pointsDeControle,
  type ControleNote as ControleNoteVue,
} from "../../lib/due-diligence";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";

export interface ControleNoteProps {
  missionId: string;
  dossierId: string;
  controle: ControleNoteVue | null | undefined;
  /** Titre du bloc ; « Avant de soumettre la note » par défaut. */
  titre?: string;
  /** Ajoute le lien vers l'écran à corriger pour chaque point. */
  avecLiens?: boolean;
}

/**
 * Bloc « Avant de soumettre la note » : chaque point bloquant et chaque avertissement du moteur
 * de contrôle (`controlerNoteComite`) en une phrase française, avec le lien vers l'écran à
 * corriger. Un bloquant empêche la soumission ; un avertissement n'empêche rien.
 */
export function ControleNote({
  missionId,
  dossierId,
  controle,
  titre = "Avant de soumettre la note",
  avecLiens = true,
}: ControleNoteProps) {
  if (!controle) {
    return (
      <Alerte tonalite="attention" titre={titre} annonce="aucune">
        <p>Le contrôle de la note n&apos;est pas disponible pour le moment.</p>
      </Alerte>
    );
  }
  const points = pointsDeControle(controle);
  if (points.length === 0) {
    return (
      <Alerte tonalite="succes" titre={titre} annonce="aucune">
        <p>Aucun point bloquant ni avertissement : la note peut être soumise.</p>
      </Alerte>
    );
  }
  return (
    <Alerte tonalite={controle.soumissible ? "attention" : "danger"} titre={titre} annonce="aucune">
      <p>
        {controle.soumissible
          ? "La note peut être soumise ; ces avertissements méritent un regard."
          : "La note ne peut pas être soumise tant que les points bloquants ne sont pas corrigés."}
      </p>
      <ul className="mp-dd-points-controle">
        {points.map((p) => (
          <li key={p.code}>
            <BadgeStatut tonalite={p.gravite === "bloquant" ? "danger" : "attention"}>
              {p.gravite === "bloquant" ? "Bloquant" : "Avertissement"}
            </BadgeStatut>{" "}
            {p.libelle}{" "}
            {avecLiens ? (
              <Link href={hrefEcranDossier(missionId, dossierId, p.ecran)}>Corriger</Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Alerte>
  );
}
