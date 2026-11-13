import Link from "next/link";
import {
  hrefEcranDossier,
  pointsDeControle,
  type ControleNote as ControleNoteVue,
} from "../../lib/due-diligence";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { creerTraduire } from "@missionpilot/shared";
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
export async function ControleNote({
  missionId,
  dossierId,
  controle,
  titre,
  avecLiens = true,
}: ControleNoteProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const titreBloc = titre ?? t("Avant de soumettre la note", "Before submitting the memo");
  if (!controle) {
    return (
      <Alerte tonalite="attention" titre={titreBloc} annonce="aucune">
        <p>
          {t(
            "Le contrôle de la note n'est pas disponible pour le moment.",
            "The memo check is not available at the moment.",
          )}
        </p>
      </Alerte>
    );
  }
  const points = pointsDeControle(controle, langue);
  if (points.length === 0) {
    return (
      <Alerte tonalite="succes" titre={titreBloc} annonce="aucune">
        <p>
          {t(
            "Aucun point bloquant ni avertissement : la note peut être soumise.",
            "No blocking issue or warning: the memo can be submitted.",
          )}
        </p>
      </Alerte>
    );
  }
  return (
    <Alerte
      tonalite={controle.soumissible ? "attention" : "danger"}
      titre={titreBloc}
      annonce="aucune"
    >
      <p>
        {controle.soumissible
          ? t(
              "La note peut être soumise ; ces avertissements méritent un regard.",
              "The memo can be submitted; these warnings deserve a look.",
            )
          : t(
              "La note ne peut pas être soumise tant que les points bloquants ne sont pas corrigés.",
              "The memo cannot be submitted until the blocking issues are fixed.",
            )}
      </p>
      <ul className="mp-dd-points-controle">
        {points.map((p) => (
          <li key={p.code}>
            <BadgeStatut tonalite={p.gravite === "bloquant" ? "danger" : "attention"}>
              {p.gravite === "bloquant" ? t("Bloquant", "Blocking") : t("Avertissement", "Warning")}
            </BadgeStatut>{" "}
            {p.libelle}{" "}
            {avecLiens ? (
              <Link href={hrefEcranDossier(missionId, dossierId, p.ecran)}>
                {t("Corriger", "Fix")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Alerte>
  );
}
